import { describe, expect, it } from "vitest";
import type { BookableAvailability } from "../dao/availability.js";
import { findNewSlots } from "./slots.js";

const LA = "America/Los_Angeles";

function makeSlot(
  overrides: Partial<BookableAvailability> &
    Pick<BookableAvailability, "startDateTime">,
): BookableAvailability {
  return {
    date: "1/20/2024",
    startTime: "5:00:00 PM",
    endTime: "7:00:00 PM",
    instructorId: "123e4567-e89b-12d3-a456-426614174000",
    aircraftId: "223e4567-e89b-12d3-a456-426614174000",
    endDateTime: new Date("2024-01-20T19:00:00.000Z"),
    ...overrides,
  };
}

describe("findNewSlots", () => {
  it("identifies new slots within the rolling window", () => {
    const previous = [
      makeSlot({
        startDateTime: new Date("2024-01-20T17:00:00.000Z"),
        aircraftId: "223e4567-e89b-12d3-a456-426614174000",
      }),
    ];
    const current = [
      ...previous,
      makeSlot({
        startDateTime: new Date("2024-01-25T15:00:00.000Z"),
        aircraftId: "323e4567-e89b-12d3-a456-426614174000",
        date: "1/25/2024",
        startTime: "3:00:00 PM",
      }),
    ];

    const result = findNewSlots(current, previous, "2024-01-15", 10, LA);

    expect(result).toHaveLength(1);
    expect(result[0].aircraftId).toBe("323e4567-e89b-12d3-a456-426614174000");
  });

  it("excludes slots beyond the tracked window", () => {
    const current = [
      makeSlot({ startDateTime: new Date("2024-01-20T17:00:00.000Z") }),
      makeSlot({
        startDateTime: new Date("2024-02-01T15:00:00.000Z"),
        date: "2/1/2024",
        aircraftId: "323e4567-e89b-12d3-a456-426614174000",
      }),
    ];

    const result = findNewSlots(current, [], "2024-01-15", 10, LA);

    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("1/20/2024");
  });
});
