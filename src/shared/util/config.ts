import { z } from "zod";
import { DEFAULT_TIMEZONE } from "./flightTime.js";

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
  AIRCRAFT_REGEX: z.string().default("172S|172N"),
  TIMEZONE: z
    .string()
    .min(1)
    .refine((value) => isValidIanaTimeZone(value), {
      message:
        "TIMEZONE must be a valid IANA timezone (e.g. America/Los_Angeles)",
    })
    .default(DEFAULT_TIMEZONE),

  // Weekday hours (with defaults)
  WEEKDAY_MIN_HOUR: z.coerce.number().int().min(0).max(23).default(15),
  MAX_HOUR: z.coerce.number().int().min(0).max(23).default(19),

  // Optional reservation type override for automated monitoring
  RESERVATION_TYPE_ID: z
    .uuid("RESERVATION_TYPE_ID must be a valid UUID")
    .optional(),
});

export interface ConfigType {
  WEEKDAY_MIN_HOUR: number;
  MAX_HOUR: number;
  EMAIL: string;
  PASSWORD: string;
  AIRCRAFT_REGEX: RegExp;
  DAYS_AHEAD: number;
  TIMEZONE: string;
  RESERVATION_TYPE_ID?: string;
}

/** Worker env bindings used to build runtime config. */
export interface WorkerEnvInput {
  FSP_EMAIL: string;
  FSP_PASSWORD: string;
  DAYS_AHEAD: string;
  AIRCRAFT_REGEX: string;
  WEEKDAY_MIN_HOUR?: string;
  MAX_HOUR?: string;
  TIMEZONE?: string;
  RESERVATION_TYPE_ID?: string;
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
        `Environment variable validation failed:\n${missingOrInvalid.join(
          "\n",
        )}\n\n` + `Please ensure all required environment variables are set.`,
        { cause: error },
      );
    }
    throw error;
  }

  return {
    // Weekday hours
    WEEKDAY_MIN_HOUR: env.WEEKDAY_MIN_HOUR,
    MAX_HOUR: env.MAX_HOUR,

    // Authentication
    EMAIL: env.FSP_EMAIL,
    PASSWORD: env.FSP_PASSWORD,

    // Scheduling preferences
    AIRCRAFT_REGEX: new RegExp(env.AIRCRAFT_REGEX, "i"),
    DAYS_AHEAD: env.DAYS_AHEAD,
    TIMEZONE: env.TIMEZONE,
    RESERVATION_TYPE_ID: env.RESERVATION_TYPE_ID,
  };
}

export function createWorkerConfig(env: WorkerEnvInput): ConfigType {
  return createConfig({
    FSP_EMAIL: env.FSP_EMAIL,
    FSP_PASSWORD: env.FSP_PASSWORD,
    DAYS_AHEAD: env.DAYS_AHEAD,
    AIRCRAFT_REGEX: env.AIRCRAFT_REGEX,
    WEEKDAY_MIN_HOUR: env.WEEKDAY_MIN_HOUR ?? "15",
    MAX_HOUR: env.MAX_HOUR ?? "19",
    TIMEZONE: env.TIMEZONE,
    RESERVATION_TYPE_ID: env.RESERVATION_TYPE_ID,
  });
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
