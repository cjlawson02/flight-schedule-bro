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
 * - Weekends: end <= MAX_HOUR
 */
export function isValidBlock(
  start: Date,
  end: Date,
  config: Pick<ConfigType, "TIMEZONE" | "WEEKDAY_MIN_HOUR" | "MAX_HOUR">,
  expectedDurationMinutes: number,
): boolean {
  const timeZone = config.TIMEZONE;
  const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
  if (durationMinutes !== expectedDurationMinutes) return false;

  const hour = getOperatorHour(start, timeZone);
  const endZoned = toOperatorZoned(end, timeZone);
  const endHour = endZoned.getHours() + endZoned.getMinutes() / 60;
  const isWeekend = isOperatorWeekend(start, timeZone);

  return isWeekend
    ? endHour <= config.MAX_HOUR
    : hour >= config.WEEKDAY_MIN_HOUR && endHour <= config.MAX_HOUR;
}
