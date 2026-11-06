import { z } from "zod";
import { ROLE_KEYS, type RoleKey } from "@/lib/forms/roles";

export const STEP_TYPES = [
  "TASK",
  "PARALLEL_TASK",
  "DECISION",
  "SIGNATURE",
  "AUTO",
  "WAIT_PROPONENT",
  "END",
] as const;

export type StepType = (typeof STEP_TYPES)[number];

export const DURATION_UNITS = ["HOURS", "CALENDAR_DAYS", "WORKING_DAYS"] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export const FILE_KINDS = [
  "MANUSCRIPT",
  "COVER_LETTER",
  "FEE_RECEIPT",
  "SUPPORTING",
  "GENERATED_DOCX",
  "GENERATED_PDF",
  "SIGNATURE_IMAGE",
  "TEMPLATE",
] as const;

export type WorkflowFileKind = (typeof FILE_KINDS)[number];

const roleKeySchema = z.enum(ROLE_KEYS);

export const assigneeRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ROLE"), role: roleKeySchema }),
  z.object({ kind: z.literal("PANEL_ROLE_OF_PROTOCOL"), role: roleKeySchema }),
  z.object({ kind: z.literal("PROTOCOL_LEADER") }),
  z.object({ kind: z.literal("PROTOCOL_PROPONENTS") }),
  z.object({ kind: z.literal("PROTOCOL_ADVISER") }),
  z.object({
    kind: z.literal("ASSIGNED_IN_STEP"),
    stepKey: z.string().min(1),
    /** `parent` reads reviewers chosen on an earlier workflow instance, such as a resubmission. */
    source: z.enum(["instance", "parent"]).optional(),
  }),
  z.object({ kind: z.literal("USER"), userId: z.string().uuid() }),
]);

export type AssigneeRule = z.infer<typeof assigneeRuleSchema>;

const durationSchema = z.object({
  amount: z.number().int().positive(),
  unit: z.enum(DURATION_UNITS),
});

export type Duration = z.infer<typeof durationSchema>;

const autoActionSchema = z.object({
  kind: z.enum(["ASSIGN_PROTOCOL_CODE", "SNAPSHOT_VERSION", "GENERATE_DOCUMENTS", "NOTIFY", "START_WORKFLOW", "PREFILL"]),
  /** onEnter runs when the step opens. onExit runs when it completes. AUTO steps run onEnter before they move on. */
  hook: z.enum(["onEnter", "onExit"]).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export type AutoAction = z.infer<typeof autoActionSchema>;

const completeWhenSchema = z.union([
  z.enum(["ALL", "ANY"]),
  z.object({ atLeast: z.number().int().positive() }),
]);

export type CompleteWhen = z.infer<typeof completeWhenSchema>;

export const stepSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(STEP_TYPES),
  assignee: assigneeRuleSchema.optional(),
  parallel: z.object({ completeWhen: completeWhenSchema }).optional(),
  outcomes: z.array(z.object({ key: z.string().min(1), label: z.string().min(1) })).optional(),
  forms: z
    .array(
      z.object({
        code: z.string().min(1),
        mode: z.enum(["FILL", "SIGN", "VIEW"]),
        perAssignee: z.boolean().optional(),
        required: z.boolean(),
      }),
    )
    .optional(),
  uploads: z.array(z.object({ kind: z.enum(FILE_KINDS), required: z.boolean() })).optional(),
  actions: z.array(autoActionSchema).optional(),
  setFields: z
    .array(
      z.object({
        path: z.enum(["protocol.reviewType", "protocol.status", "protocol.panelId"]),
        from: z.enum(["outcome", "formField"]),
        field: z.string().min(1).optional(),
      }),
    )
    .optional(),
  assignReviewers: z
    .object({
      roles: z.array(roleKeySchema).min(1),
      min: z.number().int().min(1),
      /** Omitted means the chair may add more than the minimum. */
      max: z.number().int().min(1).optional(),
    })
    .optional(),
  /** Extra facts the assignee records before the step can be completed. */
  capture: z.object({ meetingDate: z.literal(true).optional() }).optional(),
  deadline: z
    .object({
      amount: z.number().int().positive(),
      unit: z.enum(DURATION_UNITS),
      remindBefore: z.array(durationSchema).optional(),
      escalateTo: assigneeRuleSchema.optional(),
    })
    .optional(),
  statusLabel: z.string().min(1).optional(),
  /** Outcomes that cannot be chosen until the fee receipt is verified. */
  feeVerifiedOutcomes: z.array(z.string().min(1)).optional(),
  /** Extra tasks that do not advance the step, such as an extension request. */
  sideTasks: z
    .array(
      z.object({
        key: z.string().min(1),
        name: z.string().min(1),
        assignee: assigneeRuleSchema,
        outcomes: z.array(z.object({ key: z.string().min(1), label: z.string().min(1) })).min(1),
        effect: z.enum(["SET_DUE", "NONE"]).optional(),
      }),
    )
    .optional(),
  notify: z
    .object({
      onAssigned: z.string().min(1).optional(),
      onDueSoon: z.string().min(1).optional(),
      onOverdue: z.string().min(1).optional(),
      onCompleted: z.string().min(1).optional(),
      cc: z.array(assigneeRuleSchema).optional(),
    })
    .optional(),
});

export type Step = z.infer<typeof stepSchema>;

export const transitionSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  when: z.unknown().optional(),
  label: z.string().optional(),
  priority: z.number().int().optional(),
  /** Replaces the destination step's status when this transition is the one taken. */
  statusLabel: z.string().min(1).optional(),
});

export type Transition = z.infer<typeof transitionSchema>;

export const workflowGraphSchema = z.object({
  startStep: z.string().min(1),
  steps: z.array(stepSchema).min(1),
  transitions: z.array(transitionSchema),
});

export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;

export function parseGraph(input: unknown): { ok: true; graph: WorkflowGraph } | { ok: false; message: string } {
  const parsed = workflowGraphSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "The workflow graph is not valid." };
  }
  return { ok: true, graph: parsed.data };
}

export function isRoleKeyValue(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}
