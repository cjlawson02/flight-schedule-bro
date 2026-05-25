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
import { SchedulerBLO } from "../shared/blo/scheduler.js";

vi.mock("./kv.js");
vi.mock("./discord.js");
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
  return {
    date: "1/20/2024",
    startTime: "5:00:00 PM",
    endTime: "7:00:00 PM",
    instructorId: "123e4567-e89b-12d3-a456-426614174000",
    aircraftId,
    startDateTime: new Date("2024-01-20T17:00:00.000Z"),
    endDateTime: new Date("2024-01-20T19:00:00.000Z"),
  };
}

describe("filterSlotsForNotification", () => {
  it("returns all slots when no aircraft filter is configured", () => {
    const slots = [makeSlot("ac-1"), makeSlot("ac-2")];
    expect(filterSlotsForNotification(slots, mockMetadata, [])).toEqual(slots);
  });

  it("filters slots to configured tail numbers", () => {
    const slots = [makeSlot("ac-1"), makeSlot("ac-2")];
    expect(filterSlotsForNotification(slots, mockMetadata, ["N172S"])).toEqual([
      makeSlot("ac-1"),
    ]);
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
      DAYS_AHEAD: "14",
      AIRCRAFT_REGEX: "172S",
      TIMEZONE: "America/Los_Angeles",
    };

    vi.mocked(kvModule.getSnapshot).mockResolvedValue({
      slots: [],
      metadata: {
        lastSearchDate: "2024-01-15",
        lastUpdate: "2024-01-15T12:00:00.000Z",
        daysAhead: 14,
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
      budget: {
        daysAhead: 14,
        totalFetches: 1,
        capped: false,
        instructorChunkCount: 1,
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

    vi.mocked(kvModule.setSnapshot).mockImplementation(async () => {
      callOrder.push("setSnapshot");
    });
    vi.mocked(discordModule.sendAvailabilityNotification).mockImplementation(
      async () => {
        callOrder.push("sendAvailabilityNotification");
      },
    );

    await runScheduledTask(mockEnv);

    expect(callOrder).toEqual(["setSnapshot", "sendAvailabilityNotification"]);
  });

  it("passes explicit auth context into worker availability search", async () => {
    await runScheduledTask(mockEnv);

    expect(
      workerSearchModule.executeWorkerAvailabilitySearch,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: {
          customerUserGuid: mockSession.userId,
          locationId: mockSession.defaultLocationId,
          operatorId: mockSession.operatorId,
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
});

describe("SchedulerBLO hydration in scheduled flow", () => {
  it("uses shared worker pipeline exports", async () => {
    const { bootstrapWorker, runWorkerAvailabilitySearchFlow } =
      await import("./workerPipeline.js");

    expect(bootstrapWorker).toBeTypeOf("function");
    expect(runWorkerAvailabilitySearchFlow).toBeTypeOf("function");
  });
});
