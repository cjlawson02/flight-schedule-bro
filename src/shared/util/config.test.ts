import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createConfig, createWorkerConfig } from "./config.js";

describe("config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules to ensure fresh config load
    vi.resetModules();
    // Create a copy of process.env
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  it("loads configuration from environment variables", async () => {
    process.env.FSP_EMAIL = "test@example.com";
    process.env.FSP_PASSWORD = "test-password-123";
    process.env.DAYS_AHEAD = "60";

    const { loadCliConfig } = await import("./config.js");
    const config = loadCliConfig();

    expect(config.EMAIL).toBe("test@example.com");
    expect(config.PASSWORD).toBe("test-password-123");
    expect(config.DAYS_AHEAD).toBe(60);
  });

  it("validates email format", () => {
    const invalidEnv = {
      FSP_EMAIL: "invalid-email",
      FSP_PASSWORD: "password",
    };

    expect(() => createConfig(invalidEnv)).toThrow("Invalid email format");
  });

  it("requires non-empty password", () => {
    const invalidEnv = {
      FSP_EMAIL: "test@example.com",
      FSP_PASSWORD: "",
    };

    expect(() => createConfig(invalidEnv)).toThrow();
  });

  it("uses default values for optional config", async () => {
    process.env.FSP_EMAIL = "test@example.com";
    process.env.FSP_PASSWORD = "password123";

    const { loadCliConfig } = await import("./config.js");
    const config = loadCliConfig();

    expect(config.DAYS_AHEAD).toBe(60);
    expect(config.TIMEZONE).toBe("America/Los_Angeles");
    expect(config.AIRCRAFT_REGEX.test("N65411")).toBe(true);
    expect(config.AIRCRAFT_REGEX.test("N737BC")).toBe(true);
    expect(config.INSTRUCTOR_REGEX.test("Doug Libal")).toBe(true);
  });

  it("parses regex pattern correctly", async () => {
    process.env.FSP_EMAIL = "test@example.com";
    process.env.FSP_PASSWORD = "password123";
    process.env.AIRCRAFT_REGEX = "N12345|N67890";

    const { loadCliConfig } = await import("./config.js");
    const config = loadCliConfig();

    expect(config.AIRCRAFT_REGEX).toBeInstanceOf(RegExp);
    expect(config.AIRCRAFT_REGEX.test("N12345")).toBe(true);
    expect(config.AIRCRAFT_REGEX.test("N67890")).toBe(true);
    expect(config.AIRCRAFT_REGEX.test("N99999")).toBe(false);
  });

  it("handles numeric configuration values", async () => {
    process.env.FSP_EMAIL = "test@example.com";
    process.env.FSP_PASSWORD = "password123";
    process.env.WEEKDAY_MIN_HOUR = "14";
    process.env.MAX_HOUR = "20";

    const { loadCliConfig } = await import("./config.js");
    const config = loadCliConfig();

    expect(config.WEEKDAY_MIN_HOUR).toBe(14);
    expect(config.MAX_HOUR).toBe(20);
  });

  it("createWorkerConfig ignores legacy DAYS_AHEAD", () => {
    const config = createWorkerConfig({
      FSP_EMAIL: "worker@example.com",
      FSP_PASSWORD: "worker-password",
      AIRCRAFT_REGEX: "172S",
      DAYS_AHEAD: "60",
    });

    expect(config.WEEKDAY_MIN_HOUR).toBe(15);
    expect(config.MAX_HOUR).toBe(19);
    expect(config).not.toHaveProperty("DAYS_AHEAD");
    expect(config.MAX_DAYS_AHEAD).toBeUndefined();
  });

  it("createWorkerConfig parses MAX_DAYS_AHEAD", () => {
    const config = createWorkerConfig({
      FSP_EMAIL: "worker@example.com",
      FSP_PASSWORD: "worker-password",
      AIRCRAFT_REGEX: "172S",
      MAX_DAYS_AHEAD: "60",
    });

    expect(config.MAX_DAYS_AHEAD).toBe(60);
  });

  it("rejects invalid IANA timezone values", () => {
    const invalidEnv = {
      FSP_EMAIL: "test@example.com",
      FSP_PASSWORD: "password123",
      TIMEZONE: "America/Los_Angles",
    };

    expect(() => createConfig(invalidEnv)).toThrow(
      "TIMEZONE must be a valid IANA timezone",
    );
  });

  it("accepts valid IANA timezone values", () => {
    const validEnv = {
      FSP_EMAIL: "test@example.com",
      FSP_PASSWORD: "password123",
      TIMEZONE: "America/Chicago",
    };

    const config = createConfig(validEnv);
    expect(config.TIMEZONE).toBe("America/Chicago");
  });

  it("accepts optional RESERVATION_TYPE_ID", () => {
    const config = createConfig({
      FSP_EMAIL: "test@example.com",
      FSP_PASSWORD: "password123",
      RESERVATION_TYPE_ID: "09c58400-bd2a-49a3-a35e-9ab0e81fcebc",
    });

    expect(config.RESERVATION_TYPE_ID).toBe(
      "09c58400-bd2a-49a3-a35e-9ab0e81fcebc",
    );
  });
});
