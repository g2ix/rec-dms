import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { AuditAction } from "@/lib/audit-log";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import { recordAuditEvent } from "@/server/audit/chain";
import { confirmRegistration, startRegistration } from "@/server/auth/register";
import { linkProviderAccount, removeSignInMethod, setPassword } from "@/server/auth/linking";
import { hashPassword } from "@/server/auth/passwords";
import { decidePendingUser } from "@/server/auth/users";
import { makeUser, STRONG_PASSWORD } from "@/server/test/users";

function concurrentUrl(): string {
  const raw = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");
  const [base, query = ""] = raw.split("?");
  const params = new URLSearchParams(query);
  params.set("connection_limit", "15");
  params.set("pool_timeout", "120");
  params.delete("pgbouncer");
  return `${base}?${params.toString()}`;
}

describe("audit chain", () => {
  it("rejects updates and deletes, and names a tampered sequence", async () => {
    const user = await makeUser({ email: "audit.chain@usc.edu.ph" });
    const row = await prisma.$transaction((tx) =>
      audit.record(tx, {
        actorUserId: user.id,
        action: "audit.probe",
        entityType: "user",
        entityId: user.id,
        diff: { status: { before: "ACTIVE", after: "ACTIVE" } },
      }),
    );

    await expect(
      prisma.auditEvent.update({ where: { id: row.id }, data: { action: "audit.changed" } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`DELETE FROM audit_events WHERE id = ${row.id}`).rejects.toThrow(/append-only/);

    const original = row.diff;
    let disabled = false;
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only`);
      disabled = true;
      await prisma.$executeRawUnsafe(
        `UPDATE audit_events SET diff = $1::jsonb WHERE id = $2`,
        JSON.stringify({ tampered: true }),
        row.id,
      );
      const broken = await audit.verifyChain();
      expect(broken.ok).toBe(false);
      if (!broken.ok) expect(broken.seq).toBe(row.seq);
    } finally {
      if (disabled) {
        await prisma.$executeRawUnsafe(
          `UPDATE audit_events SET diff = $1::jsonb WHERE id = $2`,
          JSON.stringify(original),
          row.id,
        );
        await prisma.$executeRawUnsafe(`ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only`);
      }
    }

    expect((await audit.verifyChain()).ok).toBe(true);
    const first = await prisma.auditEvent.findFirst({ orderBy: { seq: "asc" } });
    expect(first?.prevHash).toBe("GENESIS");
  });

  it("writes no audit row when the transaction rolls back", async () => {
    const user = await makeUser({ email: "audit.rollback@usc.edu.ph" });
    const before = await prisma.auditEvent.count({ where: { entityId: user.id } });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
        await audit.record(tx, {
          actorUserId: user.id,
          action: AuditAction.userSuspended,
          entityType: "user",
          entityId: user.id,
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await prisma.auditEvent.count({ where: { entityId: user.id } })).toBe(before);
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.status).toBe("ACTIVE");
  });

  it("keeps one valid chain under concurrent records", async () => {
    const client = new PrismaClient({ datasources: { db: { url: concurrentUrl() } } });
    try {
      await Promise.all(
        Array.from({ length: 100 }, (_, index) =>
          client.$transaction(
            (tx) =>
              recordAuditEvent(tx, {
                action: "audit.concurrent",
                entityType: "test",
                entityId: `concurrent-${index}`,
                meta: { index },
              }),
            { maxWait: 120_000, timeout: 30_000 },
          ),
        ),
      );
      const chain = await audit.verifyChain();
      expect(chain.ok).toBe(true);
      expect(await prisma.auditEvent.count({ where: { action: "audit.concurrent" } })).toBe(100);
    } finally {
      await client.$disconnect();
    }
  }, 120_000);

  it("records sign-up, verification, password changes, linking, and approval without secrets", async () => {
    const sent: string[] = [];
    await startRegistration(
      {
        firstName: "Liza",
        familyName: "Santos",
        email: "liza.santos@gmail.com",
        password: STRONG_PASSWORD,
      },
      { async send(message) { sent.push(message.text); } },
    );
    const started = await prisma.auditEvent.findFirstOrThrow({
      where: { action: AuditAction.signUpStarted, entityId: "liza.santos@gmail.com" },
    });
    expect(JSON.stringify({ diff: started.diff, meta: started.meta })).not.toContain("password");

    const code = sent[0]?.match(/\d{6}/)?.[0] ?? "";
    const user = await confirmRegistration("liza.santos@gmail.com", code);
    const verified = await prisma.auditEvent.findFirstOrThrow({
      where: { action: AuditAction.emailVerified, entityId: user.id },
    });
    expect(verified.diff).toMatchObject({ status: { after: "PENDING_APPROVAL" } });

    const passwordHash = await hashPassword(STRONG_PASSWORD);
    await setPassword(user.id, passwordHash);
    const passwordEvent = await prisma.auditEvent.findFirstOrThrow({
      where: { action: AuditAction.passwordSet, entityId: user.id },
    });
    expect(JSON.stringify(passwordEvent.diff)).not.toContain(passwordHash);
    expect(passwordEvent.diff).toMatchObject({ passwordHash: { after: "[redacted]" } });

    const linked = await linkProviderAccount({
      userId: user.id,
      provider: "google",
      providerAccountId: "google-liza",
      email: "liza.santos@gmail.com",
    });
    expect(linked).toEqual({ linked: true });
    expect(await prisma.auditEvent.count({ where: { action: AuditAction.identityLinked, actorUserId: user.id } })).toBe(1);

    const methods = await import("@/server/auth/linking").then((module) => module.listSignInMethods(user.id));
    await removeSignInMethod(user.id, { kind: "oauth", accountId: methods.accounts[0]!.id });
    expect(
      await prisma.auditEvent.count({ where: { action: AuditAction.identityUnlinked, actorUserId: user.id } }),
    ).toBe(1);

    const admin = await makeUser({ email: "audit.admin@usc.edu.ph" });
    await decidePendingUser({ actorUserId: admin.id, userId: user.id, decision: "approve" });
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.status).toBe("ACTIVE");
    expect(await prisma.auditEvent.findFirst({ where: { action: AuditAction.userApproved, entityId: user.id } })).toBeTruthy();

    await decidePendingUser({ actorUserId: admin.id, userId: user.id, decision: "reject" });
    const rejected = await prisma.auditEvent.findFirstOrThrow({
      where: { action: AuditAction.userRejected, entityId: user.id },
    });
    expect(rejected.diff).toMatchObject({ status: { before: "ACTIVE", after: "SUSPENDED" } });
    expect((await audit.verifyChain()).ok).toBe(true);
  });
});
