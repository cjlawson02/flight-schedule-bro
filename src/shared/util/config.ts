import { z } from "zod";

// Define schema for environment variables
const envSchema = z.object({
  // Authentication (required)
  FSP_EMAIL: z.email("Invalid email format for FSP_EMAIL"),
  FSP_PASSWORD: z.string().min(1, "FSP_PASSWORD cannot be empty"),

  // Scheduling preferences (with defaults)
  DAYS_AHEAD: z.coerce.number().int().positive().default(60),
  AIRCRAFT_REGEX: z.string().default("172S|172N"),

  // Weekday hours (with defaults)
  WEEKDAY_MIN_HOUR: z.coerce.number().int().min(0).max(23).default(15),
  MAX_HOUR: z.coerce.number().int().min(0).max(23).default(19),
});

export interface ConfigType {
  WEEKDAY_MIN_HOUR: number;
  MAX_HOUR: number;
  EMAIL: string;
  PASSWORD: string;
  AIRCRAFT_REGEX: RegExp;
  DAYS_AHEAD: number;
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
  };
}

/**
 * CLI-specific config loader (uses dotenv)
 * Only import this in CLI code
 */
export let CONFIG: ConfigType;

// Check if we're in a Node.js environment (not Workers)
if (typeof process !== "undefined") {
  // Dynamically import dotenv only in Node.js environment
  try {
    const dotenv = await import("dotenv");
    dotenv.config();
    CONFIG = createConfig(process.env);
  } catch {
    // If we're here, we might be in a bundled Worker context
    // The CONFIG will be created via createConfig in the Worker
    console.warn("Failed to load dotenv, assuming Worker environment");
  }
}
