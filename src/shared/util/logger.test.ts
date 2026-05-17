import { afterEach, describe, expect, it, vi } from "vitest";
import { configureLogger, getLogger } from "./logger.js";

describe("logger", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates named sub-loggers", () => {
    configureLogger({ runtime: "test" });
    const log = getLogger("test-module");
    expect(log).toBeDefined();
    expect(() => {
      log.info("test message", { key: "value" });
    }).not.toThrow();
  });

  it("defaults CLI to warn and worker to info", () => {
    configureLogger({ runtime: "cli" });
    expect(getLogger("cli-default").settings.minLevel).toBe(4);

    configureLogger({ runtime: "worker" });
    expect(getLogger("worker-default").settings.minLevel).toBe(3);
  });

  it("respects LOG_LEVEL from environment", () => {
    vi.stubEnv("LOG_LEVEL", "error");
    configureLogger({ runtime: "cli" });
    const log = getLogger("level-test");
    expect(log.settings.minLevel).toBe(5);
  });
});
