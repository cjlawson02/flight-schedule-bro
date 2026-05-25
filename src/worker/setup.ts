import { SchedulerBLO } from "../shared/blo/scheduler.js";
import { createConfig } from "../shared/util/config.js";
import { BookableAvailability } from "../shared/dao/availability.js";
import { isValidBlock } from "../shared/util/dates.js";
import {
  addOperatorDays,
  formatOperatorIsoDate,
  startOfOperatorDay,
} from "../shared/util/flightTime.js";
import {
  fetchAuth,
  getOperatorId,
  getUserId,
  getDefaultLocationId,
} from "../shared/dao/auth.js";
import { chunk } from "../shared/util/array.js";
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

    // Create config from worker environment
    const config = createConfig({
      FSP_EMAIL: env.FSP_EMAIL,
      FSP_PASSWORD: env.FSP_PASSWORD,
      DAYS_AHEAD: env.DAYS_AHEAD,
      AIRCRAFT_REGEX: env.AIRCRAFT_REGEX,
      WEEKDAY_MIN_HOUR: env.WEEKDAY_MIN_HOUR ?? "15",
      MAX_HOUR: env.MAX_HOUR ?? "19",
      TIMEZONE: env.TIMEZONE,
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

    if (allInstructorIds.length === 0) {
      throw new Error(
        "No instructors found in metadata. Cannot fetch availability.",
      );
    }

    const instructorChunks = chunk(allInstructorIds, 3);

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

    // Get activity type - use first one (typically "dual")
    const activityTypeId = metadata.reservationTypes[0]?.reservationTypeId;

    if (!activityTypeId) {
      throw new Error("No activity types found");
    }

    log.info("Activity type selected", {
      name: metadata.reservationTypes[0].reservationTypeName,
      activityTypeId,
    });
    log.info("Fetching availability", { daysAhead: config.DAYS_AHEAD });

    // Create scheduler for availability fetching
    const scheduler = new SchedulerBLO(operatorId, config.TIMEZONE);

    // Collect all bookable availability
    const bookablePromises: Promise<BookableAvailability[]>[] = [];

    for (let offset = 0; offset <= config.DAYS_AHEAD; offset++) {
      const day = addOperatorDays(today, offset, config.TIMEZONE);
      const dayISO = formatOperatorIsoDate(day, config.TIMEZONE);

      bookablePromises.push(
        ...instructorChunks.map((instructors) =>
          scheduler.getBookableAvailability({
            customerUserGuid: getUserId(),
            locationId: getDefaultLocationId(),
            activityTypeId,
            instructors,
            aircraftIds,
            startDate: dayISO,
            endDate: dayISO,
          }),
        ),
      );
    }

    const allBookableResults: BookableAvailability[] = (
      await Promise.all(bookablePromises)
    ).flat();

    log.info("Availability search complete", {
      totalResults: allBookableResults.length,
    });

    // Filter valid results using the existing validation logic
    const validResults = allBookableResults.filter((result) =>
      isValidBlock(result.startDateTime, result.endDateTime, config, 120),
    );

    log.info("Filtered valid time slots", { count: validResults.length });

    // Initialize snapshot in KV
    await initializeSnapshot(
      env,
      validResults,
      config.DAYS_AHEAD,
      config.TIMEZONE,
    );

    const successMessage = `✅ Setup complete! Initialized with ${validResults.length} available time slots for the next ${config.DAYS_AHEAD} days.`;
    log.info("Setup complete", {
      slotsCount: validResults.length,
      daysAhead: config.DAYS_AHEAD,
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
        daysAhead: config.DAYS_AHEAD,
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
