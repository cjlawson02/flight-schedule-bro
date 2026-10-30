import { z } from "zod";
import { DEFAULT_TIMEZONE } from "./flightTime.js";
import { createLogger } from "./logger.js";

const log = createLogger("config");

function isValidIanaTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// Define schema for environment variables
const envSchema = z.object({
  // Authentication (required)
  FSP_EMAIL: z.email("Invalid email format for FSP_EMAIL"),
  FSP_PASSWORD: z.string().min(1, "FSP_PASSWORD cannot be empty"),

  // Scheduling preferences (with defaults)
  DAYS_AHEAD: z.coerce.number().int().positive().default(60),
  AIRCRAFT_REGEX: z.string().default("65411|737BC"),
  INSTRUCTOR_REGEX: z.string().default("Doug Libal"),
  TIMEZONE: z
    .string()
    .min(1)
    .refine((value) => isValidIanaTimeZone(value), {
      message: "TIMEZONE must be a valid IANA timezone (e.g. America/Los_Angeles)",
    })
    .default(DEFAULT_TIMEZONE),

  // Booking hour window (with defaults)
  WEEKDAY_MIN_HOUR: z.coerce.number().int().min(0).max(23).default(15),
  WEEKEND_MIN_HOUR: z.coerce.number().int().min(0).max(23).default(8),
  MAX_HOUR: z.coerce.number().int().min(0).max(23).default(19),

  // Optional reservation type override for automated monitoring
  RESERVATION_TYPE_ID: z.uuid("RESERVATION_TYPE_ID must be a valid UUID").optional(),
});

export interface ConfigType {
  WEEKDAY_MIN_HOUR: number;
  WEEKEND_MIN_HOUR: number;
  MAX_HOUR: number;
  EMAIL: string;
  PASSWORD: string;
  AIRCRAFT_REGEX: RegExp;
  INSTRUCTOR_REGEX: RegExp;
  DAYS_AHEAD: number;
  TIMEZONE: string;
  RESERVATION_TYPE_ID?: string;
}

/** Worker runtime config (lookahead is derived from the subrequest budget). */
export type WorkerConfigType = Omit<ConfigType, "DAYS_AHEAD"> & {
  /** Optional cap on calendar days searched (today + N days). */
  MAX_DAYS_AHEAD?: number;
  /** When true, cron auto-books clear rental slots (>24h lead). */
  AUTO_BOOK: boolean;
  /** Max reservations to create per cron invocation. */
  AUTO_BOOK_MAX_PER_RUN: number;
  /**
   * Minutes from local midnight after which personal-calendar busy is ignored
   * for auto-book (still enforces FSP same-day). Default 15:30 → 930.
   */
  AUTO_BOOK_IGNORE_CALENDAR_AFTER_MINUTES: number;
};

/** Worker env bindings used to build runtime config. */
export interface WorkerEnvInput {
  FSP_EMAIL: string;
  FSP_PASSWORD: string;
  AIRCRAFT_REGEX: string;
  INSTRUCTOR_REGEX?: string;
  WEEKDAY_MIN_HOUR?: string;
  WEEKEND_MIN_HOUR?: string;
  MAX_HOUR?: string;
  TIMEZONE?: string;
  RESERVATION_TYPE_ID?: string;
  MAX_DAYS_AHEAD?: string;
  DAYS_AHEAD?: string;
  AUTO_BOOK?: string;
  AUTO_BOOK_MAX_PER_RUN?: string;
  /** HH:MM local (e.g. "15:30") — ignore iCal busy for slots starting then or later. */
  AUTO_BOOK_IGNORE_CALENDAR_AFTER?: string;
}

/**
 * Create configuration from environment object
 * Works in both Node.js (process.env) and Cloudflare Workers (env object)
 */
