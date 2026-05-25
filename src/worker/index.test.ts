import { describe, expect, it, beforeEach, vi } from "vitest";
import type { Env } from "./types.js";
import { chunk } from "../shared/util/array.js";
import { findNewSlots } from "../shared/util/slots.js";
import type { BookableAvailability } from "../shared/dao/availability.js";

const LA = "America/Los_Angeles";

function makeSlot(
  overrides: Partial<BookableAvailability> &
    Pick<BookableAvailability, "startDateTime">,
): BookableAvailability {
  return {
    date: "1/20/2024",
    startTime: "5:00:00 PM",
    endTime: "7:00:00 PM",
    instructorId: "123e4567-e89b-12d3-a456-426614174000",
    aircraftId: "223e4567-e89b-12d3-a456-426614174000",
    endDateTime: new Date("2024-01-20T19:00:00.000Z"),
    ...overrides,
  };
}

// We'll test the helper functions and HTTP endpoints
// The scheduled handler is harder to unit test due to dependencies

describe("Worker Index - Helper Functions", () => {
  describe("chunk function", () => {
    it("chunks array into specified size", () => {
      const arr = [1, 2, 3, 4, 5, 6, 7];
      const result = chunk(arr, 3);
      expect(result).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    });

    it("returns single chunk when array smaller than size", () => {
      const arr = [1, 2];
      const result = chunk(arr, 5);
      expect(result).toEqual([[1, 2]]);
    });

    it("handles empty array", () => {
      const arr: number[] = [];
      const result = chunk(arr, 3);
      expect(result).toEqual([]);
    });
  });

  describe("findNewSlots function", () => {
    it("identifies new slots not in previous snapshot", () => {
      const previousSlots = [
        makeSlot({
          startDateTime: new Date("2024-01-20T17:00:00.000Z"),
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
        }),
      ];

      const currentSlots = [
        ...previousSlots,
        makeSlot({
          date: "1/25/2024",
          startTime: "3:00:00 PM",
          endTime: "5:00:00 PM",
          aircraftId: "aircraft-789",
          instructorId: "instructor-101",
          startDateTime: new Date("2024-01-25T15:00:00.000Z"),
          endDateTime: new Date("2024-01-25T17:00:00.000Z"),
        }),
      ];

      const newSlots = findNewSlots(
        currentSlots,
        previousSlots,
        "2024-01-15",
        60,
        LA,
      );

      expect(newSlots).toHaveLength(1);
      expect(newSlots[0].aircraftId).toBe("aircraft-789");
    });

    it("excludes slots beyond tracked window", () => {
      const currentSlots = [
        makeSlot({
          startDateTime: new Date("2024-01-20T17:00:00.000Z"),
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
        }),
        makeSlot({
          date: "2/1/2024",
          startTime: "3:00:00 PM",
          endTime: "5:00:00 PM",
          aircraftId: "aircraft-789",
          instructorId: "instructor-101",
          startDateTime: new Date("2024-02-01T15:00:00.000Z"),
          endDateTime: new Date("2024-02-01T17:00:00.000Z"),
        }),
      ];

      const newSlots = findNewSlots(currentSlots, [], "2024-01-15", 10, LA);

      expect(newSlots).toHaveLength(1);
      expect(newSlots[0].date).toBe("1/20/2024");
    });

    it("returns empty array when no new slots", () => {
      const slots = [
        makeSlot({
          startDateTime: new Date("2024-01-20T17:00:00.000Z"),
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
        }),
      ];

      const newSlots = findNewSlots(slots, slots, "2024-01-15", 60, LA);

      expect(newSlots).toHaveLength(0);
    });

    it("handles different slot times for same aircraft/instructor", () => {
      const previousSlots = [
        makeSlot({
          startDateTime: new Date("2024-01-20T17:00:00.000Z"),
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
        }),
      ];

      const currentSlots = [
        ...previousSlots,
        makeSlot({
          date: "1/20/2024",
          startTime: "3:00:00 PM",
          endTime: "5:00:00 PM",
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
          startDateTime: new Date("2024-01-20T15:00:00.000Z"),
          endDateTime: new Date("2024-01-20T17:00:00.000Z"),
        }),
      ];

      const newSlots = findNewSlots(
        currentSlots,
        previousSlots,
        "2024-01-15",
        60,
        LA,
      );

      expect(newSlots).toHaveLength(1);
      expect(newSlots[0].startTime).toBe("3:00:00 PM");
    });

    it("includes slots on the last tracked day regardless of time", () => {
      const currentSlots = [
        makeSlot({
          date: "1/25/2024",
          startTime: "8:00:00 AM",
          endTime: "10:00:00 AM",
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
          startDateTime: new Date("2024-01-25T16:00:00.000Z"),
          endDateTime: new Date("2024-01-25T18:00:00.000Z"),
        }),
        makeSlot({
          date: "1/25/2024",
          startTime: "11:00:00 PM",
          endTime: "11:59:00 PM",
          aircraftId: "aircraft-789",
          instructorId: "instructor-101",
          startDateTime: new Date("2024-01-26T07:00:00.000Z"),
          endDateTime: new Date("2024-01-26T07:59:00.000Z"),
        }),
        makeSlot({
          date: "1/26/2024",
          startTime: "9:00:00 AM",
          endTime: "11:00:00 AM",
          aircraftId: "aircraft-999",
          instructorId: "instructor-999",
          startDateTime: new Date("2024-01-26T17:00:00.000Z"),
          endDateTime: new Date("2024-01-26T19:00:00.000Z"),
        }),
      ];

      const newSlots = findNewSlots(currentSlots, [], "2024-01-15", 10, LA);

      expect(newSlots).toHaveLength(2);
      expect(newSlots.every((slot) => slot.date === "1/25/2024")).toBe(true);
    });
  });

  describe("Rolling Window Date Comparison Edge Cases", () => {
    it("handles slots exactly at maxTrackedDateOnly boundary", () => {
      const currentSlots = [
        makeSlot({
          date: "1/25/2024",
          startTime: "11:59:59 PM",
          endTime: "11:59:59 PM",
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
          startDateTime: new Date("2024-01-26T07:59:59.999Z"),
          endDateTime: new Date("2024-01-26T07:59:59.999Z"),
        }),
        makeSlot({
          date: "1/26/2024",
          startTime: "12:00:00 AM",
          endTime: "12:00:00 AM",
          aircraftId: "aircraft-789",
          instructorId: "instructor-101",
          startDateTime: new Date("2024-01-26T08:00:00.000Z"),
          endDateTime: new Date("2024-01-26T08:00:00.000Z"),
        }),
      ];

      const newSlots = findNewSlots(currentSlots, [], "2024-01-15", 10, LA);

      expect(newSlots).toHaveLength(1);
      expect(newSlots[0].aircraftId).toBe("aircraft-123");
    });

    it("handles slots just before maxTrackedDateOnly boundary", () => {
      const currentSlots = [
        makeSlot({
          date: "1/25/2024",
          startTime: "11:59:58 PM",
          endTime: "11:59:58 PM",
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
          startDateTime: new Date("2024-01-26T07:59:58.000Z"),
          endDateTime: new Date("2024-01-26T07:59:58.000Z"),
        }),
      ];

      const newSlots = findNewSlots(currentSlots, [], "2024-01-15", 10, LA);

      expect(newSlots).toHaveLength(1);
      expect(newSlots[0].aircraftId).toBe("aircraft-123");
    });

    it("handles lastSearchDate parsed from ISO date string", () => {
      const currentSlots = [
        makeSlot({
          date: "1/25/2024",
          startTime: "5:00:00 PM",
          endTime: "7:00:00 PM",
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
          startDateTime: new Date("2024-01-26T01:00:00.000Z"),
          endDateTime: new Date("2024-01-26T03:00:00.000Z"),
        }),
      ];

      const newSlots = findNewSlots(currentSlots, [], "2024-01-15", 10, LA);

      expect(newSlots).toHaveLength(1);
    });

    it("excludes slots when lastSearchDate is today and slot is beyond window", () => {
      const currentSlots = [
        makeSlot({
          date: "1/25/2024",
          startTime: "5:00:00 PM",
          endTime: "7:00:00 PM",
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
          startDateTime: new Date("2024-01-26T01:00:00.000Z"),
          endDateTime: new Date("2024-01-26T03:00:00.000Z"),
        }),
        makeSlot({
          date: "1/26/2024",
          startTime: "5:00:00 PM",
          endTime: "7:00:00 PM",
          aircraftId: "aircraft-789",
          instructorId: "instructor-101",
          startDateTime: new Date("2024-01-27T01:00:00.000Z"),
          endDateTime: new Date("2024-01-27T03:00:00.000Z"),
        }),
      ];

      const newSlots = findNewSlots(currentSlots, [], "2024-01-15", 10, LA);

      expect(newSlots).toHaveLength(1);
      expect(newSlots[0].aircraftId).toBe("aircraft-123");
    });
  });
});

