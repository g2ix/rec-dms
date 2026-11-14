import "server-only";
import { Prisma } from "@prisma/client";
import { addDuration } from "@/lib/workflow/calendar";
import { manilaDay } from "@/lib/workflow/calendar";
import { effectiveCell } from "@/lib/forms/schema";
import { validateSchema } from "@/lib/forms/schema";
import { missingRequiredSignatures } from "@/lib/signatures/target";
import { formDefinitionForVersion } from "@/server/effective";
import { signatureMarks, toRoster } from "@/server/signatures/sign";

type Tx = Prisma.TransactionClient;

type Ctx = {
  protocolId: string;
  protocolVersionId: string;
  instanceId: string;
  stepKey: string;
};

type Row = Record<string, unknown>;

export async function prefillForm(tx: Tx, params: Record<string, unknown>, ctx: Ctx): Promise<void> {
  const strategy = typeof params.strategy === "string" ? params.strategy : "";
  if (strategy === "yesNoFromEvidence") await yesNoFromEvidence(tx, params, ctx);
  else if (strategy === "copyReviewerColumns") await copyReviewerColumns(tx, params, ctx);
  else if (strategy === "copySharedCells") await copySharedCells(tx, params, ctx);
  else if (strategy === "copyTableColumn") await copyTableColumn(tx, params, ctx);
  else if (strategy === "prepareActionSummary") await prepareActionSummary(tx, params, ctx);
  else if (strategy === "decisionLetter") await decisionLetter(tx, params, ctx);
  else if (strategy === "summaryHeader") await summaryHeader(tx, params, ctx);
}

async function yesNoFromEvidence(tx: Tx, params: Record<string, unknown>, ctx: Ctx): Promise<void> {
  const formCode = text(params.formCode);
  const field = text(params.field);
  const column = text(params.column);
  if (!formCode || !field || !column) return;
  const instance = await sharedInstance(tx, ctx.protocolVersionId, formCode);
  if (!instance) return;
  const data = record(instance.data);
  const table = record(data[field]);
  const rules = Array.isArray(params.rules) ? params.rules : [];
  let changed = false;
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") continue;
    const rowId = text((rule as Row).row);
    if (!rowId) continue;
    const present = await evidencePresent(tx, ctx, rule as Row);
    // `otherwise` ("NO" or "NA") is the suggestion when the evidence is missing; staff confirm either way.
    const otherwise = (rule as Row).otherwise === "NO" || (rule as Row).otherwise === "NA" ? ((rule as Row).otherwise as string) : null;
    if (!present && !otherwise) continue;
    const row = record(table[rowId]);
    const cell = row[column];
    const choice = cell && typeof cell === "object" && !Array.isArray(cell) ? (cell as Row).choice : null;
    if (choice === "YES" || choice === "NO" || choice === "NA") continue;
    row[column] = { choice: present ? "YES" : otherwise, reason: present ? "" : "Suggested from the submission" };
    table[rowId] = row;
    changed = true;
  }
  if (!changed) return;
  data[field] = table;
  await writeFormData(tx, instance.id, data);
}

async function evidencePresent(tx: Tx, ctx: Ctx, rule: Row): Promise<boolean> {
  if (typeof rule.upload === "string") {
    const file = await tx.storedFile.findFirst({
      where: { protocolVersionId: ctx.protocolVersionId, kind: rule.upload as never },
      select: { id: true },
    });
    return Boolean(file);
  }
  if (typeof rule.form === "string") {
    const instance = await sharedInstance(tx, ctx.protocolVersionId, rule.form);
    if (!instance) return false;
    // `signed: true`: the form counts only when every required signature is on it.
    if (rule.signed !== true) return true;
    const definition = await tx.formDefinition.findUnique({ where: { id: instance.formDefinitionId }, select: { schema: true } });
    const check = validateSchema(definition?.schema);
    if (!check.ok) return false;
    const members = toRoster(
      await tx.protocolMember.findMany({
        where: { protocolId: ctx.protocolId, status: { in: ["ACTIVE", "INVITED"] } },
        include: { user: { select: { displayName: true } } },
      }),
    );
    const marks = (await signatureMarks(tx, [instance.id])).get(instance.id) ?? [];
    return missingRequiredSignatures(check.schema, members, marks).length === 0;
  }
  if (rule.fee === "VERIFIED") {
    const fee = await tx.feeVerification.findUnique({ where: { protocolVersionId: ctx.protocolVersionId } });
    return fee?.status === "VERIFIED";
  }
  return false;
}

