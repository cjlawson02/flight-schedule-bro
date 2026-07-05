import { describe, expect, it } from "vitest";
import type { BookableAvailability } from "../dao/availability.js";
import {
  BOOKING_MIN_LEAD_HOURS,
  DISCORD_NOTIFICATION_MIN_LEAD_HOURS,
  filterSlotsBookable,
  filterSlotsForDiscordNotification,
  filterSlotsNotInPast,
  findNewSlots,
  isSlotStartInPast,
  isSlotStartTooSoonForBooking,
  isSlotStartTooSoonForDiscordNotification,
} from "./slots.js";

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

describe("slot start time filters", () => {
  const now = new Date("2024-01-20T18:00:00.000Z");

  it("detects past slot starts", () => {
    expect(isSlotStartInPast(new Date("2024-01-20T17:59:59.999Z"), now)).toBe(
      true,
    );
    expect(isSlotStartInPast(new Date("2024-01-20T18:00:00.000Z"), now)).toBe(
      false,
    );
  });

  it("detects slots starting within the Discord lead window", () => {
    const withinLead = new Date(
      now.getTime() + DISCORD_NOTIFICATION_MIN_LEAD_HOURS * 60 * 60 * 1000 - 1,
    );
    const afterLead = new Date(
      now.getTime() + DISCORD_NOTIFICATION_MIN_LEAD_HOURS * 60 * 60 * 1000,
    );

    expect(
      isSlotStartTooSoonForDiscordNotification(withinLead, undefined, now),
    ).toBe(true);
    expect(
      isSlotStartTooSoonForDiscordNotification(afterLead, undefined, now),
    ).toBe(false);
  });

  it("filters past slots from CLI suggestions", () => {
    const slots = [
      makeSlot({ startDateTime: new Date("2024-01-20T17:00:00.000Z") }),
      makeSlot({ startDateTime: new Date("2024-01-21T17:00:00.000Z") }),
    ];

    expect(filterSlotsNotInPast(slots, now)).toHaveLength(1);
    expect(filterSlotsNotInPast(slots, now)[0].startDateTime).toEqual(
      new Date("2024-01-21T17:00:00.000Z"),
    );
  });

  it("filters past and near-term slots from Discord notifications", () => {
    const slots = [
      makeSlot({ startDateTime: new Date("2024-01-20T17:00:00.000Z") }),
      makeSlot({ startDateTime: new Date("2024-01-21T17:59:59.999Z") }),
      makeSlot({ startDateTime: new Date("2024-01-21T18:00:00.000Z") }),
    ];

    expect(filterSlotsForDiscordNotification(slots, now)).toEqual([
      makeSlot({ startDateTime: new Date("2024-01-21T18:00:00.000Z") }),
    ]);
  });

  it("detects slots starting within the booking lead window", () => {
    const withinLead = new Date(
      now.getTime() + BOOKING_MIN_LEAD_HOURS * 60 * 60 * 1000 - 1,
    );
    const afterLead = new Date(
      now.getTime() + BOOKING_MIN_LEAD_HOURS * 60 * 60 * 1000,
    );

    expect(isSlotStartTooSoonForBooking(withinLead, undefined, now)).toBe(true);
    expect(isSlotStartTooSoonForBooking(afterLead, undefined, now)).toBe(false);
  });

  it("filters slots that start within 24 hours from bookable results", () => {
    const slots = [
      makeSlot({ startDateTime: new Date("2024-01-20T17:00:00.000Z") }),
      makeSlot({ startDateTime: new Date("2024-01-20T20:59:59.999Z") }),
      makeSlot({ startDateTime: new Date("2024-01-21T18:01:00.000Z") }),
    ];

    expect(filterSlotsBookable(slots, now)).toEqual([
      makeSlot({ startDateTime: new Date("2024-01-21T18:01:00.000Z") }),
    ]);
  });
});

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
