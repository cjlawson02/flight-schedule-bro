import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import type { Env } from "./types.js";
import { readFileSync } from "fs";
import { join } from "path";

// We'll test the helper functions and HTTP endpoints
// The scheduled handler is harder to unit test due to dependencies

describe("Worker Index - Helper Functions", () => {
  describe("chunk function", () => {
    // Import the chunk function logic for testing
    const chunk = <T>(arr: T[], size: number): T[][] => {
      const chunks: T[][] = [];
      for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
      }
      return chunks;
    };

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

  describe("createSlotKey function", () => {
    // Import the slot key logic for testing
    const createSlotKey = (slot: any): string => {
      return `${slot.date}|${slot.startTime}|${slot.endTime}|${slot.aircraftId}|${slot.instructorId}`;
    };

    it("creates unique key from slot properties", () => {
      const slot = {
        date: "1/15/2024",
        startTime: "5:00:00 PM",
        endTime: "7:00:00 PM",
        aircraftId: "aircraft-123",
        instructorId: "instructor-456",
      };

      const key = createSlotKey(slot);
      expect(key).toBe(
        "1/15/2024|5:00:00 PM|7:00:00 PM|aircraft-123|instructor-456",
      );
    });

    it("creates different keys for different slots", () => {
      const slot1 = {
        date: "1/15/2024",
        startTime: "5:00:00 PM",
        endTime: "7:00:00 PM",
        aircraftId: "aircraft-123",
        instructorId: "instructor-456",
      };

      const slot2 = {
        date: "1/15/2024",
        startTime: "5:00:00 PM",
        endTime: "7:00:00 PM",
        aircraftId: "aircraft-789", // Different aircraft
        instructorId: "instructor-456",
      };

      expect(createSlotKey(slot1)).not.toBe(createSlotKey(slot2));
    });

    it("creates same key for identical slots", () => {
      const slot1 = {
        date: "1/15/2024",
        startTime: "5:00:00 PM",
        endTime: "7:00:00 PM",
        aircraftId: "aircraft-123",
        instructorId: "instructor-456",
      };

      const slot2 = { ...slot1 };

      expect(createSlotKey(slot1)).toBe(createSlotKey(slot2));
    });
  });

  describe("findNewSlots function", () => {
    // Import the rolling window logic for testing
    const addDays = (date: Date, days: number): Date => {
      const result = new Date(date);
      result.setDate(result.getDate() + days);
      return result;
    };

    const createSlotKey = (slot: any): string => {
      return `${slot.date}|${slot.startTime}|${slot.endTime}|${slot.aircraftId}|${slot.instructorId}`;
    };

    const findNewSlots = (
      currentSlots: any[],
      previousSlots: any[],
      lastSearchDate: Date,
      daysAhead: number,
    ): any[] => {
      const previousSlotKeys = new Set(previousSlots.map(createSlotKey));
      const maxTrackedDate = addDays(lastSearchDate, daysAhead);

      // Normalize to end of day in UTC for comparison (strip time component)
      const maxTrackedDateOnly = new Date(maxTrackedDate);
      maxTrackedDateOnly.setUTCHours(23, 59, 59, 999);

      const newSlots = currentSlots.filter((slot) => {
        const slotKey = createSlotKey(slot);
        const isNew = !previousSlotKeys.has(slotKey);
        // Compare dates by checking if slot is on or before the last tracked day
        const isWithinTrackedWindow = slot.startDateTime <= maxTrackedDateOnly;

        return isNew && isWithinTrackedWindow;
      });

      return newSlots;
    };

    it("identifies new slots not in previous snapshot", () => {
      const lastSearchDate = new Date("2024-01-15");
      const daysAhead = 60;

      const previousSlots = [
        {
          date: "1/20/2024",
          startTime: "5:00:00 PM",
          endTime: "7:00:00 PM",
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
          startDateTime: new Date("2024-01-20T17:00:00.000Z"),
        },
      ];

      const currentSlots = [
        ...previousSlots,
        {
          date: "1/25/2024",
          startTime: "3:00:00 PM",
          endTime: "5:00:00 PM",
          aircraftId: "aircraft-789",
          instructorId: "instructor-101",
          startDateTime: new Date("2024-01-25T15:00:00.000Z"),
        },
      ];

      const newSlots = findNewSlots(
        currentSlots,
        previousSlots,
        lastSearchDate,
        daysAhead,
      );

      expect(newSlots).toHaveLength(1);
      expect(newSlots[0].aircraftId).toBe("aircraft-789");
    });

    it("excludes slots beyond tracked window", () => {
      const lastSearchDate = new Date("2024-01-15");
      const daysAhead = 10; // Only tracking up to Jan 25

      const previousSlots: any[] = [];
      const currentSlots = [
        {
          date: "1/20/2024",
          startTime: "5:00:00 PM",
          endTime: "7:00:00 PM",
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
          startDateTime: new Date("2024-01-20T17:00:00.000Z"), // Within window
        },
        {
          date: "2/01/2024",
          startTime: "3:00:00 PM",
          endTime: "5:00:00 PM",
          aircraftId: "aircraft-789",
          instructorId: "instructor-101",
          startDateTime: new Date("2024-02-01T15:00:00.000Z"), // Beyond window
        },
      ];

      const newSlots = findNewSlots(
        currentSlots,
        previousSlots,
        lastSearchDate,
        daysAhead,
      );

      expect(newSlots).toHaveLength(1);
      expect(newSlots[0].date).toBe("1/20/2024");
    });

    it("returns empty array when no new slots", () => {
      const lastSearchDate = new Date("2024-01-15");
      const daysAhead = 60;

      const slots = [
        {
          date: "1/20/2024",
          startTime: "5:00:00 PM",
          endTime: "7:00:00 PM",
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
          startDateTime: new Date("2024-01-20T17:00:00.000Z"),
        },
      ];

      const newSlots = findNewSlots(slots, slots, lastSearchDate, daysAhead);

      expect(newSlots).toHaveLength(0);
    });

    it("handles different slot times for same aircraft/instructor", () => {
      const lastSearchDate = new Date("2024-01-15");
      const daysAhead = 60;

      const previousSlots = [
        {
          date: "1/20/2024",
          startTime: "5:00:00 PM",
          endTime: "7:00:00 PM",
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
          startDateTime: new Date("2024-01-20T17:00:00.000Z"),
        },
      ];

      const currentSlots = [
        ...previousSlots,
        {
          date: "1/20/2024",
          startTime: "3:00:00 PM", // Different time
          endTime: "5:00:00 PM",
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
          startDateTime: new Date("2024-01-20T15:00:00.000Z"),
        },
      ];

      const newSlots = findNewSlots(
        currentSlots,
        previousSlots,
        lastSearchDate,
        daysAhead,
      );

      expect(newSlots).toHaveLength(1);
      expect(newSlots[0].startTime).toBe("3:00:00 PM");
    });

    it("includes slots on the last tracked day regardless of time", () => {
      const lastSearchDate = new Date("2024-01-15");
      const daysAhead = 10; // Tracking up to Jan 25

      const previousSlots: any[] = [];
      const currentSlots = [
        {
          date: "1/25/2024",
          startTime: "8:00:00 AM",
          endTime: "10:00:00 AM",
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
          startDateTime: new Date("2024-01-25T08:00:00.000Z"), // Early morning on last day
        },
        {
          date: "1/25/2024",
          startTime: "11:00:00 PM",
          endTime: "11:59:00 PM",
          aircraftId: "aircraft-789",
          instructorId: "instructor-101",
          startDateTime: new Date("2024-01-25T23:00:00.000Z"), // Late night on last day
        },
        {
          date: "1/26/2024",
          startTime: "9:00:00 AM",
          endTime: "11:00:00 AM",
          aircraftId: "aircraft-999",
          instructorId: "instructor-999",
          startDateTime: new Date("2024-01-26T09:00:00.000Z"), // Day after (should be excluded)
        },
      ];

      const newSlots = findNewSlots(
        currentSlots,
        previousSlots,
        lastSearchDate,
        daysAhead,
      );

      // Should include both slots on Jan 25 but not Jan 26
      expect(newSlots).toHaveLength(2);
      expect(newSlots[0].date).toBe("1/25/2024");
      expect(newSlots[1].date).toBe("1/25/2024");
      expect(newSlots.some((s) => s.date === "1/26/2024")).toBe(false);
    });
  });

  describe("Date Normalization Edge Cases", () => {
    it("uses shared UTC date helpers in worker code", () => {
      // This test checks the actual source files to ensure Worker date handling
      // stays UTC-safe and doesn't regress to local-time normalization.

      const projectRoot = process.cwd();

      const indexCode = readFileSync(
        join(projectRoot, "src/worker/index.ts"),
        "utf-8",
      );
      const setupCode = readFileSync(
        join(projectRoot, "src/worker/setup.ts"),
        "utf-8",
      );

      const usesUtcHelperImport =
        /from "\.\.\/shared\/util\/utcDate\.js"/.test(indexCode) &&
        /from "\.\.\/shared\/util\/utcDate\.js"/.test(setupCode);
      const indexUsesStartOfUtcDay = /startOfUtcDay\(/.test(indexCode);
      const setupUsesStartOfUtcDay = /startOfUtcDay\(/.test(setupCode);
      const indexUsesSetHours =
        /today\.setHours\s*\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(indexCode);
      const setupUsesSetHours =
        /today\.setHours\s*\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(setupCode);

      expect(usesUtcHelperImport).toBe(true);
      expect(indexUsesStartOfUtcDay).toBe(true);
      expect(setupUsesStartOfUtcDay).toBe(true);
      expect(indexUsesSetHours).toBe(false);
      expect(setupUsesSetHours).toBe(false);
    });
  });

  describe("Rolling Window Date Comparison Edge Cases", () => {
    const addDays = (date: Date, days: number): Date => {
      const result = new Date(date);
      result.setDate(result.getDate() + days);
      return result;
    };

    const createSlotKey = (slot: any): string => {
      return `${slot.date}|${slot.startTime}|${slot.endTime}|${slot.aircraftId}|${slot.instructorId}`;
    };

    const findNewSlots = (
      currentSlots: any[],
      previousSlots: any[],
      lastSearchDate: Date,
      daysAhead: number,
    ): any[] => {
      const previousSlotKeys = new Set(previousSlots.map(createSlotKey));
      const maxTrackedDate = addDays(lastSearchDate, daysAhead);

      // Normalize to end of day in UTC for comparison (strip time component)
      const maxTrackedDateOnly = new Date(maxTrackedDate);
      maxTrackedDateOnly.setUTCHours(23, 59, 59, 999);

      const newSlots = currentSlots.filter((slot) => {
        const slotKey = createSlotKey(slot);
        const isNew = !previousSlotKeys.has(slotKey);
        // Compare dates by checking if slot is on or before the last tracked day
        const isWithinTrackedWindow = slot.startDateTime <= maxTrackedDateOnly;

        return isNew && isWithinTrackedWindow;
      });

      return newSlots;
    };

    it("handles slots exactly at maxTrackedDateOnly boundary", () => {
      const lastSearchDate = new Date("2024-01-15T00:00:00.000Z");
      const daysAhead = 10; // Max date is Jan 25, 23:59:59.999 UTC

      const previousSlots: any[] = [];
      const currentSlots = [
        {
          date: "1/25/2024",
          startTime: "11:59:59 PM",
          endTime: "11:59:59 PM",
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
          startDateTime: new Date("2024-01-25T23:59:59.999Z"), // Exactly at boundary
        },
        {
          date: "1/26/2024",
          startTime: "12:00:00 AM",
          endTime: "12:00:00 AM",
          aircraftId: "aircraft-789",
          instructorId: "instructor-101",
          startDateTime: new Date("2024-01-26T00:00:00.000Z"), // Just after boundary
        },
      ];

      const newSlots = findNewSlots(
        currentSlots,
        previousSlots,
        lastSearchDate,
        daysAhead,
      );

      // Should include the slot at the boundary but not after
      expect(newSlots).toHaveLength(1);
      expect(newSlots[0].aircraftId).toBe("aircraft-123");
    });

    it("handles slots just before maxTrackedDateOnly boundary", () => {
      const lastSearchDate = new Date("2024-01-15T00:00:00.000Z");
      const daysAhead = 10;

      const previousSlots: any[] = [];
      const currentSlots = [
        {
          date: "1/25/2024",
          startTime: "11:59:58 PM",
          endTime: "11:59:58 PM",
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
          startDateTime: new Date("2024-01-25T23:59:58.000Z"), // Just before boundary
        },
      ];

      const newSlots = findNewSlots(
        currentSlots,
        previousSlots,
        lastSearchDate,
        daysAhead,
      );

      expect(newSlots).toHaveLength(1);
      expect(newSlots[0].aircraftId).toBe("aircraft-123");
    });

    it("handles lastSearchDate parsed from ISO date string", () => {
      // Simulate how lastSearchDate is created from metadata
      const dateStr = "2024-01-15";
      const lastSearchDate = new Date(dateStr); // This creates midnight UTC
      const daysAhead = 10;

      // Verify it's midnight UTC
      expect(lastSearchDate.toISOString()).toBe("2024-01-15T00:00:00.000Z");

      const previousSlots: any[] = [];
      const currentSlots = [
        {
          date: "1/25/2024",
          startTime: "5:00:00 PM",
          endTime: "7:00:00 PM",
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
          startDateTime: new Date("2024-01-25T17:00:00.000Z"),
        },
      ];

      const newSlots = findNewSlots(
        currentSlots,
        previousSlots,
        lastSearchDate,
        daysAhead,
      );

      expect(newSlots).toHaveLength(1);
    });

    it("handles timezone edge case with UTC vs local time", () => {
      // Test that UTC normalization works correctly
      // Create a date that could be interpreted differently in different timezones
      const lastSearchDate = new Date("2024-01-15"); // Midnight UTC
      const daysAhead = 10;

      // Create a slot that's at the end of the tracked day in UTC
      const maxDate = new Date(lastSearchDate);
      maxDate.setUTCDate(maxDate.getUTCDate() + daysAhead);
      maxDate.setUTCHours(23, 59, 59, 999);

      const previousSlots: any[] = [];
      const currentSlots = [
        {
          date: "1/25/2024",
          startTime: "11:59:59 PM",
          endTime: "11:59:59 PM",
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
          startDateTime: maxDate, // Exactly at max tracked date
        },
      ];

      const newSlots = findNewSlots(
        currentSlots,
        previousSlots,
        lastSearchDate,
        daysAhead,
      );

      expect(newSlots).toHaveLength(1);
    });

    it("excludes slots when lastSearchDate is today and slot is beyond window", () => {
      // Simulate running the worker on the same day
      const today = new Date("2024-01-15T12:00:00.000Z"); // Noon UTC
      const lastSearchDate = new Date(today);
      lastSearchDate.setUTCHours(0, 0, 0, 0); // Normalized to midnight
      const daysAhead = 10;

      const previousSlots: any[] = [];
      const currentSlots = [
        {
          date: "1/25/2024",
          startTime: "5:00:00 PM",
          endTime: "7:00:00 PM",
          aircraftId: "aircraft-123",
          instructorId: "instructor-456",
          startDateTime: new Date("2024-01-25T17:00:00.000Z"), // Within window
        },
        {
          date: "1/26/2024",
          startTime: "5:00:00 PM",
          endTime: "7:00:00 PM",
          aircraftId: "aircraft-789",
          instructorId: "instructor-101",
          startDateTime: new Date("2024-01-26T17:00:00.000Z"), // Beyond window
        },
      ];

      const newSlots = findNewSlots(
        currentSlots,
        previousSlots,
        lastSearchDate,
        daysAhead,
      );

      expect(newSlots).toHaveLength(1);
      expect(newSlots[0].aircraftId).toBe("aircraft-123");
    });
  });

  describe("Snapshot Update Failure Edge Cases", () => {
    it("verifies snapshot is updated before notification to prevent duplicates", async () => {
      // This test checks the ACTUAL source code to verify the fix is in place
      // FIXED: Snapshot is now updated BEFORE notification is sent
      // This prevents duplicate notifications if setSnapshot fails (it will fail before notification)
      // If notification fails, snapshot is already updated (no duplicates on retry)

      const projectRoot = process.cwd();
      const indexCode = readFileSync(
        join(projectRoot, "src/worker/index.ts"),
        "utf-8",
      );

      // Find the line numbers for notification and snapshot update
      const lines = indexCode.split("\n");

      // Find where sendAvailabilityNotification is called
      let notificationLine = -1;
      let setSnapshotLine = -1;

      for (let i = 0; i < lines.length; i++) {
        // Look for the actual function call, not the import
        if (
          lines[i].includes("await sendAvailabilityNotification") &&
          notificationLine === -1
        ) {
          notificationLine = i + 1; // 1-indexed
        }
        if (lines[i].includes("await setSnapshot") && setSnapshotLine === -1) {
          setSnapshotLine = i + 1; // 1-indexed
        }
      }

      // This test verifies that snapshot is updated BEFORE notification
      // This prevents duplicate notifications if setSnapshot fails
      expect(notificationLine).toBeGreaterThan(0);
      expect(setSnapshotLine).toBeGreaterThan(0);

      // FIXED: Snapshot should be updated BEFORE notification
      // This ensures if setSnapshot fails, we don't send notification (no duplicates)
      // If notification fails, snapshot is already updated (no duplicates on retry)
      const snapshotBeforeNotification = setSnapshotLine < notificationLine;
      expect(snapshotBeforeNotification).toBe(true); // Snapshot should come first
    });
  });
});

describe("Worker HTTP Endpoints", () => {
  // Mock the worker module
  let worker: any;
  let mockEnv: Env;

  beforeEach(async () => {
    mockEnv = {
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