async function copyReviewerColumns(tx: Tx, params: Record<string, unknown>, ctx: Ctx): Promise<void> {
  const target = await sharedInstance(tx, ctx.protocolVersionId, text(params.targetForm));
  const sourceCode = text(params.sourceForm);
  const sourceField = text(params.sourceField);
  const targetField = text(params.targetField);
  if (!target || !sourceCode || !sourceField || !targetField) return;
  const sources = await instancesOf(tx, ctx.protocolVersionId, sourceCode);
  const reviewers = sources.filter((item) => item.filledByMemberId);
  const columns = pairList(params.columns);
  const flagColumn = text(params.flagColumn) || "needs_action";
  const onlyFlagged = params.onlyFlagged !== false;
  const data = record(target.data);
  const table = record(data[targetField]);
  const definition = await tx.formDefinition.findUnique({ where: { id: target.formDefinitionId } });
  const rows = rowIds(definition?.schema, targetField);
  for (const rowId of rows) {
    const flagged = reviewers.some((item) => {
      const sourceRow = record(record(record(item.data)[sourceField])[rowId]);
      return sourceRow[flagColumn] === true;
    });
    if (onlyFlagged && !flagged) continue;
    const row = record(table[rowId]);
    for (const pair of columns) {
      const parts = reviewers.map((item, index) => {
        const sourceRow = record(record(record(item.data)[sourceField])[rowId]);
        if (onlyFlagged && sourceRow[flagColumn] !== true) return "";
        const value = sourceRow[pair.from];
        const textValue = typeof value === "string" ? value.trim() : "";
        return textValue ? `Reviewer ${index + 1}: ${textValue}` : "";
      });
      const joined = parts.filter(Boolean).join("\n\n");
      if (joined && (typeof row[pair.to] !== "string" || (row[pair.to] as string).trim() === "")) {
        row[pair.to] = joined;
      }
    }
    if (flagged && row[flagColumn] !== true && row[flagColumn] !== false) {
      row[flagColumn] = true;
    }
    table[rowId] = row;
  }
  data[targetField] = table;
  await writeFormData(tx, target.id, data);
}

async function copySharedCells(tx: Tx, params: Record<string, unknown>, ctx: Ctx): Promise<void> {
  const code = text(params.formCode);
  const field = text(params.field);
  const columns = stringList(params.columns);
  if (!code || !field || columns.length === 0) return;
  const shared = await sharedInstance(tx, ctx.protocolVersionId, code);
  if (!shared) return;
  const copies = (await instancesOf(tx, ctx.protocolVersionId, code)).filter((item) => item.filledByMemberId);
  const sourceTable = record(record(shared.data)[field]);
  for (const copy of copies) {
    const data = record(copy.data);
    const table = record(data[field]);
    for (const [rowId, sourceRow] of Object.entries(sourceTable)) {
      const row = record(table[rowId]);
      const source = record(sourceRow);
      for (const column of columns) {
        if (source[column] != null && source[column] !== "") row[column] = source[column];
      }
      table[rowId] = row;
    }
    data[field] = table;
    await writeFormData(tx, copy.id, data);
  }
}

async function copyTableColumn(tx: Tx, params: Record<string, unknown>, ctx: Ctx): Promise<void> {
  const target = await sharedInstance(tx, ctx.protocolVersionId, text(params.targetForm));
  const source = await sharedInstance(tx, ctx.protocolVersionId, text(params.sourceForm));
  const targetField = text(params.targetField);
  const sourceField = text(params.sourceField);
  if (!target || !source || !targetField || !sourceField) return;
  const data = record(target.data);
  const table = record(data[targetField]);
  const sourceTable = record(record(source.data)[sourceField]);
  const flagColumn = text(params.flagColumn);
  const overrides = await overridesOf(tx, source.formDefinitionId, sourceField);
  for (const [rowId, sourceRow] of Object.entries(sourceTable)) {
    const from = record(sourceRow);
    if (flagColumn && from[flagColumn] !== true) continue;
    const row = record(table[rowId]);
    for (const pair of pairList(params.columns)) {
      const incoming = effectiveCell(from, pair.from, overrides);
      if (typeof incoming !== "string" || !incoming.trim()) continue;
      const current = row[pair.to];
      if (typeof current !== "string" || !current.trim()) row[pair.to] = incoming;
      else if (!current.includes(incoming)) row[pair.to] = `${current}\n\n${incoming}`;
    }
    if (flagColumn) row[flagColumn] = true;
    for (const column of stringList(params.clearColumns)) row[column] = "";
    table[rowId] = row;
  }
  data[targetField] = table;
  await writeFormData(tx, target.id, data);
}

