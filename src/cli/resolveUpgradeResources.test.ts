import { describe, expect, it, vi } from "vitest";
import {
  filterAvailabilitiesForSlot,
  resolveMissingInstructorForUpgrade,
} from "./resolveUpgradeResources.js";
import { dualFlightTraining } from "../shared/dao/reservationTypes.fixtures.js";
import { InteractiveCLI } from "../shared/util/interactive.js";
import { parseFspLocal } from "../shared/util/flightTime.js";

const LA = "America/Los_Angeles";
const aircraftId = "ad2b4bb1-1946-4c20-b1f5-51fb4039597c";
const instructorA = "bc8dbb05-d939-4539-bdf6-d4633333a169";
const instructorB = "11111111-1111-4111-8111-111111111111";

describe("filterAvailabilitiesForSlot", () => {
  const startTime = parseFspLocal("2026-06-30T16:00:00", LA);
  const endTime = parseFspLocal("2026-06-30T18:00:00", LA);

  it("returns instructors matching the exact aircraft and time", () => {
    const matches = filterAvailabilitiesForSlot(
      [
        {
          date: "6/30/2026",
          startTime: "4:00:00 PM",
          endTime: "6:00:00 PM",
          instructorId: instructorA,
          aircraftId,
          instructor: "Doug Libal",
          aircraft: "N65411",
          startDateTime: startTime,
          endDateTime: endTime,
        },
        {
          date: "6/30/2026",
          startTime: "5:00:00 PM",
          endTime: "7:00:00 PM",
          instructorId: instructorB,
          aircraftId,
          instructor: "Jane Smith",
          aircraft: "N65411",
          startDateTime: parseFspLocal("2026-06-30T17:00:00", LA),
          endDateTime: parseFspLocal("2026-06-30T19:00:00", LA),
        },
      ],
      { aircraftId, startTime, endTime },
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.instructorId).toBe(instructorA);
  });

  it("deduplicates instructors for the same slot", () => {
    const matches = filterAvailabilitiesForSlot(
      [
        {
          date: "6/30/2026",
          startTime: "4:00:00 PM",
          endTime: "6:00:00 PM",
          instructorId: instructorA,
          aircraftId,
          instructor: "Doug Libal",
          aircraft: "N65411",
          startDateTime: startTime,
          endDateTime: endTime,
        },
        {
          date: "6/30/2026",
          startTime: "4:00:00 PM",
          endTime: "6:00:00 PM",
          instructorId: instructorA,
          aircraftId,
          instructor: "Doug Libal",
          aircraft: "N65411",
          startDateTime: startTime,
          endDateTime: endTime,
        },
      ],
      { aircraftId, startTime, endTime },
    );

    expect(matches).toHaveLength(1);
  });

  it("matches instructor-only slots when no aircraft is required", () => {
    const matches = filterAvailabilitiesForSlot(
      [
        {
          date: "6/30/2026",
          startTime: "4:00:00 PM",
          endTime: "6:00:00 PM",
          instructorId: instructorA,
          aircraftId: "00000000-0000-0000-0000-000000000000",
          instructor: "Doug Libal",
          startDateTime: startTime,
          endDateTime: endTime,
        },
      ],
      { startTime, endTime },
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.instructorId).toBe(instructorA);
  });
});

describe("resolveMissingInstructorForUpgrade", () => {
  const startTime = parseFspLocal("2026-06-30T16:00:00", LA);
  const endTime = parseFspLocal("2026-06-30T18:00:00", LA);

  it("returns null with an aircraft-specific message when none are available", async () => {
    const cli = new InteractiveCLI();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const scheduler = {
      getInstructorIds: () => [instructorA],
      getBookableAvailability: vi.fn().mockResolvedValue([]),
    };

    const result = await resolveMissingInstructorForUpgrade(cli, scheduler as never, {
      customerUserGuid: "354ccb15-6534-4c59-851d-c6b4d2694320",
      locationId: 20852,
      reservationType: dualFlightTraining,
      aircraftId,
      startTime,
      endTime,
      timeZone: LA,
    });

    expect(result).toBeNull();
    expect(logSpy).toHaveBeenCalledWith(
      "❌ No instructors are available for this aircraft at this time.",
    );
    logSpy.mockRestore();
  });

  it("returns null with a generic message when searching without aircraft", async () => {
    const cli = new InteractiveCLI();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const scheduler = {
      getInstructorIds: () => [instructorA],
      getBookableAvailability: vi.fn().mockResolvedValue([]),
    };

    const result = await resolveMissingInstructorForUpgrade(cli, scheduler as never, {
      customerUserGuid: "354ccb15-6534-4c59-851d-c6b4d2694320",
      locationId: 20852,
      reservationType: dualFlightTraining,
      startTime,
      endTime,
      timeZone: LA,
    });

    expect(result).toBeNull();
    expect(logSpy).toHaveBeenCalledWith(
      "❌ No instructors are available at this time.",
    );
    logSpy.mockRestore();
  });
});
