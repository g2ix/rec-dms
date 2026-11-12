import { z } from "zod";
import { jsonLogicSchema } from "@/lib/forms/schema";
import { logicIsTrue } from "@/lib/forms/logic";
import type { Scoping } from "@/lib/intake/model";

/**
 * Scoping rules mark assessment points N/A from the proponent's scoping answers. The rules are
 * data (the `intake.scopingRules` setting, seeded from prisma/seed/usc-rec/scoping-11.ts), not
 * code: each names a JSONLogic condition over `{ scoping }`, the points it covers, and the reason
 * shown to reviewers as "N/A (proponent: …)".
 */

export const scopingRuleSchema = z
  .object({
    id: z.string().min(1),
    when: jsonLogicSchema,
    form: z.string().min(1),
    /** The point codes this rule marks N/A. */
    codes: z.array(z.string().min(1)).optional(),
    /** Or every point of the form except these. */
    allExcept: z.array(z.string().min(1)).optional(),
    reason: z.string().min(1),
  })
  .strict()
  .refine((rule) => Boolean(rule.codes?.length) !== Boolean(rule.allExcept), {
    message: "A rule lists codes or allExcept, not both.",
  });
export type ScopingRule = z.infer<typeof scopingRuleSchema>;
export const scopingRulesSchema = z.array(scopingRuleSchema);

export function readScopingRules(value: unknown): ScopingRule[] {
  const parsed = scopingRulesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** N/A points of one form, keyed by point code, with every reason that applies. */
export type NotApplicable = Record<string, string[]>;

/**
 * Evaluates the rules for one form. `codes` is the form's full list of point codes, used by
 * `allExcept` rules. A point is N/A when any rule covering it holds.
 */
export function notApplicablePoints(rules: readonly ScopingRule[], scoping: Scoping, form: string, codes: readonly string[]): NotApplicable {
  const out: NotApplicable = {};
  for (const rule of rules) {
    if (rule.form !== form) continue;
    if (!logicIsTrue(rule.when, { scoping })) continue;
    const covered = rule.codes ?? codes.filter((code) => !(rule.allExcept ?? []).includes(code));
    for (const code of covered) {
      if (!codes.includes(code)) continue;
      const reasons = out[code] ?? [];
      const reason = reasonText(rule.reason, scoping);
      if (!reasons.includes(reason)) reasons.push(reason);
      out[code] = reasons;
    }
  }
  return out;
}

/** `{waiverReason}` in a reason is replaced with the proponent's own words. */
function reasonText(reason: string, scoping: Scoping): string {
  const waiver = scoping.waiverReason?.trim() ?? "";
  return reason.replace("{waiverReason}", waiver || "no reason given").trim();
}

export function naLabel(reasons: readonly string[] | undefined): string {
  if (!reasons || reasons.length === 0) return "";
  return `N/A (proponent: ${reasons.join("; ")})`;
}
