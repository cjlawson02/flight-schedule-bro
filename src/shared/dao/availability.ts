import { z } from "zod";
import { FspHttpError, safeFetch } from "./api_wrapper.js";
import {
  DEFAULT_TIMEZONE,
  getOperatorDayOfWeek,
  parseFspLocal,
} from "../util/flightTime.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("availability");

/**
 * Availability interface that includes all booking context
 * Note: Uses UUIDs only. Resolve to human-readable names at display time using metadata.
 */
export interface BookableAvailability {
  date: string;
  startTime: string;
  endTime: string;
  instructorId: string;
  aircraftId: string;
  instructor?: string; // Human-readable instructor name
  aircraft?: string; // Human-readable aircraft name
  startDateTime: Date;
  endDateTime: Date;
}

/** KV-storable subset of BookableAvailability (ISO datetimes, no display names). */
export const BookableAvailabilityKvSchema = z.object({
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  instructorId: z.uuid(),
  aircraftId: z.uuid(),
  startDateTime: z.iso.datetime(),
  endDateTime: z.iso.datetime(),
});

export type BookableAvailabilityKV = z.infer<
  typeof BookableAvailabilityKvSchema
>;

interface TimeSlotGroup {
  date: string;
  startTime: string;
  endTime: string;
  availabilities: BookableAvailability[];
}

export function groupAvailabilitiesByTimeSlot(
  availabilities: BookableAvailability[],
): TimeSlotGroup[] {
  const grouped = new Map<string, TimeSlotGroup>();

  for (const avail of availabilities) {
    const key = `${avail.date}|${avail.startTime}|${avail.endTime}`;
    const group = grouped.get(key);

    if (group) {
      group.availabilities.push(avail);
      continue;
    }

    grouped.set(key, {
      date: avail.date,
      startTime: avail.startTime,
      endTime: avail.endTime,
      availabilities: [avail],
    });
  }

  return Array.from(grouped.values()).sort(
    (a, b) =>
      new Date(`${a.date} ${a.startTime}`).getTime() -
      new Date(`${b.date} ${b.startTime}`).getTime(),
  );
}

const TimeBlockSchema = z.object({
  startAt: z.string(),
  endAt: z.string(),
});

/** FSP scheduleMatch availability result item. */
export const AvailabilityResultSchema = z.object({
  timeBlocks: z.array(TimeBlockSchema),
  flightInstructorId: z.uuid().nullish(),
  aircraftId: z.uuid().nullish(),
});

const ResponseSchema = z.array(AvailabilityResultSchema);

interface EnabledDays {
  sundayEnabled: boolean;
  mondayEnabled: boolean;
  tuesdayEnabled: boolean;
  wednesdayEnabled: boolean;
  thursdayEnabled: boolean;
  fridayEnabled: boolean;
  saturdayEnabled: boolean;
}

const ALL_DAYS_ENABLED: EnabledDays = {
  sundayEnabled: true,
  mondayEnabled: true,
  tuesdayEnabled: true,
  wednesdayEnabled: true,
  thursdayEnabled: true,
  fridayEnabled: true,
  saturdayEnabled: true,
};

/** Match FSP Find a Time: when searching a single day, only that weekday is enabled. */
export function enabledDaysForSearchDates(
  startDate: string,
  endDate: string,
  timeZone: string = DEFAULT_TIMEZONE,
): EnabledDays {
  if (startDate !== endDate) {
    return ALL_DAYS_ENABLED;
  }

  const dayOfWeek = getOperatorDayOfWeek(
    parseFspLocal(`${startDate}T12:00:00`, timeZone),
    timeZone,
  );

  return {
    sundayEnabled: dayOfWeek === 0,
    mondayEnabled: dayOfWeek === 1,
    tuesdayEnabled: dayOfWeek === 2,
    wednesdayEnabled: dayOfWeek === 3,
    thursdayEnabled: dayOfWeek === 4,
    fridayEnabled: dayOfWeek === 5,
    saturdayEnabled: dayOfWeek === 6,
  };
}

const FspValidationErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  dataField: z.string().optional(),
});

/**
 * Instructors returned by the general instructors API may not be valid for
 * scheduleMatch/availability. Track rejected IDs for the current invocation.
 */
