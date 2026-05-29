import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveSlotSelections } from "./timeSlotSelection.js";
import { InteractiveCLI } from "../shared/util/interactive.js";

describe("resolveSlotSelections", () => {
  let cli: InteractiveCLI;

  beforeEach(() => {
    cli = new InteractiveCLI();
    vi.restoreAllMocks();
  });

  it("auto-selects when a slot has only one availability option", async () => {
    const availability = {
      date: "5/30/2026",
      startTime: "2:00:00 PM",
      endTime: "4:00:00 PM",
      instructor: "Nate Platt",
      aircraft: "N713RE",
      instructorId: "bc8dbb05-d939-4539-bdf6-d4633333a169",
      aircraftId: "ad2b4bb1-1946-4c20-b1f5-51fb4039597c",
      startDateTime: new Date("2026-05-30T14:00:00"),
      endDateTime: new Date("2026-05-30T16:00:00"),
    };

    const result = await resolveSlotSelections(cli, [availability]);

    expect(result).toEqual([availability]);
  });
});
