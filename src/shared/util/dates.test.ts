import { describe, expect, it } from "vitest";
import { isValidBlock } from "./dates.js";

describe("isValidBlock", () => {
  describe("duration validation", () => {
    it("returns false if duration is not exactly 120 minutes (2 hours)", () => {
      const start = new Date("2024-07-15T15:00:00"); // Monday, July
      const end = new Date("2024-07-15T16:00:00"); // Only 1 hour
      expect(isValidBlock(start, end, false)).toBe(false);
    });

    it("returns false if duration is 3 hours", () => {
      const start = new Date("2024-07-15T15:00:00");
      const end = new Date("2024-07-15T18:00:00"); // 3 hours
      expect(isValidBlock(start, end, false)).toBe(false);
    });

    it("returns true if duration is exactly 2 hours and within weekday hours", () => {
      const start = new Date("2024-07-15T15:00:00"); // Monday, July
      const end = new Date("2024-07-15T17:00:00"); // Exactly 2 hours
      expect(isValidBlock(start, end, false)).toBe(true);
    });
  });

  describe("weekday validation", () => {
    it("returns false if weekday block starts before WEEKDAY_MIN_HOUR", () => {
      const start = new Date("2024-07-15T14:00:00"); // Before 15:00
      const end = new Date("2024-07-15T16:00:00");
      expect(isValidBlock(start, end, false)).toBe(false);
    });

    it("returns false if weekday block ends after MAX_HOUR", () => {
      const start = new Date("2024-07-15T18:00:00"); // Ends at 20:00, after max
      const end = new Date("2024-07-15T20:00:00");
      expect(isValidBlock(start, end, false)).toBe(false);
    });

    it("returns true if weekday block is within WEEKDAY_MIN_HOUR and MAX_HOUR", () => {
      const start = new Date("2024-07-15T15:00:00"); // 3 PM
      const end = new Date("2024-07-15T17:00:00"); // 5 PM
      expect(isValidBlock(start, end, false)).toBe(true);
    });

    it("returns true for last valid weekday slot (17:00-19:00)", () => {
      const start = new Date("2024-07-15T17:00:00"); // 5 PM
      const end = new Date("2024-07-15T19:00:00"); // 7 PM (exactly at max)
      expect(isValidBlock(start, end, false)).toBe(true);
    });
  });

  describe("weekend validation (summer)", () => {
    it("returns true for weekend slot starting at 10 AM in July", () => {
      const start = new Date("2024-07-13T10:00:00"); // Saturday, July
      const end = new Date("2024-07-13T12:00:00");
      expect(isValidBlock(start, end, true)).toBe(true);
    });

    it("returns true for weekend afternoon slot", () => {
      const start = new Date("2024-07-13T15:00:00"); // Saturday afternoon
      const end = new Date("2024-07-13T17:00:00");
      expect(isValidBlock(start, end, true)).toBe(true);
    });

    it("returns false if weekend slot ends after MAX_HOUR", () => {
      const start = new Date("2024-07-13T18:00:00"); // Ends at 20:00
      const end = new Date("2024-07-13T20:00:00");
      expect(isValidBlock(start, end, true)).toBe(false);
    });
  });

  describe("weekend validation (winter)", () => {
    it("returns true for weekend morning slot starting at 9 AM in January", () => {
      const start = new Date("2024-01-13T09:00:00"); // Saturday, January
      const end = new Date("2024-01-13T11:00:00");
      expect(isValidBlock(start, end, true)).toBe(true);
    });

    it("returns true for weekend morning slot starting at 10 AM in January", () => {
      const start = new Date("2024-01-13T10:00:00"); // Saturday, January
      const end = new Date("2024-01-13T12:00:00");
      expect(isValidBlock(start, end, true)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles half-hour boundaries", () => {
      const start = new Date("2024-07-15T15:30:00"); // 3:30 PM
      const end = new Date("2024-07-15T17:30:00"); // 5:30 PM
      expect(isValidBlock(start, end, false)).toBe(true);
    });

    it("accepts slots ending exactly at MAX_HOUR (19:00)", () => {
      const start = new Date("2024-07-15T17:00:00"); // 5 PM
      const end = new Date("2024-07-15T19:00:00"); // 7 PM exactly
      expect(isValidBlock(start, end, false)).toBe(true);
    });

    it("rejects slots that go beyond MAX_HOUR", () => {
      const start = new Date("2024-07-15T17:30:00"); // 5:30 PM
      const end = new Date("2024-07-15T19:30:00"); // 7:30 PM - beyond max
      expect(isValidBlock(start, end, false)).toBe(false);
    });
  });
});
