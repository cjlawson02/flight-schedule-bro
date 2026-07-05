import type { BookableAvailability } from "../shared/dao/availability.js";
import { FSP_NIL_RESOURCE_ID } from "../shared/dao/aircraft.js";
import type { ReservationType } from "../shared/dao/reservationTypes.js";
import { getFieldState } from "../shared/dao/reservationTypes.js";
import type { SchedulerBLO } from "../shared/blo/scheduler.js";
import { formatOperatorIsoDate } from "../shared/util/flightTime.js";
import type { InteractiveCLI } from "../shared/util/interactive.js";

export function filterAvailabilitiesForSlot(
  availabilities: BookableAvailability[],
  slot: { startTime: Date; endTime: Date; aircraftId?: string },
): BookableAvailability[] {
  const seenInstructorIds = new Set<string>();

  return availabilities.filter((availability) => {
    if (slot.aircraftId && availability.aircraftId !== slot.aircraftId) {
      return false;
    }

    if (
      availability.instructorId === FSP_NIL_RESOURCE_ID ||
      !availability.instructorId
    ) {
      return false;
    }

    if (
      availability.startDateTime.getTime() !== slot.startTime.getTime() ||
      availability.endDateTime.getTime() !== slot.endTime.getTime()
    ) {
      return false;
    }

    if (seenInstructorIds.has(availability.instructorId)) {
      return false;
    }

    seenInstructorIds.add(availability.instructorId);
    return true;
  });
}

export async function findInstructorsForSlot(
  scheduler: SchedulerBLO,
  params: {
    locationId: number;
    activityTypeId: string;
    aircraftId?: string;
    startTime: Date;
    endTime: Date;
    timeZone: string;
    instructorIds: string[];
  },
): Promise<BookableAvailability[]> {
  const searchDate = formatOperatorIsoDate(params.startTime, params.timeZone);
  const durationMinutes = Math.round(
    (params.endTime.getTime() - params.startTime.getTime()) / 60000,
  );
  const aircraftIds = params.aircraftId ? [params.aircraftId] : [];

  if (params.instructorIds.length === 0) {
    return [];
  }

  const results = await scheduler.getBookableAvailability({
    locationId: params.locationId,
    activityTypeId: params.activityTypeId,
    instructorIds: params.instructorIds,
    aircraftIds,
    startDate: searchDate,
    lengthOfReservationInMinutes: durationMinutes,
  });

  return filterAvailabilitiesForSlot(results, {
    aircraftId: params.aircraftId,
    startTime: params.startTime,
    endTime: params.endTime,
  });
}

export function needsInstructorResolution(
  reservationType: ReservationType,
  instructorId?: string,
): boolean {
  const instructor = getFieldState(reservationType, "instructor");
  return instructor.enabled && instructor.required && !instructorId;
}

export async function resolveMissingInstructorForUpgrade(
  cli: InteractiveCLI,
  scheduler: SchedulerBLO,
  params: {
    locationId: number;
    reservationType: ReservationType;
    aircraftId?: string;
    startTime: Date;
    endTime: Date;
    timeZone: string;
  },
): Promise<{ instructorId: string; instructorName?: string } | null> {
  console.log("\n🔍 Searching for available instructors at this time...");

  const matchingInstructors = await findInstructorsForSlot(scheduler, {
    locationId: params.locationId,
    activityTypeId: params.reservationType.reservationTypeId,
    aircraftId: params.aircraftId,
    startTime: params.startTime,
    endTime: params.endTime,
    timeZone: params.timeZone,
    instructorIds: scheduler.getInstructorIds(),
  });

  if (matchingInstructors.length === 0) {
    console.log(
      params.aircraftId
        ? "❌ No instructors are available for this aircraft at this time."
        : "❌ No instructors are available at this time.",
    );
    return null;
  }

  const selected = await cli.selectInstructor(
    matchingInstructors[0],
    matchingInstructors,
  );

  if (!selected) {
    return null;
  }

  return {
    instructorId: selected.instructorId,
    instructorName: selected.instructor,
  };
}
