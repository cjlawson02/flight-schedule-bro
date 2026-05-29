import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  getSnapshot,
  setSnapshot,
  getSlotsFromSnapshot,
  cleanPastSlotsFromSnapshot,
  initializeSnapshot,
} from "./kv.js";
import type { Env, Metadata } from "./types.js";
import type { BookableAvailability } from "../shared/dao/availability.js";

// Mock KV namespace
const createMockKV = () => {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) || null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(),
    _store: store, // For test inspection
  };
};

const createMockEnv = (kvMock: any): Env => {
  return {
    FSP_AVAILABILITY_KV: kvMock,
    FSP_EMAIL: "test@example.com",
    FSP_PASSWORD: "password",
    DISCORD_WEBHOOK_URL: "https://discord.com/webhook",
    DAYS_AHEAD: "60",
    AIRCRAFT_REGEX: "172S",
  };
};

describe("Worker KV Operations", () => {
  let mockKV: ReturnType<typeof createMockKV>;
  let env: Env;

  beforeEach(() => {
    mockKV = createMockKV();
    env = createMockEnv(mockKV);
  });

  describe("getSnapshot", () => {
    it("returns null when no snapshot exists", async () => {
      const result = await getSnapshot(env);
      expect(result).toBeNull();
    });

    it("returns parsed snapshot when it exists", async () => {
      const snapshot = {
        slots: [],
        metadata: {
          lastSearchDate: "2024-01-15",
          lastUpdate: "2024-01-15T12:00:00.000Z",
          daysAhead: 60,
        },
      };

      mockKV._store.set("availability_snapshot", JSON.stringify(snapshot));

      const result = await getSnapshot(env);
      expect(result).toEqual(snapshot);
    });

    it("throws error for invalid snapshot data", async () => {
      mockKV._store.set(
        "availability_snapshot",
        JSON.stringify({ invalid: "data" }),
      );

      await expect(getSnapshot(env)).rejects.toThrow(
        "Invalid snapshot data in KV",
      );
    });

    it("throws error for malformed JSON", async () => {
      mockKV._store.set("availability_snapshot", "not valid json");

      await expect(getSnapshot(env)).rejects.toThrow();
    });
  });

  describe("setSnapshot", () => {
    it("stores snapshot with serialized dates", async () => {
      const slots: BookableAvailability[] = [
        {
          date: "1/15/2024",
          startTime: "5:00:00 PM",
          endTime: "7:00:00 PM",
          instructorId: "123e4567-e89b-12d3-a456-426614174000",
          aircraftId: "223e4567-e89b-12d3-a456-426614174000",
          startDateTime: new Date("2024-01-15T17:00:00.000Z"),
          endDateTime: new Date("2024-01-15T19:00:00.000Z"),
        },
      ];

      const metadata: Metadata = {
        lastSearchDate: "2024-01-15",
        lastUpdate: "2024-01-15T12:00:00.000Z",
        daysAhead: 60,
      };

      await setSnapshot(env, slots, metadata);

      const stored = mockKV._store.get("availability_snapshot");
      expect(stored).toBeDefined();

      const parsed = JSON.parse(stored!);
      expect(parsed.slots).toHaveLength(1);
      expect(parsed.slots[0].startDateTime).toBe("2024-01-15T17:00:00.000Z");
      expect(parsed.metadata).toEqual(metadata);
    });

    it("throws error for invalid snapshot data", async () => {
      const invalidSlots: any = [
        {
          // Missing required fields but has dates to avoid toISOString error
          date: "1/15/2024",
          startDateTime: new Date("2024-01-15T17:00:00.000Z"),
          endDateTime: new Date("2024-01-15T19:00:00.000Z"),
        },
      ];

      const metadata: Metadata = {
        lastSearchDate: "2024-01-15",
        lastUpdate: "2024-01-15T12:00:00.000Z",
        daysAhead: 60,
      };

      await expect(setSnapshot(env, invalidSlots, metadata)).rejects.toThrow(
        "Invalid snapshot data",
      );
    });
  });

  describe("initializeSnapshot", () => {
    it("creates initial snapshot with current date", async () => {
      const slots: BookableAvailability[] = [
        {
          date: "1/15/2024",
          startTime: "5:00:00 PM",
          endTime: "7:00:00 PM",
          instructorId: "123e4567-e89b-12d3-a456-426614174000",
          aircraftId: "223e4567-e89b-12d3-a456-426614174000",
          startDateTime: new Date("2024-01-15T17:00:00.000Z"),
          endDateTime: new Date("2024-01-15T19:00:00.000Z"),
        },
      ];

      await initializeSnapshot(env, slots, 60);

      const result = await getSnapshot(env);
      expect(result).not.toBeNull();
      expect(result!.slots).toHaveLength(1);
      expect(result!.metadata.daysAhead).toBe(60);
      expect(result!.metadata.lastSearchDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("getSlotsFromSnapshot", () => {
    it("returns empty array when snapshot is null", () => {
      const result = getSlotsFromSnapshot(null);
      expect(result).toEqual([]);
    });

    it("returns deserialized slots with Date objects", () => {
      const snapshot = {
        slots: [
          {
            date: "1/15/2024",
            startTime: "5:00:00 PM",
            endTime: "7:00:00 PM",
            instructor: "John Doe",
            aircraft: "N12345",
            instructorId: "123e4567-e89b-12d3-a456-426614174000",
            aircraftId: "223e4567-e89b-12d3-a456-426614174000",
            startDateTime: "2024-01-15T17:00:00.000Z",
            endDateTime: "2024-01-15T19:00:00.000Z",
          },
        ],
        metadata: {
          lastSearchDate: "2024-01-15",
          lastUpdate: "2024-01-15T12:00:00.000Z",
          daysAhead: 60,
        },
      };

      const result = getSlotsFromSnapshot(snapshot);
      expect(result).toHaveLength(1);
      expect(result[0].startDateTime).toBeInstanceOf(Date);
      expect(result[0].endDateTime).toBeInstanceOf(Date);
      expect(result[0].startDateTime.toISOString()).toBe(
        "2024-01-15T17:00:00.000Z",
      );
    });
  });

  describe("cleanPastSlotsFromSnapshot", () => {
    it("returns null when snapshot is null", () => {
      const now = new Date("2024-01-20T12:00:00.000Z");
      const result = cleanPastSlotsFromSnapshot(null, now);
      expect(result).toBeNull();
    });

    it("removes slots before specified date", () => {
      const now = new Date("2024-01-20T12:00:00.000Z");
      const snapshot = {
        slots: [
          {
            date: "1/15/2024",
            startTime: "5:00:00 PM",
            endTime: "7:00:00 PM",
            instructor: "John Doe",
            aircraft: "N12345",
            instructorId: "123e4567-e89b-12d3-a456-426614174000",
            aircraftId: "223e4567-e89b-12d3-a456-426614174000",
            startDateTime: "2024-01-15T17:00:00.000Z", // In the past
            endDateTime: "2024-01-15T19:00:00.000Z",
          },
          {
            date: "1/25/2024",
            startTime: "5:00:00 PM",
            endTime: "7:00:00 PM",
            instructor: "Jane Doe",
            aircraft: "N67890",
            instructorId: "223e4567-e89b-12d3-a456-426614174000",
            aircraftId: "323e4567-e89b-12d3-a456-426614174000",
            startDateTime: "2024-01-25T17:00:00.000Z", // In the future
            endDateTime: "2024-01-25T19:00:00.000Z",
          },
        ],
        metadata: {
          lastSearchDate: "2024-01-15",
          lastUpdate: "2024-01-15T12:00:00.000Z",
          daysAhead: 60,
        },
      };

      const result = cleanPastSlotsFromSnapshot(snapshot, now);
      expect(result).not.toBeNull();
      expect(result!.slots).toHaveLength(1);
      expect(result!.slots[0].aircraftId).toBe(
        "323e4567-e89b-12d3-a456-426614174000",
      );
      expect(result!.metadata).toEqual(snapshot.metadata);
    });

    it("removes slots earlier today that already started", () => {
      const now = new Date("2024-01-20T18:00:00.000Z");
      const snapshot = {
        slots: [
          {
            date: "1/20/2024",
            startTime: "9:00:00 AM",
            endTime: "11:00:00 AM",
            instructor: "John Doe",
            aircraft: "N12345",
            instructorId: "123e4567-e89b-12d3-a456-426614174000",
            aircraftId: "223e4567-e89b-12d3-a456-426614174000",
            startDateTime: "2024-01-20T17:00:00.000Z",
            endDateTime: "2024-01-20T19:00:00.000Z",
          },
          {
            date: "1/20/2024",
            startTime: "8:00:00 PM",
            endTime: "10:00:00 PM",
            instructor: "Jane Doe",
            aircraft: "N67890",
            instructorId: "223e4567-e89b-12d3-a456-426614174000",
            aircraftId: "323e4567-e89b-12d3-a456-426614174000",
            startDateTime: "2024-01-21T04:00:00.000Z",
            endDateTime: "2024-01-21T06:00:00.000Z",
          },
        ],
        metadata: {
          lastSearchDate: "2024-01-20",
          lastUpdate: "2024-01-20T12:00:00.000Z",
          daysAhead: 60,
        },
      };

      const result = cleanPastSlotsFromSnapshot(snapshot, now);
      expect(result).not.toBeNull();
      expect(result!.slots).toHaveLength(1);
      expect(result!.slots[0].aircraftId).toBe(
        "323e4567-e89b-12d3-a456-426614174000",
      );
    });

    it("preserves all slots when all are in the future", () => {
      const now = new Date("2024-01-10T12:00:00.000Z");
      const snapshot = {
        slots: [
          {
            date: "1/15/2024",
            startTime: "5:00:00 PM",
            endTime: "7:00:00 PM",
            instructor: "John Doe",
            aircraft: "N12345",
            instructorId: "123e4567-e89b-12d3-a456-426614174000",
            aircraftId: "223e4567-e89b-12d3-a456-426614174000",
            startDateTime: "2024-01-15T17:00:00.000Z",
            endDateTime: "2024-01-15T19:00:00.000Z",
          },
        ],
        metadata: {
          lastSearchDate: "2024-01-15",
          lastUpdate: "2024-01-15T12:00:00.000Z",
          daysAhead: 60,
        },
      };

      const result = cleanPastSlotsFromSnapshot(snapshot, now);
      expect(result).not.toBeNull();
      expect(result!.slots).toHaveLength(1);
    });
  });
});
