import { describe, expect, it } from "vitest";
import {
  getAvailabilitySearchResources,
  getFieldState,
  ReservationTypeSchema,
  reservationTypeRequiresAircraft,
  reservationTypeRequiresInstructor,
  reservationTypeUsesAircraft,
  reservationTypeUsesInstructor,
  selectMonitoringReservationType,
  supportsScheduleMatchSearch,
} from "./reservationTypes.js";
import {
  dualFlightTraining,
  groundTraining,
  rental,
} from "./reservationTypes.fixtures.js";

describe("reservation type helpers", () => {
  it("derives field state from reservation type metadata", () => {
    expect(getFieldState(dualFlightTraining, "aircraft")).toEqual({
      enabled: true,
      required: true,
    });
    expect(getFieldState(groundTraining, "aircraft")).toEqual({
      enabled: false,
      required: false,
    });
    expect(getFieldState(rental, "instructor")).toEqual({
      enabled: false,
      required: false,
    });
    expect(reservationTypeUsesAircraft(dualFlightTraining)).toBe(true);
    expect(reservationTypeUsesInstructor(groundTraining)).toBe(true);
    expect(reservationTypeUsesAircraft(groundTraining)).toBe(false);
    expect(reservationTypeUsesInstructor(rental)).toBe(false);
    expect(reservationTypeRequiresAircraft(dualFlightTraining)).toBe(true);
    expect(reservationTypeRequiresInstructor(groundTraining)).toBe(true);
    expect(reservationTypeRequiresAircraft(rental)).toBe(true);
    expect(reservationTypeRequiresInstructor(rental)).toBe(false);
  });

  it("builds availability search resources per reservation type", () => {
    expect(
      getAvailabilitySearchResources(dualFlightTraining, ["inst-1"], ["ac-1"]),
    ).toEqual({
      instructors: ["inst-1"],
      aircraftIds: ["ac-1"],
    });

    expect(
      getAvailabilitySearchResources(groundTraining, ["inst-1"], ["ac-1"]),
    ).toEqual({
      instructors: ["inst-1"],
      aircraftIds: [],
    });

    expect(
      getAvailabilitySearchResources(rental, ["inst-1"], ["ac-1"]),
    ).toEqual({
      instructors: [],
      aircraftIds: ["ac-1"],
    });
  });

  it("prefers instructor-and-aircraft types for automated monitoring", () => {
    expect(
      selectMonitoringReservationType([
        groundTraining,
        dualFlightTraining,
        rental,
      ])?.reservationTypeName,
    ).toBe("Dual Flight Training");
  });

  it("uses RESERVATION_TYPE_ID when configured", () => {
    expect(
      selectMonitoringReservationType(
        [groundTraining, dualFlightTraining, rental],
        rental.reservationTypeId,
      )?.reservationTypeName,
    ).toBe("Rental");
  });

  it("supports schedule match when at least one resource is enabled", () => {
    expect(supportsScheduleMatchSearch(dualFlightTraining)).toBe(true);
    expect(supportsScheduleMatchSearch(groundTraining)).toBe(true);
    expect(supportsScheduleMatchSearch(rental)).toBe(true);
  });

  it("infers enabled resources from requirement levels when booleans are omitted", () => {
    const rentalFromApi = ReservationTypeSchema.parse({
      reservationTypeId: rental.reservationTypeId,
      reservationTypeName: "Rental",
      aircraftRequirement: 2,
    });
    const groundFromApi = ReservationTypeSchema.parse({
      reservationTypeId: groundTraining.reservationTypeId,
      reservationTypeName: "Ground Training",
      instructorRequirement: 2,
    });

    expect(supportsScheduleMatchSearch(rentalFromApi)).toBe(true);
    expect(supportsScheduleMatchSearch(groundFromApi)).toBe(true);
    expect(
      getAvailabilitySearchResources(rentalFromApi, ["inst-1"], ["ac-1"]),
    ).toEqual({
      instructors: [],
      aircraftIds: ["ac-1"],
    });
  });
});
