import { describe, expect, it } from "vitest";
import { groupAvailabilitiesByTimeSlot } from "./availability.js";

describe("groupAvailabilitiesByTimeSlot", () => {
  it("groups availabilities by date and time", () => {
    const slotA1 = {
      date: "Mon 7/15",
      startTime: "3:00:00 PM",
      endTime: "5:00:00 PM",
      instructorId: "inst-1",
      aircraftId: "ac-1",
      startDateTime: new Date("2024-07-15T15:00:00"),
      endDateTime: new Date("2024-07-15T17:00:00"),
    };
    const slotA2 = { ...slotA1, instructorId: "inst-2", aircraftId: "ac-2" };
    const slotB = {
      ...slotA1,
      startTime: "5:00:00 PM",
      endTime: "7:00:00 PM",
      startDateTime: new Date("2024-07-15T17:00:00"),
      endDateTime: new Date("2024-07-15T19:00:00"),
    };

    const groups = groupAvailabilitiesByTimeSlot([slotB, slotA2, slotA1]);

    expect(groups).toHaveLength(2);
    expect(groups[0].availabilities).toHaveLength(2);
    expect(groups[1].availabilities).toHaveLength(1);
  });
});
