import { BookableAvailability } from "../dao/availability.js";
import {
  getAvailabilitySearchResources,
  type ReservationType,
} from "../dao/reservationTypes.js";
import { estimatePagesPerDay } from "../dao/schedule.js";
import { SchedulerBLO } from "./scheduler.js";
import { type ConfigType } from "../util/config.js";
import { isValidBlock } from "../util/dates.js";
import { addOperatorDays, formatOperatorIsoDate } from "../util/flightTime.js";
import { createLogger } from "../util/logger.js";
import {
  type SubrequestBudget,
  subrequestsRemaining,
} from "../util/subrequestBudget.js";

const log = createLogger("availability-search");

export interface AvailabilitySearchParams {
  locationId: number;
  timeZone: string;
  activityTypeId: string;
  reservationType: ReservationType;
  allInstructorIds: string[];
  aircraftIds: string[];
  durationMinutes?: number;
}

export interface PreparedScheduleSearch {
  searchResources: {
    instructors: string[];
    aircraftIds: string[];
  };
}

export function prepareScheduleSearch(
  params: AvailabilitySearchParams,
): PreparedScheduleSearch | null {
  const searchResources = getAvailabilitySearchResources(
    params.reservationType,
    params.allInstructorIds,
    params.aircraftIds,
  );

  if (
    searchResources.instructors.length === 0 &&
    searchResources.aircraftIds.length === 0
  ) {
    return null;
  }

  return { searchResources };
}

export function estimateSchedulePagesPerDay(
  instructorCount: number,
  aircraftCount: number,
): number {
  return estimatePagesPerDay(instructorCount + aircraftCount);
}

export interface WorkerScheduleSearchResult {
  results: BookableAvailability[];
  /** Set only after at least one fully fetched day; null when daysFetched is 0. */
  trackedThroughDate: string | null;
  scheduleSubrequests: number;
  daysFetched: number;
}

export async function fetchScheduleDaysWithinBudget(options: {
  scheduler: SchedulerBLO;
  params: AvailabilitySearchParams;
  prepared: PreparedScheduleSearch;
  today: Date;
  budget: SubrequestBudget;
  maxDaysAhead?: number;
  /** Minimum subrequests required to start another day (typically pages per day). */
  pagesPerDayEstimate?: number;
  /** When true, throw if any day fetch does not complete. */
  failFast?: boolean;
}): Promise<WorkerScheduleSearchResult> {
  const {
    scheduler,
    params,
    prepared,
    today,
    budget,
    maxDaysAhead,
    pagesPerDayEstimate = 1,
    failFast = false,
  } = options;
  const durationMinutes =
    params.durationMinutes ?? params.reservationType.defaultLength;
  const results: BookableAvailability[] = [];
  const scheduleStartUsed = budget.used;
  let trackedThroughDate: string | null = null;
  let daysFetched = 0;

  for (let offset = 0; ; offset++) {
    if (maxDaysAhead !== undefined && offset > maxDaysAhead) {
      break;
    }

    if (!canFetchAnotherScheduleDay(budget, pagesPerDayEstimate)) {
      break;
    }

    const day = addOperatorDays(today, offset, params.timeZone);
    const dayISO = formatOperatorIsoDate(day, params.timeZone);
    const { availability, complete } =
      await scheduler.getBookableAvailabilityForDay({
        locationId: params.locationId,
        activityTypeId: params.activityTypeId,
        instructorIds: prepared.searchResources.instructors,
        aircraftIds: prepared.searchResources.aircraftIds,
        startDate: dayISO,
        lengthOfReservationInMinutes: durationMinutes,
        budget,
      });

    if (!complete) {
      if (failFast) {
        throw new Error(
          `Schedule day ${dayISO} did not complete (pagination or budget exhausted).`,
        );
      }
      break;
    }

    results.push(...availability);
    trackedThroughDate = dayISO;
    daysFetched++;
  }

  const scheduleSubrequests = budget.used - scheduleStartUsed;
  log.info("Schedule search completed", {
    daysFetched,
    trackedThroughDate,
    scheduleSubrequests,
    maxDaysAhead,
    subrequestsRemaining: subrequestsRemaining(budget),
    subrequestLimit: budget.limit,
  });

  return {
    results,
    trackedThroughDate,
    scheduleSubrequests,
    daysFetched,
  };
}

function canFetchAnotherScheduleDay(
  budget: SubrequestBudget,
  pagesPerDay: number,
): boolean {
  return subrequestsRemaining(budget) >= pagesPerDay;
}

export function buildScheduleFetchTasks(
  scheduler: SchedulerBLO,
  options: {
    params: AvailabilitySearchParams;
    prepared: PreparedScheduleSearch;
    today: Date;
    daysAhead: number;
  },
): Promise<BookableAvailability[]>[] {
  const { params, prepared, today, daysAhead } = options;
  const durationMinutes =
    params.durationMinutes ?? params.reservationType.defaultLength;
  const tasks: Promise<BookableAvailability[]>[] = [];

  for (let offset = 0; offset <= daysAhead; offset++) {
    const day = addOperatorDays(today, offset, params.timeZone);
    const dayISO = formatOperatorIsoDate(day, params.timeZone);

    tasks.push(
      scheduler.getBookableAvailability({
        locationId: params.locationId,
        activityTypeId: params.activityTypeId,
        instructorIds: prepared.searchResources.instructors,
        aircraftIds: prepared.searchResources.aircraftIds,
        startDate: dayISO,
        lengthOfReservationInMinutes: durationMinutes,
      }),
    );
  }

  return tasks;
}

export async function fetchAllAvailability(
  tasks: Promise<BookableAvailability[]>[],
  options: { failFast?: boolean } = {},
): Promise<BookableAvailability[]> {
  const settledResults = await Promise.allSettled(tasks);
  const failedRequests = settledResults.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  if (failedRequests.length > 0) {
    log.warn("Some availability requests failed", {
      failedCount: failedRequests.length,
      totalCount: settledResults.length,
    });

    if (options.failFast) {
      throw failedRequests[0].reason;
    }
  }

  return settledResults.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
}

export function filterValidAvailabilityBlocks(
  results: BookableAvailability[],
  config: Pick<ConfigType, "TIMEZONE" | "WEEKDAY_MIN_HOUR" | "MAX_HOUR">,
  expectedDurationMinutes: number,
): BookableAvailability[] {
  return results.filter((result) =>
    isValidBlock(
      result.startDateTime,
      result.endDateTime,
      config,
      expectedDurationMinutes,
    ),
  );
}
