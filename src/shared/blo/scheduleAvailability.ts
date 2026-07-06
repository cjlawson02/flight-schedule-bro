import { FSP_NIL_RESOURCE_ID } from "../dao/aircraft.js";
import type { BookableAvailability } from "../dao/availability.js";
import {
  reservationTypeUsesAircraft,
  reservationTypeUsesInstructor,
  type ReservationType,
} from "../dao/reservationTypes.js";
import type { ScheduleDaySnapshot } from "../dao/schedule.js";
import { FSP_ALL_FILTER_SENTINEL } from "../dao/schedule.js";
import {
  clipInterval,
  invertIntervals,
  isIntervalFree,
  mergeIntervals,
  parseScheduleLocal,
  slotStepMs,
  slotsFromFree,
  type TimeInterval,
} from "./scheduleGaps.js";
import {
  addOperatorDays,
  formatOperatorDisplayDate,
  formatOperatorDisplayTime,
  parseOperatorDateString,
} from "../util/flightTime.js";

export interface ScheduleAvailabilityParams {
  snapshot: ScheduleDaySnapshot;
  day: string;
  timeZone: string;
  reservationType: ReservationType;
  aircraftIds: string[];
  instructorIds: string[];
  durationMinutes: number;
  instructorsMap: Map<string, string>;
  aircraftMap: Map<string, string>;
}

function buildClosingBusy(
  snapshot: ScheduleDaySnapshot,
  dayStart: Date,
  dayEnd: Date,
  timeZone: string,
): TimeInterval[] {
  const busy: TimeInterval[] = [];

  for (const closing of snapshot.closings) {
    const clipped = clipInterval(
      {
        start: parseScheduleLocal(closing.StartDate, timeZone),
        end: parseScheduleLocal(closing.EndDate, timeZone),
      },
      dayStart,
      dayEnd,
    );

    if (clipped) {
      busy.push(clipped);
    }
  }

  return busy;
}

function freeWindowsForResource(
  resourceId: string,
  snapshot: ScheduleDaySnapshot,
  dayStart: Date,
  dayEnd: Date,
  closingBusy: TimeInterval[],
  timeZone: string,
): TimeInterval[] {
  const busy: TimeInterval[] = [...closingBusy];

  for (const event of snapshot.events) {
    if (event.ResourceId !== resourceId) {
      continue;
    }

    const clipped = clipInterval(
      {
        start: parseScheduleLocal(event.StartDate, timeZone),
        end: parseScheduleLocal(event.EndDate, timeZone),
      },
      dayStart,
      dayEnd,
    );

    if (clipped) {
      busy.push(clipped);
    }
  }

  for (const block of snapshot.unavailability) {
    if (block.ResourceId !== resourceId) {
      continue;
    }

    const clipped = clipInterval(
      {
        start: parseScheduleLocal(block.StartDate, timeZone),
        end: parseScheduleLocal(block.EndDate, timeZone),
      },
      dayStart,
      dayEnd,
    );

    if (clipped) {
      busy.push(clipped);
    }
  }

  return invertIntervals(mergeIntervals(busy), dayStart, dayEnd);
}

function toBookableAvailability(
  slot: TimeInterval,
  instructorId: string,
  aircraftId: string,
  timeZone: string,
  instructorsMap: Map<string, string>,
  aircraftMap: Map<string, string>,
): BookableAvailability {
  return {
    date: formatOperatorDisplayDate(slot.start, timeZone),
    startTime: formatOperatorDisplayTime(slot.start, timeZone),
    endTime: formatOperatorDisplayTime(slot.end, timeZone),
    instructorId,
    aircraftId,
    instructor:
      instructorId === FSP_NIL_RESOURCE_ID
        ? undefined
        : (instructorsMap.get(instructorId) ?? `Instructor ${instructorId}`),
    aircraft:
      aircraftId === FSP_NIL_RESOURCE_ID
        ? undefined
        : (aircraftMap.get(aircraftId) ?? `Aircraft ${aircraftId}`),
    startDateTime: slot.start,
    endDateTime: slot.end,
  };
}

