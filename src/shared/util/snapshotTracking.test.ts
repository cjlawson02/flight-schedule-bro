import { describe, expect, it } from "vitest";
import { resolveTrackedThroughDate } from "./snapshotTracking.js";

describe("resolveTrackedThroughDate", () => {
  it("returns trackedThroughDate when present", () => {
    expect(
      resolveTrackedThroughDate(
        {
          lastSearchDate: "2024-01-15",
          trackedThroughDate: "2024-03-15",
        },
        "America/Los_Angeles",
      ),
    ).toBe("2024-03-15");
  });

  it("derives trackedThroughDate from legacy daysAhead", () => {
    expect(
      resolveTrackedThroughDate(
        {
          lastSearchDate: "2024-01-15",
          daysAhead: 10,
        },
        "America/Los_Angeles",
      ),
    ).toBe("2024-01-25");
  });
});
