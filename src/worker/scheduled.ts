import {
  bootstrapWorker,
  createHydratedScheduler,
  loadWorkerMetadata,
  runWorkerAvailabilitySearchFlow,
} from "./workerPipeline.js";
import { formatOperatorIsoDate, startOfOperatorDay } from "../shared/util/flightTime.js";
import {
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
import { fetchCalendarBusyFromIcalUrl, type BusyInterval } from "../shared/util/calendarBusy.js";
import {
  getSnapshot,
  getSlotsFromSnapshot,
  setSnapshot,
  cleanPastSlotsFromSnapshot,
} from "./kv.js";
import { sendAutoBookNotification } from "./discord.js";
import { autoBookSlots, selectAutoBookCandidates } from "./autoBook.js";
import { releaseWorkerRunLock, tryAcquireWorkerRunLock } from "./runLock.js";
import { createLogger } from "../shared/util/logger.js";
import type { Env } from "./types.js";

const log = createLogger("scheduled");

export async function runScheduledTask(env: Env, _ctx?: ExecutionContext): Promise<void> {
  log.info("Scheduled task started", { timestamp: new Date().toISOString() });

  const runId = `scheduled-${Date.now()}`;
  const lockAcquired = await tryAcquireWorkerRunLock(env.FSP_AVAILABILITY_KV, runId);
  if (!lockAcquired) {
    return;
  }

  const paidMode = parseWorkersPaidPlan(env.WORKERS_PAID_PLAN);
  const budget = createWorkerSubrequestBudget({ paidMode });
  setActiveSubrequestBudget(budget);

  try {
    const snapshot = await getSnapshot(env);
    if (!snapshot) {
      throw new Error("No snapshot found in KV. Please run setup first by visiting /setup");
    }

    const { config, session } = await bootstrapWorker(env);
    const now = new Date();
    const today = startOfOperatorDay(now, config.TIMEZONE);
    const { metadata } = snapshot;
    const previousTrackedThroughDate = resolveTrackedThroughDate(metadata, config.TIMEZONE);

    const icalUrl = env.CALENDAR_ICAL_URL?.trim() || "";
    const icalConfigured = icalUrl.length > 0;
    budget.reserve =
      (icalConfigured ? 1 : 0) + (config.AUTO_BOOK ? config.AUTO_BOOK_MAX_PER_RUN + 1 : 0); // books + book Discord

    log.info("Rolling window state", {
      lastSearchDate: metadata.lastSearchDate,
      previousTrackedThroughDate,
      today: formatOperatorIsoDate(today, config.TIMEZONE),
      autoBook: config.AUTO_BOOK,
      calendarIcal: icalConfigured,
      subrequestsUsed: budget.used,
      reserve: budget.reserve,
    });

    const cleanedSnapshot = cleanPastSlotsFromSnapshot(snapshot, now, config.TIMEZONE);
    const previousSlots = getSlotsFromSnapshot(cleanedSnapshot);
    log.info("Previous snapshot loaded", { slotCount: previousSlots.length });

    log.info("Fetching existing reservations");
    const existingReservations = await getExistingReservations(session.operatorId, config.TIMEZONE);
    log.info("Existing reservations loaded", {
      count: existingReservations.length,
      subrequestsUsed: budget.used,
    });

    const fspMetadata = await loadWorkerMetadata(session, env.FSP_AVAILABILITY_KV, {
      allowApiRefresh: false,
    });
    log.info("FSP metadata loaded", {
      instructors: fspMetadata.instructors.length,
      reservationTypes: fspMetadata.reservationTypes.length,
      aircraft: fspMetadata.aircraft.length,
      subrequestsUsed: budget.used,
    });

    const scheduler = createHydratedScheduler(session, fspMetadata, config.TIMEZONE);

    const { validResults, search, reservationType } = await runWorkerAvailabilitySearchFlow({
      config,
      session,
      fspMetadata,
      scheduler,
      budget,
      today,
      failFast: true,
    });

    log.info("Monitoring reservation type", {
      reservationTypeName: reservationType.reservationTypeName,
      reservationTypeId: reservationType.reservationTypeId,
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

    let busyIntervals: BusyInterval[] = [];
    let icalFetchFailed = false;
    if (icalConfigured) {
      try {
        busyIntervals = await fetchCalendarBusyFromIcalUrl(icalUrl, config.TIMEZONE);
      } catch (error) {
        icalFetchFailed = true;
        log.error("Failed to load calendar iCal", {
          message: getErrorMessage(error),
          error,
        });
      }
    }

    const updatedMetadata = {
      lastSearchDate: formatOperatorIsoDate(today, config.TIMEZONE),
      lastUpdate: new Date().toISOString(),
      trackedThroughDate: mergedTrackedThroughDate,
    };

    await setSnapshot(env, mergedSlots, updatedMetadata);

    const bookedKeys = new Set<string>();
    if (config.AUTO_BOOK) {
      if (icalConfigured && icalFetchFailed) {
        log.warn("Skipping auto-book: calendar iCal fetch failed");
      } else {
        if (!icalConfigured) {
          log.warn("AUTO_BOOK without CALENDAR_ICAL_URL — using FSP same-day conflicts only");
        }

        const candidates = selectAutoBookCandidates({
          slots: bookableSlots,
          existingReservations,
          busyIntervals,
          metadata: fspMetadata,
          timeZone: config.TIMEZONE,
          maxPerRun: config.AUTO_BOOK_MAX_PER_RUN,
          now,
          ignoreCalendarBusyAfterMinutes: config.AUTO_BOOK_IGNORE_CALENDAR_AFTER_MINUTES,
        });

        log.info("Auto-book candidates", { count: candidates.length });

        const booked = await autoBookSlots({
          scheduler,
          reservationType,
          locationId: session.defaultLocationId,
          candidates,
          budget,
        });

        for (const result of booked) {
          bookedKeys.add(`${result.slot.date}|${result.slot.startTime}|${result.slot.aircraftId}`);
        }

        if (booked.length > 0) {
          try {
            await sendAutoBookNotification(
              env,
              booked.map(({ slot, response }) => ({
                date: slot.date,
                startTime: slot.startTime,
                endTime: slot.endTime,
                aircraftTail: slot.aircraftTail,
                reservationId: response.id,
              })),
              config.TIMEZONE,
            );
          } catch (error) {
            log.error("Failed to send auto-book Discord notification", {
              message: getErrorMessage(error),
              error,
            });
          }
        }
      }
    }

    // Availability Discord disabled — only auto-book successes notify.
    if (newSlots.length > 0) {
      log.info("New slots found (no availability Discord)", {
        newSlotCount: newSlots.length,
        autoBooked: bookedKeys.size,
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
