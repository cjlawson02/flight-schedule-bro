import { describe, expect, it } from "vitest";
import type { BookableAvailability } from "../shared/dao/availability.js";
import type { FspMetadata } from "../shared/blo/fspMetadata.js";
import { selectAutoBookCandidates } from "./autoBook.js";

const LA = "America/Los_Angeles";

function slot(
  overrides: Partial<BookableAvailability> &
    Pick<BookableAvailability, "startDateTime" | "endDateTime">,
): BookableAvailability {
  return {
    date: "11/8/2026",
    startTime: "10:00:00 AM",
    endTime: "12:00:00 PM",
    instructorId: "00000000-0000-0000-0000-000000000000",
    aircraftId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ...overrides,
  };
}

const metadata: FspMetadata = {
  instructors: [],
  reservationTypes: [],
  aircraft: [
    { aircraftId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", tailNumber: "N737BC" },
    { aircraftId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", tailNumber: "N734UZ" },
  ],
  lastUpdated: "2026-10-21T00:00:00.000Z",
};

describe("selectAutoBookCandidates", () => {
  it("skips slots within 24 hours and pre-15:30 calendar conflicts", () => {
    const now = new Date("2026-10-21T20:00:00.000Z");
    const tooSoon = slot({
      startDateTime: new Date("2026-10-22T18:00:00.000Z"),
      endDateTime: new Date("2026-10-22T20:00:00.000Z"),
    });
    const clearWeekend = slot({
      date: "10/25/2026",
      startTime: "12:00:00 PM",
      startDateTime: new Date("2026-10-25T19:00:00.000Z"),
      endDateTime: new Date("2026-10-25T21:00:00.000Z"),
    });
    // 1pm weekday — before 15:30 soft window, Work blocks
    const earlyWorkConflict = slot({
      date: "10/26/2026",
      startTime: "1:00:00 PM",
      aircraftId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      startDateTime: new Date("2026-10-26T20:00:00.000Z"),
      endDateTime: new Date("2026-10-26T22:00:00.000Z"),
    });

    const picked = selectAutoBookCandidates({
      slots: [tooSoon, clearWeekend, earlyWorkConflict],
      existingReservations: [],
      busyIntervals: [
        {
          startMs: earlyWorkConflict.startDateTime.getTime() - 3600_000,
          endMs: earlyWorkConflict.endDateTime.getTime() + 3600_000,
          summary: "Work",
        },
      ],
      metadata,
      timeZone: LA,
      maxPerRun: 3,
      now,
    });

    expect(picked).toHaveLength(1);
    expect(picked[0].aircraftTail).toBe("N737BC");
    expect(picked[0].date).toBe("10/25/2026");
  });

  it("ignores calendar busy for slots starting at/after 15:30", () => {
    const now = new Date("2026-10-21T20:00:00.000Z");
    // Wed Nov 4 2026 is PST (UTC-8): 4pm local = 00:00 UTC Nov 5
    const afterWorkSoft = slot({
      date: "11/4/2026",
      startTime: "4:00:00 PM",
      startDateTime: new Date("2026-11-05T00:00:00.000Z"),
      endDateTime: new Date("2026-11-05T02:00:00.000Z"),
    });

    const picked = selectAutoBookCandidates({
      slots: [afterWorkSoft],
      existingReservations: [],
      busyIntervals: [
        {
          startMs: Date.parse("2026-11-04T16:30:00.000Z"), // 8:30am PST
          endMs: Date.parse("2026-11-05T01:00:00.000Z"), // 5:00pm PST
          summary: "Work",
        },
      ],
      metadata,
      timeZone: LA,
      maxPerRun: 1,
      now,
      ignoreCalendarBusyAfterMinutes: 15 * 60 + 30,
    });

    expect(picked).toHaveLength(1);
    expect(picked[0].startTime).toBe("4:00:00 PM");
  });

  it("prefers preferred tails and one slot per day", () => {
    const now = new Date("2026-10-21T20:00:00.000Z");
    const bc = slot({
      startDateTime: new Date("2026-10-25T19:00:00.000Z"),
      endDateTime: new Date("2026-10-25T21:00:00.000Z"),
      aircraftId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    const uzSameDay = slot({
      startTime: "2:00:00 PM",
      startDateTime: new Date("2026-10-25T21:00:00.000Z"),
      endDateTime: new Date("2026-10-25T23:00:00.000Z"),
      aircraftId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });

    const picked = selectAutoBookCandidates({
      slots: [uzSameDay, bc],
      existingReservations: [],
      busyIntervals: [],
      metadata,
      timeZone: LA,
      maxPerRun: 2,
      now,
    });

    expect(picked).toHaveLength(1);
    expect(picked[0].aircraftTail).toBe("N737BC");
  });
});
