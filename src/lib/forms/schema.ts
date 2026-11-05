import { z } from "zod";
import { isKnownBinding } from "@/lib/forms/bindings";
import { parseFormula } from "@/lib/forms/compute";
import { ROLE_KEYS } from "@/lib/forms/roles";

export const FIELD_TYPES = [
  "text",
  "textarea",
  "richtext",
  "number",
  "money",
  "date",
  "email",
  "phone",
  "select",
  "radio",
  "checkboxes",
  "yesNoNa",
  "declaration",
  "repeatingTable",
  "assessmentTable",
  "signature",
  "fileRef",
  "computed",
  "staticText",
] as const;

export const COLUMN_TYPES = [
  "text",
  "textarea",
  "number",
  "money",
  "date",
  "email",
  "phone",
  "select",
  "yesNoNa",
] as const;

const CHOICE_TYPES = new Set(["select", "radio", "checkboxes"]);
const TABLE_TYPES = new Set(["repeatingTable", "assessmentTable"]);
const FILLER_OPTIONAL = new Set(["computed", "staticText", "signature", "fileRef"]);

const keySchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Start with a letter. Then use letters, numbers, or underscores.");

const rowIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_]+$/, "Use letters, numbers, or underscores. Keep dots in the code, not the id.");

export const jsonLogicSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonLogicSchema), z.record(z.string(), jsonLogicSchema)]),
);

const optionSchema = z
  .object({
    value: z.string().min(1),
    label: z.string().min(1),
  })
  .strict();

const validationSchema = z
  .object({
    required: z.boolean().optional(),
    requiredIf: jsonLogicSchema.optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
    naAllowedWithReason: z.boolean().optional(),
  })
  .strict();

const columnSchema = z
  .object({
    id: keySchema,
    label: z.string().min(1),
    type: z.enum(COLUMN_TYPES),
    fillers: z.array(z.enum(ROLE_KEYS)).min(1, "Say who fills this column."),
    options: z.array(optionSchema).optional(),
    editableInSteps: z.array(z.string().min(1)).optional(),
  })
  .strict();

const rowSchema = z
  .object({
    id: rowIdSchema,
    code: z.string().min(1),
    label: z.string().min(1),
    help: z.string().optional(),
  })
  .strict();

export const fieldSchema = z
  .object({
    id: keySchema,
    label: z.string().min(1),
    help: z.string().optional(),
    type: z.enum(FIELD_TYPES),
    options: z.array(optionSchema).optional(),
    bind: z.string().min(1).optional(),
    fillers: z.array(z.enum(ROLE_KEYS)).default([]),
    editableInSteps: z.array(z.string().min(1)).optional(),
    validation: validationSchema.optional(),
    columns: z.array(columnSchema).optional(),
    rows: z.array(rowSchema).optional(),
    formula: z.string().optional(),
  })
  .strict();

export const sectionSchema = z
  .object({
    id: keySchema,
    title: z.string().min(1),
    description: z.string().optional(),
    fields: z.array(fieldSchema),
    visibleIf: jsonLogicSchema.optional(),
  })
  .strict();

export const formSchema = z
  .object({
    sections: z.array(sectionSchema),
  })
  .strict();

export type FormSchema = z.infer<typeof formSchema>;
export type FormSection = FormSchema["sections"][number];
export type FormField = FormSection["fields"][number];
export type FormColumn = NonNullable<FormField["columns"]>[number];
export type FieldType = FormField["type"];
export type ColumnType = (typeof COLUMN_TYPES)[number];

export type SchemaIssue = { path: string; message: string };

export type SchemaCheck =
  | { ok: true; schema: FormSchema; issues: [] }
  | { ok: false; schema: FormSchema | null; issues: SchemaIssue[] };

export function eachField(schema: FormSchema): FormField[] {
  return schema.sections.flatMap((section) => section.fields);
}

export function findField(schema: FormSchema, id: string): FormField | undefined {
  return eachField(schema).find((field) => field.id === id);
}

function zodIssues(error: z.ZodError): SchemaIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "(schema)",
    message: issue.message,
  }));
}

function duplicate(ids: string[]): string | null {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}

export function validateSchema(input: unknown): SchemaCheck {
  const parsed = formSchema.safeParse(input);
  if (!parsed.success) return { ok: false, schema: null, issues: zodIssues(parsed.error) };

  const schema = parsed.data;
  const issues: SchemaIssue[] = [];
  const sectionIds = schema.sections.map((section) => section.id);
  const repeatedSection = duplicate(sectionIds);
  if (repeatedSection) {
    issues.push({ path: "sections", message: `Section id "${repeatedSection}" is used more than once.` });
  }

  const fieldIds = eachField(schema).map((field) => field.id);
  const repeatedField = duplicate(fieldIds);
  if (repeatedField) {
    issues.push({ path: repeatedField, message: `Field id "${repeatedField}" is used more than once.` });
  }

  const binds = new Map<string, string>();
  schema.sections.forEach((section, sectionIndex) => {
    section.fields.forEach((field, fieldIndex) => {
      const path = `sections.${sectionIndex}.fields.${fieldIndex}`;
      issues.push(...fieldIssues(field, path, binds));
    });
  });

  if (issues.length > 0) return { ok: false, schema, issues };
  return { ok: true, schema, issues: [] };
}

