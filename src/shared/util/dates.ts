import { CONFIG, type ConfigType } from "./config.js";

/**
 * Validate if a time block meets scheduling criteria
 *
 * This function checks if a flight time slot is acceptable based on:
 * 1. **Duration**: Must be exactly 2 hours (120 minutes)
 * 2. **Time range**: Must fall within configured hours for weekdays/weekends
 *
 * Validation Rules:
 * - **Weekdays**: Start >= WEEKDAY_MIN_HOUR (default 3 PM), end <= MAX_HOUR (default 7 PM)
 * - **Weekends**: End <= MAX_HOUR
 *
 * @param start - Start time of the flight block
 * @param end - End time of the flight block
 * @param isWeekend - Whether this is a weekend day (Saturday/Sunday)
 * @returns true if the block meets all validation criteria, false otherwise
 */
export function isValidBlock(
  start: Date,
  end: Date,
  isWeekend: boolean,
  config?: ConfigType
): boolean {
  const cfg = config || CONFIG;
  const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
  if (durationMinutes !== 120) return false;

  const hour = start.getHours();
  const endHour = end.getHours() + end.getMinutes() / 60;

  return isWeekend
    ? endHour <= cfg.MAX_HOUR
    : hour >= cfg.WEEKDAY_MIN_HOUR && endHour <= cfg.MAX_HOUR;
}
