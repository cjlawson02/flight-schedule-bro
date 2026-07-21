import { describe, expect, it } from "vitest";
import { computeBookableAvailabilityFromSnapshot } from "./scheduleAvailability.js";
import { filterValidAvailabilityBlocks } from "./availabilitySearch.js";
import { dualFlightTraining } from "../dao/reservationTypes.fixtures.js";
import { selectPreferredAircraftIds } from "../dao/aircraft.js";
import jul6Fixture from "../dao/fixtures/schedule-day-2026-07-06.json" with { type: "json" };
import jul13Fixture from "../dao/fixtures/schedule-day-2026-07-13.json" with { type: "json" };
import type { ScheduleDaySnapshot } from "../dao/schedule.js";
import { parseFspLocal } from "../util/flightTime.js";

const testConfig = {
  WEEKDAY_MIN_HOUR: 15,
  WEEKEND_MIN_HOUR: 8,
  MAX_HOUR: 19,
  EMAIL: "test@example.com",
  PASSWORD: "password",
  AIRCRAFT_REGEX: /65411|734UZ|713RE/i,
  INSTRUCTOR_REGEX: /Doug Libal/i,
  DAYS_AHEAD: 7,
  TIMEZONE: "America/Los_Angeles",
};

function resourcesFromFixture(fixture: { results: ScheduleDaySnapshot }) {
  const aircraft = fixture.results.resources
    .filter((resource) => resource.ResourceTypeId === 1)
    .map((resource) => ({
      aircraftId: resource.Id,
      tailNumber: resource.Name,
    }));
  const instructorIds = fixture.results.resources
    .filter((resource) => resource.ResourceTypeId === 2)
    .map((resource) => resource.Id);

  return {
    aircraftIds: selectPreferredAircraftIds(
      aircraft,
      testConfig.AIRCRAFT_REGEX,
    ),
    instructorIds,
    aircraftMap: new Map(aircraft.map((a) => [a.aircraftId, a.tailNumber])),
    instructorsMap: new Map(
      instructorIds.map((id) => [id, `Instructor ${id.slice(0, 8)}`]),
    ),
  };
}

describe("computeBookableAvailabilityFromSnapshot", () => {
  it("returns zero afternoon dual slots on Jul 6 when preferred aircraft are fully booked", () => {
    const { aircraftIds, instructorIds, aircraftMap, instructorsMap } =
      resourcesFromFixture(jul6Fixture);

    const results = computeBookableAvailabilityFromSnapshot({
      snapshot: jul6Fixture.results,
      day: "2026-07-06",
      timeZone: testConfig.TIMEZONE,
      reservationType: dualFlightTraining,
      aircraftIds,
      instructorIds,
      durationMinutes: 120,
      instructorsMap,
      aircraftMap,
    });

    const valid = filterValidAvailabilityBlocks(results, testConfig, 120);

    expect(valid).toHaveLength(0);
  });

  it("includes a 4:30 PM start on Jul 13 for 90-minute dual training", () => {
    const { aircraftIds, instructorIds, aircraftMap, instructorsMap } =
      resourcesFromFixture(jul13Fixture);

    const results = computeBookableAvailabilityFromSnapshot({
      snapshot: jul13Fixture.results,
      day: "2026-07-13",
      timeZone: testConfig.TIMEZONE,
      reservationType: dualFlightTraining,
      aircraftIds,
      instructorIds,
      durationMinutes: 90,
      instructorsMap,
      aircraftMap,
    });

    const valid = filterValidAvailabilityBlocks(results, testConfig, 90);
    const has430Start = valid.some(
      (slot) =>
        slot.startDateTime.getTime() ===
        parseFspLocal("2026-07-13T16:30:00", testConfig.TIMEZONE).getTime(),
    );

    expect(has430Start).toBe(true);
    expect(
      valid.some(
        (slot) =>
          slot.startDateTime.getTime() ===
          parseFspLocal("2026-07-13T17:00:00", testConfig.TIMEZONE).getTime(),
      ),
    ).toBe(true);
  });

  it("emits one slot per free instructor for the same aircraft time", () => {
    const instructorA = "11111111-1111-4111-8111-111111111111";
    const instructorB = "22222222-2222-4222-8222-222222222222";
    const aircraftId = "33333333-3333-4333-8333-333333333333";

    const results = computeBookableAvailabilityFromSnapshot({
      snapshot: {
        resources: [
          { Id: aircraftId, Name: "N172", ResourceTypeId: 1 },
          { Id: instructorA, Name: "Alice", ResourceTypeId: 2 },
          { Id: instructorB, Name: "Bob", ResourceTypeId: 2 },
        ],
        events: [],
        unavailability: [],
        closings: [],
      },
      day: "2030-07-15",
      timeZone: testConfig.TIMEZONE,
      reservationType: dualFlightTraining,
      aircraftIds: [aircraftId],
      instructorIds: [instructorA, instructorB],
      durationMinutes: 60,
      instructorsMap: new Map([
        [instructorA, "Alice"],
        [instructorB, "Bob"],
      ]),
      aircraftMap: new Map([[aircraftId, "N172"]]),
    });

    const threePm = parseFspLocal("2030-07-15T15:00:00", testConfig.TIMEZONE);
    const matching = results.filter(
      (slot) => slot.startDateTime.getTime() === threePm.getTime(),
    );

    expect(matching).toHaveLength(2);
    expect(new Set(matching.map((slot) => slot.instructorId))).toEqual(
      new Set([instructorA, instructorB]),
    );
  });
});
