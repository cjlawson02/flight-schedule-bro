import dotenv from "dotenv";
import { SchedulerBLO } from "../shared/blo/scheduler.js";
import { loadCliConfig } from "../shared/util/config.js";
import { clearInvalidInstructorIds } from "../shared/dao/availability.js";
import { supportsScheduleMatchSearch } from "../shared/dao/reservationTypes.js";
import { InteractiveCLI } from "../shared/util/interactive.js";
import { fetchAuth, getOperatorId } from "../shared/dao/auth.js";
import { setCacheAdapter } from "../shared/dao/api_wrapper.js";
import { cliCacheAdapter } from "./cache.js";
import { configureLogger, createLogger } from "../shared/util/logger.js";
import { getErrorMessage } from "../shared/util/errors.js";
import { logCliSearchError, runCliAvailabilitySearch } from "./search.js";
import { handleBookingFlow } from "./booking.js";

configureLogger({ runtime: "cli" });
const log = createLogger("cli");

async function main() {
  dotenv.config();
  const config = loadCliConfig();

  setCacheAdapter(cliCacheAdapter);
  clearInvalidInstructorIds();
  await fetchAuth(config.EMAIL, config.PASSWORD);

  const operatorId = getOperatorId();
  const scheduler = new SchedulerBLO(operatorId, config.TIMEZONE);
  await scheduler.initialize();

  const cli = new InteractiveCLI();
  const reservationType = await cli.selectReservationType(
    scheduler.getReservationTypes(),
    { preferredTypeId: config.RESERVATION_TYPE_ID },
  );

  if (!reservationType) {
    console.log("❌ No activity type selected. Exiting.");
    return;
  }

  if (!supportsScheduleMatchSearch(reservationType)) {
    console.log(
      `❌ "${reservationType.reservationTypeName}" is not supported for automated availability search.`,
    );
    return;
  }

  try {
    const availableWithoutConflicts = await runCliAvailabilitySearch({
      scheduler,
      config,
      reservationType,
      operatorId,
    });

    if (availableWithoutConflicts.length > 0) {
      await handleBookingFlow(
        cli,
        scheduler,
        availableWithoutConflicts,
        reservationType,
        operatorId,
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

main().catch((error: unknown) => {
  log.error("Fatal error", {
    message: getErrorMessage(error),
    error,
  });
  process.exit(1);
});
