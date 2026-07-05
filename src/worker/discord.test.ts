import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import {
  sendAvailabilityNotification,
  sendSimpleNotification,
} from "./discord.js";
import type { Env, FspMetadata } from "./types.js";
import type { BookableAvailability } from "../shared/dao/availability.js";
import { createReservationTypeFixture } from "../shared/dao/reservationTypes.fixtures.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

const createMockEnv = (): Env => ({
  FSP_AVAILABILITY_KV: {} as any,
  FSP_EMAIL: "test@example.com",
  FSP_PASSWORD: "password",
  DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/test",
  DAYS_AHEAD: "60",
  AIRCRAFT_REGEX: "172S",
});

const createMockMetadata = (): FspMetadata => ({
  instructors: [
    {
      instructorId: "123e4567-e89b-12d3-a456-426614174000",
      displayName: "John Doe",
    },
    {
      instructorId: "223e4567-e89b-12d3-a456-426614174001",
      displayName: "Jane Smith",
    },
  ],
  reservationTypes: [
    createReservationTypeFixture({
      reservationTypeId: "323e4567-e89b-12d3-a456-426614174000",
      reservationTypeName: "Dual",
    }),
  ],
  aircraft: [
    {
      aircraftId: "223e4567-e89b-12d3-a456-426614174000",
      tailNumber: "N12345",
    },
    {
      aircraftId: "323e4567-e89b-12d3-a456-426614174000",
      tailNumber: "N67890",
    },
  ],
  lastUpdated: new Date().toISOString(),
});

const fakeNow = new Date("2024-01-14T12:00:00.000Z");

