import { z } from "zod";
import { safeFetch } from "./api_wrapper.js";
import {
  addOperatorDays,
  formatOperatorIsoDate,
  parseOperatorDateString,
} from "../util/flightTime.js";
import { createLogger } from "../util/logger.js";
import {
  canMakeSubrequest,
  type SubrequestBudget,
} from "../util/subrequestBudget.js";

const log = createLogger("schedule");

/** FSP "All" filter sentinel for schedule resource type filters. */
export const FSP_ALL_FILTER_SENTINEL = "00000000-0000-0000-0000-000000000001";

export const SCHEDULE_PAGE_SIZE = 50;
/** Safety cap when API pagination does not terminate. */
export const MAX_SCHEDULE_PAGES = 200;

/** 5 minutes — schedule changes frequently. */
export const SCHEDULE_CACHE_TTL_MS = 5 * 60 * 1000;

const ScheduleResourceSchema = z.object({
  Id: z.uuid(),
  Name: z.string(),
  ResourceTypeId: z.number(),
  LocationId: z.number().optional(),
});

const ScheduleEventSchema = z.object({
  ResourceId: z.uuid(),
  Name: z.string().optional(),
  StartDate: z.string(),
  EndDate: z.string(),
  ReservationId: z.uuid().optional(),
  Cls: z.string().optional(),
  ResourceTypeId: z.number().optional(),
});

const ScheduleUnavailabilitySchema = z.object({
  ResourceId: z.uuid(),
  Name: z.string().optional(),
  StartDate: z.string(),
  EndDate: z.string(),
  Cls: z.string().optional(),
});

const ScheduleClosingSchema = z.object({
  StartDate: z.string(),
  EndDate: z.string(),
});

const ScheduleResultsSchema = z.object({
  resources: z.array(ScheduleResourceSchema).default([]),
  events: z.array(ScheduleEventSchema).default([]),
  unavailability: z.array(ScheduleUnavailabilitySchema).default([]),
  closings: z.array(ScheduleClosingSchema).default([]),
});

export const SchedulePageResponseSchema = z.object({
  total: z.number(),
  pageIndex: z.number(),
  pageSize: z.number(),
  results: ScheduleResultsSchema,
});

export type SchedulePageResponse = z.infer<typeof SchedulePageResponseSchema>;
export type ScheduleResource = z.infer<typeof ScheduleResourceSchema>;
export type ScheduleEvent = z.infer<typeof ScheduleEventSchema>;
export type ScheduleUnavailability = z.infer<
  typeof ScheduleUnavailabilitySchema
>;
export type ScheduleClosing = z.infer<typeof ScheduleClosingSchema>;
export type ScheduleResults = z.infer<typeof ScheduleResultsSchema>;

export interface ScheduleDaySnapshot {
  resources: ScheduleResource[];
  events: ScheduleEvent[];
  unavailability: ScheduleUnavailability[];
  closings: ScheduleClosing[];
}

export interface FetchSchedulePageParams {
  operatorId: number;
  locationId: number;
  start: string;
  end: string;
  aircraftIds: string[];
  instructorIds: string[];
  reservationTypeIds: string[];
  page: number;
  pageSize?: number;
}

export interface FetchScheduleDayParams {
  operatorId: number;
  locationId: number;
  start: string;
  timeZone: string;
  aircraftIds: string[];
  instructorIds: string[];
  reservationTypeIds: string[];
  budget?: SubrequestBudget;
}

export interface ScheduleDayFetchResult {
  snapshot: ScheduleDaySnapshot;
  complete: boolean;
  pagesFetched: number;
}

function emptySnapshot(): ScheduleDaySnapshot {
  return {
    resources: [],
    events: [],
    unavailability: [],
    closings: [],
  };
}

function eventDedupeKey(event: ScheduleEvent): string {
  return `${event.ResourceId}|${event.StartDate}|${event.EndDate}|${event.ReservationId ?? ""}`;
}

function unavailabilityDedupeKey(block: ScheduleUnavailability): string {
  return `${block.ResourceId}|${block.StartDate}|${block.EndDate}|${block.Cls ?? ""}`;
}

function closingDedupeKey(closing: ScheduleClosing): string {
  return `${closing.StartDate}|${closing.EndDate}`;
}