const invalidInstructorIds = new Set<string>();

export function getInvalidInstructorIds(): ReadonlySet<string> {
  return invalidInstructorIds;
}

export function clearInvalidInstructorIds(): void {
  invalidInstructorIds.clear();
}

export function excludeInvalidInstructors(instructors: string[]): string[] {
  return instructors.filter((id) => !invalidInstructorIds.has(id));
}

function parseInvalidInstructorIndex(error: unknown): number | null {
  if (!(error instanceof FspHttpError)) {
    return null;
  }

  return parseInvalidInstructorFromResponse(error.response);
}

function parseInvalidInstructorFromResponse(response: unknown): number | null {
  let validationErrors: z.infer<typeof FspValidationErrorSchema>[];
  try {
    validationErrors = z.array(FspValidationErrorSchema).parse(response);
  } catch {
    return null;
  }

  for (const validationError of validationErrors) {
    if (
      validationError.code === 1011 &&
      validationError.dataField?.startsWith("Instructors[")
    ) {
      const indexMatch = /Instructors\[(\d+)\]/.exec(validationError.dataField);
      if (indexMatch) {
        return Number.parseInt(indexMatch[1], 10);
      }
    }
  }

  return null;
}

interface FetchAvailabilityParams {
  customerUserGuid: string;
  locationId: number;
  activityTypeId: string;
  instructors: string[];
  aircraftIds: string[];
  startDate: string;
  endDate: string;
  operatorId: number;
  timeZone?: string;
  lengthOfReservationInMinutes?: number;
}

async function fetchAvailabilityRequest(
  params: FetchAvailabilityParams,
  instructors: string[],
) {
  return await safeFetch(
    `https://usc-api.flightschedulepro.com/schedulinghub/v1.0/operators/${params.operatorId}/scheduleMatch/availability`,
    "POST",
    {
      customerUserGuid: params.customerUserGuid,
      locationId: params.locationId,
      activityTypeId: params.activityTypeId,
      instructors,
      aircrafts: params.aircraftIds,
      schedulingGroups: [],
      enabledDays: enabledDaysForSearchDates(
        params.startDate,
        params.endDate,
        params.timeZone,
      ),
      enabledTimes: {
        morningEnabled: true,
        middayEnabled: true,
        afternoonEnabled: true,
        eveningEnabled: true,
      },
      lengthOfReservationInMinutes: params.lengthOfReservationInMinutes ?? 120,
      showTimesOutsideBusinessHours: false,
      startDate: params.startDate,
      endDate: params.endDate,
      useStudentAvailability: false,
      preferenceUpdate: false,
    },
    ResponseSchema,
    // 30 min
    30 * 60 * 1000,
  );
}

export async function fetchAvailability(params: FetchAvailabilityParams) {
  const schedulableInstructors = excludeInvalidInstructors(params.instructors);

  if (schedulableInstructors.length === 0) {
    if (params.aircraftIds.length === 0) {
      return [];
    }

    return await fetchAvailabilityRequest(params, []);
  }

  while (schedulableInstructors.length > 0) {
    try {
      return await fetchAvailabilityRequest(params, schedulableInstructors);
    } catch (error) {
      const invalidIndex = parseInvalidInstructorIndex(error);
      if (
        invalidIndex === null ||
        invalidIndex < 0 ||
        invalidIndex >= schedulableInstructors.length
      ) {
        throw error;
      }

      const removedInstructorId = schedulableInstructors.splice(
        invalidIndex,
        1,
      )[0];
      invalidInstructorIds.add(removedInstructorId);
      log.warn("Skipping instructor not valid for scheduleMatch", {
        instructorId: removedInstructorId,
      });
    }
  }

  return [];
}

/**
 * Filter instructor chunks and support aircraft-only searches.
 * Invalid instructors are removed during fetchAvailability retries.
 */
export function prepareInstructorChunks(
  chunks: string[][],
  aircraftIds: string[],
): string[][] {
  const filteredChunks = chunks
    .map((instructors) => excludeInvalidInstructors(instructors))
    .filter((instructors) => instructors.length > 0);

  if (filteredChunks.length > 0) {
    return filteredChunks;
  }

  if (aircraftIds.length > 0) {
    return [[]];
  }

  return [];
}