/** Keep still-flagged F-38 rows (blank remarks) or, on the first revision, copy flagged F-37 points. */
async function prepareActionSummary(tx: Tx, params: Record<string, unknown>, ctx: Ctx): Promise<void> {
  const formCode = text(params.formCode) || "F-38";
  const target = await sharedInstance(tx, ctx.protocolVersionId, formCode);
  if (!target) return;
  const fields = stringList(params.fields);
  const flagColumn = text(params.flagColumn) || "needs_action";
  const clearColumns = stringList(params.clearColumns);
  const fallbackForm = text(params.fallbackForm) || "F-37";
  const data = record(target.data);
  let changed = false;
  for (const field of fields) {
    const table = record(data[field]);
    const stillOpen = Object.entries(table).filter(([, cells]) => record(cells)[flagColumn] === true);
    if (stillOpen.length > 0) {
      const next: Row = {};
      for (const [rowId, cells] of stillOpen) {
        const row = record(cells);
        for (const column of clearColumns) row[column] = "";
        row[flagColumn] = true;
        next[rowId] = row;
      }
      data[field] = next;
      changed = true;
      continue;
    }
    // A later round (the table came from the last F-38) with nothing still open keeps nothing:
    // F-37 is read only on the first resubmission, when F-38 has no rows yet (INTAKE-04).
    if (Object.keys(table).length > 0) {
      data[field] = {};
      changed = true;
      continue;
    }
    const source = await sharedInstance(tx, ctx.protocolVersionId, fallbackForm);
    if (!source) continue;
    const sourceTable = record(record(source.data)[field]);
    const overrides = await overridesOf(tx, source.formDefinitionId, field);
    const next = record(table);
    for (const [rowId, sourceRow] of Object.entries(sourceTable)) {
      const from = record(sourceRow);
      if (from[flagColumn] !== true) continue;
      const row = record(next[rowId]);
      const parts = [effectiveCell(from, "comments", overrides), effectiveCell(from, "recommendations", overrides)]
        .filter((value): value is string => typeof value === "string" && value.trim() !== "")
        .map((value) => value.trim());
      if (parts.length > 0 && (typeof row.panel_comments !== "string" || !row.panel_comments.trim())) {
        row.panel_comments = parts.join("\n\n");
      }
      row[flagColumn] = true;
      for (const column of clearColumns) row[column] = "";
      next[rowId] = row;
      changed = true;
    }
    data[field] = next;
  }
  if (changed) await writeFormData(tx, target.id, data);
}

async function summaryHeader(tx: Tx, params: Record<string, unknown>, ctx: Ctx): Promise<void> {
  const instance = await sharedInstance(tx, ctx.protocolVersionId, text(params.formCode));
  if (!instance) return;
  const fields = record(params.fields);
  const data = record(instance.data);
  const protocol = await tx.protocol.findUniqueOrThrow({ where: { id: ctx.protocolId } });
  const labels: Record<string, string> = { EXPEDITED: "Expedited", FULL: "Full", EXEMPT: "Exempt" };
  setText(data, fields.reviewType, protocol.reviewType ? labels[protocol.reviewType] ?? protocol.reviewType : "");
  setText(data, fields.reviewDate, manilaDay(new Date()));
  const task = await tx.task.findFirst({
    where: { instanceId: ctx.instanceId, stepKey: ctx.stepKey, status: { in: ["OPEN", "CLAIMED"] } },
    include: { assignee: { select: { displayName: true } } },
  });
  setText(data, fields.reviewedBy, task?.assignee?.displayName || "REC Chair");
  await writeFormData(tx, instance.id, data);
}

