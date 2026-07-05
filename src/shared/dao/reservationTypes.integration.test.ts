import { describe, expect, it } from "vitest";
import {
  ReservationTypeSchema,
  reservationTypeMissingFieldMetadata,
  supportsAvailabilitySearch,
} from "./reservationTypes.js";

describe("ReservationTypes Schema Validation - Real API Shapes", () => {
  it("parses rental types when FSP omits enabled booleans", () => {
    const rentalFromApi = ReservationTypeSchema.parse({
      reservationTypeId: "cc20d524-b205-43df-9670-5db41a761f87",
      reservationTypeName: "Rental",
      aircraftRequirement: 2,
      defaultLength: 120,
    });

    expect(supportsAvailabilitySearch(rentalFromApi)).toBe(true);
    expect(reservationTypeMissingFieldMetadata(rentalFromApi)).toBe(false);
  });

  it("parses ground training when only instructorRequirement is present", () => {
    const groundFromApi = ReservationTypeSchema.parse({
      reservationTypeId: "11111111-1111-4111-8111-111111111111",
      reservationTypeName: "Ground Training",
      instructorRequirement: 2,
      defaultLength: 60,
    });

    expect(supportsAvailabilitySearch(groundFromApi)).toBe(true);
    expect(reservationTypeMissingFieldMetadata(groundFromApi)).toBe(false);
  });

  it("detects cached id/name-only reservation types missing field metadata", () => {
    const legacyCached = ReservationTypeSchema.parse({
      reservationTypeId: "11111111-1111-4111-8111-111111111111",
      reservationTypeName: "Dual Flight Training",
    });

    expect(reservationTypeMissingFieldMetadata(legacyCached)).toBe(true);
    expect(supportsAvailabilitySearch(legacyCached)).toBe(false);
  });

  it("parses dual instruction payloads with explicit enabled flags", () => {
    const dualFromApi = ReservationTypeSchema.parse({
      reservationTypeId: "22222222-2222-4222-8222-222222222222",
      reservationTypeName: "Dual Flight Training",
      aircraftEnabled: true,
      instructorEnabled: true,
      aircraftRequirement: 2,
      instructorRequirement: 2,
      defaultLength: 120,
    });

    expect(reservationTypeMissingFieldMetadata(dualFromApi)).toBe(false);
    expect(supportsAvailabilitySearch(dualFromApi)).toBe(true);
  });
});
