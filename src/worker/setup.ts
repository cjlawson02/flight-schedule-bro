import {
  bootstrapWorker,
  createHydratedScheduler,
  loadWorkerMetadata,
  runWorkerAvailabilitySearchFlow,
} from "./workerPipeline.js";
import { getErrorMessage } from "../shared/util/errors.js";
import { initializeSnapshot } from "./kv.js";
import { sendSimpleNotification } from "./discord.js";
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

    const { config, session } = await bootstrapWorker(env);

    log.info("Loading metadata from KV");
    const fspMetadata = await loadWorkerMetadata(
      session,
      env.FSP_AVAILABILITY_KV,
    );

    log.info("Metadata loaded", {
      instructors: fspMetadata.instructors.length,
      reservationTypes: fspMetadata.reservationTypes.length,
      aircraft: fspMetadata.aircraft.length,
    });

    const scheduler = createHydratedScheduler(
      session,
      fspMetadata,
      config.TIMEZONE,
    );

    const { validResults, budget, reservationType } =
      await runWorkerAvailabilitySearchFlow({
        config,
        session,
        fspMetadata,
        scheduler,
        failFast: true,
      });

    log.info("Filtered valid time slots", { count: validResults.length });
    log.info("Activity type selected", {
      name: reservationType.reservationTypeName,
      activityTypeId: reservationType.reservationTypeId,
    });

    // Initialize snapshot in KV
    await initializeSnapshot(
      env,
      validResults,
      budget.daysAhead,
      config.TIMEZONE,
    );

    const successMessage = `✅ Setup complete! Initialized with ${validResults.length} available time slots for the next ${budget.daysAhead} days.`;
    log.info("Setup complete", {
      slotsCount: validResults.length,
      configuredDaysAhead: config.DAYS_AHEAD,
      effectiveDaysAhead: budget.daysAhead,
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
        daysAhead: budget.daysAhead,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    const errorMessage = `❌ Setup failed: ${getErrorMessage(error)}`;
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