describe("Discord Integration", () => {
  let metadata: FspMetadata;

  let env: Env;

  beforeEach(() => {
    metadata = createMockMetadata();

    env = createMockEnv();
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("sendAvailabilityNotification", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(fakeNow);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("does nothing when no slots provided", async () => {
      await sendAvailabilityNotification(env, [], metadata);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does nothing when slots start within 24 hours", async () => {
      const slots: BookableAvailability[] = [
        {
          date: "1/15/2024",
          startTime: "11:00:00 AM",
          endTime: "1:00:00 PM",
          instructorId: "123e4567-e89b-12d3-a456-426614174000",
          aircraftId: "223e4567-e89b-12d3-a456-426614174000",
          startDateTime: new Date("2024-01-15T11:00:00.000Z"),
          endDateTime: new Date("2024-01-15T13:00:00.000Z"),
        },
      ];

      await sendAvailabilityNotification(env, slots, metadata);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("sends notification for single slot", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => "",
      });

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

      await sendAvailabilityNotification(env, slots, metadata);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        env.DISCORD_WEBHOOK_URL,
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.username).toBe("Flight Schedule Bro");
      expect(body.content).toContain("New flight slot");
      expect(body.allowed_mentions).toEqual({ parse: [] });
      expect(body.embeds).toHaveLength(1);
      expect(body.embeds[0].title).toContain("New Flight Slots Available");
      expect(body.embeds[0].author?.name).toBe("Flight Schedule Bro");
      expect(body.embeds[0].fields).toHaveLength(1);
    });

    it("sends notification for multiple slots", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => "",
      });

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
        {
          date: "1/16/2024",
          startTime: "3:00:00 PM",
          endTime: "5:00:00 PM",

          instructorId: "223e4567-e89b-12d3-a456-426614174000",
          aircraftId: "323e4567-e89b-12d3-a456-426614174000",
          startDateTime: new Date("2024-01-16T15:00:00.000Z"),
          endDateTime: new Date("2024-01-16T17:00:00.000Z"),
        },
      ];

      await sendAvailabilityNotification(env, slots, metadata);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.embeds[0].description).toContain("2 new time slot");
      expect(body.embeds[0].fields).toHaveLength(2);
    });

    it("splits into multiple embeds for many slots", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => "",
      });

      // Create 15 slots (should split into 2 embeds: 10 + 5)
      const slots: BookableAvailability[] = Array.from(
        { length: 15 },
        (_, i) => ({
          date: `1/${15 + i}/2024`,
          startTime: "5:00:00 PM",
          endTime: "7:00:00 PM",
          instructorId: "123e4567-e89b-12d3-a456-426614174000",
          aircraftId: "223e4567-e89b-12d3-a456-426614174000",
          startDateTime: new Date(`2024-01-${15 + i}T17:00:00.000Z`),
          endDateTime: new Date(`2024-01-${15 + i}T19:00:00.000Z`),
        }),
      );

      await sendAvailabilityNotification(env, slots, metadata);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.embeds).toHaveLength(2);
      expect(body.embeds[0].fields).toHaveLength(10);
      expect(body.embeds[1].fields).toHaveLength(5);
      expect(body.embeds[1].title).toContain("continued");
    });

    it("includes aircraft and instructor in embed fields", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => "",
      });

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

      await sendAvailabilityNotification(env, slots, metadata);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const field = body.embeds[0].fields[0];
      expect(field.value).toContain("N12345");
      expect(field.value).toContain("John Doe");
      expect(field.value).toContain("5:00:00 PM");
    });

    it("throws error when Discord API returns error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "Bad Request",
      });

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

      await expect(
        sendAvailabilityNotification(env, slots, metadata),
      ).rejects.toThrow("Discord API error");
    });

    it("includes timestamp and footer in embeds", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => "",
      });

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

      await sendAvailabilityNotification(env, slots, metadata);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.embeds[0].timestamp).toBeDefined();
      expect(body.embeds[0].footer).toEqual({
        text: "Flight Schedule Bro",
      });
    });
  });

  describe("sendSimpleNotification", () => {
    it("sends simple text message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => "",
      });

      await sendSimpleNotification(env, "Test message");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content).toBe("Test message");
      expect(body.username).toBe("Flight Schedule Bro");
    });

    it("does not throw on error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "Bad Request",
      });

      // Should not throw - simple notifications are not critical
      await expect(
        sendSimpleNotification(env, "Test message"),
      ).resolves.toBeUndefined();
    });
  });

  describe("Embed Color Coding", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(fakeNow);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("uses different colors for weekday vs weekend", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        text: async () => "",
      });

      // Monday (weekday)
      const weekdaySlots: BookableAvailability[] = [
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

      await sendAvailabilityNotification(env, weekdaySlots, metadata);
      const weekdayBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const weekdayColor = weekdayBody.embeds[0].color;

      mockFetch.mockClear();

      // Sunday (weekend)
      const weekendSlots: BookableAvailability[] = [
        {
          date: "1/21/2024",
          startTime: "5:00:00 PM",
          endTime: "7:00:00 PM",

          instructorId: "123e4567-e89b-12d3-a456-426614174000",
          aircraftId: "223e4567-e89b-12d3-a456-426614174000",
          startDateTime: new Date("2024-01-21T17:00:00.000Z"),
          endDateTime: new Date("2024-01-21T19:00:00.000Z"),
        },
      ];

      await sendAvailabilityNotification(env, weekendSlots, metadata);
      const weekendBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const weekendColor = weekendBody.embeds[0].color;

      // Colors should be different
      expect(weekdayColor).not.toBe(weekendColor);
    });
  });

  describe("Existing Reservation Context", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(fakeNow);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows warning when new slot is on same day as existing reservation", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        text: async () => "",
      });

      const newSlot: BookableAvailability = {
        date: "1/15/2024",
        startTime: "5:00:00 PM",
        endTime: "7:00:00 PM",

        instructorId: "123e4567-e89b-12d3-a456-426614174000",
        aircraftId: "223e4567-e89b-12d3-a456-426614174000",
        startDateTime: new Date("2024-01-15T17:00:00.000Z"),
        endDateTime: new Date("2024-01-15T19:00:00.000Z"),
      };

      const existingReservations = [
        {
          reservationId: "7fd24fb6-977f-4b4a-89ac-dc949030d234",
          start: "2024-01-15T15:00:00",
          end: "2024-01-15T17:00:00",
          startUtc: "2024-01-15T23:00:00",
          endUtc: "2024-01-16T01:00:00",
          instructor: "Jane Smith",
          resource: "N67890",
        },
      ];

      await sendAvailabilityNotification(
        env,
        [newSlot],
        metadata,
        existingReservations,
        "America/Los_Angeles",
      );

      expect(mockFetch).toHaveBeenCalledOnce();
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const fieldValue = requestBody.embeds[0].fields[0].value;

      // Should include warning about existing reservation
      expect(fieldValue).toContain("⚠️");
      expect(fieldValue).toContain("You have:");
      expect(fieldValue).toContain("3:00 PM - 5:00 PM");
      expect(fieldValue).toContain("Jane Smith");
      expect(fieldValue).toContain("N67890");
    });

    it("shows no warning when new slot has no conflict", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        text: async () => "",
      });

      const newSlot: BookableAvailability = {
        date: "1/15/2024",
        startTime: "5:00:00 PM",
        endTime: "7:00:00 PM",

        instructorId: "123e4567-e89b-12d3-a456-426614174000",
        aircraftId: "223e4567-e89b-12d3-a456-426614174000",
        startDateTime: new Date("2024-01-15T17:00:00.000Z"),
        endDateTime: new Date("2024-01-15T19:00:00.000Z"),
      };

      const existingReservations = [
        {
          reservationId: "abc123",
          start: "2024-01-16T15:00:00", // Different day
          end: "2024-01-16T17:00:00",

          resource: "N67890",
        },
      ];

      await sendAvailabilityNotification(
        env,
        [newSlot],
        metadata,
        existingReservations,
        "America/Los_Angeles",
      );

      expect(mockFetch).toHaveBeenCalledOnce();
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const fieldValue = requestBody.embeds[0].fields[0].value;

      // Should not include warning
      expect(fieldValue).not.toContain("⚠️");
      expect(fieldValue).not.toContain("You have:");
    });

    it("handles missing instructor and aircraft in existing reservation", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        text: async () => "",
      });

      const newSlot: BookableAvailability = {
        date: "1/15/2024",
        startTime: "5:00:00 PM",
        endTime: "7:00:00 PM",

        instructorId: "123e4567-e89b-12d3-a456-426614174000",
        aircraftId: "223e4567-e89b-12d3-a456-426614174000",
        startDateTime: new Date("2024-01-15T17:00:00.000Z"),
        endDateTime: new Date("2024-01-15T19:00:00.000Z"),
      };

      const existingReservations = [
        {
          reservationId: "abc123",
          start: "2024-01-15T15:00:00",
          end: "2024-01-15T17:00:00",
          // No instructor or resource
        },
      ];

      await sendAvailabilityNotification(
        env,
        [newSlot],
        metadata,
        existingReservations,
        "America/Los_Angeles",
      );

      expect(mockFetch).toHaveBeenCalledOnce();
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const fieldValue = requestBody.embeds[0].fields[0].value;

      // Should include warning but without instructor/aircraft details
      expect(fieldValue).toContain("⚠️");
      expect(fieldValue).toContain("You have:");
      expect(fieldValue).toContain("3:00 PM - 5:00 PM");
      expect(fieldValue).not.toContain("with ");
      expect(fieldValue).not.toContain("in ");
    });
  });
});
