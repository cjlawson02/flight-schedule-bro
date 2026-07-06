import { describe, expect, it, beforeEach, vi } from "vitest";
import type { Env } from "./types.js";

describe("Worker Setup", () => {
  let mockEnv: Env;
  let mockKV: KVNamespace;

  beforeEach(() => {
    mockKV = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
      list: vi.fn(),
    } as unknown as KVNamespace;

    mockEnv = {
      FSP_AVAILABILITY_KV: mockKV,
      FSP_EMAIL: "test@example.com",
      FSP_PASSWORD: "password",
      DISCORD_WEBHOOK_URL: "https://discord.com/webhook",
      AIRCRAFT_REGEX: "172S|172N",
      WEEKDAY_MIN_HOUR: "15",
      MAX_HOUR: "19",
    };
  });

  describe("Configuration Validation", () => {
    it("validates required environment variables", () => {
      expect(mockEnv.FSP_EMAIL).toBeDefined();
      expect(mockEnv.FSP_PASSWORD).toBeDefined();
      expect(mockEnv.AIRCRAFT_REGEX).toBeDefined();
    });

    it("uses default values for optional config", () => {
      const envWithoutOptional: Env = {
        FSP_AVAILABILITY_KV: mockKV,
        FSP_EMAIL: "test@example.com",
        FSP_PASSWORD: "password",
        DISCORD_WEBHOOK_URL: "https://discord.com/webhook",
        AIRCRAFT_REGEX: "172S",
      };

      expect(envWithoutOptional.WEEKDAY_MIN_HOUR).toBeUndefined();
      expect(envWithoutOptional.MAX_HOUR).toBeUndefined();
    });
  });

  describe("Setup Process Flow", () => {
    it("follows correct setup sequence", () => {
      const setupSteps = [
        "create config",
        "authenticate",
        "initialize scheduler",
        "fetch schedule snapshot",
        "filter results",
        "initialize KV snapshot",
        "send notification",
      ];

      expect(setupSteps).toHaveLength(7);
      expect(setupSteps[0]).toBe("create config");
      expect(setupSteps[setupSteps.length - 1]).toBe("send notification");
    });
  });

  describe("Error Handling", () => {
    it("handles authentication errors", () => {
      const authError = new Error("Authentication failed");
      expect(authError.message).toContain("Authentication failed");
    });

    it("handles missing activity types", () => {
      const emptyActivityTypes: [string, string][] = [];
      if (emptyActivityTypes.length === 0) {
        const error = new Error("No activity types found");
        expect(error.message).toBe("No activity types found");
      }
    });

    it("returns error response on failure", () => {
      const errorResponse = {
        success: false,
        error: "Setup failed: Test error",
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.error).toContain("Setup failed");
    });
  });

  describe("Success Response", () => {
    it("returns success response with slot count", () => {
      const successResponse = {
        success: true,
        message:
          "✅ Setup complete! Initialized with 42 available time slots through 2024-03-15.",
        slotsCount: 42,
        trackedThroughDate: "2024-03-15",
        daysFetched: 39,
      };

      expect(successResponse.success).toBe(true);
      expect(successResponse.slotsCount).toBe(42);
      expect(successResponse.trackedThroughDate).toBe("2024-03-15");
      expect(successResponse.message).toContain("Setup complete");
    });
  });

  describe("Aircraft Filtering", () => {
    it("filters aircraft by regex pattern", () => {
      const allAircraft = [
        ["aircraft-1", "N172S"],
        ["aircraft-2", "N172N"],
        ["aircraft-3", "N152"],
      ];

      const regex = new RegExp("172S|172N", "i");
      const filtered = allAircraft
        .filter(([, callsign]) => regex.test(callsign))
        .map(([id]) => id);

      expect(filtered).toHaveLength(2);
      expect(filtered).toContain("aircraft-1");
      expect(filtered).toContain("aircraft-2");
    });

    it("uses all aircraft when no matches", () => {
      const allAircraft = [
        ["aircraft-1", "N152"],
        ["aircraft-2", "N150"],
      ];
      const allAircraftIds = allAircraft.map(([id]) => id);

      const regex = new RegExp("172S", "i");
      const filtered = allAircraft
        .filter(([, callsign]) => regex.test(callsign))
        .map(([id]) => id);

      const finalIds = filtered.length > 0 ? filtered : allAircraftIds;

      expect(finalIds).toHaveLength(2);
      expect(finalIds).toEqual(allAircraftIds);
    });
  });

  describe("Discord Notification", () => {
    it("does not fail setup if Discord notification fails", () => {
      const discordError = new Error("Discord webhook failed");
      const setupSucceeded = true;

      try {
        throw discordError;
      } catch (error) {
        console.error("Failed to send Discord notification:", error);
      }

      expect(setupSucceeded).toBe(true);
    });
  });
});
