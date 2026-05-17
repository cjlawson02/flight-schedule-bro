import { z } from "zod";
import { safeFetch } from "./api_wrapper.js";

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

const TimeBlockSchema = z.object({
  startAt: z.string(),
  endAt: z.string(),
});

const AvailabilitySchema = z.object({
  timeBlocks: z.array(TimeBlockSchema),
  flightInstructorId: z.uuid(),
  aircraftId: z.uuid(),
});

const ResponseSchema = z.array(AvailabilitySchema);

export async function fetchAvailability({
  customerUserGuid,
  locationId,
  activityTypeId,
  instructors,
  aircraftIds,
  startDate,
  endDate,
  operatorId,
}: {
  customerUserGuid: string;
  locationId: number;
  activityTypeId: string;
  instructors: string[];
  aircraftIds: string[];
  startDate: string;
  endDate: string;
  operatorId: number;
}) {
  return await safeFetch(
    `https://usc-api.flightschedulepro.com/schedulinghub/v1.0/operators/${operatorId}/scheduleMatch/availability`,
    "POST",
    {
      customerUserGuid,
      locationId,
      activityTypeId,
      instructors,
      aircrafts: aircraftIds,
      schedulingGroups: [],
      enabledDays: {
        sundayEnabled: true,
        mondayEnabled: true,
        tuesdayEnabled: true,
        wednesdayEnabled: true,
        thursdayEnabled: true,
        fridayEnabled: true,
        saturdayEnabled: true,
      },
      enabledTimes: {
        morningEnabled: true,
        middayEnabled: true,
        afternoonEnabled: true,
        eveningEnabled: true,
      },
      lengthOfReservationInMinutes: 120,
      showTimesOutsideBusinessHours: false,
      startDate,
      endDate,
      useStudentAvailability: false,
      preferenceUpdate: false,
    },
    ResponseSchema,
    // 30 min
    30 * 60 * 1000,
  );
}
