import { describe, expect, it } from "vitest";
import {
  clipInterval,
  invertIntervals,
  isIntervalFree,
  mergeIntervals,
  parseScheduleLocal,
  slotsFromFree,
} from "./scheduleGaps.js";
import { parseFspLocal } from "../util/flightTime.js";

const TZ = "America/Los_Angeles";

function interval(start: string, end: string) {
  return {
    start: parseFspLocal(start, TZ),
    end: parseFspLocal(end, TZ),
  };
}

describe("parseScheduleLocal", () => {
  it("parses FSP schedule grid timestamps", () => {
    expect(parseScheduleLocal("2026-07-06 16:30:00", TZ).getTime()).toBe(
      parseFspLocal("2026-07-06T16:30:00", TZ).getTime(),
    );
  });
});

describe("mergeIntervals", () => {
  it("unions overlapping busy blocks", () => {
    const merged = mergeIntervals([
      interval("2026-07-06T15:00:00", "2026-07-06T16:00:00"),
      interval("2026-07-06T15:30:00", "2026-07-06T17:00:00"),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].start).toEqual(parseFspLocal("2026-07-06T15:00:00", TZ));
    expect(merged[0].end).toEqual(parseFspLocal("2026-07-06T17:00:00", TZ));
  });
});

describe("invertIntervals", () => {
  it("returns free windows between busy blocks", () => {
    const dayStart = parseFspLocal("2026-07-06T00:00:00", TZ);
    const dayEnd = parseFspLocal("2026-07-07T00:00:00", TZ);
    const free = invertIntervals(
      [interval("2026-07-06T15:00:00", "2026-07-06T17:00:00")],
      dayStart,
      dayEnd,
    );

    expect(free).toHaveLength(2);
    expect(free[1].start).toEqual(parseFspLocal("2026-07-06T17:00:00", TZ));
  });
});

describe("slotsFromFree", () => {
  it("emits 30-minute stepped slots for dual intersection duration", () => {
    const free = [interval("2026-07-06T15:00:00", "2026-07-06T19:00:00")];
    const durationMs = 90 * 60 * 1000;
    const stepMs = 30 * 60 * 1000;

    const slots = slotsFromFree(free, durationMs, stepMs);

    expect(slots.map((s) => s.start.getTime())).toContain(
      parseFspLocal("2026-07-06T16:30:00", TZ).getTime(),
    );
  });
});

describe("clipInterval", () => {
  it("clips maintenance spanning weeks to a single day", () => {
    const dayStart = parseFspLocal("2026-07-06T00:00:00", TZ);
    const dayEnd = parseFspLocal("2026-07-07T00:00:00", TZ);
    const clipped = clipInterval(
      interval("2026-06-01T06:00:00", "2026-07-27T23:30:00"),
      dayStart,
      dayEnd,
    );

    expect(clipped?.start).toEqual(dayStart);
    expect(clipped?.end).toEqual(dayEnd);
  });
});

describe("isIntervalFree", () => {
  it("requires the full duration inside a free window", () => {
    const free = [interval("2026-07-06T16:30:00", "2026-07-06T18:00:00")];

    expect(
      isIntervalFree(
        parseFspLocal("2026-07-06T16:30:00", TZ),
        parseFspLocal("2026-07-06T18:00:00", TZ),
        free,
      ),
    ).toBe(true);

    expect(
      isIntervalFree(
        parseFspLocal("2026-07-06T16:00:00", TZ),
        parseFspLocal("2026-07-06T17:30:00", TZ),
        free,
      ),
    ).toBe(false);
  });
});

describe("dual intersection", () => {
  it("finds slots where aircraft and instructor are both free", () => {
    const aircraftFree = [
      interval("2026-07-06T15:00:00", "2026-07-06T19:00:00"),
    ];
    const instructorFree = [
      interval("2026-07-06T16:30:00", "2026-07-06T18:00:00"),
    ];
    const durationMs = 90 * 60 * 1000;
    const stepMs = 30 * 60 * 1000;

    const aircraftSlots = slotsFromFree(aircraftFree, durationMs, stepMs);
    const dualSlots = aircraftSlots.filter((slot) =>
      isIntervalFree(slot.start, slot.end, instructorFree),
    );

    expect(dualSlots.map((s) => s.start.getTime())).toEqual([
      parseFspLocal("2026-07-06T16:30:00", TZ).getTime(),
    ]);
  });
});
