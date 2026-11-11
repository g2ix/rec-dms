import { shiftCivilDay } from "@/lib/reports/days";

/**
 * Dates printed on certificates, computed from the release date (yyyy-MM-dd) with settings:
 * - `certificates.approvalPeriod`: how long approval lasts, e.g. { "amount": 1, "unit": "YEARS" }
 * - `certificates.progressReportAfter`: when the progress report is due, e.g. { "amount": 6, "unit": "MONTHS" }
 * - `certificates.continuingReviewBefore`: how long before expiry the continuing review is due, e.g. { "amount": 30, "unit": "DAYS" }
 */
export type Period = { amount: number; unit: "DAYS" | "MONTHS" | "YEARS" };

export function parsePeriod(value: unknown): Period | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Number.isInteger(raw.amount) || (raw.amount as number) < 0) return null;
  if (raw.unit !== "DAYS" && raw.unit !== "MONTHS" && raw.unit !== "YEARS") return null;
  return { amount: raw.amount as number, unit: raw.unit };
}

function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const total = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  const last = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(Math.min(date, last)).padStart(2, "0")}`;
}

export function addPeriod(day: string, period: Period, sign: 1 | -1 = 1): string {
  if (period.unit === "DAYS") return shiftCivilDay(day, sign * period.amount);
  return addMonths(day, sign * period.amount * (period.unit === "YEARS" ? 12 : 1));
}

export type CertificateDates = {
  releaseDate: string;
  validUntil: string | null;
  progressReportDue: string | null;
  continuingReviewDue: string | null;
};

/** Approval runs to the day before the anniversary, the way a one-year approval is usually written. */
export function certificateDates(
  releaseDate: string,
  settings: { approvalPeriod: Period | null; progressReportAfter: Period | null; continuingReviewBefore: Period | null },
): CertificateDates {
  const validUntil = settings.approvalPeriod ? shiftCivilDay(addPeriod(releaseDate, settings.approvalPeriod), -1) : null;
  return {
    releaseDate,
    validUntil,
    progressReportDue: settings.progressReportAfter ? addPeriod(releaseDate, settings.progressReportAfter) : null,
    continuingReviewDue:
      validUntil && settings.continuingReviewBefore ? addPeriod(validUntil, settings.continuingReviewBefore, -1) : null,
  };
}
