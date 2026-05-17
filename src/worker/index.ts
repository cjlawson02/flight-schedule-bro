import { SchedulerBLO } from "../shared/blo/scheduler.js";
import { createConfig } from "../shared/util/config.js";
import { BookableAvailability } from "../shared/dao/availability.js";
import { isValidBlock } from "../shared/util/dates.js";
import {
  addOperatorDays,
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
import { chunk } from "../shared/util/array.js";
import {
  getSnapshot,
  getSlotsFromSnapshot,
  setSnapshot,
  cleanPastSlotsFromSnapshot,
} from "./kv.js";
import { sendAvailabilityNotification } from "./discord.js";
import { runSetup } from "./setup.js";
import { refreshMetadata, getMetadataFromKV } from "./metadata.js";
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

      log.info("Loading FSP metadata from KV");
      const fspMetadata = await getMetadataFromKV(env.FSP_AVAILABILITY_KV);

      if (!fspMetadata) {
        throw new Error("No FSP metadata in KV. Run /refresh-metadata first.");
      }

      log.info("FSP metadata loaded from KV", {
        instructors: fspMetadata.instructors.length,
        reservationTypes: fspMetadata.reservationTypes.length,
        aircraft: fspMetadata.aircraft.length,
      });

      const allInstructorIds = fspMetadata.instructors.map(
        (i) => i.instructorId,
      );

      if (allInstructorIds.length === 0) {
        throw new Error(
          "No instructors found in metadata. Cannot fetch availability.",
        );
      }

      const instructorChunks = chunk(allInstructorIds, 3); // API limit: max 3 instructors
      log.info("Instructor chunks prepared", {
        instructors: allInstructorIds.length,
        chunks: instructorChunks.length,
      });

      const preferredAircraftIds = fspMetadata.aircraft
        .filter((a) => config.AIRCRAFT_REGEX.test(a.tailNumber))
        .map((a) => a.aircraftId);

      const aircraftIds =
        preferredAircraftIds.length > 0
          ? preferredAircraftIds
          : fspMetadata.aircraft.map((a) => a.aircraftId);

      // Get first activity type (typically "dual")
      const activityTypeId = fspMetadata.reservationTypes[0]?.reservationTypeId;

      if (!activityTypeId) {
        throw new Error("No activity types found");
      }

      // Create scheduler for availability fetching
      const scheduler = new SchedulerBLO(operatorId, config.TIMEZONE);

      // Step 5: Fetch current availability for the SAME date range as original search
      const totalDays = config.DAYS_AHEAD + 1;
      const totalRequests = totalDays * instructorChunks.length;
      log.info("Fetching availability", {
        daysAhead: config.DAYS_AHEAD,
        totalDays,
        chunks: instructorChunks.length,
        totalRequests,
      });

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
              instructors, // Max 3 instructors per request (API limit)
              aircraftIds,
              startDate: dayISO,
              endDate: dayISO,
            }),
          ),
        );
      }

      log.info("Executing availability requests", {
        requestCount: bookablePromises.length,
      });

      const allBookableResults: BookableAvailability[] = (
        await Promise.all(bookablePromises)
      ).flat();

      log.info("Availability search complete", {
        totalResults: allBookableResults.length,
      });

      // Step 6: Filter valid results
      const validResults = allBookableResults.filter((result) =>
        isValidBlock(result.startDateTime, result.endDateTime, config),
      );

      log.info("Filtered valid time slots", { count: validResults.length });

      // Step 7: Find new slots using rolling window algorithm
      const newSlots = findNewSlots(
        validResults,
        previousSlots,
        metadata.lastSearchDate,
        config.DAYS_AHEAD,
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
        daysAhead: config.DAYS_AHEAD,
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
