/** Fee amounts are centavos. Nothing here names a client type, an amount or a percent: they come from the schedule. */

export const FEE_BASES = ["EXPEDITED", "FULL", "EXEMPT"] as const;
export type FeeBasisKey = (typeof FEE_BASES)[number];

export type ScheduleData = {
  id: string;
  effectiveFrom: Date;
  rates: { clientTypeKey: string; basis: FeeBasisKey; amount: number }[];
  rules: { key: string; label?: string; percent: number; fromRound: number | null }[];
};

export type FeeQuote = {
  amount: number;
  base: number;
  basis: FeeBasisKey;
  /** The rule applied on top of the base rate, if any. */
  rule: { key: string; label: string; percent: number } | null;
  scheduleId: string;
};

/** The schedule in effect on `day` (yyyy-MM-dd): the latest one that starts on or before it. */
export function scheduleOn<T extends { effectiveFrom: Date }>(schedules: T[], day: string): T | null {
  const sorted = schedules
    .filter((schedule) => schedule.effectiveFrom.toISOString().slice(0, 10) <= day)
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  return sorted[0] ?? null;
}

export function isFeeBasis(value: unknown): value is FeeBasisKey {
  return typeof value === "string" && (FEE_BASES as readonly string[]).includes(value);
}

/**
 * Prices one bill.
 * - `reviewType` charges the base rate for the review type.
 * - `nthReview` applies the NTH_REVIEW rule (percent of base) once the round reaches its `fromRound`;
 *   an earlier round has nothing to bill and returns null.
 * - any other key names a rule (AMENDMENT, CONTINUING, ...) applied to the base rate.
 * A missing rate for the client type returns null so staff can see the bill could not be priced.
 */
export function quoteFee(
  schedule: ScheduleData,
  input: { clientTypeKey: string; reviewType: FeeBasisKey; basis: string; round: number },
): FeeQuote | null {
  const rate = schedule.rates.find((item) => item.clientTypeKey === input.clientTypeKey && item.basis === input.reviewType);
  if (!rate) return null;
  const base = rate.amount;
  if (input.basis === "reviewType") {
    return { amount: base, base, basis: input.reviewType, rule: null, scheduleId: schedule.id };
  }
  const key = input.basis === "nthReview" ? "NTH_REVIEW" : input.basis;
  const rule = schedule.rules.find((item) => item.key === key);
  if (!rule) return null;
  if (rule.fromRound != null && input.round < rule.fromRound) return null;
  const amount = Math.round((base * rule.percent) / 100);
  return {
    amount,
    base,
    basis: input.reviewType,
    rule: { key: rule.key, label: rule.label ?? rule.key, percent: rule.percent },
    scheduleId: schedule.id,
  };
}

/** Splits an amount by the `fees.distribution` setting, e.g. { "Reviewer honorarium": 70, ... }. */
export function distribute(amount: number, shares: Record<string, number>): { label: string; percent: number; amount: number }[] {
  const entries = Object.entries(shares).filter(([, percent]) => Number.isFinite(percent) && percent > 0);
  let given = 0;
  return entries.map(([label, percent], index) => {
    const part = index === entries.length - 1 ? amount - given : Math.round((amount * percent) / 100);
    given += part;
    return { label, percent, amount: part };
  });
}

/** Fills `{code}`, `{title}`, `{review}` and any other `{key}` from `values`. */
export function fillPattern(pattern: string, values: Record<string, string>): string {
  return pattern.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? (values[key] ?? "") : match));
}

/** Ordinal label for a review round, such as "3rd Review". */
export function roundLabel(round: number): string {
  const tens = round % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : round % 10 === 1 ? "st" : round % 10 === 2 ? "nd" : round % 10 === 3 ? "rd" : "th";
  return `${round}${suffix} Review`;
}

export type BillState = "ISSUED" | "PAID_PENDING" | "PARTIALLY_PAID" | "VERIFIED" | "REJECTED" | "WAIVED";

export function billSettled(status: BillState): boolean {
  return status === "VERIFIED" || status === "WAIVED";
}

export function outstanding(bill: { amount: number; amountPaid: number; status: BillState }): number {
  if (billSettled(bill.status)) return 0;
  return Math.max(0, bill.amount - bill.amountPaid);
}
