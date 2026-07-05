import type { SchedulerBLO } from "../shared/blo/scheduler.js";
import type { ExistingReservation } from "../shared/dao/existingReservations.js";
import {
  getExistingReservations,
  getUpcomingReservations,
} from "../shared/dao/existingReservations.js";
import type { ActivityFlightDetails } from "../shared/dao/reservationFlightDetails.js";
import {
  formatFlightRules,
  formatFlightType,
  reservationTypeUsesFlightDetails,
  validateActivityFlightDetails,
} from "../shared/dao/reservationFlightDetails.js";
import type { ReservationType } from "../shared/dao/reservationTypes.js";
import { getFieldState } from "../shared/dao/reservationTypes.js";
import type { ReservationDetail } from "../shared/dao/reservationManagement.js";
import {
  cancelReservation,
  getCancellationReasons,
  getReservationById,
  parseReservationDetailTimes,
  resolveUpdateResourcesForType,
  updateReservation,
  validateUpdateResourcesForType,
} from "../shared/dao/reservationManagement.js";
import type { ConfigType } from "../shared/util/config.js";
import { FspHttpError } from "../shared/dao/api_wrapper.js";
import { getErrorMessage } from "../shared/util/errors.js";
import { createLogger } from "../shared/util/logger.js";
import { InteractiveCLI } from "../shared/util/interactive.js";
import {
  needsInstructorResolution,
  resolveMissingInstructorForUpgrade,
} from "./resolveUpgradeResources.js";

const log = createLogger("cli-manage");

function formatUpdateValidationError(error: unknown): string {
  if (error instanceof FspHttpError) {
    const response = error.response;
    if (
      typeof response === "object" &&
      response !== null &&
      "errors" in response &&
      Array.isArray(response.errors)
    ) {
      const messages = response.errors
        .map((entry: unknown) => {
          if (
            typeof entry === "object" &&
            entry !== null &&
            "message" in entry &&
            typeof (entry as { message?: unknown }).message === "string"
          ) {
            return (entry as { message: string }).message;
          }
          return "Unknown error";
        })
        .join(", ");
      if (messages) {
        return messages;
      }
    }
  }

  return getErrorMessage(error).replace(/^Reservation update failed: /i, "");
}

interface ResolvedChangeResources {
  aircraftId?: string;
  instructorId?: string;
  instructorDisplayName: string;
}

function findReservationTypeName(
  scheduler: SchedulerBLO,
  reservationTypeId: string,
  fallback?: string,
): string {
  return (
    scheduler
      .getReservationTypes()
      .find((type) => type.reservationTypeId === reservationTypeId)
      ?.reservationTypeName ??
    fallback ??
    "Unknown"
  );
}

async function resolveChangeActivityResources(
  cli: InteractiveCLI,
  scheduler: SchedulerBLO,
  config: ConfigType,
  reservation: ExistingReservation,
  detail: ReservationDetail,
  reservationType: ReservationType,
  startTime: Date,
  endTime: Date,
): Promise<ResolvedChangeResources | null> {
  const aircraftField = getFieldState(reservationType, "aircraft");
  const instructorField = getFieldState(reservationType, "instructor");
  const resolvedResources = resolveUpdateResourcesForType(
    detail,
    reservationType,
  );
  const aircraftId = resolvedResources.aircraftId;
  let instructorId = resolvedResources.instructorId;

  const resourceValidationError = validateUpdateResourcesForType(
    detail,
    reservationType,
  );
  if (resourceValidationError) {
    console.log(`❌ ${resourceValidationError}`);
    return null;
  }

  let instructorDisplayName = "—";
  if (instructorField.enabled && instructorId) {
    instructorDisplayName = reservation.instructor ?? "—";
  }

  if (needsInstructorResolution(reservationType, instructorId)) {
    const searchAircraftId = aircraftField.enabled ? aircraftId : undefined;

    if (aircraftField.required && !searchAircraftId) {
      console.log(
        "❌ Cannot search for instructors: the new activity type requires an aircraft, but this activity has none assigned.",
      );
      return null;
    }

    const resolved = await resolveMissingInstructorForUpgrade(cli, scheduler, {
      locationId: detail.locationId,
      reservationType,
      aircraftId: searchAircraftId,
      startTime,
      endTime,
      timeZone: config.TIMEZONE,
    });
    if (!resolved) {
      return null;
    }

    instructorId = resolved.instructorId;
    instructorDisplayName = resolved.instructorName ?? instructorDisplayName;
  }

  return { aircraftId, instructorId, instructorDisplayName };
}

