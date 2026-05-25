import { describe, expect, it, vi } from "vitest";
import {
  buildAvailabilityFetchTasks,
  fetchAllAvailability,
  filterValidAvailabilityBlocks,
  prepareAvailabilitySearch,
  resolveAvailabilityDaysAhead,
  CLOUDFLARE_SUBREQUEST_LIMIT,
  WORKER_AVAILABILITY_OVERHEAD,
} from "./availabilitySearch.js";
import { SchedulerBLO } from "./scheduler.js";
import {
  dualFlightTraining,
  groundTraining,
  rental,
} from "../dao/reservationTypes.fixtures.js";
import { parseFspLocal } from "../util/flightTime.js";

describe("resolveAvailabilityDaysAhead", () => {
  it("keeps configured DAYS_AHEAD when within the subrequest budget", () => {
    expect(resolveAvailabilityDaysAhead(12, 3)).toEqual({
      daysAhead: 12,
      totalFetches: 39,
      capped: false,
      instructorChunkCount: 3,
    });
  });

  it("caps DAYS_AHEAD when instructor chunk count increases", () => {
    expect(resolveAvailabilityDaysAhead(12, 4)).toEqual({
      daysAhead: 9,
      totalFetches: 40,
      capped: true,
      instructorChunkCount: 4,
    });
  });

  it("stays under the Cloudflare subrequest budget", () => {
    for (const chunkCount of [1, 2, 3, 4, 5, 10]) {
      const budget = resolveAvailabilityDaysAhead(60, chunkCount);
      expect(
        budget.totalFetches + WORKER_AVAILABILITY_OVERHEAD,
      ).toBeLessThanOrEqual(CLOUDFLARE_SUBREQUEST_LIMIT);
    }
  });

  it("throws when chunk count alone exceeds the availability budget", () => {
    expect(() => resolveAvailabilityDaysAhead(12, 41)).toThrow(
      /subrequest budget/i,
    );
  });
});

describe("prepareAvailabilitySearch", () => {
  const baseParams = {
    customerUserGuid: "customer-1",
    locationId: 20852,
    operatorId: 191057,
    timeZone: "America/Los_Angeles",
    activityTypeId: dualFlightTraining.reservationTypeId,
    allInstructorIds: ["inst-1", "inst-2"],
    aircraftIds: ["ac-1"],
  };

  it("prepares instructor chunks for dual instruction", () => {
    const prepared = prepareAvailabilitySearch({
      ...baseParams,
      reservationType: dualFlightTraining,
    });

    expect(prepared).toEqual({
      searchResources: {
        instructors: ["inst-1", "inst-2"],
        aircraftIds: ["ac-1"],
      },
      instructorChunks: [["inst-1", "inst-2"]],
    });
  });

  it("prepares aircraft-only chunks for rental types", () => {
    const prepared = prepareAvailabilitySearch({
      ...baseParams,
      reservationType: rental,
    });

    expect(prepared).toEqual({
      searchResources: {
        instructors: [],
        aircraftIds: ["ac-1"],
      },
      instructorChunks: [[]],
    });
  });

  it("returns null when no search resources are available", () => {
    const prepared = prepareAvailabilitySearch({
      ...baseParams,
      reservationType: groundTraining,
      allInstructorIds: [],
      aircraftIds: [],
    });

    expect(prepared).toBeNull();
  });
});

describe("buildAvailabilityFetchTasks", () => {
  const baseParams = {
    customerUserGuid: "customer-1",
    locationId: 20852,
    operatorId: 191057,
    timeZone: "America/Los_Angeles",
    activityTypeId: dualFlightTraining.reservationTypeId,
    allInstructorIds: ["inst-1"],
    aircraftIds: ["ac-1"],
  };

  it("passes reservation type defaultLength without scheduler.initialize()", () => {
    const reservationType = { ...dualFlightTraining, defaultLength: 90 };
    const getBookableAvailability = vi.fn().mockResolvedValue([]);
    const scheduler = {
      getBookableAvailability,
    } as Pick<SchedulerBLO, "getBookableAvailability"> as SchedulerBLO;

    buildAvailabilityFetchTasks(scheduler, {
      params: { ...baseParams, reservationType },
      prepared: {
        searchResources: { instructors: ["inst-1"], aircraftIds: ["ac-1"] },
        instructorChunks: [["inst-1"]],
      },
      today: parseFspLocal("2024-07-15T12:00:00", "America/Los_Angeles"),
      daysAhead: 0,
    });

    expect(getBookableAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ lengthOfReservationInMinutes: 90 }),
    );
  });
});

describe("filterValidAvailabilityBlocks", () => {
  const testConfig = {
    WEEKDAY_MIN_HOUR: 15,
    MAX_HOUR: 19,
    EMAIL: "test@example.com",
    PASSWORD: "password",
    AIRCRAFT_REGEX: /172S/i,
    DAYS_AHEAD: 12,
    TIMEZONE: "America/Los_Angeles",
  };

  it("keeps slots matching reservation type defaultLength", () => {
    const validSlot = {
      date: "Mon 7/15",
      startTime: "3:00:00 PM",
      endTime: "4:30:00 PM",
      instructorId: "00000000-0000-0000-0000-000000000001",
      aircraftId: "00000000-0000-0000-0000-000000000002",
      startDateTime: parseFspLocal("2024-07-15T15:00:00", testConfig.TIMEZONE),
      endDateTime: parseFspLocal("2024-07-15T16:30:00", testConfig.TIMEZONE),
    };
    const invalidSlot = {
      ...validSlot,
      endDateTime: parseFspLocal("2024-07-15T17:00:00", testConfig.TIMEZONE),
    };

    expect(
      filterValidAvailabilityBlocks([validSlot, invalidSlot], testConfig, 90),
    ).toEqual([validSlot]);
  });
});

describe("fetchAllAvailability", () => {
  it("throws when failFast is enabled and any request rejects", async () => {
    const tasks = [
      Promise.resolve([]),
      Promise.reject(new Error("availability failed")),
    ];

    await expect(
      fetchAllAvailability(tasks, { failFast: true }),
    ).rejects.toThrow("availability failed");
  });

  it("returns partial results when failFast is disabled", async () => {
    const slot = {
      date: "Mon 5/25",
      startTime: "1 PM",
      endTime: "3 PM",
      instructorId: "00000000-0000-0000-0000-000000000001",
      aircraftId: "00000000-0000-0000-0000-000000000002",
      startDateTime: new Date("2026-05-25T13:00:00"),
      endDateTime: new Date("2026-05-25T15:00:00"),
    };

    const tasks = [
      Promise.resolve([slot]),
      Promise.reject(new Error("failed")),
    ];

    await expect(fetchAllAvailability(tasks)).resolves.toEqual([slot]);
  });
});