export function createConfig(envObj: Record<string, unknown>): ConfigType {
  let env: z.infer<typeof envSchema>;
  try {
    env = envSchema.parse(envObj);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingOrInvalid = error.issues.map((issue) => {
        const field = issue.path.join(".");
        return `  - ${field}: ${issue.message}`;
      });
      throw new Error(
        `Environment variable validation failed:\n${missingOrInvalid.join("\n")}\n\n` +
          `Please ensure all required environment variables are set.`,
        { cause: error },
      );
    }
    throw error;
  }

  return {
    // Booking hour window
    WEEKDAY_MIN_HOUR: env.WEEKDAY_MIN_HOUR,
    WEEKEND_MIN_HOUR: env.WEEKEND_MIN_HOUR,
    MAX_HOUR: env.MAX_HOUR,

    // Authentication
    EMAIL: env.FSP_EMAIL,
    PASSWORD: env.FSP_PASSWORD,

    // Scheduling preferences
    AIRCRAFT_REGEX: new RegExp(env.AIRCRAFT_REGEX, "i"),
    INSTRUCTOR_REGEX: new RegExp(env.INSTRUCTOR_REGEX, "i"),
    DAYS_AHEAD: env.DAYS_AHEAD,
    TIMEZONE: env.TIMEZONE,
    RESERVATION_TYPE_ID: env.RESERVATION_TYPE_ID,
  };
}

export function createWorkerConfig(env: WorkerEnvInput): WorkerConfigType {
  if (env.DAYS_AHEAD !== undefined && env.DAYS_AHEAD.trim() !== "") {
    log.warn("DAYS_AHEAD is ignored by the worker; set MAX_DAYS_AHEAD to cap calendar lookahead", {
      daysAhead: env.DAYS_AHEAD,
    });
  }

  const config = createConfig({
    FSP_EMAIL: env.FSP_EMAIL,
    FSP_PASSWORD: env.FSP_PASSWORD,
    AIRCRAFT_REGEX: env.AIRCRAFT_REGEX,
    INSTRUCTOR_REGEX: env.INSTRUCTOR_REGEX ?? "Doug Libal",
    WEEKDAY_MIN_HOUR: env.WEEKDAY_MIN_HOUR ?? "15",
    WEEKEND_MIN_HOUR: env.WEEKEND_MIN_HOUR ?? "8",
    MAX_HOUR: env.MAX_HOUR ?? "19",
    TIMEZONE: env.TIMEZONE,
    RESERVATION_TYPE_ID: env.RESERVATION_TYPE_ID,
  });

  const { DAYS_AHEAD: _daysAhead, ...workerConfig } = config;
  const maxDaysAhead = parseOptionalPositiveInt(env.MAX_DAYS_AHEAD);
  const autoBookMax = parseOptionalPositiveInt(env.AUTO_BOOK_MAX_PER_RUN) ?? 1;

  return {
    ...workerConfig,
    AUTO_BOOK: parseTruthyFlag(env.AUTO_BOOK),
    AUTO_BOOK_MAX_PER_RUN: autoBookMax,
    AUTO_BOOK_IGNORE_CALENDAR_AFTER_MINUTES: parseLocalHhMmToMinutes(
      env.AUTO_BOOK_IGNORE_CALENDAR_AFTER,
      15 * 60 + 30,
    ),
    ...(maxDaysAhead !== undefined ? { MAX_DAYS_AHEAD: maxDaysAhead } : {}),
  };
}

/** Parse "15:30" / "15.5" into minutes from midnight. */
export function parseLocalHhMmToMinutes(
  value: string | undefined,
  fallbackMinutes: number,
): number {
  if (value === undefined || value.trim() === "") {
    return fallbackMinutes;
  }
  const trimmed = value.trim();
  const hhmm = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (hhmm) {
    const hours = Number(hhmm[1]);
    const minutes = Number(hhmm[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return hours * 60 + minutes;
    }
  }
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && asNumber >= 0 && asNumber < 24) {
    return Math.round(asNumber * 60);
  }
  throw new Error(`AUTO_BOOK_IGNORE_CALENDAR_AFTER must be HH:MM (e.g. 15:30), got "${value}"`);
}

function parseTruthyFlag(value?: string): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function parseOptionalPositiveInt(value?: string): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got "${value}"`);
  }

  return parsed;
}

/**
 * CLI-specific config loader (uses dotenv).
 * Call once from the CLI entry point.
 */
export function loadCliConfig(): ConfigType {
  if (typeof process === "undefined") {
    throw new Error("loadCliConfig() is only available in Node.js");
  }

  return createConfig(process.env);
}