function printChangeActivitySummary(
  cli: InteractiveCLI,
  config: ConfigType,
  reservation: ExistingReservation,
  reservationType: ReservationType,
  currentTypeName: string,
  startTime: Date,
  endTime: Date,
  instructorDisplayName: string,
  flightDetails?: ActivityFlightDetails,
): string {
  const aircraftField = getFieldState(reservationType, "aircraft");
  const instructorField = getFieldState(reservationType, "instructor");
  const timeSummary = cli.formatActivityAtTime(
    startTime,
    endTime,
    config.TIMEZONE,
    aircraftField.enabled ? (reservation.resource ?? "—") : "—",
    instructorDisplayName,
  );

  console.log("\n📋 Ready to update:");
  console.log(
    `Activity type: ${reservationType.reservationTypeName} (was ${currentTypeName})`,
  );
  console.log(`Time: ${timeSummary} (unchanged)`);
  if (flightDetails?.flightType !== undefined) {
    console.log(`Flight type: ${formatFlightType(flightDetails.flightType)}`);
  }
  if (flightDetails?.flightRules !== undefined) {
    console.log(
      `Flight rules: ${formatFlightRules(flightDetails.flightRules)}`,
    );
  }
  if (flightDetails?.estimatedFlightHours) {
    console.log(`Estimated hours: ${flightDetails.estimatedFlightHours}`);
  }
  if (flightDetails?.flightRoute) {
    console.log(`Route: ${flightDetails.flightRoute}`);
  }
  if (instructorField.enabled && instructorDisplayName !== "—") {
    console.log(`Instructor: ${instructorDisplayName}`);
  } else if (!instructorField.enabled && reservation.instructor) {
    console.log(`Instructor: none (was ${reservation.instructor})`);
  }

  return timeSummary;
}

async function handleCancelActivity(
  cli: InteractiveCLI,
  reservation: ExistingReservation,
  operatorId: number,
): Promise<void> {
  const reasons = await getCancellationReasons(operatorId);
  if (reasons.length === 0) {
    console.log("❌ No cancellation reasons are available.");
    return;
  }

  const reason = await cli.selectCancellationReason(reasons);
  if (!reason) {
    return;
  }

  let reasonText = "";
  if (reason.requiresExplanation) {
    const explanation = await cli.promptText(
      "Enter a cancellation explanation:",
    );
    if (explanation === null) {
      return;
    }
    reasonText = explanation;
    if (!reasonText.trim()) {
      console.log("❌ Cancellation explanation is required.");
      return;
    }
  }

  const confirmed = await cli.confirmAction(
    `Cancel this activity (${reason.name})?`,
  );
  if (!confirmed) {
    return;
  }

  try {
    await cancelReservation({
      reservationId: reservation.reservationId,
      operatorId,
      reasonId: reason.id,
      reasonText,
    });
    console.log("✅ Activity cancelled.");
  } catch (error) {
    log.error("Failed to cancel activity", {
      reservationId: reservation.reservationId,
      message: getErrorMessage(error),
      error,
    });
    console.log(`❌ Failed to cancel activity: ${getErrorMessage(error)}`);
  }
}

