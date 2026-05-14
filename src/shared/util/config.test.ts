import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createConfig } from "./config.js";

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

    const { CONFIG } = await import("./config.js");

    expect(CONFIG.EMAIL).toBe("test@example.com");
    expect(CONFIG.PASSWORD).toBe("test-password-123");
    expect(CONFIG.DAYS_AHEAD).toBe(60);
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

    const { CONFIG } = await import("./config.js");

    expect(CONFIG.DAYS_AHEAD).toBe(60); // Default
  });

  it("parses regex pattern correctly", async () => {
    process.env.FSP_EMAIL = "test@example.com";
    process.env.FSP_PASSWORD = "password123";
    process.env.AIRCRAFT_REGEX = "N12345|N67890";

    const { CONFIG } = await import("./config.js");

    expect(CONFIG.AIRCRAFT_REGEX).toBeInstanceOf(RegExp);
    expect(CONFIG.AIRCRAFT_REGEX.test("N12345")).toBe(true);
    expect(CONFIG.AIRCRAFT_REGEX.test("N67890")).toBe(true);
    expect(CONFIG.AIRCRAFT_REGEX.test("N99999")).toBe(false);
  });

  it("handles numeric configuration values", async () => {
    process.env.FSP_EMAIL = "test@example.com";
    process.env.FSP_PASSWORD = "password123";
    process.env.WEEKDAY_MIN_HOUR = "14";
    process.env.MAX_HOUR = "20";

    const { CONFIG } = await import("./config.js");

    expect(CONFIG.WEEKDAY_MIN_HOUR).toBe(14);
    expect(CONFIG.MAX_HOUR).toBe(20);
  });

  it("createConfig function works with Worker environment objects", () => {
    const workerEnv = {
      FSP_EMAIL: "worker@example.com",
      FSP_PASSWORD: "worker-password",
      DAYS_AHEAD: "90",
      AIRCRAFT_REGEX: "172S",
    };

    const config = createConfig(workerEnv);

    expect(config.EMAIL).toBe("worker@example.com");
    expect(config.PASSWORD).toBe("worker-password");
    expect(config.DAYS_AHEAD).toBe(90);
    expect(config.AIRCRAFT_REGEX.test("172S")).toBe(true);
  });
});
