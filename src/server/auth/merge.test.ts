import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import { confirmMergeStepUp, completeSelfMerge, mergeAsAdmin, assertCanAuthenticate } from "@/server/auth/merge";
import { findOrStartSelfMerge, linkProviderAccount, userForProviderAccount } from "@/server/auth/linking";
import { makeUser, STRONG_PASSWORD } from "@/server/test/users";

describe("account merge", () => {
  it("moves related rows onto the primary user and keeps a valid audit chain", async () => {
    const primary = await makeUser({
      email: "primary.faculty@usc.edu.ph",
      firstName: "Elena",
      familyName: "Torres",
      password: STRONG_PASSWORD,
    });
    const secondary = await makeUser({
      email: "secondary.student@usc.edu.ph",
      firstName: "Elena",
      familyName: "Torres",
      password: STRONG_PASSWORD,
    });
    await linkProviderAccount({
      userId: primary.id,
      provider: "google",
      providerAccountId: "google-primary",
      email: "primary.faculty@usc.edu.ph",
    });
    await linkProviderAccount({
      userId: secondary.id,
      provider: "google",
      providerAccountId: "google-secondary",
      email: "secondary.student@usc.edu.ph",
    });

    const primaryProtocol = await prisma.protocol.create({
      data: { title: "Faculty study", createdById: primary.id },
    });
    const secondaryProtocol = await prisma.protocol.create({
      data: { title: "Student study", code: "USC-REC-2026-0002", createdById: secondary.id },
    });
    await prisma.protocolMember.create({
      data: {
        protocolId: primaryProtocol.id,
        userId: primary.id,
        role: "PROPONENT",
        isLeader: true,
        contactEmailId: primary.emails[0]!.id,
        affiliationKind: "FACULTY",
        position: "Professor",
        unit: "Biology",
        institution: "University of San Carlos",
        designation: "Professor, Biology, University of San Carlos",
      },
    });
    await prisma.protocolMember.create({
      data: {
        protocolId: secondaryProtocol.id,
        userId: secondary.id,
        role: "PROPONENT",
        contactEmailId: secondary.emails[0]!.id,
        affiliationKind: "STUDENT",
        course: "MS Biology",
        yearLabel: "2nd year",
        institution: "University of San Carlos",
        designation: "MS Biology, 2nd year, University of San Carlos",
      },
    });
    const role = await prisma.role.create({
      data: { key: "REC_MEMBER_TEST", name: "REC Member", scope: "GLOBAL" },
    });
    await prisma.userRole.create({ data: { userId: secondary.id, roleId: role.id } });
    await prisma.signature.create({ data: { userId: secondary.id, imageKey: "signatures/secondary.png" } });
    await prisma.notification.create({ data: { userId: secondary.id, type: "test", payload: { ok: true } } });
    await prisma.task.create({ data: { assigneeUserId: secondary.id, title: "Read the comments" } });
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        actorUserId: secondary.id,
        action: "auth.sign_in",
        entityType: "user",
        entityId: secondary.id,
      }),
    );

    const session = await findOrStartSelfMerge(primary.id, secondary.id);
    await confirmMergeStepUp({
      sessionId: session.id,
      actorUserId: primary.id,
      side: "primary",
      password: STRONG_PASSWORD,
    });
    await confirmMergeStepUp({
      sessionId: session.id,
      actorUserId: primary.id,
      side: "secondary",
      password: STRONG_PASSWORD,
    });
    await completeSelfMerge(primary.id, session.id);

    const merged = await prisma.user.findUniqueOrThrow({ where: { id: secondary.id } });
    expect(merged.status).toBe("MERGED");
    expect(merged.mergedIntoId).toBe(primary.id);
    expect(await prisma.account.count({ where: { userId: primary.id, provider: "google" } })).toBe(2);
    expect(await prisma.userEmail.count({ where: { userId: primary.id } })).toBe(2);
    expect(await prisma.protocolMember.count({ where: { userId: primary.id } })).toBe(2);
    expect(await prisma.userRole.count({ where: { userId: primary.id } })).toBe(1);
    expect(await prisma.signature.count({ where: { userId: primary.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: primary.id } })).toBe(1);
    expect(await prisma.task.count({ where: { assigneeUserId: primary.id } })).toBe(1);
    expect(await prisma.protocol.findUnique({ where: { id: secondaryProtocol.id } })).toMatchObject({
      createdById: primary.id,
    });

    expect((await userForProviderAccount("google", "google-secondary"))?.id).toBe(primary.id);
    await expect(assertCanAuthenticate(secondary.id)).rejects.toMatchObject({ code: "SIGN_IN_BLOCKED" });

    const chain = await audit.verifyChain();
    expect(chain.ok).toBe(true);
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: "user.merged" } });
    expect(event.diff).toMatchObject({ primaryUserId: primary.id, secondaryUserId: secondary.id });
    expect(event.actorUserId).toBe(primary.id);
  });

  it("refuses a merge when the two users hold conflicting roles on the same protocol", async () => {
    const primary = await makeUser({ email: "proponent@usc.edu.ph", firstName: "Paolo", familyName: "Lim" });
    const secondary = await makeUser({ email: "reviewer@gmail.com", firstName: "Paolo", familyName: "Lim" });
    const protocol = await prisma.protocol.create({
      data: { title: "Shared river study", code: "USC-REC-2026-0044", createdById: primary.id },
    });
    await prisma.protocolMember.create({
      data: {
        protocolId: protocol.id,
        userId: primary.id,
        role: "PROPONENT",
        contactEmailId: primary.emails[0]!.id,
        affiliationKind: "STUDENT",
        course: "BS Biology",
        yearLabel: "4th year",
        institution: "University of San Carlos",
        designation: "BS Biology, 4th year, University of San Carlos",
      },
    });
    await prisma.protocolMember.create({
      data: {
        protocolId: protocol.id,
        userId: secondary.id,
        role: "PRIMARY_REVIEWER",
        contactEmailId: secondary.emails[0]!.id,
        affiliationKind: "FACULTY",
        position: "Consultant",
        unit: "Panel 3",
        institution: "University of San Carlos",
        designation: "Consultant, Panel 3, University of San Carlos",
      },
    });

    await expect(mergeAsAdmin(primary.id, primary.id, secondary.id)).rejects.toThrow(/Shared river study/);
    expect(await prisma.user.findUnique({ where: { id: secondary.id } })).toMatchObject({ status: "ACTIVE" });
    const mergedEvents = await prisma.auditEvent.findMany({ where: { action: "user.merged" } });
    expect(
      mergedEvents.some((event) => {
        const diff = event.diff as { secondaryUserId?: string };
        return diff.secondaryUserId === secondary.id;
      }),
    ).toBe(false);
  });
});
