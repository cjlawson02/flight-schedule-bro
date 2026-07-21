import { type ConfigType } from "./config.js";
import {
  getOperatorHour,
  isOperatorWeekend,
  toOperatorZoned,
} from "./flightTime.js";

/**
 * Validate if a time block meets scheduling criteria in the operator's timezone.
 *
 * Rules:
 * - Duration must match expectedDurationMinutes (reservation type defaultLength)
 * - Weekdays: start >= WEEKDAY_MIN_HOUR, end <= MAX_HOUR
 * - Weekends: start >= WEEKEND_MIN_HOUR, end <= MAX_HOUR
 * - End hour is measured from the start day's midnight so overnight slots
 *   (e.g. 10 PM–12 AM) are rejected by MAX_HOUR instead of wrapping to 0
 */
export function isValidBlock(
  start: Date,
  end: Date,
  config: Pick<
    ConfigType,
    "TIMEZONE" | "WEEKDAY_MIN_HOUR" | "WEEKEND_MIN_HOUR" | "MAX_HOUR"
  >,
  expectedDurationMinutes: number,
): boolean {
  const timeZone = config.TIMEZONE;
  const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
  if (durationMinutes !== expectedDurationMinutes) return false;

  const hour = getOperatorHour(start, timeZone);
  // Measure end as hours from the start calendar day's midnight so overnight
  // slots (e.g. 10 PM–12 AM) compare as 24, not wrapped 0.
  const startZoned = toOperatorZoned(start, timeZone);
  const endZoned = toOperatorZoned(end, timeZone);
  const startMidnight = new Date(startZoned);
  startMidnight.setHours(0, 0, 0, 0);
  const endHour =
    (endZoned.getTime() - startMidnight.getTime()) / (1000 * 60 * 60);
  const isWeekend = isOperatorWeekend(start, timeZone);
  const minHour = isWeekend ? config.WEEKEND_MIN_HOUR : config.WEEKDAY_MIN_HOUR;

  return hour >= minHour && endHour <= config.MAX_HOUR;
}
