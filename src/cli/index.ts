import dotenv from "dotenv";
import { SchedulerBLO } from "../shared/blo/scheduler.js";
import { loadCliConfig } from "../shared/util/config.js";
import {
  reservationTypeUsesAircraft,
  reservationTypeUsesInstructor,
  supportsAvailabilitySearch,
} from "../shared/dao/reservationTypes.js";
import {
  reservationTypeUsesFlightDetails,
  validateActivityFlightDetails,
} from "../shared/dao/reservationFlightDetails.js";
import { InteractiveCLI } from "../shared/util/interactive.js";
import {
  fetchAuth,
  getOperatorId,
  setActiveAuthSession,
} from "../shared/dao/auth.js";
import { setCacheAdapter } from "../shared/dao/api_wrapper.js";
import { cliCacheAdapter } from "./cache.js";
import { configureLogger, createLogger } from "../shared/util/logger.js";
import { getErrorMessage } from "../shared/util/errors.js";
import type { ConfigType } from "../shared/util/config.js";
import { logCliSearchError, runCliAvailabilitySearch } from "./search.js";
import { handleBookingFlow } from "./booking.js";
import { runManageExistingActivityWorkflow } from "./manage.js";

configureLogger({ runtime: "cli" });
const log = createLogger("cli");

async function runBookWorkflow(
  cli: InteractiveCLI,
  scheduler: SchedulerBLO,
  config: ConfigType,
  operatorId: number,
): Promise<void> {
  const reservationType = await cli.selectReservationType(
    scheduler.getReservationTypes(),
    { preferredTypeId: config.RESERVATION_TYPE_ID },
  );

  if (!reservationType) {
    console.log("❌ No activity type selected.");
    return;
  }

  if (!supportsAvailabilitySearch(reservationType)) {
    console.log(
      `❌ "${reservationType.reservationTypeName}" is not supported for automated availability search.`,
    );
    return;
  }

  const durationMinutes = await cli.selectDurationMinutes(reservationType);
  if (durationMinutes === null) {
    return;
  }

  let aircraftIds: string[] | undefined;
  if (reservationTypeUsesAircraft(reservationType)) {
    const aircraft = Array.from(
      scheduler.getAircraftMapEntries(),
      ([aircraftId, tailNumber]) => ({
        aircraftId,
        tailNumber,
      }),
    );
    const selectedTailNumbers = await cli.selectTailNumbers(
      aircraft,
      config.AIRCRAFT_REGEX,
    );
    if (selectedTailNumbers === null) {
      return;
    }
    aircraftIds = selectedTailNumbers;
  }

  let instructorIds: string[] | undefined;
  if (reservationTypeUsesInstructor(reservationType)) {
    const instructors = Array.from(
      scheduler.getInstructorMapEntries(),
      ([instructorId, displayName]) => ({
        instructorId,
        displayName,
      }),
    );
    const selectedInstructors = await cli.selectInstructors(
      instructors,
      config.INSTRUCTOR_REGEX,
    );
    if (selectedInstructors === null) {
      return;
    }
    instructorIds = selectedInstructors;
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

  try {
    const availableWithoutConflicts = await runCliAvailabilitySearch({
      scheduler,
      config,
      reservationType,
      operatorId,
      durationMinutes,
      aircraftIds,
      instructorIds,
    });

    if (availableWithoutConflicts.length > 0) {
      await handleBookingFlow(
        cli,
        scheduler,
        availableWithoutConflicts,
        reservationType,
        operatorId,
        flightDetails,
      );
    } else {
      console.log("❌ No availability found for the specified criteria.");
      console.log(
        "💡 Try adjusting your time preferences in the configuration.",
      );
    }
  } catch (error) {
    logCliSearchError(error);
  }
}

async function main() {
  dotenv.config();
  const config = loadCliConfig();

  setCacheAdapter(cliCacheAdapter);
  setActiveAuthSession(await fetchAuth(config.EMAIL, config.PASSWORD));

  const operatorId = getOperatorId();
  const scheduler = new SchedulerBLO(operatorId, config.TIMEZONE);
  await scheduler.initialize();

  const cli = new InteractiveCLI();

  for (;;) {
    const action = await cli.selectMainAction();

    if (!action || action === "exit") {
      console.log("👋 Goodbye!");
      return;
    }

    if (action === "manage-existing-activity") {
      await runManageExistingActivityWorkflow(
        cli,
        scheduler,
        config,
        operatorId,
      );
      continue;
    }

    await runBookWorkflow(cli, scheduler, config, operatorId);
  }
}

main().catch((error: unknown) => {
  log.error("Fatal error", {
    message: getErrorMessage(error),
    error,
  });
  process.exit(1);
});
