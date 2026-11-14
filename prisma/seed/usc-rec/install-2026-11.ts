import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { validateSchema } from "../../../src/lib/forms/schema";
import { validateGraph } from "../../../src/lib/workflow/validate";
import type { UscForm } from "./forms";
import { uscForms2026 } from "./forms-2026-11";
import { REPLACED_BY_11, RETIRED_FORMS, uscForms11 } from "./forms-11-01";
import { SCOPING_RULES_11, SCOPING_RULES_11_INTAKE01 } from "./scoping-11";
import { initialSubmission2026, M14_START, PROCESS_START, resubmission2026 } from "./workflows-2026-11";

/**
 * The November 2026 process (docs/PROCESS-UPDATE-2026-11.md) as data: form versions, workflow
 * versions and settings, all starting on PROCESS_START. Earlier versions stay published, so a
 * protocol created before that date runs to the end on the version it started with.
 */

type Db = PrismaClient | Prisma.TransactionClient;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TEMPLATE_DIR = join(process.cwd(), "templates", "2026-11");
const TEMPLATE_DIR_11 = join(process.cwd(), "templates", "11-01");

/** The forms of the November process: the 11-01 intake outputs, and the M14 versions of the other codes. */
export const processForms: { form: UscForm; dir: string }[] = [
  ...uscForms2026.filter((form) => !REPLACED_BY_11.includes(form.code)).map((form) => ({ form, dir: TEMPLATE_DIR })),
  ...uscForms11.map((form) => ({ form, dir: TEMPLATE_DIR_11 })),
];

export type InstallOptions = {
  /** When the new versions start. Defaults to PROCESS_START; tests pass their own date. */
  startsOn?: Date;
};

export async function installProcess2026(prisma: PrismaClient, ownerId: string, options: InstallOptions = {}): Promise<void> {
  const startsOn = options.startsOn ?? PROCESS_START;
  await immediateSettings(prisma);
  await moveEarlierSchedule(prisma, startsOn);
  await scheduledSettings(prisma, ownerId, startsOn);
  await feeSchedule(prisma, ownerId);
  const codes = new Set<string>();
  for (const { form, dir } of processForms) {
    await publishScheduledForm(prisma, ownerId, form, startsOn, dir);
    codes.add(form.code);
  }
  await retireReplaced(prisma, startsOn);
  await publishScheduledWorkflow(prisma, ownerId, { key: "INITIAL_SUBMISSION", name: "Initial submission", submissionType: "INITIAL", graph: initialSubmission2026, codes }, startsOn);
  await publishScheduledWorkflow(prisma, ownerId, { key: "RESUBMISSION", name: "Resubmission", submissionType: "RESUBMISSION", graph: resubmission2026, codes }, startsOn);
}

/** Billing and certificate settings are read only by the 2026 versions, so they apply at once. */
async function immediateSettings(prisma: PrismaClient): Promise<void> {
  const rows: { key: string; value: unknown; replaces?: unknown[] }[] = [
    { key: "fees.statementTitle", value: "STATEMENT OF ACCOUNT" },
    // From the billing statement template; {review} is "Expedited Review", "Full Review", "Exempt Review" or "3rd Review".
    { key: "fees.description", value: "Ethics review fee for Protocol {code}: {title} ({review})" },
    {
      key: "fees.paymentInstructions",
      value:
        'You can pay directly through the teller either in USC Downtown or Talamban Campus:\nPayment Slip: Others - IERC 100-212100-000-0568\nRemarks: Ethics Review Fee\n\nor you can pay through the following banks: BPI, BDO, Unionbank, PNB and Metrobank under "Bills Payment"\nMerchant Name/Biller Name: University of San Carlos\nReference Number: USC student ID number / 0568 (for non-USC clients)\n\nNote: Please fax the deposit slip to (+63 32) 254-7742 or email to rec@usc.edu.ph',
    },
    { key: "fees.certifiedLabel", value: "CERTIFIED CORRECT.\nREC Staff" },
    // Memo of 12 Nov 2024: 70% honorarium of reviewer, 20% REC operation, 10% administrative cost.
    { key: "fees.distribution", value: { "Reviewer honorarium": 70, "REC operation": 20, "Administrative cost": 10 } },
    // Client type from the leader's profile and the F-27 source of funds (docs/PROCESS-UPDATE-2026-11.md → Fees).
    { key: "fees.clientTypeRules", value: CLIENT_TYPE_RULES, replaces: [CLIENT_TYPE_RULES_M14] },
    { key: "fees.clientTypeFunds", value: { code: "F-27", field: "funds" } },
    // F-40: approved for one year, progress report within six months, continuing review 30 days before expiry.
    { key: "certificates.approvalPeriod", value: { amount: 1, unit: "YEARS" } },
    { key: "certificates.progressReportAfter", value: { amount: 6, unit: "MONTHS" } },
    { key: "certificates.continuingReviewBefore", value: { amount: 30, unit: "DAYS" } },
    // The 2025 process met on the second Friday with a 14-day cutoff; it stays until the 2027 schedule starts.
    { key: "meetings.schedule", value: { default: { weekday: 5, week: 2, cutoffDays: 14 } } },
    // INTAKE-01: scoping answers that mark F-35 and F-36 points N/A. Read only by 11-01 forms.
    { key: "intake.scopingRules", value: SCOPING_RULES_11, replaces: [SCOPING_RULES_11_INTAKE01] },
    // INTAKE-04: the review forms proponents and advisers may open once released, as the release copy only.
    { key: "revision.releasedForms", value: ["F-37", "F-38", "F-39", "F-40", "F-42"] },
  ];
  for (const row of rows) {
    const existing = await prisma.setting.findUnique({ where: { key: row.key } });
    if (!existing) {
      await prisma.setting.create({ data: { key: row.key, value: row.value as never } });
      continue;
    }
    // An earlier seeded value is brought up to date; a value staff changed is left alone.
    if (row.replaces?.some((old) => canonical(old) === canonical(existing.value))) {
      await prisma.setting.update({ where: { key: row.key }, data: { value: row.value as never } });
    }
  }
}

