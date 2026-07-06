import { describe, expect, it, vi } from "vitest";
import {
  buildScheduleFetchTasks,
  fetchAllAvailability,
  fetchScheduleDaysWithinBudget,
  filterValidAvailabilityBlocks,
  prepareScheduleSearch,
  resolveMaxScheduleSearchBudget,
  resolveScheduleSearchBudget,
  CLOUDFLARE_FREE_EXTERNAL_SUBREQUEST_LIMIT,
  WORKER_AVAILABILITY_OVERHEAD,
} from "./availabilitySearch.js";
import { SchedulerBLO } from "./scheduler.js";
import {
  createSubrequestBudget,
  subrequestsRemaining,
} from "../util/subrequestBudget.js";
import {
  dualFlightTraining,
  groundTraining,
  rental,
} from "../dao/reservationTypes.fixtures.js";
import { parseFspLocal } from "../util/flightTime.js";

describe("resolveScheduleSearchBudget", () => {
  it("keeps configured DAYS_AHEAD when within the subrequest budget", () => {
    expect(resolveScheduleSearchBudget(12, 1)).toEqual({
      daysAhead: 12,
      totalFetches: 13,
      capped: false,
      pagesPerDay: 1,
    });
  });

  it("caps DAYS_AHEAD when pages per day increases", () => {
    expect(resolveScheduleSearchBudget(60, 2)).toEqual({
      daysAhead: 19,
      totalFetches: 40,
      capped: true,
      pagesPerDay: 2,
    });
  });

  it("stays under the Cloudflare subrequest budget", () => {
    for (const pagesPerDay of [1, 2, 3, 4, 5]) {
      const budget = resolveScheduleSearchBudget(60, pagesPerDay);
      expect(
        budget.totalFetches + WORKER_AVAILABILITY_OVERHEAD,
      ).toBeLessThanOrEqual(CLOUDFLARE_FREE_EXTERNAL_SUBREQUEST_LIMIT);
    }
  });

  it("throws when pages per day alone exceeds the availability budget", () => {
    expect(() => resolveScheduleSearchBudget(12, 41)).toThrow(
      /subrequest budget/i,
    );
  });
});

describe("resolveMaxScheduleSearchBudget", () => {
  it("uses the full Cloudflare availability budget", () => {
    expect(resolveMaxScheduleSearchBudget(1)).toEqual({
      daysAhead: 39,
      totalFetches: 40,
      capped: false,
      pagesPerDay: 1,
    });
  });

  it("stays under the Cloudflare subrequest budget", () => {
    for (const pagesPerDay of [1, 2, 3, 4, 5]) {
      const budget = resolveMaxScheduleSearchBudget(pagesPerDay);
      expect(
        budget.totalFetches + WORKER_AVAILABILITY_OVERHEAD,
      ).toBeLessThanOrEqual(CLOUDFLARE_FREE_EXTERNAL_SUBREQUEST_LIMIT);
    }
  });
});

