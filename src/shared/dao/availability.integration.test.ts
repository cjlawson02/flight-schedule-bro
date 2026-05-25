import { describe, expect, it } from "vitest";
import { AvailabilityResultSchema } from "./availability.js";

describe("Availability Schema Validation - Real API Shapes", () => {
  it("parses dual instruction results with instructor and aircraft ids", () => {
    const dualResult = AvailabilityResultSchema.parse({
      timeBlocks: [{ startAt: "2026-05-25T15:00", endAt: "2026-05-25T17:00" }],
      flightInstructorId: "123e4567-e89b-12d3-a456-426614174000",
      aircraftId: "223e4567-e89b-12d3-a456-426614174000",
    });

    expect(dualResult.flightInstructorId).toBeTruthy();
    expect(dualResult.aircraftId).toBeTruthy();
  });

  it("parses rental results when flightInstructorId is null", () => {
    const rentalResult = AvailabilityResultSchema.parse({
      timeBlocks: [{ startAt: "2026-05-25T15:00", endAt: "2026-05-25T17:00" }],
      flightInstructorId: null,
      aircraftId: "cc20d524-b205-43df-9670-5db41a761f87",
    });

    expect(rentalResult.flightInstructorId).toBeNull();
    expect(rentalResult.aircraftId).toBeTruthy();
  });

  it("parses aircraft-only results when instructor id is omitted", () => {
    const aircraftOnlyResult = AvailabilityResultSchema.parse({
      timeBlocks: [{ startAt: "2026-05-25T15:00", endAt: "2026-05-25T17:00" }],
      aircraftId: "cc20d524-b205-43df-9670-5db41a761f87",
    });

    expect(aircraftOnlyResult.flightInstructorId).toBeUndefined();
    expect(aircraftOnlyResult.aircraftId).toBeTruthy();
  });
});
