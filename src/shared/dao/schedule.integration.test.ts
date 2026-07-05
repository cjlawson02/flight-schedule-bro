import { describe, expect, it } from "vitest";
import {
  mergeScheduleSnapshot,
  SchedulePageResponseSchema,
} from "./schedule.js";
import jul6Fixture from "./fixtures/schedule-day-2026-07-06.json" with { type: "json" };

describe("SchedulePageResponseSchema", () => {
  it("parses the Jul 6 HAR fixture", () => {
    const parsed = SchedulePageResponseSchema.parse(jul6Fixture);

    expect(parsed.total).toBe(14);
    expect(parsed.results.resources).toHaveLength(14);
    expect(parsed.results.events.length).toBeGreaterThan(0);
  });
});

describe("mergeScheduleSnapshot", () => {
  it("dedupes resources and events across pages", () => {
    const page1 = SchedulePageResponseSchema.parse({
      total: 3,
      pageIndex: 1,
      pageSize: 2,
      results: {
        resources: [
          {
            Id: "11111111-1111-4111-8111-111111111111",
            Name: "N111",
            ResourceTypeId: 1,
          },
          {
            Id: "22222222-2222-4222-8222-222222222222",
            Name: "N222",
            ResourceTypeId: 1,
          },
        ],
        events: [
          {
            ResourceId: "11111111-1111-4111-8111-111111111111",
            StartDate: "2026-07-06 09:00:00",
            EndDate: "2026-07-06 11:00:00",
            ReservationId: "33333333-3333-4333-8333-333333333333",
          },
        ],
        unavailability: [],
        closings: [],
      },
    }).results;

    const page2 = SchedulePageResponseSchema.parse({
      total: 3,
      pageIndex: 2,
      pageSize: 2,
      results: {
        resources: [
          {
            Id: "44444444-4444-4444-8444-444444444444",
            Name: "Instructor",
            ResourceTypeId: 2,
          },
          {
            Id: "11111111-1111-4111-8111-111111111111",
            Name: "N111",
            ResourceTypeId: 1,
          },
        ],
        events: [
          {
            ResourceId: "11111111-1111-4111-8111-111111111111",
            StartDate: "2026-07-06 09:00:00",
            EndDate: "2026-07-06 11:00:00",
            ReservationId: "33333333-3333-4333-8333-333333333333",
          },
          {
            ResourceId: "44444444-4444-4444-8444-444444444444",
            StartDate: "2026-07-06 14:00:00",
            EndDate: "2026-07-06 16:00:00",
          },
        ],
        unavailability: [],
        closings: [],
      },
    }).results;

    const merged = {
      resources: [],
      events: [],
      unavailability: [],
      closings: [],
    };

    mergeScheduleSnapshot(merged, page1);
    mergeScheduleSnapshot(merged, page2);

    expect(merged.resources).toHaveLength(3);
    expect(merged.events).toHaveLength(2);
  });
});