/** Juris Doctor, Bachelor of Laws, LLB; Doctor of Medicine, MD. Matched against the program or course name. */
const LAW = String.raw`\b(law|laws|juris|jd|llb)\b`;
const MEDICINE_OR_LAW = String.raw`\b(medicine|md|law|laws|juris|jd|llb)\b`;

/** First match wins. Law and medicine are read from the program or course the person typed. */
export const CLIENT_TYPE_RULES = [
  { clientTypeKey: "USC_LAW", when: { profileKind: "USC_STUDENT", programName: { matches: LAW } } },
  { clientTypeKey: "USC_LAW", when: { profileKind: "USC_STUDENT", course: { matches: LAW } } },
  { clientTypeKey: "USC_GRADUATE", when: { profileKind: "USC_STUDENT", academicLevel: "GRADUATE" } },
  { clientTypeKey: "USC_SHS_UNDERGRADUATE", when: { profileKind: "USC_STUDENT" } },
  { clientTypeKey: "EXTERNAL_MEDICINE_LAW", when: { profileKind: "EXTERNAL_STUDENT", programName: { matches: MEDICINE_OR_LAW } } },
  { clientTypeKey: "EXTERNAL_MEDICINE_LAW", when: { profileKind: "EXTERNAL_STUDENT", course: { matches: MEDICINE_OR_LAW } } },
  { clientTypeKey: "EXTERNAL_GRADUATE", when: { profileKind: "EXTERNAL_STUDENT", academicLevel: "GRADUATE" } },
  { clientTypeKey: "EXTERNAL_SHS_UNDERGRADUATE", when: { profileKind: "EXTERNAL_STUDENT" } },
  // A study funded by an institution or an outside agency counts as a research grant.
  { clientTypeKey: "USC_FACULTY_GRANT", when: { profileKind: ["USC_ACADEMIC", "USC_STAFF"], funds: ["INSTITUTION", "AGENCY"] } },
  { clientTypeKey: "USC_FACULTY_WORKLOAD", when: { profileKind: ["USC_ACADEMIC", "USC_STAFF"] } },
  { clientTypeKey: "EXTERNAL_INSTITUTION", when: { profileKind: ["EXTERNAL_ADVISER", "INDUSTRY_PARTNER"] } },
];

/** The rules M14 first seeded, replaced where a database still holds them unchanged. */
const CLIENT_TYPE_RULES_M14 = [
  { clientTypeKey: "USC_GRADUATE", when: { profileKind: "USC_STUDENT", academicLevel: "GRADUATE" } },
  { clientTypeKey: "USC_SHS_UNDERGRADUATE", when: { profileKind: "USC_STUDENT" } },
  { clientTypeKey: "EXTERNAL_GRADUATE", when: { profileKind: "EXTERNAL_STUDENT", academicLevel: "GRADUATE" } },
  { clientTypeKey: "EXTERNAL_SHS_UNDERGRADUATE", when: { profileKind: "EXTERNAL_STUDENT" } },
  { clientTypeKey: "USC_FACULTY_WORKLOAD", when: { profileKind: "USC_ACADEMIC" } },
];

