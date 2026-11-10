import type { RoleScope } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditAction } from "@/lib/audit-log";
import { authorize } from "@/server/authz";
import { prisma } from "@/server/db";
import { makeUser } from "@/server/test/users";
import { assertMayMergeAccounts, changePanelChair, grantRole, panelOverview, revokeRole } from "@/server/users/roles";

const person = (name: string, status?: "ACTIVE" | "PENDING_APPROVAL") => {
  const suffix = crypto.randomUUID().slice(0, 8);
  return makeUser({ email: `${name}.${suffix}@usc.edu.ph`, familyName: `${name}${suffix}`, status });
};

function role(key: string, scope: RoleScope = "GLOBAL") {
  return prisma.role.upsert({ where: { key }, update: { scope }, create: { key, name: key, scope } });
}

async function hold(userId: string, key: string, panelId?: string) {
  const row = await role(key, panelId ? "PANEL" : "GLOBAL");
  return prisma.userRole.create({ data: { userId, roleId: row.id, panelId: panelId ?? null } });
}

function panel() {
  const code = `T${crypto.randomUUID().slice(0, 8)}`;
  return prisma.panel.create({ data: { code, name: `Panel ${code}` } });
}

function events(action: string, entityId: string) {
  return prisma.auditEvent.findMany({ where: { action, entityId }, orderBy: { seq: "asc" } });
}

async function bootstrapPerson() {
  const user = await person("bootstrap");
  const email = await prisma.userEmail.findFirstOrThrow({ where: { userId: user.id } });
  await prisma.userEmail.update({ where: { id: email.id }, data: { verifiedAt: new Date() } });
  vi.stubEnv("BOOTSTRAP_ADMIN_EMAILS", email.email);
  return user;
}

const forbidden = { code: "FORBIDDEN" };
const invalid = { code: "INVALID" };