async function handleChangeActivityType(
  cli: InteractiveCLI,
  scheduler: SchedulerBLO,
  config: ConfigType,
  reservation: ExistingReservation,
  operatorId: number,
): Promise<void> {
  let detail;
  try {
    detail = await getReservationById(operatorId, reservation.reservationId);
  } catch (error) {
    console.log(
      `❌ Could not load activity details: ${getErrorMessage(error)}`,
    );
    return;
  }

  const currentTypeName = findReservationTypeName(
    scheduler,
    detail.reservationTypeId,
    detail.reservationType?.reservationTypeName,
  );

  console.log("\n✏️  Change activity type");
  console.log(
    `Current: ${cli.formatExistingActivity(reservation, config.TIMEZONE)}`,
  );
  console.log(`Activity type: ${currentTypeName}`);

  const reservationType = await cli.selectReservationType(
    scheduler.getReservationTypes(),
    { excludeTypeIds: [detail.reservationTypeId] },
  );

  if (!reservationType) {
    console.log("❌ No activity type selected.");
    return;
  }

  let flightDetails;
  if (reservationTypeUsesFlightDetails(reservationType)) {
    flightDetails = await cli.collectActivityFlightDetails(reservationType);
    if (!flightDetails) {
      return;
    }

    const validationError = validateActivityFlightDetails(
      reservationType,
      flightDetails,
    );
    if (validationError) {
      console.log(`❌ ${validationError}`);
      return;
    }
  }

  const { startTime, endTime } = parseReservationDetailTimes(
    detail,
    config.TIMEZONE,
  );
  const resources = await resolveChangeActivityResources(
    cli,
    scheduler,
    config,
    reservation,
    detail,
    reservationType,
    startTime,
    endTime,
  );
  if (!resources) {
    return;
  }

  const { aircraftId, instructorId, instructorDisplayName } = resources;

  const updateParams = {
    reservationId: detail.reservationId,
    reservationType,
    operatorId,
    locationId: detail.locationId,
    pilotId: detail.pilot.pilotId,
    aircraftId,
    instructorId,
    startTime,
    endTime,
    timeZone: config.TIMEZONE,
    schedulingGroupId: detail.aircraftSummary?.schedulingGroupId ?? null,
    schedulingGroupSlotId:
      detail.aircraftSummary?.schedulingGroupSlotId ?? null,
    flightDetails,
    comments: detail.comments ?? "",
    orFor: detail.orFor ?? null,
    validateOnly: true,
  };

  console.log("\n⏳ Checking if this update is available...");
  try {
    await updateReservation(updateParams);
  } catch (error) {
    console.log(
      `❌ This update is not available: ${formatUpdateValidationError(error)}`,
    );
    return;
  }

  const timeSummary = printChangeActivitySummary(
    cli,
    config,
    reservation,
    reservationType,
    currentTypeName,
    startTime,
    endTime,
    instructorDisplayName,
    flightDetails,
  );

  const confirmed = await cli.confirmAction("Confirm and proceed with update?");
  if (!confirmed) {
    return;
  }

  try {
    console.log("⏳ Committing your update...");
    await updateReservation({ ...updateParams, validateOnly: false });
    console.log(
      `✅ Updated: ${timeSummary} | ${reservationType.reservationTypeName}`,
    );
  } catch (error) {
    log.error("Failed to update activity", {
      reservationId: reservation.reservationId,
      message: getErrorMessage(error),
      error,
    });
    const message = formatUpdateValidationError(error);
    console.log(
      `❌ Failed to update activity: ${message || "The slot may no longer be available — try again."}`,
    );
  }
}

export async function runManageExistingActivityWorkflow(
  cli: InteractiveCLI,
  scheduler: SchedulerBLO,
  config: ConfigType,
  operatorId: number,
): Promise<void> {
  let reservations;
  try {
    reservations = await getExistingReservations(operatorId, config.TIMEZONE);
  } catch (error) {
    log.warn("Failed to load existing activities", {
      message: getErrorMessage(error),
      error,
    });
    console.log("\n⚠️  Could not load your existing activities.");
    return;
  }

  const upcoming = getUpcomingReservations(reservations, config.TIMEZONE);
  const selectedActivity = await cli.selectExistingActivity(
    upcoming,
    config.TIMEZONE,
  );
  if (!selectedActivity) {
    return;
  }

  const manageAction = await cli.selectManageActivityAction();
  if (!manageAction || manageAction === "back") {
    return;
  }

  if (manageAction === "cancel") {
    await handleCancelActivity(cli, selectedActivity, operatorId);
    return;
  }

  await handleChangeActivityType(
    cli,
    scheduler,
    config,
    selectedActivity,
    operatorId,
  );
}
