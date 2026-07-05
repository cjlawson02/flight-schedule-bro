import type { BookableAvailability } from "../dao/availability.js";
import {
  reservationTypeUsesInstructor,
  selectMonitoringReservationType,
  type ReservationType,
} from "../dao/reservationTypes.js";
import { type ConfigType } from "../util/config.js";
import { startOfOperatorDay } from "../util/flightTime.js";
import type { FspMetadata } from "./fspMetadata.js";
import { SchedulerBLO } from "./scheduler.js";
import {
  buildScheduleFetchTasks,
  estimateSchedulePagesPerDay,
  fetchAllAvailability,
  filterValidAvailabilityBlocks,
  logScheduleSearchBudget,
  prepareScheduleSearch,
  resolveScheduleSearchBudget,
  type ScheduleSearchBudget,
} from "./availabilitySearch.js";
import { selectPreferredAircraftIds } from "../dao/aircraft.js";

export interface WorkerAuthContext {
  locationId: number;
}

export interface WorkerAvailabilitySearchResult {
  validResults: BookableAvailability[];
  budget: ScheduleSearchBudget;
  reservationType: ReservationType;
  today: Date;
}

export function buildWorkerSearchResources(
  config: ConfigType,
  fspMetadata: FspMetadata,
): {
  reservationType: ReservationType;
  allInstructorIds: string[];
  aircraftIds: string[];
} {
  const reservationType = selectMonitoringReservationType(
    fspMetadata.reservationTypes,
    config.RESERVATION_TYPE_ID,
  );

  if (!reservationType) {
    throw new Error(
      "No reservation types available for automated monitoring search.",
    );
  }

  const allInstructorIds = fspMetadata.instructors.map((i) => i.instructorId);

  if (
    reservationTypeUsesInstructor(reservationType) &&
    allInstructorIds.length === 0
  ) {
    throw new Error(
      "No instructors found in metadata. Cannot fetch availability.",
    );
  }

  const aircraftIds = selectPreferredAircraftIds(
    fspMetadata.aircraft,
    config.AIRCRAFT_REGEX,
  );

  return { reservationType, allInstructorIds, aircraftIds };
}

export async function executeWorkerAvailabilitySearch(options: {
  config: ConfigType;
  fspMetadata: FspMetadata;
  scheduler: SchedulerBLO;
  auth: WorkerAuthContext;
  today?: Date;
  failFast?: boolean;
  onTaskComplete?: () => void;
}): Promise<WorkerAvailabilitySearchResult> {
  const { config, fspMetadata, scheduler, auth } = options;
  const today =
    options.today ?? startOfOperatorDay(new Date(), config.TIMEZONE);
  const { reservationType, allInstructorIds, aircraftIds } =
    buildWorkerSearchResources(config, fspMetadata);

  const searchParams = {
    locationId: auth.locationId,
    timeZone: config.TIMEZONE,
    activityTypeId: reservationType.reservationTypeId,
    reservationType,
    allInstructorIds,
    aircraftIds,
  };

  const prepared = prepareScheduleSearch(searchParams);
  if (!prepared) {
    throw new Error("No instructors or aircraft available for search.");
  }

  const pagesPerDay = estimateSchedulePagesPerDay(
    prepared.searchResources.instructors.length,
    prepared.searchResources.aircraftIds.length,
  );

  const budget = resolveScheduleSearchBudget(config.DAYS_AHEAD, pagesPerDay);
  logScheduleSearchBudget(budget, config.DAYS_AHEAD);

  const bookablePromises = buildScheduleFetchTasks(scheduler, {
    params: searchParams,
    prepared,
    today,
    daysAhead: budget.daysAhead,
  });

  let tasks = bookablePromises;
  if (options.onTaskComplete) {
    tasks = bookablePromises.map((promise) =>
      promise
        .then((result) => {
          options.onTaskComplete?.();
          return result;
        })
        .catch((error: unknown) => {
          options.onTaskComplete?.();
          throw error;
        }),
    );
  }

  const allBookableResults = await fetchAllAvailability(tasks, {
    failFast: options.failFast,
  });

  const validResults = filterValidAvailabilityBlocks(
    allBookableResults,
    config,
    reservationType.defaultLength,
  );

  return { validResults, budget, reservationType, today };
}
