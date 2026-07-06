import { describe, expect, it, vi, beforeEach } from "vitest";
import { filterSlotsForNotification, runScheduledTask } from "./scheduled.js";
import type { BookableAvailability } from "../shared/dao/availability.js";
import type { FspMetadata } from "../shared/blo/fspMetadata.js";
import type { AuthSession } from "../shared/dao/auth.js";
import type { Env } from "./types.js";
import * as kvModule from "./kv.js";
import * as discordModule from "./discord.js";
import * as authModule from "../shared/dao/auth.js";
import * as existingReservationsModule from "../shared/dao/existingReservations.js";
import * as metadataModule from "./metadata.js";
import * as workerSearchModule from "../shared/blo/workerAvailabilitySearch.js";

vi.mock("./kv.js");
vi.mock("./discord.js");
vi.mock("./runLock.js", () => ({
  tryAcquireWorkerRunLock: vi.fn().mockResolvedValue(true),
  releaseWorkerRunLock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../shared/dao/auth.js");
vi.mock("../shared/dao/existingReservations.js");
vi.mock("./metadata.js");
vi.mock("../shared/blo/workerAvailabilitySearch.js");
vi.mock("./utils.js", () => ({
  initializeWorker: vi.fn(),
}));

const mockSession: AuthSession = {
  sessionCookies: "session=abc",
  operatorId: 123,
  subscriptionKey: "sub-key",
  authToken: "token",
  userId: "user-guid-123",
  pilotId: "123e4567-e89b-12d3-a456-426614174000",
  defaultLocationId: 456,
};

const mockMetadata: FspMetadata = {
  instructors: [],
  reservationTypes: [],
  aircraft: [
    { aircraftId: "ac-1", tailNumber: "N172S" },
    { aircraftId: "ac-2", tailNumber: "N152" },
  ],
  lastUpdated: "2024-01-15T12:00:00.000Z",
};

function makeSlot(aircraftId: string): BookableAvailability {
  const startDateTime = new Date("2026-07-06T03:14:34.700Z");
  const endDateTime = new Date("2026-07-06T05:14:34.700Z");

  return {
    date: "1/20/2024",
    startTime: "5:00:00 PM",
    endTime: "7:00:00 PM",
    instructorId: "123e4567-e89b-12d3-a456-426614174000",
    aircraftId,
    startDateTime,
    endDateTime,
  };
}

describe("filterSlotsForNotification", () => {
  it("returns all slots when no aircraft filter is configured", () => {
    const slots = [makeSlot("ac-1"), makeSlot("ac-2")];
    expect(filterSlotsForNotification(slots, mockMetadata, [])).toEqual(slots);
  });

  it("filters slots to configured tail numbers", () => {
    const slot1 = makeSlot("ac-1");
    const slot2 = makeSlot("ac-2");
    expect(
      filterSlotsForNotification([slot1, slot2], mockMetadata, ["N172S"]),
    ).toEqual([slot1]);
  });
});

describe("runScheduledTask", () => {
  let mockEnv: Env;

  beforeEach(() => {
    vi.clearAllMocks();

    mockEnv = {
      FSP_AVAILABILITY_KV: {} as KVNamespace,
      FSP_EMAIL: "test@example.com",
      FSP_PASSWORD: "password",
      DISCORD_WEBHOOK_URL: "https://discord.com/webhook",
      AIRCRAFT_REGEX: "172S",
      TIMEZONE: "America/Los_Angeles",
    };

    vi.mocked(kvModule.getSnapshot).mockResolvedValue({
      slots: [],
      metadata: {
        lastSearchDate: "2024-01-15",
        lastUpdate: "2024-01-15T12:00:00.000Z",
        trackedThroughDate: "2024-01-29",
      },
    });
    vi.mocked(kvModule.cleanPastSlotsFromSnapshot).mockImplementation(
      (snapshot) => snapshot,
    );
    vi.mocked(kvModule.getSlotsFromSnapshot).mockReturnValue([]);
    vi.mocked(kvModule.setSnapshot).mockResolvedValue(undefined);
    vi.mocked(authModule.fetchAuth).mockResolvedValue(mockSession);
    vi.mocked(
      existingReservationsModule.getExistingReservations,
    ).mockResolvedValue([]);
    vi.mocked(metadataModule.getOrFetchMetadata).mockResolvedValue(
      mockMetadata,
    );
    vi.mocked(
      workerSearchModule.executeWorkerAvailabilitySearch,
    ).mockResolvedValue({
      validResults: [makeSlot("ac-1")],
      search: {
        results: [makeSlot("ac-1")],
        trackedThroughDate: "2024-01-29",
        scheduleSubrequests: 1,
        daysFetched: 14,
      },
      reservationType: {
        reservationTypeId: "11111111-1111-4111-8111-111111111111",
        reservationTypeName: "Dual",
      } as never,
      today: new Date("2024-01-15T08:00:00.000Z"),
    });
    vi.mocked(discordModule.sendAvailabilityNotification).mockResolvedValue(
      undefined,
    );
  });

  it("updates the snapshot before sending Discord notifications", async () => {
    const callOrder: string[] = [];
    const now = new Date("2024-01-20T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const notifyableSlot = {
      ...makeSlot("ac-1"),
      startDateTime: new Date("2024-01-21T12:00:00.000Z"),
      endDateTime: new Date("2024-01-21T14:00:00.000Z"),
    };

    vi.mocked(
      workerSearchModule.executeWorkerAvailabilitySearch,
    ).mockResolvedValue({
      validResults: [notifyableSlot],
      search: {
        results: [notifyableSlot],
        trackedThroughDate: "2024-02-03",
        scheduleSubrequests: 1,
        daysFetched: 14,
      },
      reservationType: {
        reservationTypeId: "11111111-1111-4111-8111-111111111111",
        reservationTypeName: "Dual",
      } as never,
      today: new Date("2024-01-20T08:00:00.000Z"),
    });

    vi.mocked(kvModule.setSnapshot).mockImplementation(async () => {
      callOrder.push("setSnapshot");
    });
    vi.mocked(discordModule.sendAvailabilityNotification).mockImplementation(
      async () => {
        callOrder.push("sendAvailabilityNotification");
      },
    );

    await runScheduledTask(mockEnv);

    vi.useRealTimers();

    expect(callOrder).toEqual(["setSnapshot", "sendAvailabilityNotification"]);
  });

  it("passes explicit auth context into worker availability search", async () => {
    await runScheduledTask(mockEnv);

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

  it("throws when no snapshot exists", async () => {
    vi.mocked(kvModule.getSnapshot).mockResolvedValue(null);

    await expect(runScheduledTask(mockEnv)).rejects.toThrow(
      /No snapshot found in KV/,
    );
  });

  it("passes operator timezone to existing reservation lookup", async () => {
    await runScheduledTask(mockEnv);

    expect(
      existingReservationsModule.getExistingReservations,
    ).toHaveBeenCalledWith(mockSession.operatorId, "America/Los_Angeles");
  });

  it("does not send Discord when new slots start within 24 hours", async () => {
    const now = new Date("2024-01-20T18:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const soonSlot = {
      ...makeSlot("ac-1"),
      startDateTime: new Date("2024-01-20T20:00:00.000Z"),
      endDateTime: new Date("2024-01-20T22:00:00.000Z"),
    };

    vi.mocked(
      workerSearchModule.executeWorkerAvailabilitySearch,
    ).mockResolvedValue({
      validResults: [soonSlot],
      search: {
        results: [soonSlot],
        trackedThroughDate: "2024-02-03",
        scheduleSubrequests: 1,
        daysFetched: 14,
      },
      reservationType: {
        reservationTypeId: "11111111-1111-4111-8111-111111111111",
        reservationTypeName: "Dual",
      } as never,
      today: new Date("2024-01-20T08:00:00.000Z"),
    });

    await runScheduledTask(mockEnv);

    expect(discordModule.sendAvailabilityNotification).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("skips snapshot update when no complete days were fetched", async () => {
    vi.mocked(
      workerSearchModule.executeWorkerAvailabilitySearch,
    ).mockResolvedValue({
      validResults: [],
      search: {
        results: [],
        trackedThroughDate: null,
        scheduleSubrequests: 0,
        daysFetched: 0,
      },
      reservationType: {
        reservationTypeId: "11111111-1111-4111-8111-111111111111",
        reservationTypeName: "Dual",
      } as never,
      today: new Date("2024-01-15T08:00:00.000Z"),
    });

    await runScheduledTask(mockEnv);

    expect(kvModule.setSnapshot).not.toHaveBeenCalled();
    expect(discordModule.sendAvailabilityNotification).not.toHaveBeenCalled();
  });
});

describe("SchedulerBLO hydration in scheduled flow", () => {
  it("uses shared worker pipeline exports", async () => {
    const { bootstrapWorker, runWorkerAvailabilitySearchFlow } =
      await import("./workerPipeline.js");

    expect(bootstrapWorker).toBeTypeOf("function");
    expect(runWorkerAvailabilitySearchFlow).toBeTypeOf("function");
  });
});