export function computeBookableAvailabilityFromSnapshot(
  params: ScheduleAvailabilityParams,
): BookableAvailability[] {
  const {
    snapshot,
    day,
    timeZone,
    reservationType,
    aircraftIds,
    instructorIds,
    durationMinutes,
    instructorsMap,
    aircraftMap,
  } = params;

  const dayStart = parseOperatorDateString(day, timeZone);
  const dayEnd = addOperatorDays(dayStart, 1, timeZone);
  const durationMs = durationMinutes * 60 * 1000;
  const stepMs = slotStepMs();
  const closingBusy = buildClosingBusy(snapshot, dayStart, dayEnd, timeZone);

  const usesAircraft = reservationTypeUsesAircraft(reservationType);
  const usesInstructor = reservationTypeUsesInstructor(reservationType);
  const results: BookableAvailability[] = [];

  if (usesAircraft && usesInstructor) {
    const instructorFree = new Map<string, TimeInterval[]>();
    for (const instructorId of instructorIds) {
      instructorFree.set(
        instructorId,
        freeWindowsForResource(
          instructorId,
          snapshot,
          dayStart,
          dayEnd,
          closingBusy,
          timeZone,
        ),
      );
    }

    for (const aircraftId of aircraftIds) {
      const aircraftFree = freeWindowsForResource(
        aircraftId,
        snapshot,
        dayStart,
        dayEnd,
        closingBusy,
        timeZone,
      );
      const aircraftSlots = slotsFromFree(aircraftFree, durationMs, stepMs);

      for (const slot of aircraftSlots) {
        for (const instructorId of instructorIds) {
          if (
            !isIntervalFree(
              slot.start,
              slot.end,
              instructorFree.get(instructorId) ?? [],
            )
          ) {
            continue;
          }

          results.push(
            toBookableAvailability(
              slot,
              instructorId,
              aircraftId,
              timeZone,
              instructorsMap,
              aircraftMap,
            ),
          );
        }
      }
    }

    return results;
  }

  if (usesInstructor) {
    for (const instructorId of instructorIds) {
      const free = freeWindowsForResource(
        instructorId,
        snapshot,
        dayStart,
        dayEnd,
        closingBusy,
        timeZone,
      );
      const slots = slotsFromFree(free, durationMs, stepMs);

      for (const slot of slots) {
        results.push(
          toBookableAvailability(
            slot,
            instructorId,
            FSP_NIL_RESOURCE_ID,
            timeZone,
            instructorsMap,
            aircraftMap,
          ),
        );
      }
    }

    return results;
  }

  if (usesAircraft) {
    for (const aircraftId of aircraftIds) {
      const free = freeWindowsForResource(
        aircraftId,
        snapshot,
        dayStart,
        dayEnd,
        closingBusy,
        timeZone,
      );
      const slots = slotsFromFree(free, durationMs, stepMs);

      for (const slot of slots) {
        results.push(
          toBookableAvailability(
            slot,
            FSP_NIL_RESOURCE_ID,
            aircraftId,
            timeZone,
            instructorsMap,
            aircraftMap,
          ),
        );
      }
    }
  }

  return results;
}

export function buildScheduleFilterIds(
  aircraftIds: string[],
  instructorIds: string[],
): {
  aircraftIds: string[];
  instructorIds: string[];
  reservationTypeIds: string[];
} {
  return {
    aircraftIds:
      aircraftIds.length > 0 ? [FSP_ALL_FILTER_SENTINEL] : aircraftIds,
    instructorIds:
      instructorIds.length > 0 ? [FSP_ALL_FILTER_SENTINEL] : instructorIds,
    reservationTypeIds: [FSP_ALL_FILTER_SENTINEL],
  };
}
