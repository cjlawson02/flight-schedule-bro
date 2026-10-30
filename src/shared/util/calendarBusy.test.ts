import { describe, expect, it } from "vitest";
import {
  intervalsOverlap,
  normalizeCalendarIcalUrl,
  parseICalBusyIntervals,
} from "./calendarBusy.js";

const LA = "America/Los_Angeles";

describe("parseICalBusyIntervals", () => {
  it("parses timed events with TZID", () => {
    const ical = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;TZID=America/Los_Angeles:20261022T083000
DTEND;TZID=America/Los_Angeles:20261022T170000
SUMMARY:Work
END:VEVENT
END:VCALENDAR`;

    const busy = parseICalBusyIntervals(ical, LA);
    expect(busy).toHaveLength(1);
    expect(busy[0].summary).toBe("Work");
    expect(busy[0].endMs).toBeGreaterThan(busy[0].startMs);
  });

  it("parses all-day events with exclusive end date", () => {
    const ical = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261106
DTEND;VALUE=DATE:20261109
SUMMARY:Diwali
END:VEVENT
END:VCALENDAR`;

    const busy = parseICalBusyIntervals(ical, LA);
    expect(busy).toHaveLength(1);
    // 11/6 00:00 through 11/9 00:00 local
    expect(busy[0].summary).toBe("Diwali");
    expect(busy[0].endMs - busy[0].startMs).toBeGreaterThan(2 * 24 * 60 * 60 * 1000);
  });

  it("skips transparent and cancelled events", () => {
    const ical = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART:20261022T150000Z
DTEND:20261022T160000Z
SUMMARY:Free
TRANSP:TRANSPARENT
END:VEVENT
BEGIN:VEVENT
DTSTART:20261022T170000Z
DTEND:20261022T180000Z
SUMMARY:Cancelled
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`;

    expect(parseICalBusyIntervals(ical, LA)).toHaveLength(0);
  });
});

describe("normalizeCalendarIcalUrl", () => {
  it("rewrites webcal to https", () => {
    expect(
      normalizeCalendarIcalUrl("webcal://calendar.google.com/calendar/ical/x/private-y/basic.ics"),
    ).toBe("https://calendar.google.com/calendar/ical/x/private-y/basic.ics");
  });
});

describe("intervalsOverlap", () => {
  it("detects overlap", () => {
    const busy = [
      { startMs: 1000, endMs: 2000, summary: "a" },
      { startMs: 5000, endMs: 6000, summary: "b" },
    ];
    expect(intervalsOverlap(1500, 1800, busy)?.summary).toBe("a");
    expect(intervalsOverlap(2000, 3000, busy)).toBeUndefined();
    expect(intervalsOverlap(5500, 7000, busy)?.summary).toBe("b");
  });
});