/** Settings that change how the 2025 process behaves start with the new process. */
async function scheduledSettings(prisma: PrismaClient, ownerId: string, startsOn: Date): Promise<void> {
  const rows: { key: string; value: unknown }[] = [
    // 2027-001-Cruz, or 2027-001-Cruz et al for several researchers.
    { key: "protocol.codePattern", value: "{YYYY}-{###}-{LEADER_FAMILY}{ET_AL}" },
    // 2/01Jan2027, as the F-38 Word file shows. The suggested manuscript file name writes 2-01Jan2027.
    { key: "protocol.versionLabel", value: "{N}/{DDMMMYYYY}" },
    // Panel 1 meets on the first Friday, Panel 2 on the second, Panel 3 on the third.
    {
      key: "meetings.schedule",
      value: {
        default: { weekday: 5, week: 2, cutoffDays: 14 },
        panels: {
          P1: { weekday: 5, week: 1, cutoffDays: 14 },
          P2: { weekday: 5, week: 2, cutoffDays: 14 },
          P3: { weekday: 5, week: 3, cutoffDays: 14 },
        },
      },
    },
  ];
  for (const row of rows) {
    const existing = await prisma.settingSchedule.findFirst({ where: { key: row.key, effectiveFrom: startsOn, cancelledAt: null } });
    if (existing) {
      if (!existing.appliedAt && JSON.stringify(existing.value) !== JSON.stringify(row.value)) {
        await prisma.settingSchedule.update({ where: { id: existing.id }, data: { value: row.value as never } });
      }
      continue;
    }
    await prisma.settingSchedule.create({ data: { key: row.key, value: row.value as never, effectiveFrom: startsOn, createdById: ownerId } });
  }
}

/** Client types and the schedule of the memo dated 9 Dec 2025 (approved 12 Nov 2024), effective 1 Jan 2026. Amounts in centavos. */
export const CLIENT_TYPES: { key: string; label: string; expedited: number; full: number; exempt: number }[] = [
  { key: "USC_SHS_UNDERGRADUATE", label: "USC student: Senior High / Undergraduate", expedited: 1_600, full: 2_000, exempt: 800 },
  { key: "USC_LAW", label: "USC student: Law", expedited: 2_500, full: 3_000, exempt: 1_250 },
  { key: "USC_GRADUATE", label: "USC student: Graduate (free for now)", expedited: 0, full: 0, exempt: 0 },
  { key: "USC_FACULTY_WORKLOAD", label: "USC faculty/researcher with research and creative workload", expedited: 4_500, full: 5_000, exempt: 2_250 },
  { key: "USC_FACULTY_GRANT", label: "USC faculty-researcher with a research grant", expedited: 8_000, full: 15_000, exempt: 4_000 },
  { key: "EXTERNAL_SHS_UNDERGRADUATE", label: "External student: Senior High / Undergraduate", expedited: 3_000, full: 3_500, exempt: 1_500 },
  { key: "EXTERNAL_MEDICINE_LAW", label: "External student: Medicine / Law", expedited: 4_000, full: 4_500, exempt: 2_000 },
  { key: "EXTERNAL_GRADUATE", label: "External student: Graduate", expedited: 4_500, full: 5_000, exempt: 2_250 },
  { key: "EXTERNAL_INSTITUTION", label: "External faculty/institution with research grants, foundation, etc.", expedited: 15_000, full: 20_000, exempt: 7_500 },
];

export const FEE_RULES = [
  { key: "NTH_REVIEW", label: "3rd to Nth review", percent: 50, fromRound: 3 },
  { key: "AMENDMENT", label: "Protocol amendment", percent: 50, fromRound: null },
  { key: "CONTINUING", label: "Continuing review", percent: 50, fromRound: null },
];

const FEES_FROM = new Date("2026-01-01T00:00:00.000Z");
export const FEE_SCHEDULE_REF = "USC REC memo of 9 Dec 2025 (revised schedule approved 12 Nov 2024)";

