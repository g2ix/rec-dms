import { hash } from "@node-rs/argon2";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { defaultFileNameSetting } from "../../../src/lib/docs/names";
import { validateSchema } from "../../../src/lib/forms/schema";
import { validateGraph } from "../../../src/lib/workflow/validate";
import { uscForms } from "./forms";
import { initialSubmission, resubmission } from "./workflows";

const DEMO_PASSWORD = "Usc-ethics-review-2026-protocol";
const HASH = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export async function installUscRec(prisma: PrismaClient): Promise<void> {
  const ownerId = await owner(prisma);
  await settings(prisma);
  const codes = new Set<string>();
  for (const form of uscForms) {
    const check = validateSchema(form.schema);
    if (!check.ok) {
      throw new Error(`${form.code}: ${check.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    }
    await publishForm(prisma, ownerId, form, formMap(form.code));
    codes.add(form.code);
  }
  await publishWorkflow(prisma, ownerId, {
    key: "INITIAL_SUBMISSION",
    name: "Initial submission",
    submissionType: "INITIAL",
    graph: initialSubmission,
    codes,
  });
  await publishWorkflow(prisma, ownerId, {
    key: "RESUBMISSION",
    name: "Resubmission",
    submissionType: "RESUBMISSION",
    graph: resubmission,
    codes,
  });
  if (process.env.SEED_DEMO === "true") await demo(prisma, ownerId);
}

async function owner(prisma: PrismaClient): Promise<string> {
  const emails = (process.env.BOOTSTRAP_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const preferred = emails[0];
  if (preferred) {
    const existing = await prisma.userEmail.findUnique({ where: { email: preferred } });
    if (existing?.userId) return existing.userId;
  }
  const seedEmail = "seed@rec-dms.local";
  const found = await prisma.userEmail.findUnique({ where: { email: seedEmail } });
  if (found?.userId) return found.userId;
  const verifiedAt = new Date();
  const user = await prisma.user.create({
    data: {
      firstName: "Seed",
      familyName: "Owner",
      displayName: "Seed Owner",
      name: "Seed Owner",
      email: seedEmail,
      emailVerified: verifiedAt,
      status: "ACTIVE",
      approvedAt: verifiedAt,
      emails: { create: { email: seedEmail, verifiedAt, isContact: true, isPrimary: true } },
    },
    include: { emails: true },
  });
  await prisma.user.update({ where: { id: user.id }, data: { primaryEmailId: user.emails[0]?.id } });
  return user.id;
}

async function settings(prisma: PrismaClient): Promise<void> {
  const rows: { key: string; value: unknown }[] = [
    { key: "protocol.codePattern", value: "USC-REC-{YYYY}-{####}" },
    { key: "protocol.revisionWorkingDays", value: 30 },
    {
      key: "rec.contact",
      value: {
        office: "USC REC SECRETARIAT",
        institution: "University of San Carlos",
        address: "Nasipit, Talamban, Cebu City",
        phone: "(032) 401 2300 loc. 204",
        email: "rec@usc.edu.ph",
      },
    },
    {
      key: "protocol.panelDisciplines",
      value: {
        P1: ["Management", "Education", "Political Science", "Law", "Economics", "Accountancy"],
        P2: ["Engineering", "Architecture", "Fine Arts", "Psychology", "SoAn", "Other social sciences"],
        P3: ["Natural Sciences", "Health Sciences"],
      },
    },
    { key: "docs.fileNamePattern", value: defaultFileNameSetting() },
  ];
  for (const row of rows) {
    await prisma.setting.upsert({
      where: { key: row.key },
      create: { key: row.key, value: row.value as never },
      update: {},
    });
  }
}

function canonical(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
}

function formMap(code: string): unknown {
  const path = join(process.cwd(), "templates", "maps", `${code}.json`);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

async function publishForm(
  prisma: PrismaClient,
  userId: string,
  form: (typeof uscForms)[number],
  map: unknown,
): Promise<void> {
  const existing = await prisma.formDefinition.findUnique({
    where: { code_version: { code: form.code, version: form.version } },
  });
  if (existing?.status === "PUBLISHED") {
    await prisma.formDefinition.update({
      where: { id: existing.id },
      data: { title: form.title, schema: form.schema as never, placeholderMap: map as never },
    });
    return;
  }
  const row =
    existing ??
    (await prisma.formDefinition.create({
      data: {
        code: form.code,
        title: form.title,
        version: form.version,
        effectiveDate: new Date(`${form.effectiveDate}T00:00:00.000Z`),
        schema: form.schema as never,
        placeholderMap: map as never,
        createdById: userId,
      },
    }));
  if (row.status !== "PUBLISHED") {
    await prisma.formDefinition.update({
      where: { id: row.id },
      data: { status: "PUBLISHED", publishedAt: new Date(), schema: form.schema as never, placeholderMap: map as never },
    });
  }
}

async function publishWorkflow(
  prisma: PrismaClient,
  userId: string,
  input: { key: string; name: string; submissionType: string; graph: unknown; codes: Set<string> },
): Promise<void> {
  const issues = validateGraph(input.graph, input.codes);
  if (issues.length > 0) throw new Error(`${input.key}: ${issues[0]?.message}`);
  let definition = await prisma.workflowDefinition.findUnique({ where: { key: input.key } });
  if (!definition) {
    definition = await prisma.workflowDefinition.create({
      data: { key: input.key, name: input.name, submissionType: input.submissionType },
    });
  }
  const published = await prisma.workflowVersion.findFirst({
    where: { definitionId: definition.id, status: "PUBLISHED" },
  });
  if (published && canonical(published.graph) === canonical(input.graph)) return;
  const latest = await prisma.workflowVersion.findFirst({
    where: { definitionId: definition.id },
    orderBy: { number: "desc" },
  });
  if (published) {
    await prisma.workflowVersion.update({ where: { id: published.id }, data: { status: "ARCHIVED" } });
  }
  const reusable =
    latest && latest.status === "DRAFT"
      ? latest
      : await prisma.workflowVersion.create({
          data: {
            definitionId: definition.id,
            number: (latest?.number ?? 0) + 1,
            status: "DRAFT",
            graph: input.graph as never,
          },
        });
  await prisma.workflowVersion.update({
    where: { id: reusable.id },
    data: { graph: input.graph as never, status: "PUBLISHED", publishedAt: new Date(), publishedById: userId },
  });
}

async function demo(prisma: PrismaClient, grantedById: string): Promise<void> {
  const panel = await prisma.panel.findUnique({ where: { code: "P1" } });
  const people = [
    ["proponent", "REC", "Proponent", null],
    ["adviser", "REC", "Adviser", "ADVISER"],
    ["staff", "REC", "Staff", "REC_STAFF"],
    ["chair", "Panel", "Chair", "PANEL_CHAIR"],
    ["rec-chair", "REC", "Chair", "REC_CHAIR"],
    ["secretary", "Member", "Secretary", "MEMBER_SECRETARY"],
    ["reviewer", "Primary", "Reviewer", "PRIMARY_REVIEWER"],
    ["consultant", "Independent", "Consultant", "INDEPENDENT_CONSULTANT"],
  ] as const;
  const ids: Record<string, string> = {};
  for (const [key, firstName, familyName, role] of people) {
    const email = `${key}.demo@usc.edu.ph`;
    ids[key] = await demoUser(prisma, { email, firstName, familyName, role, panelId: role === "PANEL_CHAIR" ? panel?.id ?? null : null, grantedById });
  }
  const discipline = await prisma.discipline.findUnique({ where: { name: "Management" } });
  await demoProtocol(prisma, {
    title: "Expedited sample protocol",
    leaderId: ids.proponent!,
    adviserId: ids.adviser!,
    disciplineId: discipline?.id ?? null,
    panelId: panel?.id ?? null,
  });
  await demoProtocol(prisma, {
    title: "Full review sample protocol",
    leaderId: ids.proponent!,
    adviserId: ids.adviser!,
    disciplineId: discipline?.id ?? null,
    panelId: panel?.id ?? null,
  });
}

async function demoUser(
  prisma: PrismaClient,
  input: { email: string; firstName: string; familyName: string; role: string | null; panelId: string | null; grantedById: string },
): Promise<string> {
  const existing = await prisma.userEmail.findUnique({ where: { email: input.email } });
  let userId = existing?.userId;
  if (!userId) {
    const verifiedAt = new Date();
    const passwordHash = await hash(DEMO_PASSWORD, HASH);
    const name = `${input.firstName} ${input.familyName}`;
    const user = await prisma.user.create({
      data: {
        firstName: input.firstName,
        familyName: input.familyName,
        displayName: name,
        name,
        email: input.email,
        emailVerified: verifiedAt,
        status: "ACTIVE",
        approvedAt: verifiedAt,
        passwordHash,
        emails: { create: { email: input.email, verifiedAt, isContact: true, isPrimary: true } },
      },
      include: { emails: true },
    });
    await prisma.user.update({ where: { id: user.id }, data: { primaryEmailId: user.emails[0]?.id } });
    userId = user.id;
  }
  if (input.role) {
    const role = await prisma.role.upsert({
      where: { key: input.role },
      update: {},
      create: { key: input.role, name: input.role, scope: input.panelId ? "PANEL" : "GLOBAL" },
    });
    const grant = await prisma.userRole.findFirst({ where: { userId, roleId: role.id, revokedAt: null } });
    if (!grant) {
      await prisma.userRole.create({
        data: { userId, roleId: role.id, panelId: input.panelId, grantedById: input.grantedById },
      });
    }
  }
  return userId;
}

async function demoProtocol(
  prisma: PrismaClient,
  input: { title: string; leaderId: string; adviserId: string; disciplineId: string | null; panelId: string | null },
): Promise<void> {
  const existing = await prisma.protocol.findFirst({ where: { title: input.title, leaderUserId: input.leaderId } });
  if (existing) return;
  const protocol = await prisma.protocol.create({
    data: {
      title: input.title,
      leaderUserId: input.leaderId,
      createdById: input.leaderId,
      disciplineId: input.disciplineId,
      panelId: input.panelId,
      institution: "University of San Carlos",
      institutionAddress: "Nasipit, Talamban, Cebu City",
      researchType: "Basic research",
      status: "Draft",
      members: {
        create: [
          {
            userId: input.leaderId,
            role: "PROPONENT",
            isLeader: true,
            rosterOrder: 1,
            status: "ACTIVE",
            institution: "University of San Carlos",
            designation: "Researcher",
          },
          {
            userId: input.adviserId,
            role: "ADVISER",
            rosterOrder: 2,
            status: "ACTIVE",
            institution: "University of San Carlos",
            designation: "Adviser",
          },
        ],
      },
      versions: { create: { number: 1, label: "1/06Nov2026", state: "WORKING" } },
    },
    include: { versions: true },
  });
  const version = protocol.versions[0];
  const form = await prisma.formDefinition.findFirst({ where: { code: "F-35", status: "PUBLISHED" } });
  if (version && form) {
    await prisma.formInstance.create({
      data: {
        formDefinitionId: form.id,
        ownerType: "PROTOCOL_VERSION",
        ownerId: version.id,
        status: "DRAFT",
        data: {},
      },
    });
  }
}