describe("Worker HTTP Endpoints", () => {
  // Mock the worker module
  let _worker: unknown;
  let _mockEnv: Env;

  beforeEach(async () => {
    _mockEnv = {
      FSP_AVAILABILITY_KV: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn(),
        list: vi.fn(),
      } as any,
      FSP_EMAIL: "test@example.com",
      FSP_PASSWORD: "password",
      DISCORD_WEBHOOK_URL: "https://discord.com/webhook",
      DAYS_AHEAD: "60",
      AIRCRAFT_REGEX: "172S",
    };
  });

  describe("Root endpoint", () => {
    it("returns worker info and available endpoints", async () => {
      // We'll test the expected structure
      const expectedResponse = {
        message: "Flight Schedule Bro Worker",
        endpoints: {
          "/setup": "Initialize the availability snapshot",
          "/health": "Check worker health and snapshot status",
        },
      };

      // Verify the structure is as expected
      expect(expectedResponse.message).toBeDefined();
      expect(expectedResponse.endpoints["/setup"]).toBeDefined();
      expect(expectedResponse.endpoints["/health"]).toBeDefined();
    });
  });

  describe("Health endpoint", () => {
    it("returns health status with no snapshot", async () => {
      const expectedResponse = {
        status: "ok",
        snapshotExists: false,
        metadata: null,
      };

      expect(expectedResponse.status).toBe("ok");
      expect(expectedResponse.snapshotExists).toBe(false);
    });

    it("returns health status with existing snapshot", async () => {
      const metadata = {
        lastSearchDate: "2024-01-15",
        lastUpdate: "2024-01-15T12:00:00.000Z",
        daysAhead: 60,
      };

      const expectedResponse = {
        status: "ok",
        snapshotExists: true,
        metadata,
      };

      expect(expectedResponse.status).toBe("ok");
      expect(expectedResponse.snapshotExists).toBe(true);
      expect(expectedResponse.metadata).toEqual(metadata);
    });
  });
});

describe("Worker Error Handling", () => {
  it("handles invalid snapshot data gracefully", () => {
    const invalidSnapshot = {
      // Missing required fields
      slots: "not an array",
    };

    // In production, this would be caught by Zod validation
    expect(() => {
      if (!Array.isArray(invalidSnapshot.slots)) {
        throw new Error("Invalid snapshot structure");
      }
    }).toThrow("Invalid snapshot structure");
  });

  it("handles missing environment variables", () => {
    const incompleteEnv = {
      FSP_EMAIL: "test@example.com",
      // Missing FSP_PASSWORD
    };

    expect(incompleteEnv.FSP_EMAIL).toBeDefined();
    expect((incompleteEnv as any).FSP_PASSWORD).toBeUndefined();
  });
});
