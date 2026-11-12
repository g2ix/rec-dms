import "server-only";
import type { Prisma } from "@prisma/client";
import { overlayBound } from "@/lib/forms/bound";
import { validateSchema, type FormSchema } from "@/lib/forms/schema";
import {
  BUDGET_SECTIONS,
  formatReference,
  lineTotal,
  readIntake,
  type BudgetLine,
  type IntakeValues,
} from "@/lib/intake/model";
import { notApplicablePoints, readScopingRules, type ScopingRule } from "@/lib/intake/scoping";
import { prisma } from "@/server/db";
import { formDefinitionForVersion, settingValue } from "@/server/effective";
import { sharedSnapshot, studyBindings } from "@/server/protocols/snapshot";

type Db = Prisma.TransactionClient | typeof prisma;

export const SCOPING_RULES_SETTING = "intake.scopingRules";

export async function scopingRules(db: Db): Promise<ScopingRule[]> {
  return readScopingRules(await settingValue(db, SCOPING_RULES_SETTING));
}

/** Point codes of every assessment table on a form schema. */
export function pointCodes(schema: FormSchema): string[] {
  return schema.sections.flatMap((section) =>
    section.fields.flatMap((field) => (field.type === "assessmentTable" ? (field.rows ?? []).map((row) => row.code) : [])),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** F-30 rows in the shape the budget print helpers read. */
/** F-30 rows in the shape the budget print helpers read. The Ethics Review Fee is the last MOOE row (`_fee`). */
function budgetRows(lines: BudgetLine[], section: string) {
  const row = (line: BudgetLine) => ({
    _rowId: line.id,
    particular: line.fee ? "Ethics Review Fee" : line.item,
    personal: line.personal ?? null,
    external: line.external ?? null,
    internal: line.internal ?? null,
    total: lineTotal(line),
    ...(line.fee ? { _fee: true } : {}),
  });
  const items = lines.filter((line) => line.section === section && !line.fee).map(row);
  const fee = section === "MOOE" ? lines.find((line) => line.fee) : undefined;
  return fee ? [...items, row(fee)] : items;
}

type Researcher = { memberId: string; userId: string | null; name: string; declarationsAt: string | null; consentsAt: string | null };

/** intake.*, team.* and system.* for a version, plus the N/A map the scoping rules give. */
export function intakeBindings(input: {
  intake: IntakeValues;
  researchers: Researcher[];
  reviewType: string | null;
  fundingDetail: Record<string, string>;
  na: Record<string, Record<string, string[]>>;
}): Record<string, unknown> {
  const { intake } = input;
  const references: Record<string, string> = {};
  for (const [code, reference] of Object.entries(intake.references)) {
    const text = formatReference(reference);
    if (text) references[code] = text;
  }
  const everyone = (key: "declarationsAt" | "consentsAt") =>
    input.researchers.length > 0 && input.researchers.every((researcher) => Boolean(researcher[key]));
  const out: Record<string, unknown> = {
    "intake.coi.kind": intake.coi.kind ?? null,
    "intake.coi.text": intake.coi.kind === "SPECIFY" ? (intake.coi.text ?? "") : "",
    "intake.scoping.consentNeeded": intake.scoping.consentNeeded ?? null,
    "intake.scoping.waiverReason": intake.scoping.consentNeeded === false ? (intake.scoping.waiverReason ?? "") : "",
    "intake.declarations": everyone("declarationsAt"),
    "intake.consents": everyone("consentsAt"),
    "intake.references": references,
    "intake.actions": { ...intake.actions },
    "intake.na": input.na,
    "intake.budget.externalSource": [input.fundingDetail.AGENCY, input.fundingDetail.OTHER].filter(Boolean).join("; "),
    "team.researchers": input.researchers,
    "system.reviewType": input.reviewType,
  };
  for (const section of BUDGET_SECTIONS) out[`intake.budget.${section}`] = budgetRows(intake.budgetLines, section);
  return out;
}

/**
 * Every value a form of this version can bind: the Details page (frozen with the version once
 * submitted), the intake, the roster with each researcher's agreements, and the review type.
 */
export async function versionBoundValues(db: Db, versionId: string): Promise<Record<string, unknown>> {
  const version = await db.protocolVersion.findUnique({
    where: { id: versionId },
    include: {
      protocol: { include: { members: { include: { user: true, contactEmail: true } } } },
      intake: { include: { agreements: true } },
    },
  });
  if (!version) return {};
  const live = sharedSnapshot(version.protocol, version.label, version.submittedAt);
  const frozen = version.state === "SUBMITTED" && isRecord(version.snapshot) ? (version.snapshot as Record<string, unknown>) : null;
  // A version submitted before the intake existed has the study details without the protocol.* keys.
  const study = frozen && !("protocol.fundingCodes" in frozen)
    ? studyBindings({
        researchTypeCodes: Array.isArray(frozen.researchTypeCodes) ? frozen.researchTypeCodes.map(String) : [],
        researchTypeOther: typeof frozen.researchTypeOther === "string" ? frozen.researchTypeOther : "",
        durationMonths: typeof frozen.durationMonths === "number" ? frozen.durationMonths : null,
        expectedParticipants: typeof frozen.expectedParticipants === "number" ? frozen.expectedParticipants : null,
        studySite: typeof frozen.studySite === "string" ? frozen.studySite : "",
        fundingSources: (frozen.fundingSources ?? []) as Prisma.JsonValue,
      })
    : {};
  const base: Record<string, unknown> = frozen ? { ...frozen, ...study } : { ...live };

  const intake = readIntake(version.intake);
  const agreements = version.intake?.agreements ?? [];
  const researchers = version.protocol.members
    .filter((member) => member.role === "PROPONENT" && member.status === "ACTIVE" && member.user)
    .sort((a, b) => a.rosterOrder - b.rosterOrder)
    .map((member) => {
      const agreed = (kind: "DECLARATIONS" | "F28_CONSENT") =>
        agreements.find((item) => item.memberId === member.id && item.kind === kind)?.agreedAt.toISOString() ?? null;
      return {
        memberId: member.id,
        userId: member.userId,
        name: member.user?.displayName ?? "",
        declarationsAt: agreed("DECLARATIONS"),
        consentsAt: agreed("F28_CONSENT"),
      };
    });
  const names = Array.isArray(base["protocol.researchers"]) ? (base["protocol.researchers"] as unknown[]).map(String) : [];
  researchers.forEach((researcher, index) => {
    // Print the formal name the header uses.
    if (names[index]) researcher.name = names[index]!;
  });

  const rules = await scopingRules(db);
  const na: Record<string, Record<string, string[]>> = {};
  for (const form of new Set(rules.map((rule) => rule.form))) {
    const definition = await formDefinitionForVersion(db, form, versionId);
    const check = definition ? validateSchema(definition.schema) : null;
    if (!check?.ok || check.schema.source !== "intake") continue;
    na[form] = notApplicablePoints(rules, intake.scoping, form, pointCodes(check.schema));
  }

  const fundingDetail = {
    AGENCY: String(base["protocol.fundingDetail.AGENCY"] ?? ""),
    OTHER: String(base["protocol.fundingDetail.OTHER"] ?? ""),
  };
  return {
    ...base,
    ...intakeBindings({ intake, researchers, reviewType: version.protocol.reviewType, fundingDetail, na }),
  };
}

/** The data a form copy prints and is signed with: the stored copy plus its bound values. */
export async function effectiveFormData(
  db: Db,
  instance: { ownerType: string; ownerId: string; data: unknown; formDefinition: { code: string; schema: unknown } },
  bound?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const data = isRecord(instance.data) ? instance.data : {};
  const check = validateSchema(instance.formDefinition.schema);
  if (!check.ok || check.schema.source !== "intake" || instance.ownerType !== "PROTOCOL_VERSION") return data;
  const values = bound ?? (await versionBoundValues(db, instance.ownerId));
  return overlayBound(check.schema, data, values, instance.formDefinition.code);
}
