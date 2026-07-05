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

const log = createLogger("availability-search");

/** Cloudflare Workers scheduled invocations are limited to 50 subrequests. */
export const CLOUDFLARE_SUBREQUEST_LIMIT = 50;

/** Conservative non-availability subrequests per worker run (auth, reservations, KV, Discord). */
export const WORKER_AVAILABILITY_OVERHEAD = 10;

export interface ScheduleSearchBudget {
  daysAhead: number;
  totalFetches: number;
  capped: boolean;
  pagesPerDay: number;
}

export function resolveScheduleSearchBudget(
  daysAhead: number,
  pagesPerDay: number,
  options: {
    subrequestLimit?: number;
    overhead?: number;
  } = {},
): ScheduleSearchBudget {
  const subrequestLimit =
    options.subrequestLimit ?? CLOUDFLARE_SUBREQUEST_LIMIT;
  const overhead = options.overhead ?? WORKER_AVAILABILITY_OVERHEAD;
  const maxAvailabilityFetches = subrequestLimit - overhead;

  if (pagesPerDay === 0) {
    return {
      daysAhead: 0,
      totalFetches: 0,
      capped: false,
      pagesPerDay,
    };
  }

  if (pagesPerDay > maxAvailabilityFetches) {
    throw new Error(
      `Schedule pages per day (${pagesPerDay}) exceeds Cloudflare subrequest budget (${maxAvailabilityFetches} availability fetches).`,
    );
  }

  const maxDayCount = Math.floor(maxAvailabilityFetches / pagesPerDay);
  const effectiveDaysAhead = Math.min(daysAhead, Math.max(0, maxDayCount - 1));
  const totalFetches = (effectiveDaysAhead + 1) * pagesPerDay;

  return {
    daysAhead: effectiveDaysAhead,
    totalFetches,
    capped: effectiveDaysAhead < daysAhead,
    pagesPerDay,
  };
}

export function logScheduleSearchBudget(
  budget: ScheduleSearchBudget,
  configuredDaysAhead: number,
): void {
  if (budget.capped) {
    log.warn("Reducing DAYS_AHEAD to stay under Cloudflare subrequest limit", {
      configuredDaysAhead,
      effectiveDaysAhead: budget.daysAhead,
      pagesPerDay: budget.pagesPerDay,
      availabilityFetches: budget.totalFetches,
      subrequestLimit: CLOUDFLARE_SUBREQUEST_LIMIT,
    });
  } else {
    log.info("Schedule search budget", {
      daysAhead: budget.daysAhead,
      pagesPerDay: budget.pagesPerDay,
      availabilityFetches: budget.totalFetches,
    });
  }
}

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
  config: ConfigType,
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
