import { CONFIG, type ConfigType } from "./config.js";
import {
  getOperatorHour,
  isOperatorWeekend,
  toOperatorZoned,
} from "./flightTime.js";

/**
 * Validate if a time block meets scheduling criteria in the operator's timezone.
 *
 * Rules:
 * - Duration must be exactly 2 hours (120 minutes)
 * - Weekdays: start >= WEEKDAY_MIN_HOUR, end <= MAX_HOUR
 * - Weekends: end <= MAX_HOUR
 */
export function isValidBlock(
  start: Date,
  end: Date,
  config?: ConfigType,
): boolean {
  const cfg = config ?? CONFIG;
  const timeZone = cfg.TIMEZONE;
  const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
  if (durationMinutes !== 120) return false;

  const hour = getOperatorHour(start, timeZone);
  const endZoned = toOperatorZoned(end, timeZone);
  const endHour = endZoned.getHours() + endZoned.getMinutes() / 60;
  const isWeekend = isOperatorWeekend(start, timeZone);

  return isWeekend
    ? endHour <= cfg.MAX_HOUR
    : hour >= cfg.WEEKDAY_MIN_HOUR && endHour <= cfg.MAX_HOUR;
}
