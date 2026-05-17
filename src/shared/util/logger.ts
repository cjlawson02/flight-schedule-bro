import { Logger, type ILogObj } from "tslog";

export type LogRuntime = "cli" | "worker" | "test";

export interface LoggerConfig {
  runtime?: LogRuntime;
  minLevel?: number;
  type?: "pretty" | "json" | "hidden";
}

const LOG_LEVEL_MAP: Record<string, number> = {
  silly: 0,
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fatal: 6,
};

function parseLogLevel(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  return LOG_LEVEL_MAP[value.toLowerCase()];
}

function detectRuntime(): LogRuntime {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "test") {
    return "test";
  }
  return "cli";
}

function defaultConfig(
  runtime: LogRuntime,
): Required<Pick<LoggerConfig, "runtime" | "type" | "minLevel">> {
  const envLevel =
    typeof process !== "undefined"
      ? parseLogLevel(process.env.LOG_LEVEL)
      : undefined;

  if (runtime === "test") {
    return { runtime, type: "hidden", minLevel: 6 };
  }

  if (runtime === "worker") {
    return {
      runtime,
      type: "json",
      minLevel: envLevel ?? 3,
    };
  }

  return {
    runtime: "cli",
    type: "pretty",
    minLevel: envLevel ?? 4,
  };
}

let rootLogger: Logger<ILogObj> | undefined;

export function configureLogger(config: LoggerConfig = {}): Logger<ILogObj> {
  const runtime = config.runtime ?? detectRuntime();
  const defaults = defaultConfig(runtime);
  const merged = { ...defaults, ...config };

  rootLogger = new Logger({
    type: merged.type,
    minLevel: merged.minLevel,
    name: "flight-schedule-bro",
    hideLogPositionForProduction: merged.runtime === "worker",
    maskValuesOfKeys: [
      "password",
      "token",
      "authorization",
      "cookie",
      "FSP_PASSWORD",
    ],
  });

  return rootLogger;
}

export function getLogger(name: string): Logger<ILogObj> {
  rootLogger ??= configureLogger();
  return rootLogger.getSubLogger({ name });
}

/**
 * Module-scoped logger that always delegates to the current root logger.
 * Use this for `const log = createLogger("module")` at module scope so runtime
 * configuration (CLI vs Worker) applied in entry points takes effect.
 */
export function createLogger(name: string): Logger<ILogObj> {
  return new Proxy({} as Logger<ILogObj>, {
    get(_target, prop: string | symbol) {
      if (prop === "then") {
        return undefined;
      }
      const logger = getLogger(name);
      const value: unknown = Reflect.get(logger, prop);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(logger)
        : value;
    },
  });
}
