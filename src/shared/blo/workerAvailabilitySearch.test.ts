import { describe, expect, it, vi } from "vitest";
import {
  buildWorkerSearchResources,
  executeWorkerAvailabilitySearch,
} from "./workerAvailabilitySearch.js";
import { dualFlightTraining } from "../dao/reservationTypes.fixtures.js";
import { SchedulerBLO } from "./scheduler.js";
import * as availabilitySearchModule from "./availabilitySearch.js";
import { createSubrequestBudget } from "../util/subrequestBudget.js";

describe("buildWorkerSearchResources", () => {
  it("selects monitoring reservation type and preferred aircraft", () => {
    const result = buildWorkerSearchResources(
      {
        WEEKDAY_MIN_HOUR: 15,
        WEEKEND_MIN_HOUR: 8,
        MAX_HOUR: 19,
        EMAIL: "test@example.com",
        PASSWORD: "password",
        AIRCRAFT_REGEX: /172S/i,
        INSTRUCTOR_REGEX: /Doug Libal/i,
        TIMEZONE: "America/Los_Angeles",
      },
      {
        instructors: [{ instructorId: "inst-1", displayName: "Instructor" }],
        reservationTypes: [dualFlightTraining],
        aircraft: [
          { aircraftId: "ac-1", tailNumber: "N172S" },
          { aircraftId: "ac-2", tailNumber: "N152" },
        ],
        lastUpdated: "2024-01-15T12:00:00.000Z",
      },
    );

    expect(result.reservationType).toEqual(dualFlightTraining);
    expect(result.aircraftIds).toEqual(["ac-1"]);
    expect(result.allInstructorIds).toEqual(["inst-1"]);
  });

  it("throws when no reservation types are available", () => {
    expect(() =>
      buildWorkerSearchResources(
        {
          WEEKDAY_MIN_HOUR: 15,
          WEEKEND_MIN_HOUR: 8,
          MAX_HOUR: 19,
          EMAIL: "test@example.com",
          PASSWORD: "password",
          AIRCRAFT_REGEX: /172S/i,
          INSTRUCTOR_REGEX: /Doug Libal/i,
          TIMEZONE: "America/Los_Angeles",
        },
        {
          instructors: [],
          reservationTypes: [],
          aircraft: [],
          lastUpdated: "2024-01-15T12:00:00.000Z",
        },
      ),
    ).toThrow(/No reservation types available/);
  });
});

describe("executeWorkerAvailabilitySearch", () => {
  it("uses explicit auth context and subrequest budget", async () => {
    vi.spyOn(
      availabilitySearchModule,
      "fetchScheduleDaysWithinBudget",
    ).mockResolvedValue({
      results: [],
      trackedThroughDate: "2024-07-15",
      scheduleSubrequests: 3,
      daysFetched: 2,
    });
    vi.spyOn(
      availabilitySearchModule,
      "filterValidAvailabilityBlocks",
    ).mockReturnValue([]);
    vi.spyOn(availabilitySearchModule, "prepareScheduleSearch").mockReturnValue(
      {
        searchResources: { instructors: ["inst-1"], aircraftIds: ["ac-1"] },
      },
    );

    const scheduler = new SchedulerBLO(123, "America/Los_Angeles");
    const budget = createSubrequestBudget();

    await executeWorkerAvailabilitySearch({
      config: {
        WEEKDAY_MIN_HOUR: 15,
        WEEKEND_MIN_HOUR: 8,
        MAX_HOUR: 19,
        EMAIL: "test@example.com",
        PASSWORD: "password",
        AIRCRAFT_REGEX: /172S/i,
        INSTRUCTOR_REGEX: /Doug Libal/i,
        TIMEZONE: "America/Los_Angeles",
      },
      fspMetadata: {
        instructors: [{ instructorId: "inst-1", displayName: "Instructor" }],
        reservationTypes: [dualFlightTraining],
        aircraft: [{ aircraftId: "ac-1", tailNumber: "N172S" }],
        lastUpdated: "2024-01-15T12:00:00.000Z",
      },
      scheduler,
      auth: {
        locationId: 999,
      },
      budget,
      today: new Date("2024-07-15T12:00:00.000Z"),
      failFast: true,
    });

    expect(
      availabilitySearchModule.fetchScheduleDaysWithinBudget,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduler,
        budget,
        failFast: true,
        params: expect.objectContaining({
          locationId: 999,
        }),
      }),
    );
  });
});
