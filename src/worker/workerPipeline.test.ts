import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  bootstrapWorker,
  runWorkerAvailabilitySearchFlow,
} from "./workerPipeline.js";
import * as authModule from "../shared/dao/auth.js";
import * as workerSearchModule from "../shared/blo/workerAvailabilitySearch.js";
import * as metadataModule from "./metadata.js";
import { SchedulerBLO } from "../shared/blo/scheduler.js";
import { dualFlightTraining } from "../shared/dao/reservationTypes.fixtures.js";
import type { Env } from "./types.js";
import type { AuthSession } from "../shared/dao/auth.js";
import { createSubrequestBudget } from "../shared/util/subrequestBudget.js";

vi.mock("../shared/dao/auth.js");
vi.mock("../shared/blo/workerAvailabilitySearch.js");
vi.mock("./metadata.js");
vi.mock("./utils.js", () => ({
  initializeWorker: vi.fn(),
}));

const mockSession: AuthSession = {
  sessionCookies: "session=abc",
  operatorId: 123,
  subscriptionKey: "sub-key",
  authToken: "token",
  userId: "user-guid",
  pilotId: "123e4567-e89b-12d3-a456-426614174000",
  defaultLocationId: 456,
};

const mockMetadata = {
  instructors: [{ instructorId: "inst-1", displayName: "Instructor" }],
  reservationTypes: [dualFlightTraining],
  aircraft: [{ aircraftId: "ac-1", tailNumber: "N172S" }],
  lastUpdated: "2024-01-15T12:00:00.000Z",
};

describe("workerPipeline", () => {
  const mockEnv: Env = {
    FSP_AVAILABILITY_KV: {} as KVNamespace,
    FSP_EMAIL: "test@example.com",
    FSP_PASSWORD: "password",
    DISCORD_WEBHOOK_URL: "https://discord.com/webhook",
    AIRCRAFT_REGEX: "172S",
    TIMEZONE: "America/Los_Angeles",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authModule.fetchAuth).mockResolvedValue(mockSession);
    vi.mocked(metadataModule.getOrFetchMetadata).mockResolvedValue(
      mockMetadata,
    );
    vi.mocked(
      workerSearchModule.executeWorkerAvailabilitySearch,
    ).mockResolvedValue({
      validResults: [],
      search: {
        results: [],
        trackedThroughDate: "2024-01-29",
        scheduleSubrequests: 1,
        daysFetched: 14,
      },
      reservationType: dualFlightTraining,
      today: new Date("2024-01-15T08:00:00.000Z"),
    });
  });

  it("returns auth session from bootstrapWorker", async () => {
    const bootstrap = await bootstrapWorker(mockEnv);

    expect(bootstrap.session).toEqual(mockSession);
    expect(authModule.fetchAuth).toHaveBeenCalledWith(
      "test@example.com",
      "password",
    );
  });

  it("threads session auth fields into availability search", async () => {
    const { config, session } = await bootstrapWorker(mockEnv);
    const scheduler = new SchedulerBLO(session.operatorId, config.TIMEZONE);
    scheduler.hydrateFromMetadata(mockMetadata);

    await runWorkerAvailabilitySearchFlow({
      config,
      session,
      fspMetadata: mockMetadata,
      scheduler,
      budget: createSubrequestBudget(),
      failFast: true,
    });

    expect(
      workerSearchModule.executeWorkerAvailabilitySearch,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: {
          locationId: mockSession.defaultLocationId,
        },
      }),
    );
  });
});
