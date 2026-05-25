import { SchedulerBLO } from "../shared/blo/scheduler.js";
import {
  buildAvailabilityFetchTasks,
  fetchAllAvailability,
  filterValidAvailabilityBlocks,
  logAvailabilitySearchBudget,
  prepareAvailabilitySearch,
  resolveAvailabilityDaysAhead,
} from "../shared/blo/availabilitySearch.js";
import { createConfig } from "../shared/util/config.js";
import {
  reservationTypeUsesInstructor,
  selectMonitoringReservationType,
} from "../shared/dao/reservationTypes.js";
import { clearInvalidInstructorIds } from "../shared/dao/availability.js";
import { startOfOperatorDay } from "../shared/util/flightTime.js";
import {
  fetchAuth,
  getOperatorId,
  getUserId,
  getDefaultLocationId,
} from "../shared/dao/auth.js";
import { initializeSnapshot } from "./kv.js";
import { sendSimpleNotification } from "./discord.js";
import { getOrFetchMetadata } from "./metadata.js";
import { initializeWorker } from "./utils.js";
import { createLogger } from "../shared/util/logger.js";
import type { Env } from "./types.js";

const log = createLogger("setup");

/**
 * Initialize the availability snapshot in KV
 * This should be called once to set up the initial state
 *
 * @param env - Worker environment bindings
 * @returns Response with status message
 */
export async function runSetup(env: Env): Promise<Response> {
  try {
    log.info("Starting setup");

    initializeWorker();
    clearInvalidInstructorIds();

    // Create config from worker environment
    const config = createConfig({
      FSP_EMAIL: env.FSP_EMAIL,
      FSP_PASSWORD: env.FSP_PASSWORD,
      DAYS_AHEAD: env.DAYS_AHEAD,
      AIRCRAFT_REGEX: env.AIRCRAFT_REGEX,
      WEEKDAY_MIN_HOUR: env.WEEKDAY_MIN_HOUR ?? "15",
      MAX_HOUR: env.MAX_HOUR ?? "19",
      TIMEZONE: env.TIMEZONE,
      RESERVATION_TYPE_ID: env.RESERVATION_TYPE_ID,
    });

    // Authenticate
    log.info("Authenticating");
    await fetchAuth(config.EMAIL, config.PASSWORD);

    const operatorId = getOperatorId();

    // Get or fetch metadata from KV (saves 3 API calls!)
    log.info("Loading metadata from KV");
    const metadata = await getOrFetchMetadata(
      operatorId,
      env.FSP_AVAILABILITY_KV,
    );

    log.info("Metadata loaded", {
      instructors: metadata.instructors.length,
      reservationTypes: metadata.reservationTypes.length,
      aircraft: metadata.aircraft.length,
    });

    const today = startOfOperatorDay(new Date(), config.TIMEZONE);

    const allInstructorIds = metadata.instructors.map((i) => i.instructorId);

    const reservationType = selectMonitoringReservationType(
      metadata.reservationTypes,
      config.RESERVATION_TYPE_ID,
    );

    if (!reservationType) {
      throw new Error("No activity types found");
    }

    if (
      reservationTypeUsesInstructor(reservationType) &&
      allInstructorIds.length === 0
    ) {
      throw new Error(
        "No instructors found in metadata. Cannot fetch availability.",
      );
    }

    const activityTypeId = reservationType.reservationTypeId;

    // Get preferred aircraft IDs using cached metadata
    const preferredAircraftIds = metadata.aircraft
      .filter((a) => config.AIRCRAFT_REGEX.test(a.tailNumber))
      .map((a) => a.aircraftId);

    const aircraftIds =
      preferredAircraftIds.length > 0
        ? preferredAircraftIds
        : metadata.aircraft.map((a) => a.aircraftId);

    log.info("Aircraft selected", {
      total: aircraftIds.length,
      preferred: preferredAircraftIds.length,
    });

    log.info("Activity type selected", {
      name: reservationType.reservationTypeName,
      activityTypeId,
    });

    const searchParams = {
      customerUserGuid: getUserId(),
      locationId: getDefaultLocationId(),
      operatorId,
      timeZone: config.TIMEZONE,
      activityTypeId,
      reservationType,
      allInstructorIds,
      aircraftIds,
    };

    const prepared = prepareAvailabilitySearch(searchParams);
    if (!prepared) {
      throw new Error("No instructors or aircraft available for search.");
    }

    log.info("Fetching availability", {
      configuredDaysAhead: config.DAYS_AHEAD,
      chunks: prepared.instructorChunks.length,
    });

    const searchBudget = resolveAvailabilityDaysAhead(
      config.DAYS_AHEAD,
      prepared.instructorChunks.length,
    );
    logAvailabilitySearchBudget(searchBudget, config.DAYS_AHEAD);

    const scheduler = new SchedulerBLO(operatorId, config.TIMEZONE);
    const bookablePromises = buildAvailabilityFetchTasks(scheduler, {
      params: searchParams,
      prepared,
      today,
      daysAhead: searchBudget.daysAhead,
    });

    const allBookableResults = await fetchAllAvailability(bookablePromises, {
      failFast: true,
    });

    log.info("Availability search complete", {
      totalResults: allBookableResults.length,
    });

    // Filter valid results using reservation type duration and hour rules
    const validResults = filterValidAvailabilityBlocks(
      allBookableResults,
      config,
      reservationType.defaultLength,
    );

    log.info("Filtered valid time slots", { count: validResults.length });

    // Initialize snapshot in KV
    await initializeSnapshot(
      env,
      validResults,
      searchBudget.daysAhead,
      config.TIMEZONE,
    );

    const successMessage = `✅ Setup complete! Initialized with ${validResults.length} available time slots for the next ${searchBudget.daysAhead} days.`;
    log.info("Setup complete", {
      slotsCount: validResults.length,
      configuredDaysAhead: config.DAYS_AHEAD,
      effectiveDaysAhead: searchBudget.daysAhead,
    });

    // Send notification to Discord
    try {
      await sendSimpleNotification(env, successMessage);
    } catch (error) {
      log.error("Failed to send Discord notification", { error });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: successMessage,
        slotsCount: validResults.length,
        daysAhead: searchBudget.daysAhead,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    const errorMessage = `❌ Setup failed: ${
      error instanceof Error ? error.message : "Unknown error"
    }`;
    log.error(errorMessage, { error });

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
