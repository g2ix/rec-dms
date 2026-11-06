import type { ReviewType } from "@prisma/client";

/**
 * Time limits from the USC REC tracks.
 * Expedited is 28 calendar days. Full review is 7 weeks (49 calendar days).
 * Exempt is the 2 + 2 + 5 day track (9 calendar days).
 * The clock starts when staff screening is completed.
 */
export const TURNAROUND_LIMIT_DAYS: Record<ReviewType, number> = {
  EXPEDITED: 28,
  FULL: 7 * 7,
  EXEMPT: 2 + 2 + 5,
};

export const REVIEW_TYPES = ["EXEMPT", "EXPEDITED", "FULL"] as const satisfies readonly ReviewType[];

export type TurnaroundSample = {
  reviewType: ReviewType;
  days: number;
};

export type TurnaroundSummary = {
  reviewType: ReviewType;
  limitDays: number;
  count: number;
  medianDays: number | null;
  p90Days: number | null;
  withinLimit: number;
};

/** Even counts use the mean of the two middle values. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const left = sorted[mid - 1];
  const right = sorted[mid];
  if (left === undefined || right === undefined) return null;
  return (left + right) / 2;
}

/**
 * Nearest-rank percentile. Rank is ceil(p/100 * n), 1-based, clamped to the sample.
 * The 90th percentile of 10 sorted values is the 9th.
 */
export function nearestRank(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((percentile / 100) * sorted.length);
  const index = Math.min(sorted.length, Math.max(1, rank)) - 1;
  return sorted[index] ?? null;
}

export function withinLimit(days: number, reviewType: ReviewType): boolean {
  return days <= TURNAROUND_LIMIT_DAYS[reviewType];
}

export function summarizeTurnaround(samples: TurnaroundSample[]): TurnaroundSummary[] {
  return REVIEW_TYPES.map((reviewType) => {
    const days = samples.filter((sample) => sample.reviewType === reviewType).map((sample) => sample.days);
    return {
      reviewType,
      limitDays: TURNAROUND_LIMIT_DAYS[reviewType],
      count: days.length,
      medianDays: median(days),
      p90Days: nearestRank(days, 90),
      withinLimit: days.filter((value) => withinLimit(value, reviewType)).length,
    };
  });
}
