import {
  BookableAvailability,
  prepareInstructorChunks,
} from "../dao/availability.js";
import {
  getAvailabilitySearchResources,
  type ReservationType,
} from "../dao/reservationTypes.js";
import { SchedulerBLO } from "./scheduler.js";
import { chunk } from "../util/array.js";
import { type ConfigType } from "../util/config.js";
import { isValidBlock } from "../util/dates.js";
import { addOperatorDays, formatOperatorIsoDate } from "../util/flightTime.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("availability-search");

/** Cloudflare Workers scheduled invocations are limited to 50 subrequests. */
export const CLOUDFLARE_SUBREQUEST_LIMIT = 50;

/** Conservative non-availability subrequests per worker run (auth, reservations, KV, Discord). */
export const WORKER_AVAILABILITY_OVERHEAD = 10;

export type AvailabilitySearchBudget = {
  daysAhead: number;
  totalFetches: number;
  capped: boolean;
  instructorChunkCount: number;
};

export function resolveAvailabilityDaysAhead(
  daysAhead: number,
  instructorChunkCount: number,
  options: {
    subrequestLimit?: number;
    overhead?: number;
  } = {},
): AvailabilitySearchBudget {
  const subrequestLimit =
    options.subrequestLimit ?? CLOUDFLARE_SUBREQUEST_LIMIT;
  const overhead = options.overhead ?? WORKER_AVAILABILITY_OVERHEAD;
  const maxAvailabilityFetches = subrequestLimit - overhead;

  if (instructorChunkCount === 0) {
    return {
      daysAhead: 0,
      totalFetches: 0,
      capped: false,
      instructorChunkCount,
    };
  }

  if (instructorChunkCount > maxAvailabilityFetches) {
    throw new Error(
      `Instructor chunk count (${instructorChunkCount}) exceeds Cloudflare subrequest budget (${maxAvailabilityFetches} availability fetches). Reduce instructors or set RESERVATION_TYPE_ID to an aircraft-only type.`,
    );
  }

  const maxDayCount = Math.floor(maxAvailabilityFetches / instructorChunkCount);
  const effectiveDaysAhead = Math.min(daysAhead, Math.max(0, maxDayCount - 1));
  const totalFetches = (effectiveDaysAhead + 1) * instructorChunkCount;

  return {
    daysAhead: effectiveDaysAhead,
    totalFetches,
    capped: effectiveDaysAhead < daysAhead,
    instructorChunkCount,
  };
}

export function logAvailabilitySearchBudget(
  budget: AvailabilitySearchBudget,
  configuredDaysAhead: number,
): void {
  if (budget.capped) {
    log.warn("Reducing DAYS_AHEAD to stay under Cloudflare subrequest limit", {
      configuredDaysAhead,
      effectiveDaysAhead: budget.daysAhead,
      instructorChunks: budget.instructorChunkCount,
      availabilityFetches: budget.totalFetches,
      subrequestLimit: CLOUDFLARE_SUBREQUEST_LIMIT,
    });
  } else {
    log.info("Availability search budget", {
      daysAhead: budget.daysAhead,
      instructorChunks: budget.instructorChunkCount,
      availabilityFetches: budget.totalFetches,
    });
  }
}

export type AvailabilitySearchParams = {
  customerUserGuid: string;
  locationId: number;
  operatorId: number;
  timeZone: string;
  activityTypeId: string;
  reservationType: ReservationType;
  allInstructorIds: string[];
  aircraftIds: string[];
};

export type PreparedAvailabilitySearch = {
  searchResources: {
    instructors: string[];
    aircraftIds: string[];
  };
  instructorChunks: string[][];
};

export function prepareAvailabilitySearch(
  params: AvailabilitySearchParams,
): PreparedAvailabilitySearch | null {
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

  const instructorChunks = prepareInstructorChunks(
    chunk(searchResources.instructors, 3),
    searchResources.aircraftIds,
  );

  if (instructorChunks.length === 0) {
    return null;
  }

  return { searchResources, instructorChunks };
}

export function buildAvailabilityFetchTasks(
  scheduler: SchedulerBLO,
  options: {
    params: AvailabilitySearchParams;
    prepared: PreparedAvailabilitySearch;
    today: Date;
    daysAhead: number;
  },
): Promise<BookableAvailability[]>[] {
  const { params, prepared, today, daysAhead } = options;
  const tasks: Promise<BookableAvailability[]>[] = [];

  for (let offset = 0; offset <= daysAhead; offset++) {
    const day = addOperatorDays(today, offset, params.timeZone);
    const dayISO = formatOperatorIsoDate(day, params.timeZone);

    for (const instructors of prepared.instructorChunks) {
      tasks.push(
        scheduler.getBookableAvailability({
          customerUserGuid: params.customerUserGuid,
          locationId: params.locationId,
          activityTypeId: params.activityTypeId,
          instructors,
          aircraftIds: prepared.searchResources.aircraftIds,
          startDate: dayISO,
          endDate: dayISO,
          lengthOfReservationInMinutes: params.reservationType.defaultLength,
        }),
      );
    }
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
