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

const baseRuleSchema = z.discriminatedUnion("kind", [
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

export type BaseAssigneeRule = z.infer<typeof baseRuleSchema>;

/**
 * Tries each rule in order and gives the task to the first person available. A person is skipped
 * when they are a member of the protocol or have declared a conflict of interest on it.
 */
const firstAvailableSchema = z.object({
  kind: z.literal("FIRST_AVAILABLE"),
  rules: z.array(baseRuleSchema).min(1),
});

export const assigneeRuleSchema = z.union([baseRuleSchema, firstAvailableSchema]);

export type AssigneeRule = z.infer<typeof assigneeRuleSchema>;

const durationSchema = z.object({
  amount: z.number().int().positive(),
  unit: z.enum(DURATION_UNITS),
});

export type Duration = z.infer<typeof durationSchema>;

export const ACTION_KINDS = [
  "ASSIGN_PROTOCOL_CODE",
  "SNAPSHOT_VERSION",
  "GENERATE_DOCUMENTS",
  "NOTIFY",
  "START_WORKFLOW",
  "PREFILL",
  /** The frozen version becomes editable by the proponents again under the same number. params: { forms?: string[] }. */
  "REOPEN_VERSION",
  /** Creates a bill from the fee schedule in effect. params: { basis: "reviewType" | "nthReview" | a fee rule key }. */
  "ISSUE_BILL",
] as const;

const autoActionSchema = z.object({
  kind: z.enum(ACTION_KINDS),
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

const outcomeSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  /** The comment box is required when this outcome is chosen, for example a reason to decline. */
  requiresComment: z.boolean().optional(),
});

const reviewerSlotSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  eligible: z
    .object({
      roles: z.array(roleKeySchema).min(1).optional(),
      /** Attributes on the person's role grant, such as { isScientist: true }. */
      attributes: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])).optional(),
    })
    .optional(),
  /** Form codes this slot fills. */
  forms: z.array(z.string().min(1)).optional(),
});

export type ReviewerSlot = z.infer<typeof reviewerSlotSchema>;

/** A release item is a form code or "certificate:<form code>", optionally with render options. */
const releaseItemSchema = z.union([
  z.string().min(1),
  z.object({
    item: z.string().min(1),
    /** Field paths left out of the generated copy. The stored form is not changed. */
    redact: z.array(z.string().min(1)).optional(),
    /** false prints an overriding column in place of the original wherever the override is filled. */
    showOriginal: z.boolean().optional(),
  }),
]);

export type ReleaseItem = z.infer<typeof releaseItemSchema>;

const releaseSchema = z.record(
  z.string().min(1),
  z.object({
    send: z.array(releaseItemSchema).optional(),
    keep: z.array(releaseItemSchema).optional(),
  }),
);

export type ReleasePackage = z.infer<typeof releaseSchema>;

export const SET_FIELD_PATHS = ["protocol.reviewType", "protocol.status", "protocol.panelId"] as const;

export const stepSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(STEP_TYPES),
  assignee: assigneeRuleSchema.optional(),
  parallel: z.object({ completeWhen: completeWhenSchema }).optional(),
  outcomes: z.array(outcomeSchema).optional(),
  forms: z
    .array(
      z.object({
        code: z.string().min(1),
        mode: z.enum(["FILL", "SIGN", "VIEW"]),
        perAssignee: z.boolean().optional(),
        /** Only the reviewer chosen for this slot sees and fills the form. */
        slot: z.string().min(1).optional(),
        required: z.boolean(),
      }),
    )
    .optional(),
  uploads: z.array(z.object({ kind: z.enum(FILE_KINDS), required: z.boolean() })).optional(),
  actions: z.array(autoActionSchema).optional(),
  setFields: z
    .array(
      z.object({
        path: z.enum(SET_FIELD_PATHS),
        from: z.enum(["outcome", "formField", "value"]),
        field: z.string().min(1).optional(),
        /** Used with from: "value". */
        value: z.string().min(1).optional(),
        /** JSONLogic over the transition data. The field is set only when it is true. */
        when: z.unknown().optional(),
      }),
    )
    .optional(),
  assignReviewers: z
    .object({
      roles: z.array(roleKeySchema).min(1).optional(),
      min: z.number().int().min(1).optional(),
      /** Omitted means the chair may add more than the minimum. */
      max: z.number().int().min(1).optional(),
      /** When present, one reviewer is chosen per slot instead of roles / min / max. */
      slots: z.array(reviewerSlotSchema).min(1).optional(),
    })
    .refine((value) => Boolean(value.slots?.length) || (Boolean(value.roles?.length) && value.min != null), {
      message: "A reviewer step needs slots, or roles and a minimum.",
    })
    .optional(),
  /** Extra facts the assignee records before the step can be completed. */
  capture: z
    .object({
      meetingDate: z.literal(true).optional(),
      /** Text shown on the reviewers' tasks and in their assignment email. */
      noteToReviewers: z.literal(true).optional(),
      /** yyyy-MM-dd shown on the reviewers' tasks and in their assignment email. */
      reviewDueDate: z.literal(true).optional(),
    })
    .optional(),
  deadline: z
    .object({
      amount: z.number().int().positive(),
      unit: z.enum(DURATION_UNITS),
      remindBefore: z.array(durationSchema).optional(),
      escalateTo: assigneeRuleSchema.optional(),
    })
    .optional(),
  /** When the deadline passes on an open task, the SLA scan completes it with this outcome as the system. */
  onTimeout: z.object({ outcome: z.string().min(1) }).optional(),
  /**
   * A reviewer who picks this outcome declines the designation. A re-designation task opens for
   * `redesignateBy`; it replaces only that reviewer's slot.
   */
  decline: z
    .object({
      outcome: z.string().min(1),
      redesignateBy: assigneeRuleSchema,
      name: z.string().min(1).optional(),
    })
    .optional(),
  statusLabel: z.string().min(1).optional(),
  /** Outcomes that cannot be chosen until the fee receipt, or this round's bill, is verified. */
  feeVerifiedOutcomes: z.array(z.string().min(1)).optional(),
  /** REC Staff may still choose a fee-checked outcome after typing a reason. Audited as fee.release_override. */
  feeOverride: z.boolean().optional(),
  /** Which documents go to proponents and advisers (send) and which are only filed (keep), per decision. */
  release: releaseSchema.optional(),
  /** Extra tasks that do not advance the step, such as an extension request. */
  sideTasks: z
    .array(
      z.object({
        key: z.string().min(1),
        name: z.string().min(1),
        assignee: assigneeRuleSchema,
        outcomes: z.array(outcomeSchema).min(1),
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
  /** Template sent to the project leader when this transition is taken, such as a return. */
  notify: z.string().min(1).optional(),
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

/** The rules a step's assignee falls back through, in order. */
export function ruleChain(rule: AssigneeRule): BaseAssigneeRule[] {
  return rule.kind === "FIRST_AVAILABLE" ? rule.rules : [rule];
}

/** True when a person can be swapped out of the step after declaring a conflict of interest. */
export function stepAllowsConflict(step: Step): boolean {
  return step.assignee?.kind === "FIRST_AVAILABLE" || Boolean(step.decline) || step.assignee?.kind === "ASSIGNED_IN_STEP";
}

export function releaseItemKey(item: ReleaseItem): string {
  return typeof item === "string" ? item : item.item;
}

export function slotsOf(step: Step | undefined): ReviewerSlot[] {
  return step?.assignReviewers?.slots ?? [];
}

export function isRoleKeyValue(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}