/** The rate rows of the memo, for a schedule create. */
export function memoRates() {
  return CLIENT_TYPES.flatMap((type) => [
    { clientTypeKey: type.key, basis: "EXPEDITED" as const, amount: type.expedited * 100 },
    { clientTypeKey: type.key, basis: "FULL" as const, amount: type.full * 100 },
    { clientTypeKey: type.key, basis: "EXEMPT" as const, amount: type.exempt * 100 },
  ]);
}

async function feeSchedule(prisma: PrismaClient, ownerId: string): Promise<void> {
  for (const [index, type] of CLIENT_TYPES.entries()) {
    await prisma.clientType.upsert({
      where: { key: type.key },
      create: { key: type.key, label: type.label, sortOrder: index + 1 },
      update: {},
    });
  }
  // A schedule is never rewritten by the seed: once it priced a bill it is locked, and staff own later changes.
  const existing = await prisma.feeSchedule.findFirst({ where: { effectiveFrom: FEES_FROM, approvedRef: FEE_SCHEDULE_REF } });
  if (existing) return;
  await prisma.feeSchedule.create({
    data: {
      effectiveFrom: FEES_FROM,
      approvedRef: FEE_SCHEDULE_REF,
      notes: "Distribution: 70% reviewer honorarium, 20% REC operation, 10% administrative cost.",
      createdById: ownerId,
      rates: { create: memoRates() },
      rules: { create: FEE_RULES },
    },
  });
}

