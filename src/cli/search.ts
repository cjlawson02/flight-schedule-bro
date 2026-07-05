import { SchedulerBLO } from "../shared/blo/scheduler.js";
import {
  buildScheduleFetchTasks,
  fetchAllAvailability,
  filterValidAvailabilityBlocks,
  prepareScheduleSearch,
} from "../shared/blo/availabilitySearch.js";
import type { BookableAvailability } from "../shared/dao/availability.js";
import { getDefaultLocationId } from "../shared/dao/auth.js";
import {
  getExistingReservations,
  hasReservationOnSameDay,
} from "../shared/dao/existingReservations.js";
import { selectPreferredAircraftIds } from "../shared/dao/aircraft.js";
import type { ReservationType } from "../shared/dao/reservationTypes.js";
import { type ConfigType } from "../shared/util/config.js";
import { startOfOperatorDay } from "../shared/util/flightTime.js";
import { filterSlotsBookable } from "../shared/util/slots.js";
import { getErrorMessage } from "../shared/util/errors.js";
import { createProgressBar } from "../shared/util/progressBar.js";
import { createLogger } from "../shared/util/logger.js";

const log = createLogger("cli-search");

export async function runCliAvailabilitySearch(options: {
  scheduler: SchedulerBLO;
  config: ConfigType;
  reservationType: ReservationType;
  operatorId: number;
  durationMinutes: number;
  aircraftIds?: string[];
  instructorIds?: string[];
}): Promise<BookableAvailability[]> {
  const {
    scheduler,
    config,
    reservationType,
    operatorId,
    durationMinutes,
    aircraftIds: selectedAircraftIds,
    instructorIds: selectedInstructorIds,
  } = options;
  const today = startOfOperatorDay(new Date(), config.TIMEZONE);
  const allInstructorIds =
    selectedInstructorIds ?? scheduler.getInstructorIds();
  const aircraftIds =
    selectedAircraftIds ??
    selectPreferredAircraftIds(
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
    locationId: getDefaultLocationId(),
    timeZone: config.TIMEZONE,
    activityTypeId: reservationType.reservationTypeId,
    reservationType,
    allInstructorIds,
    aircraftIds,
    durationMinutes,
  };

  const prepared = prepareScheduleSearch(searchParams);
  if (!prepared) {
    throw new Error(
      `"${reservationType.reservationTypeName}" has no instructors or aircraft to search with.`,
    );
  }

  log.info("Checking existing reservations");
  const existingReservations = await getExistingReservations(
    operatorId,
    config.TIMEZONE,
  );
  log.info("Existing reservations loaded", {
    count: existingReservations.length,
  });

  const bookablePromises = buildScheduleFetchTasks(scheduler, {
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
      durationMinutes,
    );

    const futureResults = filterSlotsBookable(validResults);
    const leadTimeFiltered = validResults.length - futureResults.length;
    if (leadTimeFiltered > 0) {
      console.log(
        `\n⏭️  Filtered out ${leadTimeFiltered} time slots that already started or start within 24 hours`,
      );
    }

    const availableWithoutConflicts = futureResults.filter(
      (result) =>
        !hasReservationOnSameDay(
          result.startDateTime,
          existingReservations,
          config.TIMEZONE,
        ),
    );

    const conflictsFiltered =
      futureResults.length - availableWithoutConflicts.length;
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
