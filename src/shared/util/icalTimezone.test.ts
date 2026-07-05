import { describe, expect, it } from "vitest";
import { tagICalWithTimeZone } from "./icalTimezone.js";

const PACIFIC = "America/Los_Angeles";

describe("tagICalWithTimeZone", () => {
  it("tags floating DTSTART and DTEND with the operator timezone", () => {
    const input = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART:20251104T170000",
      "DTEND:20251104T190000",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const output = tagICalWithTimeZone(input, PACIFIC);

    expect(output).toContain(
      "DTSTART;TZID=America/Los_Angeles:20251104T170000",
    );
    expect(output).toContain("DTEND;TZID=America/Los_Angeles:20251104T190000");
  });

  it("converts UTC DTSTART and DTEND to operator-local times", () => {
    const input = ["DTSTART:20251105T010000Z", "DTEND:20251105T030000Z"].join(
      "\n",
    );

    const output = tagICalWithTimeZone(input, PACIFIC);

    expect(output).toContain(
      "DTSTART;TZID=America/Los_Angeles:20251104T170000",
    );
    expect(output).toContain("DTEND;TZID=America/Los_Angeles:20251104T190000");
  });

  it("leaves all-day and already-tagged properties unchanged", () => {
    const input = [
      "DTSTART;VALUE=DATE:20251104",
      "DTSTART;TZID=America/Chicago:20251104T170000",
      "DTEND;TZID=America/Chicago:20251104T190000",
    ].join("\n");

    const output = tagICalWithTimeZone(input, PACIFIC);

    expect(output).toContain("DTSTART;VALUE=DATE:20251104");
    expect(output).toContain("DTSTART;TZID=America/Chicago:20251104T170000");
    expect(output).toContain("DTEND;TZID=America/Chicago:20251104T190000");
  });

  it("unfolds wrapped iCal lines before tagging", () => {
    const input = [
      "DTSTART:20251104T1700",
      " 00",
      "DTEND:20251104T190000",
    ].join("\n");

    const output = tagICalWithTimeZone(input, PACIFIC);

    expect(output).toContain(
      "DTSTART;TZID=America/Los_Angeles:20251104T170000",
    );
    expect(output).toContain("DTEND;TZID=America/Los_Angeles:20251104T190000");
  });
});