function mapFor(code: string, dir: string = TEMPLATE_DIR): unknown {
  const path = join(dir, "maps", `${code}.json`);
  if (!existsSync(path)) throw new Error(`${path} is missing. Run the prepare-templates script for that set.`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

/**
 * Stores the official Word template beside its form version, as the admin "replace template"
 * screen does, so each version prints with its own file. The object key is the content hash.
 */
async function templateFile(prisma: Db, ownerId: string, form: UscForm, current: string | null, dir: string = TEMPLATE_DIR): Promise<string> {
  const bytes = readFileSync(join(dir, `${form.code}.docx`));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (current) {
    const stored = await prisma.storedFile.findUnique({ where: { id: current } });
    if (stored?.sha256 === sha256) return current;
  }
  const storageKey = `templates/${form.code}/${form.version}/${sha256}.docx`;
  const { putObject } = await import("../../../src/server/storage");
  await putObject(storageKey, bytes, DOCX_MIME);
  const stored = await prisma.storedFile.create({
    data: {
      kind: "TEMPLATE",
      originalName: `${form.code}.docx`,
      suggestedName: `${form.code}.docx`,
      storageKey,
      mime: DOCX_MIME,
      size: bytes.length,
      sha256,
      uploadedById: ownerId,
      scanStatus: "CLEAN",
    },
  });
  return stored.id;
}

async function publishScheduledForm(prisma: PrismaClient, ownerId: string, form: UscForm, startsOn: Date, dir: string = TEMPLATE_DIR): Promise<void> {
  const check = validateSchema(form.schema);
  if (!check.ok) throw new Error(`${form.code} ${form.version}: ${check.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
  const map = mapFor(form.code, dir);
  const existing = await prisma.formDefinition.findUnique({ where: { code_version: { code: form.code, version: form.version } } });
  const templateFileId = await templateFile(prisma, ownerId, form, existing?.templateFileId ?? null, dir);
  if (existing) {
    // Refresh the wording of a version already published; its status stays. An unused version
    // still scheduled for another start moves to the current start.
    const unused = (await prisma.formInstance.count({ where: { formDefinitionId: existing.id } })) === 0;
    const move = unused && existing.effectiveFrom != null && existing.effectiveFrom.getTime() !== startsOn.getTime();
    await prisma.formDefinition.update({
      where: { id: existing.id },
      data: {
        title: form.title,
        schema: form.schema as never,
        placeholderMap: map as never,
        templateFileId,
        ...(existing.status === "DRAFT" ? { status: "PUBLISHED", publishedAt: new Date(), effectiveFrom: startsOn } : {}),
        ...(move ? { effectiveFrom: startsOn, effectiveAnnouncedAt: null } : {}),
      },
    });
    return;
  }
  await prisma.formDefinition.create({
    data: {
      code: form.code,
      title: form.title,
      version: form.version,
      effectiveDate: new Date(`${form.effectiveDate}T00:00:00.000Z`),
      schema: form.schema as never,
      placeholderMap: map as never,
      templateFileId,
      createdById: ownerId,
      status: "PUBLISHED",
      publishedAt: new Date(),
      effectiveFrom: startsOn,
    },
  });
}

/**
 * 11-01 replaces the M14 versions of F-26, F-27, F-28, F-30, F-35, F-36 and F-38: an unused one is
 * retired, one already in use stops being chosen for protocols created from the start. F-29 is
 * retired the same way; protocols created earlier keep it, and old copies stay readable.
 */
async function retireReplaced(prisma: PrismaClient, startsOn: Date): Promise<void> {
  const replaced = uscForms2026.filter((form) => REPLACED_BY_11.includes(form.code));
  for (const form of replaced) {
    const row = await prisma.formDefinition.findUnique({ where: { code_version: { code: form.code, version: form.version } } });
    if (!row || row.status === "RETIRED") continue;
    const used = await prisma.formInstance.count({ where: { formDefinitionId: row.id } });
    await prisma.formDefinition.update({ where: { id: row.id }, data: used === 0 ? { status: "RETIRED" } : { retiredFrom: startsOn } });
  }
  await prisma.formDefinition.updateMany({ where: { code: { in: RETIRED_FORMS }, retiredFrom: null }, data: { retiredFrom: startsOn } });
}

/**
 * M14 scheduled its versions and settings for 1 Jan 2027. Unused workflow versions and unapplied
 * settings still waiting for that date are archived or cancelled, so they do not take over from
 * the versions published for the current start. Form versions move in publishScheduledForm.
 */
async function moveEarlierSchedule(prisma: PrismaClient, startsOn: Date): Promise<void> {
  if (startsOn.getTime() === M14_START.getTime()) return;
  const stale = await prisma.workflowVersion.findMany({
    where: { status: "PUBLISHED", effectiveFrom: M14_START },
    include: { _count: { select: { instances: true } } },
  });
  for (const version of stale) {
    if (version._count.instances === 0) await prisma.workflowVersion.update({ where: { id: version.id }, data: { status: "ARCHIVED" } });
  }
  await prisma.settingSchedule.updateMany({
    where: { effectiveFrom: M14_START, appliedAt: null, cancelledAt: null },
    data: { cancelledAt: new Date() },
  });
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

/**
 * Publishes a graph to start on `startsOn` beside the version in effect now. Running the seed
 * again changes nothing when the graph is the same. A changed graph gets a new version with the
 * same start date; the earlier scheduled one is archived unless a protocol already runs on it.
 */
async function publishScheduledWorkflow(
  prisma: PrismaClient,
  ownerId: string,
  input: { key: string; name: string; submissionType: string; graph: unknown; codes: Set<string> },
  startsOn: Date,
): Promise<void> {
  const issues = validateGraph(input.graph, input.codes);
  if (issues.length > 0) throw new Error(`${input.key} (2026): ${issues[0]?.message}`);
  const definition =
    (await prisma.workflowDefinition.findUnique({ where: { key: input.key } })) ??
    (await prisma.workflowDefinition.create({ data: { key: input.key, name: input.name, submissionType: input.submissionType } }));
  const scheduled = await prisma.workflowVersion.findMany({
    where: { definitionId: definition.id, status: "PUBLISHED", effectiveFrom: startsOn },
    include: { _count: { select: { instances: true } } },
  });
  if (scheduled.some((version) => canonical(version.graph) === canonical(input.graph))) return;
  for (const version of scheduled) {
    if (version._count.instances === 0) await prisma.workflowVersion.update({ where: { id: version.id }, data: { status: "ARCHIVED" } });
  }
  const latest = await prisma.workflowVersion.aggregate({ where: { definitionId: definition.id }, _max: { number: true } });
  await prisma.workflowVersion.create({
    data: {
      definitionId: definition.id,
      number: (latest._max.number ?? 0) + 1,
      status: "PUBLISHED",
      graph: input.graph as never,
      notes: "November 2026 process (M14)",
      publishedAt: new Date(),
      publishedById: ownerId,
      effectiveFrom: startsOn,
    },
  });
}

/**
 * SEED_DEMO only: panels and members from docs/forms/2026-11/REC members.xlsx through the
 * /admin/panels importer. Staging and production import the workbook on that screen instead.
 */
export async function importDemoPanels(actorUserId: string): Promise<void> {
  const path = join(process.cwd(), "docs", "forms", "2026-11", "REC members.xlsx");
  if (!existsSync(path)) return;
  const { parseWorkbook, applyImport } = await import("../../../src/server/users/panel-import");
  const parsed = await parseWorkbook(readFileSync(path));
  await applyImport({ rows: parsed.rows, actorUserId });
}