function fieldIssues(field: FormField, path: string, binds: Map<string, string>): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  if (field.bind) {
    if (field.type === "computed" || field.type === "staticText") {
      issues.push({ path: `${path}.bind`, message: "This field type cannot bind to a protocol field." });
    } else if (!isKnownBinding(field.bind)) {
      issues.push({
        path: `${path}.bind`,
        message: `"${field.bind}" is not a shared protocol field. Use one of the protocol.* paths.`,
      });
    } else if (binds.has(field.bind)) {
      issues.push({ path: `${path}.bind`, message: `${field.bind} is already bound on ${binds.get(field.bind)}.` });
    } else {
      binds.set(field.bind, field.id);
    }
  }

  if (!FILLER_OPTIONAL.has(field.type) && !field.bind && field.fillers.length === 0) {
    issues.push({ path: `${path}.fillers`, message: "Say who fills this field." });
  }

  if (field.validation?.pattern) {
    try {
      new RegExp(field.validation.pattern);
    } catch {
      issues.push({ path: `${path}.validation.pattern`, message: "That pattern is not a valid regular expression." });
    }
  }

  if (CHOICE_TYPES.has(field.type) && !(field.options && field.options.length > 0)) {
    issues.push({ path: `${path}.options`, message: "Add at least one choice." });
  }
  if (field.options && !CHOICE_TYPES.has(field.type)) {
    issues.push({ path: `${path}.options`, message: "Only select, radio, and checkboxes use options." });
  }
  const repeatedOption = duplicate((field.options ?? []).map((option) => option.value));
  if (repeatedOption) {
    issues.push({ path: `${path}.options`, message: `Choice value "${repeatedOption}" is used more than once.` });
  }

  if (field.type === "repeatingTable" && !(field.columns && field.columns.length > 0)) {
    issues.push({ path: `${path}.columns`, message: "A repeating table needs at least one column." });
  }
  if (field.type === "assessmentTable") {
    if (!(field.rows && field.rows.length > 0)) {
      issues.push({ path: `${path}.rows`, message: "An assessment table needs at least one row." });
    }
    if (!(field.columns && field.columns.length > 0)) {
      issues.push({ path: `${path}.columns`, message: "An assessment table needs at least one column." });
    }
  }
  if (!TABLE_TYPES.has(field.type) && field.columns) {
    issues.push({ path: `${path}.columns`, message: "Only tables use columns." });
  }
  if (field.type !== "assessmentTable" && field.rows) {
    issues.push({ path: `${path}.rows`, message: "Only an assessment table uses fixed rows." });
  }

  if (field.type === "computed") {
    if (!field.formula?.trim()) {
      issues.push({ path: `${path}.formula`, message: "A computed field needs a formula." });
    } else {
      try {
        parseFormula(field.formula);
      } catch (error) {
        issues.push({
          path: `${path}.formula`,
          message: error instanceof Error ? error.message : "That formula could not be read.",
        });
      }
    }
  } else if (field.formula) {
    issues.push({ path: `${path}.formula`, message: "Only a computed field uses a formula." });
  }

  const columns = field.columns ?? [];
  const repeatedColumn = duplicate(columns.map((column) => column.id));
  if (repeatedColumn) {
    issues.push({ path: `${path}.columns`, message: `Column id "${repeatedColumn}" is used more than once.` });
  }
  const repeatedRow = duplicate((field.rows ?? []).map((row) => row.id));
  if (repeatedRow) {
    issues.push({ path: `${path}.rows`, message: `Row id "${repeatedRow}" is used more than once.` });
  }

  columns.forEach((column, index) => {
    if (column.type === "select" && !(column.options && column.options.length > 0)) {
      issues.push({ path: `${path}.columns.${index}.options`, message: "Add at least one choice." });
    }
    if (column.options && column.type !== "select") {
      issues.push({ path: `${path}.columns.${index}.options`, message: "Only a select column uses options." });
    }
    if (field.fillers.length > 0) {
      const outsider = column.fillers.find((role) => !field.fillers.includes(role));
      if (outsider) {
        issues.push({
          path: `${path}.columns.${index}.fillers`,
          message: `${outsider} fills this column, so list that role on the field as well.`,
        });
      }
    }
  });

  return issues;
}
