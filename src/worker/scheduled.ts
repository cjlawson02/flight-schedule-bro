import {
  bootstrapWorker,
  createHydratedScheduler,
  loadWorkerMetadata,
  runWorkerAvailabilitySearchFlow,
} from "./workerPipeline.js";
import {
  formatOperatorIsoDate,
  startOfOperatorDay,
} from "../shared/util/flightTime.js";
import {
  filterSlotsForDiscordNotification,
  filterSlotsNotInPast,
  findNewSlots,
  maxIsoDate,
  mergeRefreshedSnapshotSlots,
} from "../shared/util/slots.js";
import { resolveTrackedThroughDate } from "../shared/util/snapshotTracking.js";
import {
  createWorkerSubrequestBudget,
  parseWorkersPaidPlan,
  setActiveSubrequestBudget,
} from "../shared/util/subrequestBudget.js";
import { setActiveAuthSession } from "../shared/dao/auth.js";
import { getErrorMessage } from "../shared/util/errors.js";
import { getExistingReservations } from "../shared/dao/existingReservations.js";
import type { BookableAvailability } from "../shared/dao/availability.js";
import type { FspMetadata } from "../shared/blo/fspMetadata.js";
import {
  getSnapshot,
  getSlotsFromSnapshot,
  setSnapshot,
  cleanPastSlotsFromSnapshot,
} from "./kv.js";
import { sendAvailabilityNotification } from "./discord.js";
import { releaseWorkerRunLock, tryAcquireWorkerRunLock } from "./runLock.js";
import { createLogger } from "../shared/util/logger.js";
import type { Env } from "./types.js";

const log = createLogger("scheduled");

export function filterSlotsForNotification(
  newSlots: BookableAvailability[],
  fspMetadata: FspMetadata,
  notificationAircraftTailNumbers: string[],
): BookableAvailability[] {
  if (notificationAircraftTailNumbers.length === 0) {
    return newSlots;
  }

  const notificationAircraftIds = new Set(
    fspMetadata.aircraft
      .filter((aircraft) =>
        notificationAircraftTailNumbers.includes(aircraft.tailNumber),
      )
      .map((aircraft) => aircraft.aircraftId),
  );

  return newSlots.filter((slot) =>
    notificationAircraftIds.has(slot.aircraftId),
  );
}