describe("fetchScheduleDaysWithinBudget", () => {
  it("fetches days sequentially until the subrequest budget is exhausted", async () => {
    const budget = createSubrequestBudget(5, 0);
    budget.used = 2;

    const getBookableAvailabilityForDay = vi
      .fn()
      .mockResolvedValueOnce({
        availability: [{ date: "2024-07-15" }],
        complete: true,
      })
      .mockResolvedValueOnce({
        availability: [{ date: "2024-07-16" }],
        complete: true,
      })
      .mockResolvedValueOnce({
        availability: [],
        complete: false,
      });

    const scheduler = {
      getBookableAvailabilityForDay,
    } as Pick<SchedulerBLO, "getBookableAvailabilityForDay"> as SchedulerBLO;

    const result = await fetchScheduleDaysWithinBudget({
      scheduler,
      params: {
        locationId: 1,
        timeZone: "America/Los_Angeles",
        activityTypeId: "type-1",
        reservationType: dualFlightTraining,
        allInstructorIds: ["inst-1"],
        aircraftIds: ["ac-1"],
      },
      prepared: {
        searchResources: { instructors: ["inst-1"], aircraftIds: ["ac-1"] },
      },
      today: new Date("2024-07-15T12:00:00.000Z"),
      budget,
    });

    expect(getBookableAvailabilityForDay).toHaveBeenCalledTimes(3);
    expect(result.daysFetched).toBe(2);
    expect(result.trackedThroughDate).toBe("2024-07-16");
    expect(result.results).toHaveLength(2);
    expect(subrequestsRemaining(budget)).toBe(3);
  });

  it("stops after maxDaysAhead even when budget remains", async () => {
    const budget = createSubrequestBudget(50, 0);

    const getBookableAvailabilityForDay = vi.fn().mockResolvedValue({
      availability: [{ date: "2024-07-15" }],
      complete: true,
    });

    const scheduler = {
      getBookableAvailabilityForDay,
    } as Pick<SchedulerBLO, "getBookableAvailabilityForDay"> as SchedulerBLO;

    const result = await fetchScheduleDaysWithinBudget({
      scheduler,
      params: {
        locationId: 1,
        timeZone: "America/Los_Angeles",
        activityTypeId: "type-1",
        reservationType: dualFlightTraining,
        allInstructorIds: ["inst-1"],
        aircraftIds: ["ac-1"],
      },
      prepared: {
        searchResources: { instructors: ["inst-1"], aircraftIds: ["ac-1"] },
      },
      today: new Date("2024-07-15T12:00:00.000Z"),
      budget,
      maxDaysAhead: 2,
    });

    expect(getBookableAvailabilityForDay).toHaveBeenCalledTimes(3);
    expect(result.daysFetched).toBe(3);
    expect(result.trackedThroughDate).toBe("2024-07-17");
  });
});

describe("prepareScheduleSearch", () => {
  const baseParams = {
    locationId: 20852,
    timeZone: "America/Los_Angeles",
    activityTypeId: dualFlightTraining.reservationTypeId,
    allInstructorIds: ["inst-1", "inst-2"],
    aircraftIds: ["ac-1"],
  };

  it("prepares search resources for dual instruction", () => {
    const prepared = prepareScheduleSearch({
      ...baseParams,
      reservationType: dualFlightTraining,
    });

    expect(prepared).toEqual({
      searchResources: {
        instructors: ["inst-1", "inst-2"],
        aircraftIds: ["ac-1"],
      },
    });
  });

  it("prepares aircraft-only resources for rental types", () => {
    const prepared = prepareScheduleSearch({
      ...baseParams,
      reservationType: rental,
    });

    expect(prepared).toEqual({
      searchResources: {
        instructors: [],
        aircraftIds: ["ac-1"],
      },
    });
  });

  it("returns null when no search resources are available", () => {
    const prepared = prepareScheduleSearch({
      ...baseParams,
      reservationType: groundTraining,
      allInstructorIds: [],
      aircraftIds: [],
    });

    expect(prepared).toBeNull();
  });
});

describe("buildScheduleFetchTasks", () => {
  const baseParams = {
    locationId: 20852,
    timeZone: "America/Los_Angeles",
    activityTypeId: dualFlightTraining.reservationTypeId,
    allInstructorIds: ["inst-1"],
    aircraftIds: ["ac-1"],
  };

  it("passes selected duration to schedule snapshot search", () => {
    const reservationType = { ...dualFlightTraining, defaultLength: 90 };
    const getBookableAvailability = vi.fn().mockResolvedValue([]);
    const scheduler = {
      getBookableAvailability,
    } as Pick<SchedulerBLO, "getBookableAvailability"> as SchedulerBLO;

    buildScheduleFetchTasks(scheduler, {
      params: {
        ...baseParams,
        reservationType,
        durationMinutes: 60,
      },
      prepared: {
        searchResources: { instructors: ["inst-1"], aircraftIds: ["ac-1"] },
      },
      today: parseFspLocal("2024-07-15T12:00:00", "America/Los_Angeles"),
      daysAhead: 0,
    });

    expect(getBookableAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ lengthOfReservationInMinutes: 60 }),
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
    INSTRUCTOR_REGEX: /Doug Libal/i,
    DAYS_AHEAD: 12,
    TIMEZONE: "America/Los_Angeles",
  };

  it("keeps slots matching expected duration", () => {
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
