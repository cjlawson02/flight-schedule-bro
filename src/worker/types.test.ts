import { describe, expect, it } from "vitest";
import {
  BookableAvailabilitySchema,
  MetadataSchema,
  SnapshotSchema,
  DiscordEmbedFieldSchema,
  DiscordEmbedSchema,
  DiscordPayloadSchema,
} from "./types.js";

describe("Worker Types - Zod Schemas", () => {
  describe("BookableAvailabilitySchema", () => {
    it("validates a valid availability object", () => {
      const valid = {
        date: "1/15/2024",
        startTime: "5:00:00 PM",
        endTime: "7:00:00 PM",
        instructor: "John Doe",
        aircraft: "N12345",
        instructorId: "123e4567-e89b-12d3-a456-426614174000",
        aircraftId: "223e4567-e89b-12d3-a456-426614174000",
        startDateTime: "2024-01-15T17:00:00.000Z",
        endDateTime: "2024-01-15T19:00:00.000Z",
      };

      const result = BookableAvailabilitySchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("rejects invalid UUID format", () => {
      const invalid = {
        date: "1/15/2024",
        startTime: "5:00:00 PM",
        endTime: "7:00:00 PM",
        instructor: "John Doe",
        aircraft: "N12345",
        instructorId: "not-a-uuid",
        aircraftId: "223e4567-e89b-12d3-a456-426614174000",
        startDateTime: "2024-01-15T17:00:00.000Z",
        endDateTime: "2024-01-15T19:00:00.000Z",
      };

      const result = BookableAvailabilitySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("rejects invalid datetime format", () => {
      const invalid = {
        date: "1/15/2024",
        startTime: "5:00:00 PM",
        endTime: "7:00:00 PM",
        instructor: "John Doe",
        aircraft: "N12345",
        instructorId: "123e4567-e89b-12d3-a456-426614174000",
        aircraftId: "223e4567-e89b-12d3-a456-426614174000",
        startDateTime: "not-a-datetime",
        endDateTime: "2024-01-15T19:00:00.000Z",
      };

      const result = BookableAvailabilitySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("MetadataSchema", () => {
    it("validates valid metadata", () => {
      const valid = {
        lastSearchDate: "2024-01-15",
        lastUpdate: "2024-01-15T12:30:00.000Z",
        daysAhead: 60,
      };

      const result = MetadataSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("rejects invalid date format", () => {
      const invalid = {
        lastSearchDate: "01/15/2024", // Wrong format
        lastUpdate: "2024-01-15T12:30:00.000Z",
        daysAhead: 60,
      };

      const result = MetadataSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("rejects negative daysAhead", () => {
      const invalid = {
        lastSearchDate: "2024-01-15",
        lastUpdate: "2024-01-15T12:30:00.000Z",
        daysAhead: -10,
      };

      const result = MetadataSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("SnapshotSchema", () => {
    it("validates a complete snapshot", () => {
      const valid = {
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
          lastUpdate: "2024-01-15T12:30:00.000Z",
          daysAhead: 60,
        },
      };

      const result = SnapshotSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("validates snapshot with empty slots array", () => {
      const valid = {
        slots: [],
        metadata: {
          lastSearchDate: "2024-01-15",
          lastUpdate: "2024-01-15T12:30:00.000Z",
          daysAhead: 60,
        },
      };

      const result = SnapshotSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });

  describe("DiscordEmbedFieldSchema", () => {
    it("validates a valid embed field", () => {
      const valid = {
        name: "Wed, Jan 15",
        value: "**5:00 PM - 7:00 PM**\n✈️ N12345\n👨‍✈️ John Doe",
        inline: true,
      };

      const result = DiscordEmbedFieldSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("allows optional inline field", () => {
      const valid = {
        name: "Field Name",
        value: "Field Value",
      };

      const result = DiscordEmbedFieldSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });

  describe("DiscordEmbedSchema", () => {
    it("validates a complete embed", () => {
      const valid = {
        title: "New Flight Slots Available!",
        description: "Found 3 new slots",
        color: 0x3498db,
        fields: [
          {
            name: "Wed, Jan 15",
            value: "**5:00 PM - 7:00 PM**",
            inline: true,
          },
        ],
        timestamp: "2024-01-15T12:30:00.000Z",
        footer: {
          text: "Flight Schedule Bro",
        },
      };

      const result = DiscordEmbedSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("allows minimal embed", () => {
      const valid = {
        description: "Simple message",
      };

      const result = DiscordEmbedSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });

  describe("DiscordPayloadSchema", () => {
    it("validates payload with embeds", () => {
      const valid = {
        username: "Flight Schedule Bro",
        embeds: [
          {
            title: "Test",
            description: "Test embed",
          },
        ],
      };

      const result = DiscordPayloadSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("validates payload with simple content", () => {
      const valid = {
        content: "Simple text message",
      };

      const result = DiscordPayloadSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("validates payload with both content and embeds", () => {
      const valid = {
        content: "Check this out:",
        embeds: [
          {
            description: "Embed content",
          },
        ],
      };

      const result = DiscordPayloadSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });
});
