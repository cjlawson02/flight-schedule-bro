import type { BookableAvailability } from "../dao/availability.js";
import { endOfOperatorDay, parseOperatorDateString } from "./flightTime.js";

/** Minimum hours before slot start before a Discord notification is sent. */
export const DISCORD_NOTIFICATION_MIN_LEAD_HOURS = 24;

/** Minimum hours before slot start before a reservation can be booked. */
export const BOOKING_MIN_LEAD_HOURS = 24;

export function isSlotStartInPast(
  startDateTime: Date,
  now: Date = new Date(),
): boolean {
  return startDateTime.getTime() < now.getTime();
}

export function isSlotStartTooSoonForDiscordNotification(
  startDateTime: Date,
  minLeadHours: number = DISCORD_NOTIFICATION_MIN_LEAD_HOURS,
  now: Date = new Date(),
): boolean {
  const minStartMs = now.getTime() + minLeadHours * 60 * 60 * 1000;
  return startDateTime.getTime() < minStartMs;
}

export function isSlotStartTooSoonForBooking(
  startDateTime: Date,
  minLeadHours: number = BOOKING_MIN_LEAD_HOURS,
  now: Date = new Date(),
): boolean {
  const minStartMs = now.getTime() + minLeadHours * 60 * 60 * 1000;
  return startDateTime.getTime() < minStartMs;
}

export function filterSlotsNotInPast(
  slots: BookableAvailability[],
  now: Date = new Date(),
): BookableAvailability[] {
  return slots.filter((slot) => !isSlotStartInPast(slot.startDateTime, now));
}

export function filterSlotsBookable(
  slots: BookableAvailability[],
  now: Date = new Date(),
): BookableAvailability[] {
  return slots.filter(
    (slot) =>
      !isSlotStartInPast(slot.startDateTime, now) &&
      !isSlotStartTooSoonForBooking(slot.startDateTime, undefined, now),
  );
}

export function filterSlotsForDiscordNotification(
  slots: BookableAvailability[],
  now: Date = new Date(),
): BookableAvailability[] {
  return slots.filter(
    (slot) =>
      !isSlotStartInPast(slot.startDateTime, now) &&
      !isSlotStartTooSoonForDiscordNotification(
        slot.startDateTime,
        undefined,
        now,
      ),
  );
}

function createSlotKey(slot: BookableAvailability): string {
  return `${slot.date}|${slot.startTime}|${slot.endTime}|${slot.aircraftId}|${slot.instructorId}`;
}

/** Later ISO calendar date (YYYY-MM-DD). */
export function maxIsoDate(a: string, b: string): string {
  return a >= b ? a : b;
}

/**
 * Combine freshly searched slots with prior snapshot slots beyond the refreshed window.
 * Used when a budget-limited run re-fetches only the near-term days.
 */
export function mergeRefreshedSnapshotSlots(
  refreshedSlots: BookableAvailability[],
  previousSlots: BookableAvailability[],
  refreshedThroughDateIso: string,
  timeZone: string,
): BookableAvailability[] {
  const refreshedThroughEnd = endOfOperatorDay(
    parseOperatorDateString(refreshedThroughDateIso, timeZone),
    timeZone,
  );
  const retained = previousSlots.filter(
    (slot) => slot.startDateTime.getTime() > refreshedThroughEnd.getTime(),
  );
  return [...refreshedSlots, ...retained];
}

/**
 * Find new slots that aren't in the existing snapshot.
 * Implements the rolling window algorithm to exclude newly added future days.
 */
export function findNewSlots(
  currentSlots: BookableAvailability[],
  previousSlots: BookableAvailability[],
  previousTrackedThroughDateIso: string,
  timeZone: string,
): BookableAvailability[] {
  const previousSlotKeys = new Set(previousSlots.map(createSlotKey));
  const maxTrackedDateOnly = endOfOperatorDay(
    parseOperatorDateString(previousTrackedThroughDateIso, timeZone),
    timeZone,
  );

  return currentSlots.filter((slot) => {
    const slotKey = createSlotKey(slot);
    const isNew = !previousSlotKeys.has(slotKey);
    const isWithinTrackedWindow = slot.startDateTime <= maxTrackedDateOnly;
    return isNew && isWithinTrackedWindow;
  });
}
