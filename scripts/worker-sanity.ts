/**
 * Local sanity check for the worker schedule search (uses .env via dotenv).
 * Run: npx tsx scripts/worker-sanity.ts
 */
import "dotenv/config";
import { fetchAuth } from "../src/shared/dao/auth.js";
import { fetchFspMetadata } from "../src/shared/blo/fspMetadata.js";
import { SchedulerBLO } from "../src/shared/blo/scheduler.js";
import { executeWorkerAvailabilitySearch } from "../src/shared/blo/workerAvailabilitySearch.js";
import {
  createConfig,
  type WorkerConfigType,
} from "../src/shared/util/config.js";
import { startOfOperatorDay } from "../src/shared/util/flightTime.js";
import {
  CLOUDFLARE_FREE_EXTERNAL_SUBREQUEST_LIMIT,
  createSubrequestBudget,
  setActiveSubrequestBudget,
} from "../src/shared/util/subrequestBudget.js";
import { setCacheAdapter } from "../src/shared/dao/api_wrapper.js";

setCacheAdapter(null);

const fullConfig = createConfig(process.env);
const { DAYS_AHEAD: _daysAhead, ...workerConfig } = fullConfig satisfies {
  DAYS_AHEAD: number;
} & WorkerConfigType;

const budget = createSubrequestBudget();
setActiveSubrequestBudget(budget);

try {
  console.log("Authenticating…");
  const session = await fetchAuth(workerConfig.EMAIL, workerConfig.PASSWORD);
  console.log("Auth OK", {
    operatorId: session.operatorId,
    locationId: session.defaultLocationId,
    subrequestsUsed: budget.used,
  });

  console.log("Loading FSP metadata…");
  const fspMetadata = await fetchFspMetadata(session.operatorId);
  console.log("Metadata OK", {
    instructors: fspMetadata.instructors.length,
    aircraft: fspMetadata.aircraft.length,
    reservationTypes: fspMetadata.reservationTypes.length,
    subrequestsUsed: budget.used,
  });

  const scheduler = new SchedulerBLO(session.operatorId, workerConfig.TIMEZONE);
  scheduler.hydrateFromMetadata(fspMetadata);

  const today = startOfOperatorDay(new Date(), workerConfig.TIMEZONE);
  console.log("Running sequential schedule search…");

  const { validResults, search, reservationType } =
    await executeWorkerAvailabilitySearch({
      config: workerConfig,
      fspMetadata,
      scheduler,
      auth: { locationId: session.defaultLocationId },
      budget,
      today,
      failFast: true,
    });

  console.log("\n--- Worker search summary ---");
  console.log(
    JSON.stringify(
      {
        reservationType: reservationType.reservationTypeName,
        daysFetched: search.daysFetched,
        trackedThroughDate: search.trackedThroughDate,
        scheduleSubrequests: search.scheduleSubrequests,
        validSlotCount: validResults.length,
        sampleSlots: validResults.slice(0, 3).map((slot) => ({
          date: slot.date,
          startTime: slot.startTime,
          aircraft: slot.aircraft,
          instructor: slot.instructor,
        })),
        totalSubrequestsUsed: budget.used,
        subrequestLimit: CLOUDFLARE_FREE_EXTERNAL_SUBREQUEST_LIMIT,
      },
      null,
      2,
    ),
  );
} finally {
  setActiveSubrequestBudget(null);
}
