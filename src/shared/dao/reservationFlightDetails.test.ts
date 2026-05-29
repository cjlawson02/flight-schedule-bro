import { describe, expect, it } from "vitest";
import {
  FLIGHT_RULES_VFR,
  FLIGHT_TYPE_LOCAL,
  formatFlightRules,
  formatFlightType,
  reservationTypeUsesFlightDetails,
  validateActivityFlightDetails,
} from "./reservationFlightDetails.js";
import { dualFlightTraining, rental } from "./reservationTypes.fixtures.js";

describe("reservationFlightDetails", () => {
  it("detects when a reservation type uses flight detail fields", () => {
    expect(reservationTypeUsesFlightDetails(dualFlightTraining)).toBe(false);
    expect(reservationTypeUsesFlightDetails(rental)).toBe(true);
  });

  it("formats flight type and rules labels", () => {
    expect(formatFlightType(FLIGHT_TYPE_LOCAL)).toBe("Local");
    expect(formatFlightRules(FLIGHT_RULES_VFR)).toBe("VFR");
  });

  it("validates required flight detail fields", () => {
    expect(
      validateActivityFlightDetails(
        {
          ...rental,
          flightRulesRequirement: 2,
        },
        { flightType: FLIGHT_TYPE_LOCAL },
      ),
    ).toBe("Flight rules are required.");
  });
});
