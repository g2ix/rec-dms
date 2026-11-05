import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export function appTimeZone(): string {
  return process.env.APP_TIMEZONE || "Asia/Manila";
}

export function formatManila(date: Date, pattern = "yyyy-MM-dd HH:mm"): string {
  return formatInTimeZone(date, appTimeZone(), pattern);
}

export function manilaDayStart(day: string): Date {
  return fromZonedTime(`${day}T00:00:00.000`, appTimeZone());
}

export function manilaDayEnd(day: string): Date {
  return fromZonedTime(`${day}T23:59:59.999`, appTimeZone());
}