beforeEach(async () => {
  await prisma.userRole.deleteMany();
  await role("PANEL_CHAIR", "PANEL");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("users.manage", () => {
  it("allows REC Staff and System Admin, and nobody else", async () => {
    const staff = await person("staff");
    const admin = await person("admin");
    const chair = await person("chair");
    const plain = await person("plain");
    await hold(staff.id, "REC_STAFF");
    await hold(admin.id, "SYSTEM_ADMIN");
    await hold(chair.id, "REC_CHAIR");

    await expect(authorize(staff, "users.manage")).resolves.toBeUndefined();
    await expect(authorize(admin, "users.manage")).resolves.toBeUndefined();
    await expect(authorize(chair, "users.manage")).rejects.toMatchObject(forbidden);
    await expect(authorize(plain, "users.manage")).rejects.toMatchObject(forbidden);
  });

  it("keeps the bootstrap admin only until a System Admin exists", async () => {
    const bootstrap = await bootstrapPerson();
    await expect(authorize(bootstrap, "users.manage")).resolves.toBeUndefined();

    const admin = await person("admin");
    const grant = await hold(admin.id, "SYSTEM_ADMIN");
    await expect(authorize(bootstrap, "users.manage")).rejects.toMatchObject(forbidden);

    await prisma.userRole.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
    await expect(authorize(bootstrap, "users.manage")).resolves.toBeUndefined();
  });

  it("restores the fallback when the only System Admin is suspended", async () => {
    const bootstrap = await bootstrapPerson();
    const admin = await person("admin");
    await hold(admin.id, "SYSTEM_ADMIN");
    await prisma.user.update({ where: { id: admin.id }, data: { status: "SUSPENDED" } });
    await expect(authorize(bootstrap, "users.manage")).resolves.toBeUndefined();
  });
});

describe("admin screen permissions", () => {
  it("allows REC Staff, REC Chair, and System Admin to view the audit log", async () => {
    const staff = await person("staff");
    const chair = await person("chair");
    const admin = await person("admin");
    const plain = await person("plain");
    await hold(staff.id, "REC_STAFF");
    await hold(chair.id, "REC_CHAIR");
    await hold(admin.id, "SYSTEM_ADMIN");

    await expect(authorize(staff, "audit.view")).resolves.toBeUndefined();
    await expect(authorize(chair, "audit.view")).resolves.toBeUndefined();
    await expect(authorize(admin, "audit.view")).resolves.toBeUndefined();
    await expect(authorize(plain, "audit.view")).rejects.toMatchObject(forbidden);
  });

  it("limits forms, workflows, and settings to System Admin", async () => {
    const staff = await person("staff");
    const chair = await person("chair");
    const admin = await person("admin");
    await hold(staff.id, "REC_STAFF");
    await hold(chair.id, "REC_CHAIR");
    await hold(admin.id, "SYSTEM_ADMIN");

    for (const action of ["forms.edit", "forms.view", "forms.fill", "workflow.edit", "workflow.view", "settings.edit", "notification.edit"] as const) {
      await expect(authorize(admin, action)).resolves.toBeUndefined();
      await expect(authorize(staff, action)).rejects.toMatchObject(forbidden);
      await expect(authorize(chair, action)).rejects.toMatchObject(forbidden);
    }
  });

  it("allows REC Staff and System Admin for holidays and retention", async () => {
    const staff = await person("staff");
    const chair = await person("chair");
    const admin = await person("admin");
    await hold(staff.id, "REC_STAFF");
    await hold(chair.id, "REC_CHAIR");
    await hold(admin.id, "SYSTEM_ADMIN");

    for (const action of ["holiday.edit", "retention.review"] as const) {
      await expect(authorize(staff, action)).resolves.toBeUndefined();
      await expect(authorize(admin, action)).resolves.toBeUndefined();
      await expect(authorize(chair, action)).rejects.toMatchObject(forbidden);
    }
  });

  it("keeps the bootstrap fallback for each admin permission until a System Admin exists", async () => {
    const bootstrap = await bootstrapPerson();
    const actions = [
      "audit.view",
      "forms.edit",
      "workflow.edit",
      "settings.edit",
      "holiday.edit",
      "retention.review",
    ] as const;

    for (const action of actions) {
      await expect(authorize(bootstrap, action)).resolves.toBeUndefined();
    }

    const admin = await person("admin");
    await hold(admin.id, "SYSTEM_ADMIN");
    for (const action of actions) {
      await expect(authorize(bootstrap, action)).rejects.toMatchObject(forbidden);
    }
  });
});

describe("granting a role", () => {
  it("grants a global role and audits it", async () => {
    const staff = await person("staff");
    const target = await person("target");
    await hold(staff.id, "REC_STAFF");
    const member = await role("REC_MEMBER");

    const grant = await grantRole({ actorUserId: staff.id, userId: target.id, roleId: member.id, panelId: null });

    expect(grant).toMatchObject({ userId: target.id, roleId: member.id, panelId: null, grantedById: staff.id, revokedAt: null });
    const [event, ...rest] = await events(AuditAction.roleGranted, target.id);
    expect(rest).toHaveLength(0);
    expect(event).toMatchObject({ action: "user.role_granted", actorUserId: staff.id, entityType: "user" });
    expect(event?.diff).toMatchObject({ role: { before: null, after: "REC_MEMBER" } });
  });

  it("needs a panel for a panel role, and records it", async () => {
    const staff = await person("staff");
    const target = await person("target");
    await hold(staff.id, "REC_STAFF");
    const chair = await role("PANEL_CHAIR", "PANEL");
    const onePanel = await panel();

    await expect(grantRole({ actorUserId: staff.id, userId: target.id, roleId: chair.id, panelId: null })).rejects.toMatchObject(invalid);
    expect(await events(AuditAction.roleGranted, target.id)).toHaveLength(0);

    const grant = await grantRole({ actorUserId: staff.id, userId: target.id, roleId: chair.id, panelId: onePanel.id });
    expect(grant.panelId).toBe(onePanel.id);
    const [event] = await events(AuditAction.roleGranted, target.id);
    expect(event?.diff).toMatchObject({ panel: { after: onePanel.code } });
  });

  it("lets only a System Admin grant System Admin", async () => {
    const staff = await person("staff");
    const admin = await person("admin");
    const target = await person("target");
    await hold(staff.id, "REC_STAFF");
    await hold(admin.id, "SYSTEM_ADMIN");
    const system = await role("SYSTEM_ADMIN");

    await expect(grantRole({ actorUserId: staff.id, userId: target.id, roleId: system.id, panelId: null })).rejects.toMatchObject(forbidden);
    await expect(grantRole({ actorUserId: staff.id, userId: staff.id, roleId: system.id, panelId: null })).rejects.toMatchObject(forbidden);
    expect(await events(AuditAction.roleGranted, target.id)).toHaveLength(0);

    await grantRole({ actorUserId: admin.id, userId: target.id, roleId: system.id, panelId: null });
    expect(await events(AuditAction.roleGranted, target.id)).toHaveLength(1);
  });

  it("lets the bootstrap admin make the first System Admin, then stops", async () => {
    const bootstrap = await bootstrapPerson();
    const system = await role("SYSTEM_ADMIN");
    const first = await person("first");
    const second = await person("second");

    await grantRole({ actorUserId: bootstrap.id, userId: first.id, roleId: system.id, panelId: null });
    await expect(grantRole({ actorUserId: bootstrap.id, userId: second.id, roleId: system.id, panelId: null })).rejects.toMatchObject(forbidden);
  });

  it("refuses someone who cannot manage users", async () => {
    const plain = await person("plain");
    const target = await person("target");
    const member = await role("REC_MEMBER");
    await expect(grantRole({ actorUserId: plain.id, userId: target.id, roleId: member.id, panelId: null })).rejects.toMatchObject(forbidden);
  });

  it("refuses a duplicate, a second chair, a protocol role, and an account that is not active", async () => {
    const staff = await person("staff");
    const target = await person("target");
    const other = await person("other");
    const pending = await person("pending", "PENDING_APPROVAL");
    await hold(staff.id, "REC_STAFF");
    const member = await role("REC_MEMBER");
    const chair = await role("PANEL_CHAIR", "PANEL");
    const adviser = await role("ADVISER", "PROTOCOL");
    const onePanel = await panel();

    await grantRole({ actorUserId: staff.id, userId: target.id, roleId: member.id, panelId: null });
    await expect(grantRole({ actorUserId: staff.id, userId: target.id, roleId: member.id, panelId: null })).rejects.toMatchObject(invalid);

    await grantRole({ actorUserId: staff.id, userId: target.id, roleId: chair.id, panelId: onePanel.id });
    await expect(grantRole({ actorUserId: staff.id, userId: other.id, roleId: chair.id, panelId: onePanel.id })).rejects.toMatchObject(invalid);

    await expect(grantRole({ actorUserId: staff.id, userId: other.id, roleId: adviser.id, panelId: null })).rejects.toMatchObject(invalid);
    await expect(grantRole({ actorUserId: staff.id, userId: pending.id, roleId: member.id, panelId: null })).rejects.toMatchObject(invalid);
  });
});

describe("revoking a role", () => {
  it("needs a reason, ends the grant, and audits the reason", async () => {
    const staff = await person("staff");
    const target = await person("target");
    await hold(staff.id, "REC_STAFF");
    const grant = await hold(target.id, "REC_MEMBER");

    await expect(revokeRole({ actorUserId: staff.id, userRoleId: grant.id, reason: "   " })).rejects.toMatchObject(invalid);
    expect((await prisma.userRole.findUniqueOrThrow({ where: { id: grant.id } })).revokedAt).toBeNull();

    await revokeRole({ actorUserId: staff.id, userRoleId: grant.id, reason: "Term ended" });

    expect((await prisma.userRole.findUniqueOrThrow({ where: { id: grant.id } })).revokedAt).not.toBeNull();
    const [event, ...rest] = await events(AuditAction.roleRevoked, target.id);
    expect(rest).toHaveLength(0);
    expect(event).toMatchObject({ action: "user.role_revoked", actorUserId: staff.id });
    expect(event?.diff).toMatchObject({ role: { before: "REC_MEMBER" }, reason: { after: "Term ended" } });

    await expect(revokeRole({ actorUserId: staff.id, userRoleId: grant.id, reason: "Again" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps System Admin out of REC Staff's reach and keeps the last one", async () => {
    const staff = await person("staff");
    const admin = await person("admin");
    const second = await person("second");
    await hold(staff.id, "REC_STAFF");
    const adminGrant = await hold(admin.id, "SYSTEM_ADMIN");

    await expect(revokeRole({ actorUserId: staff.id, userRoleId: adminGrant.id, reason: "No" })).rejects.toMatchObject(forbidden);
    await expect(revokeRole({ actorUserId: admin.id, userRoleId: adminGrant.id, reason: "Leaving" })).rejects.toMatchObject(invalid);

    await hold(second.id, "SYSTEM_ADMIN");
    await revokeRole({ actorUserId: admin.id, userRoleId: adminGrant.id, reason: "Leaving" });
    expect(await events(AuditAction.roleRevoked, admin.id)).toHaveLength(1);
  });
});

describe("panels", () => {
  it("changes the chair in one step with both audit events", async () => {
    const staff = await person("staff");
    const before = await person("before");
    const after = await person("after");
    await hold(staff.id, "REC_STAFF");
    const onePanel = await panel();
    const old = await hold(before.id, "PANEL_CHAIR", onePanel.id);

    await expect(changePanelChair({ actorUserId: staff.id, panelId: onePanel.id, newChairUserId: after.id, reason: "" })).rejects.toMatchObject(invalid);
    await expect(changePanelChair({ actorUserId: staff.id, panelId: onePanel.id, newChairUserId: before.id, reason: "Same" })).rejects.toMatchObject(invalid);

    await changePanelChair({ actorUserId: staff.id, panelId: onePanel.id, newChairUserId: after.id, reason: "New term" });

    expect((await prisma.userRole.findUniqueOrThrow({ where: { id: old.id } })).revokedAt).not.toBeNull();
    expect(await prisma.userRole.count({ where: { userId: after.id, panelId: onePanel.id, revokedAt: null } })).toBe(1);
    const [revoked] = await events(AuditAction.roleRevoked, before.id);
    expect(revoked?.diff).toMatchObject({ reason: { after: "New term" } });
    expect(await events(AuditAction.roleGranted, after.id)).toHaveLength(1);
  });

  it("assigns a first chair without a reason", async () => {
    const staff = await person("staff");
    const chair = await person("chair");
    await hold(staff.id, "REC_STAFF");
    const onePanel = await panel();
    await changePanelChair({ actorUserId: staff.id, panelId: onePanel.id, newChairUserId: chair.id, reason: "" });
    expect(await events(AuditAction.roleGranted, chair.id)).toHaveLength(1);
  });

  it("lists disciplines, the chair, and other people on the panel", async () => {
    const chair = await person("chair");
    const member = await person("member");
    const onePanel = await panel();
    await prisma.discipline.create({ data: { name: `Discipline ${onePanel.code}`, panelId: onePanel.id } });
    await hold(chair.id, "PANEL_CHAIR", onePanel.id);
    await hold(member.id, "PANEL_MEMBER", onePanel.id);

    const row = (await panelOverview()).find((item) => item.id === onePanel.id);
    expect(row?.disciplines).toEqual([`Discipline ${onePanel.code}`]);
    expect(row?.chairs.map((item) => item.userId)).toEqual([chair.id]);
    expect(row?.members.map((item) => item.userId)).toEqual([member.id]);
  });
});

describe("merging accounts", () => {
  it("does not let REC Staff take a System Admin's role through a merge", async () => {
    const staff = await person("staff");
    const admin = await person("admin");
    const plain = await person("plain");
    await hold(staff.id, "REC_STAFF");
    await hold(admin.id, "SYSTEM_ADMIN");

    await expect(assertMayMergeAccounts(staff.id, [staff.id, admin.id])).rejects.toMatchObject(forbidden);
    await expect(assertMayMergeAccounts(staff.id, [staff.id, plain.id])).resolves.toBeUndefined();
    await expect(assertMayMergeAccounts(admin.id, [admin.id, plain.id])).resolves.toBeUndefined();
  });
});
