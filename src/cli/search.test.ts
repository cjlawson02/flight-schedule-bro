import { describe, expect, it, vi, beforeEach } from "vitest";
import { runCliAvailabilitySearch } from "./search.js";
import { dualFlightTraining } from "../shared/dao/reservationTypes.fixtures.js";
import * as existingReservationsModule from "../shared/dao/existingReservations.js";
import * as availabilitySearchModule from "../shared/blo/availabilitySearch.js";
import * as authModule from "../shared/dao/auth.js";
import { parseFspLocal } from "../shared/util/flightTime.js";

vi.mock("../shared/dao/auth.js", () => ({
  getUserId: vi.fn(),
  getDefaultLocationId: vi.fn(),
}));
vi.mock("../shared/dao/existingReservations.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../shared/dao/existingReservations.js")
    >();
  return {
    ...actual,
    getExistingReservations: vi.fn(),
    hasReservationOnSameDay: vi.fn(),
  };
});
vi.mock("../shared/blo/availabilitySearch.js");
vi.mock("../shared/util/progressBar.js", () => ({
  createProgressBar: () => ({
    start: vi.fn(),
    update: vi.fn(),
    stop: vi.fn(),
  }),
}));

const testConfig = {
  WEEKDAY_MIN_HOUR: 15,
  MAX_HOUR: 19,
  EMAIL: "test@example.com",
  PASSWORD: "password",
  AIRCRAFT_REGEX: /172S/i,
  INSTRUCTOR_REGEX: /Doug Libal/i,
  DAYS_AHEAD: 1,
  TIMEZONE: "America/Chicago",
};

describe("runCliAvailabilitySearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(authModule.getUserId).mockReturnValue("user-guid");
    vi.mocked(authModule.getDefaultLocationId).mockReturnValue(456);
    vi.mocked(
      existingReservationsModule.getExistingReservations,
    ).mockResolvedValue([]);
    vi.mocked(availabilitySearchModule.prepareScheduleSearch).mockReturnValue({
      searchResources: { instructors: ["inst-1"], aircraftIds: ["ac-1"] },
    });
    vi.mocked(availabilitySearchModule.buildScheduleFetchTasks).mockReturnValue(
      [Promise.resolve([])],
    );
    vi.mocked(availabilitySearchModule.fetchAllAvailability).mockResolvedValue(
      [],
    );
    vi.mocked(
      availabilitySearchModule.filterValidAvailabilityBlocks,
    ).mockReturnValue([]);
  });

  it("passes configured timezone to existing reservation lookup", async () => {
    const scheduler = {
      getInstructorIds: () => ["inst-1"],
      getAircraftMapEntries: () =>
        [["ac-1", "N172S"] as [string, string]][Symbol.iterator](),
    };

    await runCliAvailabilitySearch({
      scheduler: scheduler as never,
      config: testConfig,
      reservationType: dualFlightTraining,
      operatorId: 123,
      durationMinutes: 120,
    });

    expect(
      existingReservationsModule.getExistingReservations,
    ).toHaveBeenCalledWith(123, "America/Chicago");
  });

  it("uses explicitly selected aircraft ids when provided", async () => {
    const scheduler = {
      getInstructorIds: () => ["inst-1"],
      getAircraftMapEntries: () =>
        [
          ["ac-1", "N172S"] as [string, string],
          ["ac-2", "N734UZ"] as [string, string],
        ][Symbol.iterator](),
    };

    await runCliAvailabilitySearch({
      scheduler: scheduler as never,
      config: testConfig,
      reservationType: dualFlightTraining,
      operatorId: 123,
      durationMinutes: 120,
      aircraftIds: ["ac-2"],
    });

    expect(availabilitySearchModule.prepareScheduleSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        aircraftIds: ["ac-2"],
      }),
    );
  });

  it("uses explicitly selected instructor ids when provided", async () => {
    const scheduler = {
      getInstructorIds: () => ["inst-1", "inst-2"],
      getAircraftMapEntries: () =>
        [["ac-1", "N172S"] as [string, string]][Symbol.iterator](),
    };

    await runCliAvailabilitySearch({
      scheduler: scheduler as never,
      config: testConfig,
      reservationType: dualFlightTraining,
      operatorId: 123,
      durationMinutes: 120,
      instructorIds: ["inst-2"],
    });

    expect(availabilitySearchModule.prepareScheduleSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        allInstructorIds: ["inst-2"],
      }),
    );
  });

  it("filters out slots on days with existing reservations", async () => {
    const slotOnConflictDay = {
      date: "Mon 7/15",
      startTime: "3:00:00 PM",
      endTime: "5:00:00 PM",
      instructorId: "123e4567-e89b-12d3-a456-426614174000",
      aircraftId: "223e4567-e89b-12d3-a456-426614174000",
      startDateTime: parseFspLocal("2024-07-15T15:00:00", testConfig.TIMEZONE),
      endDateTime: parseFspLocal("2024-07-15T17:00:00", testConfig.TIMEZONE),
    };

    vi.mocked(availabilitySearchModule.fetchAllAvailability).mockResolvedValue([
      slotOnConflictDay,
    ]);
    vi.mocked(
      availabilitySearchModule.filterValidAvailabilityBlocks,
    ).mockReturnValue([slotOnConflictDay]);
    vi.mocked(
      existingReservationsModule.getExistingReservations,
    ).mockResolvedValue([
      {
        reservationId: "33333333-3333-4333-8333-333333333333",
        start: "2024-07-15T10:00:00",
        end: "2024-07-15T12:00:00",
      },
    ]);
    vi.mocked(
      existingReservationsModule.hasReservationOnSameDay,
    ).mockReturnValue(true);

    const scheduler = {
      getInstructorIds: () => ["inst-1"],
      getAircraftMapEntries: () =>
        [["ac-1", "N172S"] as [string, string]][Symbol.iterator](),
    };

    const results = await runCliAvailabilitySearch({
      scheduler: scheduler as never,
      config: testConfig,
      reservationType: dualFlightTraining,
      operatorId: 123,
      durationMinutes: 120,
    });

    expect(results).toEqual([]);
  });
});