async function decisionLetter(tx: Tx, params: Record<string, unknown>, ctx: Ctx): Promise<void> {
  const instance = await sharedInstance(tx, ctx.protocolVersionId, text(params.formCode));
  if (!instance) return;
  const fields = record(params.fields);
  const data = record(instance.data);
  const protocol = await tx.protocol.findUniqueOrThrow({ where: { id: ctx.protocolId } });
  const protocolVersion = await tx.protocolVersion.findUnique({ where: { id: ctx.protocolVersionId } });
  const definition = await tx.workflowInstance.findUnique({
    where: { id: ctx.instanceId },
    include: { version: { include: { definition: true } } },
  });
  const tasks = await tx.task.findMany({
    where: { instanceId: ctx.instanceId, status: "COMPLETED", kind: "MAIN", outcome: { not: null } },
    orderBy: { completedAt: "desc" },
  });
  const outcomeOf = new Map<string, string>();
  for (const task of tasks) {
    if (task.stepKey && task.outcome && !outcomeOf.has(task.stepKey)) outcomeOf.set(task.stepKey, task.outcome);
  }
  const fromSteps = stringList(params.decisionFromSteps);
  const decision = fromSteps.map((key) => outcomeOf.get(key)).find((value) => value) ?? null;
  const today = manilaDay(new Date());
  const setting = await tx.setting.findUnique({ where: { key: "protocol.revisionWorkingDays" } });
  const days = typeof setting?.value === "number" ? setting.value : 30;
  const holidays = new Set((await tx.holiday.findMany({ select: { date: true } })).map((row) => manilaDay(row.date)));
  const deadline = manilaDay(addDuration(new Date(), days, "WORKING_DAYS", holidays));
  const files = await tx.storedFile.findMany({
    where: { protocolVersionId: ctx.protocolVersionId },
    orderBy: { createdAt: "asc" },
  });
  const lines = [
    "1) Protocol Review Assessment Form",
    `2) Study Protocol version ${protocolVersion?.label ?? ""}`.trim(),
    "3) Informed Consent Form Checklist",
    "4) Informed Assent / Consent Form for respondents",
    "5) Curriculum Vitae",
    ...files.map((file) => `${file.kind} ${file.originalName}`),
  ];
  setText(data, fields.reviewDate, today);
  setText(data, fields.reviewType, protocol.reviewType ?? "");
  setText(data, fields.submissionType, definition?.version.definition.key === "RESUBMISSION" ? "RESUBMISSION" : "INITIAL");
  setText(data, fields.documents, lines.join("\n"));
  setText(data, fields.decision, decision ?? "");
  if (typeof fields.deadline === "string") setText(data, fields.deadline, deadline);
  const instructions = record(params.instructions);
  if (decision && typeof instructions[decision] === "string") setText(data, fields.instructions, instructions[decision]);
  if (decision === "DISAPPROVED") {
    const formCodes = [...stringList(params.justificationForms), text(params.justificationForm)].filter(Boolean);
    for (const code of formCodes) {
      const source = await sharedInstance(tx, ctx.protocolVersionId, code);
      const justification = source ? record(source.data)[text(params.justificationField)] : "";
      if (typeof justification === "string" && justification.trim()) {
        setText(data, fields.justification, justification);
        break;
      }
    }
  }
  await writeFormData(tx, instance.id, data);
}

async function writeFormData(tx: Tx, id: string, data: Row): Promise<void> {
  await tx.$executeRaw`SELECT set_config('recdms.form_review', 'on', true)`;
  await tx.formInstance.update({ where: { id }, data: { data: data as Prisma.InputJsonValue } });
}

function setText(data: Row, key: unknown, value: string): void {
  if (typeof key !== "string" || !key) return;
  const current = data[key];
  if (typeof current === "string" && current.trim()) return;
  data[key] = value;
}

async function sharedInstance(tx: Tx, protocolVersionId: string, code: string) {
  if (!code) return null;
  const rows = await instancesOf(tx, protocolVersionId, code);
  return rows.find((row) => row.filledByMemberId == null) ?? null;
}

/** Overriding columns on a table field, read from the form definition (column.overrides). */
export async function overridesOf(tx: Tx, formDefinitionId: string, fieldId: string): Promise<Record<string, string>> {
  const definition = await tx.formDefinition.findUnique({ where: { id: formDefinitionId }, select: { schema: true } });
  const sections = (definition?.schema as { sections?: { fields?: { id?: string; columns?: { id?: string; overrides?: string }[] }[] }[] } | null)?.sections ?? [];
  const out: Record<string, string> = {};
  for (const section of sections) {
    for (const field of section.fields ?? []) {
      if (field.id !== fieldId) continue;
      for (const column of field.columns ?? []) if (column.id && column.overrides) out[column.overrides] = column.id;
    }
  }
  return out;
}

async function instancesOf(tx: Tx, protocolVersionId: string, code: string) {
  const definition = await formDefinitionForVersion(tx, code, protocolVersionId);
  if (!definition) return [];
  return tx.formInstance.findMany({
    where: { formDefinitionId: definition.id, ownerType: "PROTOCOL_VERSION", ownerId: protocolVersionId },
  });
}

function rowIds(schema: unknown, fieldId: string): string[] {
  if (!schema || typeof schema !== "object") return [];
  const sections = (schema as { sections?: { fields?: { id?: string; rows?: { id?: string }[] }[] }[] }).sections ?? [];
  for (const section of sections) {
    for (const field of section.fields ?? []) {
      if (field.id === fieldId) return (field.rows ?? []).map((row) => row.id).filter((id): id is string => Boolean(id));
    }
  }
  return [];
}

function pairList(value: unknown): { from: string; to: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const from = text((item as Row).from);
    const to = text((item as Row).to);
    return from && to ? [{ from, to }] : [];
  });
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function record(value: unknown): Row {
  if (value && typeof value === "object" && !Array.isArray(value)) return { ...(value as Row) };
  return {};
}