export async function runScheduledTask(
  env: Env,
  ctx?: ExecutionContext,
): Promise<void> {
  log.info("Scheduled task started", { timestamp: new Date().toISOString() });

  const runId = `scheduled-${Date.now()}`;
  const lockAcquired = await tryAcquireWorkerRunLock(
    env.FSP_AVAILABILITY_KV,
    runId,
  );
  if (!lockAcquired) {
    return;
  }

  const paidMode = parseWorkersPaidPlan(env.WORKERS_PAID_PLAN);
  const budget = createWorkerSubrequestBudget({ paidMode });
  setActiveSubrequestBudget(budget);

  try {
    const snapshot = await getSnapshot(env);
    if (!snapshot) {
      throw new Error(
        "No snapshot found in KV. Please run setup first by visiting /setup",
      );
    }

    const { config, session } = await bootstrapWorker(env);
    const now = new Date();
    const today = startOfOperatorDay(now, config.TIMEZONE);
    const { metadata } = snapshot;
    const previousTrackedThroughDate = resolveTrackedThroughDate(
      metadata,
      config.TIMEZONE,
    );

    log.info("Rolling window state", {
      lastSearchDate: metadata.lastSearchDate,
      previousTrackedThroughDate,
      today: formatOperatorIsoDate(today, config.TIMEZONE),
      subrequestsUsed: budget.used,
    });

    const cleanedSnapshot = cleanPastSlotsFromSnapshot(
      snapshot,
      now,
      config.TIMEZONE,
    );
    const previousSlots = getSlotsFromSnapshot(cleanedSnapshot);
    log.info("Previous snapshot loaded", { slotCount: previousSlots.length });

    log.info("Fetching existing reservations");
    const existingReservations = await getExistingReservations(
      session.operatorId,
      config.TIMEZONE,
    );
    log.info("Existing reservations loaded", {
      count: existingReservations.length,
      subrequestsUsed: budget.used,
    });

    const fspMetadata = await loadWorkerMetadata(
      session,
      env.FSP_AVAILABILITY_KV,
      { allowApiRefresh: false },
    );
    log.info("FSP metadata loaded", {
      instructors: fspMetadata.instructors.length,
      reservationTypes: fspMetadata.reservationTypes.length,
      aircraft: fspMetadata.aircraft.length,
      subrequestsUsed: budget.used,
    });

    const scheduler = createHydratedScheduler(
      session,
      fspMetadata,
      config.TIMEZONE,
    );

    const { validResults, search } = await runWorkerAvailabilitySearchFlow({
      config,
      session,
      fspMetadata,
      scheduler,
      budget,
      today,
      failFast: true,
    });

    const bookableSlots = filterSlotsNotInPast(validResults, now);
    log.info("Filtered valid time slots", {
      count: bookableSlots.length,
      removedPast: validResults.length - bookableSlots.length,
      daysFetched: search.daysFetched,
      trackedThroughDate: search.trackedThroughDate,
      scheduleSubrequests: search.scheduleSubrequests,
      subrequestsUsed: budget.used,
    });

    if (search.daysFetched === 0 || search.trackedThroughDate === null) {
      log.warn("Skipping snapshot update: no complete schedule days fetched", {
        daysFetched: search.daysFetched,
        subrequestsUsed: budget.used,
      });
      return;
    }

    const mergedSlots = mergeRefreshedSnapshotSlots(
      bookableSlots,
      previousSlots,
      search.trackedThroughDate,
      config.TIMEZONE,
    );
    const mergedTrackedThroughDate = maxIsoDate(
      previousTrackedThroughDate,
      search.trackedThroughDate,
    );

    const newSlots = findNewSlots(
      mergedSlots,
      previousSlots,
      previousTrackedThroughDate,
      config.TIMEZONE,
    );
    log.info("New slots within tracked window", { count: newSlots.length });

    const notificationAircraftTailNumbers = env.NOTIFICATION_AIRCRAFT
      ? env.NOTIFICATION_AIRCRAFT.split(",").map((value) => value.trim())
      : [];
    const slotsToNotify = filterSlotsForDiscordNotification(
      filterSlotsForNotification(
        newSlots,
        fspMetadata,
        notificationAircraftTailNumbers,
      ),
      now,
    );

    log.info("Slots selected for notification", {
      count: slotsToNotify.length,
      filter:
        notificationAircraftTailNumbers.length > 0
          ? notificationAircraftTailNumbers
          : "all aircraft",
    });

    const updatedMetadata = {
      lastSearchDate: formatOperatorIsoDate(today, config.TIMEZONE),
      lastUpdate: new Date().toISOString(),
      trackedThroughDate: mergedTrackedThroughDate,
    };

    await setSnapshot(env, mergedSlots, updatedMetadata);

    if (slotsToNotify.length > 0) {
      log.info("Sending Discord notification");
      const notify = () =>
        sendAvailabilityNotification(
          env,
          slotsToNotify,
          fspMetadata,
          existingReservations,
          config.TIMEZONE,
        );

      try {
        await notify();
      } catch (error) {
        log.error("Failed to send Discord notification", {
          message: getErrorMessage(error),
          error,
        });
        if (ctx) {
          ctx.waitUntil(
            notify().catch((retryError: unknown) => {
              log.error("Discord notification retry failed", {
                message: getErrorMessage(retryError),
                error: retryError,
              });
            }),
          );
        }
      }
    } else if (newSlots.length > 0) {
      log.info("Skipping notification: no slots match filter", {
        newSlotCount: newSlots.length,
      });
    }

    log.info("Scheduled task completed successfully", {
      subrequestsUsed: budget.used,
      subrequestLimit: budget.limit,
      paidMode,
    });
  } finally {
    setActiveSubrequestBudget(null);
    setActiveAuthSession(null);
    await releaseWorkerRunLock(env.FSP_AVAILABILITY_KV, runId);
  }
}
