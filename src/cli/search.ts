import { SchedulerBLO } from "../shared/blo/scheduler.js";
import {
  buildAvailabilityFetchTasks,
  fetchAllAvailability,
  filterValidAvailabilityBlocks,
  prepareAvailabilitySearch,
} from "../shared/blo/availabilitySearch.js";
import { getInvalidInstructorIds } from "../shared/dao/availability.js";
import type { BookableAvailability } from "../shared/dao/availability.js";
import { getDefaultLocationId, getUserId } from "../shared/dao/auth.js";
import {
  getExistingReservations,
  hasReservationOnSameDay,
} from "../shared/dao/existingReservations.js";
import { selectPreferredAircraftIds } from "../shared/dao/aircraft.js";
import type { ReservationType } from "../shared/dao/reservationTypes.js";
import { type ConfigType } from "../shared/util/config.js";
import { startOfOperatorDay } from "../shared/util/flightTime.js";
import { getErrorMessage } from "../shared/util/errors.js";
import { createProgressBar } from "../shared/util/progressBar.js";
import { createLogger } from "../shared/util/logger.js";

const log = createLogger("cli-search");

export async function runCliAvailabilitySearch(options: {
  scheduler: SchedulerBLO;
  config: ConfigType;
  reservationType: ReservationType;
  operatorId: number;
}): Promise<BookableAvailability[]> {
  const { scheduler, config, reservationType, operatorId } = options;
  const today = startOfOperatorDay(new Date(), config.TIMEZONE);
  const allInstructorIds = scheduler.getInstructorIds();
  const aircraftIds = selectPreferredAircraftIds(
    Array.from(
      scheduler.getAircraftMapEntries(),
      ([aircraftId, tailNumber]) => ({
        aircraftId,
        tailNumber,
      }),
    ),
    config.AIRCRAFT_REGEX,
  );

  const searchParams = {
    customerUserGuid: getUserId(),
    locationId: getDefaultLocationId(),
    operatorId,
    timeZone: config.TIMEZONE,
    activityTypeId: reservationType.reservationTypeId,
    reservationType,
    allInstructorIds,
    aircraftIds,
  };

  const prepared = prepareAvailabilitySearch(searchParams);
  if (!prepared) {
    throw new Error(
      `"${reservationType.reservationTypeName}" has no instructors or aircraft to search with.`,
    );
  }

  const skippedInstructors = allInstructorIds.filter((id) =>
    getInvalidInstructorIds().has(id),
  );
  if (skippedInstructors.length > 0) {
    log.warn("Skipped instructors not valid for scheduleMatch", {
      count: skippedInstructors.length,
      instructorIds: skippedInstructors,
    });
  }

  log.info("Checking existing reservations");
  const existingReservations = await getExistingReservations(
    operatorId,
    config.TIMEZONE,
  );
  log.info("Existing reservations loaded", {
    count: existingReservations.length,
  });

  const bookablePromises = buildAvailabilityFetchTasks(scheduler, {
    params: searchParams,
    prepared,
    today,
    daysAhead: config.DAYS_AHEAD,
  });

  const progressBar = createProgressBar("🔄 Fetching schedules");
  progressBar.start(bookablePromises.length, 0);

  let completedCount = 0;
  const trackedPromises = bookablePromises.map((promise) =>
    promise
      .then((result) => {
        completedCount++;
        progressBar.update(completedCount);
        return result;
      })
      .catch((error: unknown) => {
        completedCount++;
        progressBar.update(completedCount);
        throw error;
      }),
  );

  try {
    const allBookableResults = await fetchAllAvailability(trackedPromises);
    progressBar.stop();

    const validResults = filterValidAvailabilityBlocks(
      allBookableResults,
      config,
      reservationType.defaultLength,
    );

    const availableWithoutConflicts = validResults.filter(
      (result) =>
        !hasReservationOnSameDay(
          result.startDateTime,
          existingReservations,
          config.TIMEZONE,
        ),
    );

    const conflictsFiltered =
      validResults.length - availableWithoutConflicts.length;
    if (conflictsFiltered > 0) {
      console.log(
        `\n⏭️  Filtered out ${conflictsFiltered} time slots on days where you already have reservations`,
      );
    }

    return availableWithoutConflicts;
  } catch (error) {
    progressBar.stop();
    throw error;
  }
}

export function logCliSearchError(error: unknown): void {
  log.error("An error occurred during availability search", {
    message: getErrorMessage(error),
    error,
  });
}
