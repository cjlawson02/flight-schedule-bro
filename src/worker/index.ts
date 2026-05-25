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
import {
  formatOperatorIsoDate,
  startOfOperatorDay,
} from "../shared/util/flightTime.js";
import { findNewSlots } from "../shared/util/slots.js";
import {
  fetchAuth,
  getOperatorId,
  getUserId,
  getDefaultLocationId,
} from "../shared/dao/auth.js";
import { getExistingReservations } from "../shared/dao/existingReservations.js";
import { clearInvalidInstructorIds } from "../shared/dao/availability.js";
import {
  getSnapshot,
  getSlotsFromSnapshot,
  setSnapshot,
  cleanPastSlotsFromSnapshot,
} from "./kv.js";
import { sendAvailabilityNotification } from "./discord.js";
import { runSetup } from "./setup.js";
import { getOrFetchMetadata, refreshMetadata } from "./metadata.js";
import { initializeWorker } from "./utils.js";
import { createLogger } from "../shared/util/logger.js";
import type { Env } from "./types.js";

const log = createLogger("worker");

/**
 * Main scheduled handler - runs every 30 minutes
 */
export default {
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    initializeWorker();
    clearInvalidInstructorIds();

    log.info("Scheduled task started", { timestamp: new Date().toISOString() });

    try {
      // Get existing snapshot and metadata
      const snapshot = await getSnapshot(env);

      if (!snapshot) {
        log.error(
          "No snapshot found in KV. Please run setup first by visiting /setup",
        );
        return;
      }

      const { metadata } = snapshot;

      // Step 1: Create config and authenticate
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

      const today = startOfOperatorDay(new Date(), config.TIMEZONE);

      log.info("Rolling window state", {
        lastSearchDate: metadata.lastSearchDate,
        today: formatOperatorIsoDate(today, config.TIMEZONE),
      });

      log.info("Cleaning past slots");
      const cleanedSnapshot = cleanPastSlotsFromSnapshot(
        snapshot,
        today,
        config.TIMEZONE,
      );

      // Step 3: Get previous slots from cleaned snapshot for comparison
      const previousSlots = getSlotsFromSnapshot(cleanedSnapshot);
      log.info("Previous snapshot loaded", { slotCount: previousSlots.length });

      log.info("Authenticating");
      await fetchAuth(config.EMAIL, config.PASSWORD);

      const operatorId = getOperatorId();

      // Fetch existing reservations to provide context
      log.info("Fetching existing reservations");
      const existingReservations = await getExistingReservations(
        operatorId,
        config.TIMEZONE,
      );
      log.info("Existing reservations loaded", {
        count: existingReservations.length,
      });

      log.info("Loading FSP metadata");
      const fspMetadata = await getOrFetchMetadata(
        operatorId,
        env.FSP_AVAILABILITY_KV,
      );

      log.info("FSP metadata loaded", {
        instructors: fspMetadata.instructors.length,
        reservationTypes: fspMetadata.reservationTypes.length,
        aircraft: fspMetadata.aircraft.length,
      });

      const allInstructorIds = fspMetadata.instructors.map(
        (i) => i.instructorId,
      );

      const preferredAircraftIds = fspMetadata.aircraft
        .filter((a) => config.AIRCRAFT_REGEX.test(a.tailNumber))
        .map((a) => a.aircraftId);

      const aircraftIds =
        preferredAircraftIds.length > 0
          ? preferredAircraftIds
          : fspMetadata.aircraft.map((a) => a.aircraftId);

      const reservationType = selectMonitoringReservationType(
        fspMetadata.reservationTypes,
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

      log.info("Instructor chunks prepared", {
        instructors: allInstructorIds.length,
        chunks: prepared.instructorChunks.length,
      });

      const searchBudget = resolveAvailabilityDaysAhead(
        config.DAYS_AHEAD,
        prepared.instructorChunks.length,
      );
      logAvailabilitySearchBudget(searchBudget, config.DAYS_AHEAD);

      const scheduler = new SchedulerBLO(operatorId, config.TIMEZONE);

      log.info("Fetching availability", {
        configuredDaysAhead: config.DAYS_AHEAD,
        effectiveDaysAhead: searchBudget.daysAhead,
        chunks: searchBudget.instructorChunkCount,
        totalRequests: searchBudget.totalFetches,
      });

      const bookablePromises = buildAvailabilityFetchTasks(scheduler, {
        params: searchParams,
        prepared,
        today,
        daysAhead: searchBudget.daysAhead,
      });

      log.info("Executing availability requests", {
        requestCount: bookablePromises.length,
      });

      const allBookableResults = await fetchAllAvailability(bookablePromises, {
        failFast: true,
      });

      log.info("Availability search complete", {
        totalResults: allBookableResults.length,
      });

      // Step 6: Filter valid results
      const validResults = filterValidAvailabilityBlocks(
        allBookableResults,
        config,
        reservationType.defaultLength,
      );

      log.info("Filtered valid time slots", { count: validResults.length });

      // Step 7: Find new slots using rolling window algorithm
      const newSlots = findNewSlots(
        validResults,
        previousSlots,
        metadata.lastSearchDate,
        searchBudget.daysAhead,
        config.TIMEZONE,
      );

      log.info("New slots within tracked window", { count: newSlots.length });

      // Step 8: Filter slots for notification (configurable aircraft list)
      const notificationAircraftTailNumbers = env.NOTIFICATION_AIRCRAFT
        ? env.NOTIFICATION_AIRCRAFT.split(",").map((s) => s.trim())
        : [];

      // Convert tail numbers to aircraft IDs for filtering
      // Use Set for O(1) lookups instead of O(n) array.includes()
      const notificationAircraftIdsSet =
        notificationAircraftTailNumbers.length > 0
          ? new Set(
              fspMetadata.aircraft
                .filter((a) =>
                  notificationAircraftTailNumbers.includes(a.tailNumber),
                )
                .map((a) => a.aircraftId),
            )
          : null;

      const slotsToNotify = notificationAircraftIdsSet
        ? newSlots.filter((slot) =>
            notificationAircraftIdsSet.has(slot.aircraftId),
          )
        : newSlots; // If no filter configured, notify for all aircraft

      log.info("Slots selected for notification", {
        count: slotsToNotify.length,
        filter:
          notificationAircraftTailNumbers.length > 0
            ? notificationAircraftTailNumbers
            : "all aircraft",
      });

      // Step 9: Update snapshot with latest data BEFORE sending notification
      // This prevents duplicate notifications if setSnapshot fails
      // Update lastSearchDate to today so the rolling window advances
      const updatedMetadata = {
        lastSearchDate: formatOperatorIsoDate(today, config.TIMEZONE),
        lastUpdate: new Date().toISOString(),
        daysAhead: searchBudget.daysAhead,
      };

      await setSnapshot(env, validResults, updatedMetadata);

      // Step 10: Send Discord notification if filtered slots found
      // Now that snapshot is updated, we can safely send notifications
      if (slotsToNotify.length > 0) {
        log.info("Sending Discord notification");
        try {
          await sendAvailabilityNotification(
            env,
            slotsToNotify,
            fspMetadata,
            existingReservations,
            config.TIMEZONE,
          );
        } catch (error) {
          log.error("Failed to send Discord notification", { error });
          // Don't fail the entire job if notification fails
          // Snapshot is already updated, so we won't get duplicates
        }
      } else if (newSlots.length > 0) {
        log.info("Skipping notification: no slots match filter", {
          newSlotCount: newSlots.length,
        });
      }

      log.info("Scheduled task completed successfully");
    } catch (error) {
      log.error("Error in scheduled task", {
        message: error instanceof Error ? error.message : "Unknown error",
        error,
      });
      // Don't throw - let the worker continue running
    }
  },

  /**
   * HTTP handler for setup and health checks
   */
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Setup endpoint
    if (url.pathname === "/setup") {
      return await runSetup(env);
    }

    // Refresh metadata endpoint
    if (url.pathname === "/refresh-metadata") {
      try {
        initializeWorker();

        log.info("Refreshing metadata");
        const config = createConfig({
          FSP_EMAIL: env.FSP_EMAIL,
          FSP_PASSWORD: env.FSP_PASSWORD,
          DAYS_AHEAD: env.DAYS_AHEAD,
          AIRCRAFT_REGEX: env.AIRCRAFT_REGEX,
          WEEKDAY_MIN_HOUR: env.WEEKDAY_MIN_HOUR,
          MAX_HOUR: env.MAX_HOUR,
          TIMEZONE: env.TIMEZONE,
        });

        await fetchAuth(config.EMAIL, config.PASSWORD);
        const operatorId = getOperatorId();

        const metadata = await refreshMetadata(
          operatorId,
          env.FSP_AVAILABILITY_KV,
        );

        return new Response(
          JSON.stringify({
            success: true,
            message: "Metadata refreshed successfully",
            metadata: {
              instructors: metadata.instructors.length,
              reservationTypes: metadata.reservationTypes.length,
              aircraft: metadata.aircraft.length,
              lastUpdated: metadata.lastUpdated,
            },
          }),
          {
            headers: { "content-type": "application/json" },
          },
        );
      } catch (error) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `❌ Refresh failed: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          }),
          {
            status: 500,
            headers: { "content-type": "application/json" },
          },
        );
      }
    }

    // Health check endpoint
    if (url.pathname === "/health") {
      const snapshot = await getSnapshot(env);

      return new Response(
        JSON.stringify({
          status: "ok",
          snapshotExists: !!snapshot,
          metadata: snapshot?.metadata ?? null,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Default response
    return new Response(
      JSON.stringify({
        message: "Flight Schedule Bro Worker",
        endpoints: {
          "/setup": "Initialize the availability snapshot",
          "/refresh-metadata":
            "Refresh cached FSP metadata (instructors, aircraft, types)",
          "/health": "Check worker health and snapshot status",
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  },
};
