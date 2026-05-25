import type { BookableAvailability } from "../dao/availability.js";
import {
  addOperatorDays,
  endOfOperatorDay,
  parseOperatorDateString,
} from "./flightTime.js";

function createSlotKey(slot: BookableAvailability): string {
  return `${slot.date}|${slot.startTime}|${slot.endTime}|${slot.aircraftId}|${slot.instructorId}`;
}

/**
 * Find new slots that aren't in the existing snapshot.
 * Implements the rolling window algorithm to exclude newly added future days.
 */
export function findNewSlots(
  currentSlots: BookableAvailability[],
  previousSlots: BookableAvailability[],
  lastSearchDateIso: string,
  daysAhead: number,
  timeZone: string,
): BookableAvailability[] {
  const previousSlotKeys = new Set(previousSlots.map(createSlotKey));
  const lastSearchDate = parseOperatorDateString(lastSearchDateIso, timeZone);
  const maxTrackedDateOnly = endOfOperatorDay(
    addOperatorDays(lastSearchDate, daysAhead, timeZone),
    timeZone,
  );

  return currentSlots.filter((slot) => {
    const slotKey = createSlotKey(slot);
    const isNew = !previousSlotKeys.has(slotKey);
    const isWithinTrackedWindow = slot.startDateTime <= maxTrackedDateOnly;
    return isNew && isWithinTrackedWindow;
  });
}
