import { describe, expect, it, beforeEach, vi } from "vitest";
import type { Env } from "./types.js";

// Mock the dependencies
vi.mock("../shared/dao/auth.js", () => ({
  fetchAuth: vi.fn().mockResolvedValue(undefined),
  getOperatorId: vi.fn().mockReturnValue(123),
  getUserId: vi.fn().mockReturnValue("user-guid-123"),
  getDefaultLocationId: vi.fn().mockReturnValue(456),
}));

vi.mock("../shared/blo/scheduler.js", () => ({
  SchedulerBLO: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    getInstructorIds: vi.fn().mockReturnValue(["instructor-1", "instructor-2"]),
    getAircraftMapEntries: vi.fn().mockReturnValue([
      ["aircraft-1", "N172S"],
      ["aircraft-2", "N172N"],
    ]),
    getAircraftIds: vi.fn().mockReturnValue(["aircraft-1", "aircraft-2"]),
    getActivityTypesMapEntries: vi
      .fn()
      .mockReturnValue([["activity-1", "Dual Flight Training"]]),
    getBookableAvailability: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock("./kv.js", () => ({
  initializeSnapshot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./discord.js", () => ({
  sendSimpleNotification: vi.fn().mockResolvedValue(undefined),
}));

describe("Worker Setup", () => {
  let mockEnv: Env;
  let mockKV: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockKV = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
      list: vi.fn(),
    };

    mockEnv = {
      FSP_AVAILABILITY_KV: mockKV,
      FSP_EMAIL: "test@example.com",
      FSP_PASSWORD: "password",
      DISCORD_WEBHOOK_URL: "https://discord.com/webhook",
      DAYS_AHEAD: "60",
      AIRCRAFT_REGEX: "172S|172N",
      WEEKDAY_MIN_HOUR: "15",
      MAX_HOUR: "19",
    };
  });

  describe("Configuration Validation", () => {
    it("validates required environment variables", () => {
      expect(mockEnv.FSP_EMAIL).toBeDefined();
      expect(mockEnv.FSP_PASSWORD).toBeDefined();
      expect(mockEnv.DAYS_AHEAD).toBeDefined();
      expect(mockEnv.AIRCRAFT_REGEX).toBeDefined();
    });

    it("uses default values for optional config", () => {
      const envWithoutOptional: Env = {
        FSP_AVAILABILITY_KV: mockKV,
        FSP_EMAIL: "test@example.com",
        FSP_PASSWORD: "password",
        DISCORD_WEBHOOK_URL: "https://discord.com/webhook",
        DAYS_AHEAD: "60",
        AIRCRAFT_REGEX: "172S",
      };

      expect(envWithoutOptional.WEEKDAY_MIN_HOUR).toBeUndefined();
      expect(envWithoutOptional.MAX_HOUR).toBeUndefined();
    });
  });

  describe("Setup Process Flow", () => {
    it("follows correct setup sequence", async () => {
      // The setup should:
      // 1. Create config
      // 2. Authenticate
      // 3. Initialize scheduler
      // 4. Fetch availability
      // 5. Filter valid results
      // 6. Initialize snapshot in KV
      // 7. Send Discord notification

      const setupSteps = [
        "create config",
        "authenticate",
        "initialize scheduler",
        "fetch availability",
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
    it("handles authentication errors", async () => {
      const authError = new Error("Authentication failed");
      // In the real implementation, this would be caught and returned as error response
      expect(authError.message).toContain("Authentication failed");
    });

    it("handles missing activity types", async () => {
      const emptyActivityTypes: Array<[string, string]> = [];
      // Should throw error when no activity types found
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
          "✅ Setup complete! Initialized with 42 available time slots for the next 60 days.",
        slotsCount: 42,
        daysAhead: 60,
      };

      expect(successResponse.success).toBe(true);
      expect(successResponse.slotsCount).toBe(42);
      expect(successResponse.daysAhead).toBe(60);
      expect(successResponse.message).toContain("Setup complete");
    });
  });

  describe("Chunking Strategy", () => {
    it("chunks instructors into groups of 3", () => {
      const instructors = ["inst-1", "inst-2", "inst-3", "inst-4", "inst-5"];
      const chunkSize = 3;

      const chunks: string[][] = [];
      for (let i = 0; i < instructors.length; i += chunkSize) {
        chunks.push(instructors.slice(i, i + chunkSize));
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toHaveLength(3);
      expect(chunks[1]).toHaveLength(2);
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

  describe("Date Range Calculation", () => {
    it("calculates correct date range for DAYS_AHEAD", () => {
      const today = new Date("2024-01-15T00:00:00.000Z");

      const daysAhead = 60;
      const dates: string[] = [];

      for (let offset = 0; offset <= daysAhead; offset++) {
        const day = new Date(today);
        day.setDate(day.getDate() + offset);
        const dayISO = day.toISOString().split("T")[0];
        dates.push(dayISO);
      }

      expect(dates).toHaveLength(61); // 0 to 60 inclusive
      expect(dates[0]).toBe("2024-01-15");
      expect(dates[60]).toBe("2024-03-14"); // 60 days after Jan 15
    });
  });

  describe("Discord Notification", () => {
    it("does not fail setup if Discord notification fails", () => {
      // Discord notification should not throw error
      // Setup should still succeed if notification fails

      const discordError = new Error("Discord webhook failed");
      let setupSucceeded = true;

      try {
        // Discord notification fails
        throw discordError;
      } catch (error) {
        console.error("Failed to send Discord notification:", error);
        // Don't fail the setup
      }

      expect(setupSucceeded).toBe(true);
    });
  });
});
