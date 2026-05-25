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
  buildAvailabilityFetchTasks,
  fetchAllAvailability,
  filterValidAvailabilityBlocks,
  logAvailabilitySearchBudget,
  prepareAvailabilitySearch,
  resolveAvailabilityDaysAhead,
  type AvailabilitySearchBudget,
} from "./availabilitySearch.js";
import { selectPreferredAircraftIds } from "../dao/aircraft.js";

export interface WorkerAuthContext {
  customerUserGuid: string;
  locationId: number;
  operatorId: number;
}

export interface WorkerAvailabilitySearchResult {
  validResults: BookableAvailability[];
  budget: AvailabilitySearchBudget;
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
    customerUserGuid: auth.customerUserGuid,
    locationId: auth.locationId,
    operatorId: auth.operatorId,
    timeZone: config.TIMEZONE,
    activityTypeId: reservationType.reservationTypeId,
    reservationType,
    allInstructorIds,
    aircraftIds,
  };

  const prepared = prepareAvailabilitySearch(searchParams);
  if (!prepared) {
    throw new Error("No instructors or aircraft available for search.");
  }

  const budget = resolveAvailabilityDaysAhead(
    config.DAYS_AHEAD,
    prepared.instructorChunks.length,
  );
  logAvailabilitySearchBudget(budget, config.DAYS_AHEAD);

  const bookablePromises = buildAvailabilityFetchTasks(scheduler, {
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
