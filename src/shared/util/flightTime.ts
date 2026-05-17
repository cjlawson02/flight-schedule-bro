import {
  formatInTimeZone,
  fromZonedTime,
  getTimezoneOffset,
  toZonedTime,
} from "date-fns-tz";

export const DEFAULT_TIMEZONE = "America/Los_Angeles";

/**
 * Parse an FSP wall-clock timestamp in the operator's timezone.
 * Example: "2025-11-04T17:00:00" with America/Los_Angeles → 5 PM Pacific as a UTC instant.
 */
export function parseFspLocal(
  localDateTime: string,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  return fromZonedTime(localDateTime, timeZone);
}

/**
 * Parse an FSP UTC field (may omit the "Z" suffix).
 */
export function parseFspUtc(utcDateTime: string): Date {
  if (utcDateTime.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(utcDateTime)) {
    return new Date(utcDateTime);
  }
  return new Date(`${utcDateTime}Z`);
}

/**
 * Resolve an FSP timestamp to a UTC instant, preferring explicit UTC when provided.
 */
export function parseFspDateTime(
  fields: { local?: string; utc?: string },
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  if (fields.utc) {
    return parseFspUtc(fields.utc);
  }
  if (fields.local) {
    return parseFspLocal(fields.local, timeZone);
  }
  throw new Error("FSP date/time requires either local or utc field");
}

/** FSP API timeZoneBias query param (minutes), derived from IANA zone with DST. */
export function getFspTimeZoneBias(
  timeZone: string = DEFAULT_TIMEZONE,
  at: Date = new Date(),
): number {
  return getTimezoneOffset(timeZone, at) / (60 * 1000);
}

export function toOperatorZoned(
  instant: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  return toZonedTime(instant, timeZone);
}

export function getOperatorHour(
  instant: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): number {
  return toOperatorZoned(instant, timeZone).getHours();
}

export function getOperatorDayOfWeek(
  instant: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): number {
  return toOperatorZoned(instant, timeZone).getDay();
}

export function isOperatorWeekend(
  instant: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): boolean {
  const day = getOperatorDayOfWeek(instant, timeZone);
  return day === 0 || day === 6;
}

/** Calendar date key (YYYY-MM-DD) in the operator timezone. */
export function createOperatorDateKey(
  instant: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  return formatInTimeZone(instant, timeZone, "yyyy-MM-dd");
}

/** Parse YYYY-MM-DD as midnight at the start of that calendar day in the operator zone. */
export function parseOperatorDateString(
  isoDate: string,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  return fromZonedTime(`${isoDate}T00:00:00`, timeZone);
}

export function startOfOperatorDay(
  instant: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const dateKey = createOperatorDateKey(instant, timeZone);
  return parseOperatorDateString(dateKey, timeZone);
}

export function endOfOperatorDay(
  instant: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const zoned = toOperatorZoned(instant, timeZone);
  zoned.setHours(23, 59, 59, 999);
  return fromZonedTime(zoned, timeZone);
}

export function addOperatorDays(
  instant: Date,
  days: number,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const zoned = toOperatorZoned(instant, timeZone);
  zoned.setDate(zoned.getDate() + days);
  return fromZonedTime(zoned, timeZone);
}

/** YYYY-MM-DD for API date parameters in the operator timezone. */
export function formatOperatorIsoDate(
  instant: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  return formatInTimeZone(instant, timeZone, "yyyy-MM-dd");
}

/** Local wall-clock string for FSP booking APIs (YYYY-MM-DDTHH:mm). */
export function formatFspLocalDateTime(
  instant: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  return formatInTimeZone(instant, timeZone, "yyyy-MM-dd'T'HH:mm");
}

export function formatOperatorDisplayDate(
  instant: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  return formatInTimeZone(instant, timeZone, "M/d/yyyy");
}

export function formatOperatorDisplayTime(
  instant: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  return formatInTimeZone(instant, timeZone, "h:mm:ss a");
}
