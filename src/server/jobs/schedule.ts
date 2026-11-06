import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

const ZONE = "Asia/Manila";

/** The next clock time in Asia/Manila, today if it is still ahead, otherwise tomorrow. */
export function nextManilaClock(now: Date, hour: number, minute = 0): Date {
  const day = formatInTimeZone(now, ZONE, "yyyy-MM-dd");
  const clock = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000`;
  const today = fromZonedTime(`${day}T${clock}`, ZONE);
  if (today.getTime() > now.getTime()) return today;
  const [year, month, date] = day.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(year!, (month ?? 1) - 1, (date ?? 1) + 1)).toISOString().slice(0, 10);
  return fromZonedTime(`${tomorrow}T${clock}`, ZONE);
}

export function nextDigestAt(now = new Date()): Date {
  return nextManilaClock(now, 7, 0);
}

export function nextAuditAt(now = new Date()): Date {
  return nextManilaClock(now, 2, 0);
}