export function mergeScheduleSnapshot(
  merged: ScheduleDaySnapshot,
  page: ScheduleResults,
): void {
  const resourceMap = new Map(merged.resources.map((r) => [r.Id, r]));
  for (const resource of page.resources) {
    resourceMap.set(resource.Id, resource);
  }
  merged.resources = Array.from(resourceMap.values());

  const eventKeys = new Set(merged.events.map(eventDedupeKey));
  for (const event of page.events) {
    const key = eventDedupeKey(event);
    if (!eventKeys.has(key)) {
      eventKeys.add(key);
      merged.events.push(event);
    }
  }

  const unavailabilityKeys = new Set(
    merged.unavailability.map(unavailabilityDedupeKey),
  );
  for (const block of page.unavailability) {
    const key = unavailabilityDedupeKey(block);
    if (!unavailabilityKeys.has(key)) {
      unavailabilityKeys.add(key);
      merged.unavailability.push(block);
    }
  }

  const closingKeys = new Set(merged.closings.map(closingDedupeKey));
  for (const closing of page.closings) {
    const key = closingDedupeKey(closing);
    if (!closingKeys.has(key)) {
      closingKeys.add(key);
      merged.closings.push(closing);
    }
  }
}

/** Exclusive end date for a schedule day query (next calendar day in operator TZ). */
export function scheduleExclusiveEndDate(
  start: string,
  timeZone: string,
): string {
  const dayStart = parseOperatorDateString(start, timeZone);
  const nextDay = addOperatorDays(dayStart, 1, timeZone);
  return formatOperatorIsoDate(nextDay, timeZone);
}

function buildScheduleRequestBody(params: FetchSchedulePageParams) {
  return {
    operatorId: params.operatorId,
    start: params.start,
    end: params.end,
    scheduleViewId: `L:${params.locationId}`,
    locationIds: [params.locationId],
    aircraftIds: params.aircraftIds,
    instructorIds: params.instructorIds,
    reservationTypeIds: params.reservationTypeIds,
    includeInstructorTimeOff: true,
    canViewMaintenanceReservations: true,
    outputFormat: "bryntum",
    page: params.page,
    pageSize: params.pageSize ?? SCHEDULE_PAGE_SIZE,
  };
}

export async function fetchSchedulePage(
  params: FetchSchedulePageParams,
): Promise<SchedulePageResponse> {
  const body = buildScheduleRequestBody(params);

  const response = await safeFetch(
    "https://api-external.flightschedulepro.com/api/v2/schedule",
    "POST",
    body,
    SchedulePageResponseSchema,
    SCHEDULE_CACHE_TTL_MS,
  );

  log.info("Fetched schedule page", {
    start: params.start,
    page: response.pageIndex,
    pageSize: response.pageSize,
    total: response.total,
    resources: response.results.resources.length,
    events: response.results.events.length,
    unavailability: response.results.unavailability.length,
    closings: response.results.closings.length,
  });

  return response;
}

export async function fetchScheduleDay(
  params: FetchScheduleDayParams,
): Promise<ScheduleDayFetchResult> {
  const end = scheduleExclusiveEndDate(params.start, params.timeZone);
  const merged = emptySnapshot();
  let previousPageIndex: number | null = null;
  let pagesFetched = 0;

  for (let page = 1; ; page++) {
    if (page > MAX_SCHEDULE_PAGES) {
      log.error("Schedule pagination exceeded safety page limit", {
        start: params.start,
        maxPages: MAX_SCHEDULE_PAGES,
        pagesFetched,
      });
      return { snapshot: merged, complete: false, pagesFetched };
    }

    if (params.budget && !canMakeSubrequest(params.budget)) {
      log.info("Schedule fetch stopped: subrequest budget exhausted", {
        start: params.start,
        pagesFetched,
      });
      return { snapshot: merged, complete: false, pagesFetched };
    }

    const response = await fetchSchedulePage({
      operatorId: params.operatorId,
      locationId: params.locationId,
      start: params.start,
      end,
      aircraftIds: params.aircraftIds,
      instructorIds: params.instructorIds,
      reservationTypeIds: params.reservationTypeIds,
      page,
    });
    pagesFetched++;

    if (previousPageIndex !== null && response.pageIndex <= previousPageIndex) {
      log.warn("Schedule pagination did not advance; using partial snapshot", {
        start: params.start,
        pageIndex: response.pageIndex,
        previousPageIndex,
      });
      return { snapshot: merged, complete: false, pagesFetched };
    }
    previousPageIndex = response.pageIndex;

    mergeScheduleSnapshot(merged, response.results);

    const reachedEnd = response.pageIndex * response.pageSize >= response.total;

    if (reachedEnd) {
      return { snapshot: merged, complete: true, pagesFetched };
    }
  }
}

export function estimatePagesPerDay(resourceCount: number): number {
  return Math.max(1, Math.ceil(resourceCount / SCHEDULE_PAGE_SIZE));
}
