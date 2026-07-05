import { describe, expect, it } from "vitest";
import {
  createOperatorDateKey,
  formatFspLocalDateTime,
  getFspTimeZoneBias,
  getOperatorHour,
  isOperatorWeekend,
  parseFspDateTime,
  parseFspLocal,
  parseFspUtc,
} from "./flightTime.js";
import { isValidBlock } from "./dates.js";

const LA = "America/Los_Angeles";

describe("flightTime", () => {
  it("parses FSP local wall-clock times in the operator zone", () => {
    const instant = parseFspLocal("2025-11-04T17:00:00", LA);
    expect(instant.toISOString()).toBe("2025-11-05T01:00:00.000Z");
  });

  it("parses FSP UTC fields without Z suffix", () => {
    const instant = parseFspUtc("2025-11-05T01:00:00");
    expect(instant.toISOString()).toBe("2025-11-05T01:00:00.000Z");
  });

  it("prefers startUtc over local when both are provided", () => {
    const instant = parseFspDateTime(
      {
        local: "2025-11-04T09:00:00",
        utc: "2025-11-05T01:00:00",
      },
      LA,
    );
    expect(instant.toISOString()).toBe("2025-11-05T01:00:00.000Z");
  });

  it("uses operator calendar date keys", () => {
    const instant = parseFspUtc("2025-11-05T01:00:00");
    expect(createOperatorDateKey(instant, LA)).toBe("2025-11-04");
  });

  it("derives FSP API timeZoneBias with DST", () => {
    expect(getFspTimeZoneBias(LA, new Date("2025-11-04T12:00:00Z"))).toBe(-480);
    expect(getFspTimeZoneBias(LA, new Date("2025-07-15T12:00:00Z"))).toBe(-420);
  });

  it("formats booking timestamps in operator local time", () => {
    const instant = parseFspUtc("2025-11-05T01:00:00");
    expect(formatFspLocalDateTime(instant, LA)).toBe("2025-11-04T17:00");
  });
});

describe("isValidBlock with operator timezone", () => {
  const testConfig = {
    WEEKDAY_MIN_HOUR: 15,
    MAX_HOUR: 19,
    EMAIL: "test@example.com",
    PASSWORD: "password",
    AIRCRAFT_REGEX: /172S/i,
    INSTRUCTOR_REGEX: /Doug Libal/i,
    DAYS_AHEAD: 60,
    TIMEZONE: LA,
  };

  it("accepts a 5-7 PM Pacific weekday block", () => {
    const start = parseFspLocal("2025-11-04T17:00:00", LA);
    const end = parseFspLocal("2025-11-04T19:00:00", LA);
    expect(isValidBlock(start, end, testConfig, 120)).toBe(true);
    expect(getOperatorHour(start, LA)).toBe(17);
    expect(isOperatorWeekend(start, LA)).toBe(false);
  });

  it("rejects a 9-11 AM Pacific weekday block", () => {
    const start = parseFspLocal("2025-11-04T09:00:00", LA);
    const end = parseFspLocal("2025-11-04T11:00:00", LA);
    expect(isValidBlock(start, end, testConfig, 120)).toBe(false);
  });
});
