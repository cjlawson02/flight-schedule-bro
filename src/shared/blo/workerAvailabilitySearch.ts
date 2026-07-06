import type { BookableAvailability } from "../dao/availability.js";
import {
  reservationTypeUsesInstructor,
  selectMonitoringReservationType,
  type ReservationType,
} from "../dao/reservationTypes.js";
import { type WorkerConfigType } from "../util/config.js";
import { startOfOperatorDay } from "../util/flightTime.js";
import type { FspMetadata } from "./fspMetadata.js";
import { SchedulerBLO } from "./scheduler.js";
import {
  estimateSchedulePagesPerDay,
  fetchScheduleDaysWithinBudget,
  filterValidAvailabilityBlocks,
  prepareScheduleSearch,
  type WorkerScheduleSearchResult,
} from "./availabilitySearch.js";
import { selectPreferredAircraftIds } from "../dao/aircraft.js";
import type { SubrequestBudget } from "../util/subrequestBudget.js";

export interface WorkerAuthContext {
  locationId: number;
}

export interface WorkerAvailabilitySearchResult {
  validResults: BookableAvailability[];
  search: WorkerScheduleSearchResult;
  reservationType: ReservationType;
  today: Date;
}

export function buildWorkerSearchResources(
  config: WorkerConfigType,
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
  config: WorkerConfigType;
  fspMetadata: FspMetadata;
  scheduler: SchedulerBLO;
  auth: WorkerAuthContext;
  budget: SubrequestBudget;
  today?: Date;
  failFast?: boolean;
}): Promise<WorkerAvailabilitySearchResult> {
  const {
    config,
    fspMetadata,
    scheduler,
    auth,
    budget,
    failFast = false,
  } = options;
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

  budget.reserve = 1;

  const pagesPerDayEstimate = estimateSchedulePagesPerDay(
    fspMetadata.instructors.length,
    fspMetadata.aircraft.length,
  );

  let search: WorkerScheduleSearchResult;
  try {
    search = await fetchScheduleDaysWithinBudget({
      scheduler,
      params: searchParams,
      prepared,
      today,
      budget,
      maxDaysAhead: config.MAX_DAYS_AHEAD,
      pagesPerDayEstimate,
      failFast,
    });
  } finally {
    budget.reserve = 0;
  }

  const validResults = filterValidAvailabilityBlocks(
    search.results,
    config,
    reservationType.defaultLength,
  );

  return { validResults, search, reservationType, today };
}
