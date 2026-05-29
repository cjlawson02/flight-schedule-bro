import z from "zod";
import { getSubscriptionKey, getAuthToken } from "./auth.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("api-wrapper");

// Cache interface for dependency injection
export interface CacheAdapter {
  getCachedResult(key: object, ttlMs: number): Promise<unknown>;
  setCachedResult(key: object, data: unknown): Promise<void>;
  invalidateCache(pattern?: string): Promise<void>;
}

// Global cache adapter (injected by CLI or Worker)
let cacheAdapter: CacheAdapter | null = null;

/**
 * Set the cache adapter for the API wrapper
 * Call this from your entry point (CLI or Worker)
 */
export function setCacheAdapter(adapter: CacheAdapter | null) {
  cacheAdapter = adapter;
}

/**
 * Rate Limiting and Retry Strategy
 *
 * The Flight Schedule Pro API has rate limits to prevent abuse and ensure
 * fair usage. This module implements a multi-layered strategy to handle
 * rate limiting gracefully:
 *
 * 1. **Request Queue Management**
 *    - MAX_CONCURRENT_REQUESTS = 20: Limits parallel API calls
 *    - STAGGER_DELAY_MS = 50ms: Staggers initial requests to prevent thundering herd
 *    - Request queue: Waits for slots when at capacity
 *
 * 2. **Caching (30 minutes default)**
 *    - Reduces API calls by caching responses
 *    - Prevents redundant requests for the same data
 *    - Configured per-request with TTL parameter
 *
 * 3. **Unified Retry Budget**
 *    - MAX_ATTEMPTS = 8 total fetch attempts per safeFetch call
 *    - Exponential backoff for transient/network errors: 1s → 2s → 4s (capped at 30s)
 *    - Rate-limit responses wait out the API window and release concurrency slots while waiting
 *
 * 4. **Request Chunking (availabilitySearch.ts)**
 *    - Limits availability searches to 3 instructors per request
 *    - Worker runs cap total day-by-day fetches via resolveAvailabilityDaysAhead()
 *
 * Why This Works:
 * - Most rate limits are time-based (e.g., "X requests per minute")
 * - Exponential backoff spaces out retries, often waiting out the limit window
 * - Caching dramatically reduces total API calls over time
 * - Staggering prevents sudden bursts that trigger rate limits
 * - Request queue ensures we never exceed reasonable concurrency
 *
 * Error Handling:
 * - 429 (Rate Limited): Retries with backoff
 * - 5xx (Server Error): Retries with backoff
 * - 4xx (Client Error): Fails immediately (no retry)
 * - Network errors: Retries with backoff
 */

/**
 * HTTP error from the FSP API. Client errors (4xx except 429) are not retried.
 */
export class FspHttpError extends Error {
  readonly status: number;
  readonly response: unknown;

  constructor(status: number, response: unknown) {
    super(
      `HTTP error! status: ${status}, response: ${JSON.stringify(response)}`,
    );
    this.name = "FspHttpError";
    this.status = status;
    this.response = response;
  }
}

export class FspRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FspRateLimitError";
  }
}

function isNonRetryableHttpError(error: unknown): error is FspHttpError {
  if (!(error instanceof Error) || error.name !== "FspHttpError") {
    return false;
  }

  const status = (error as FspHttpError).status;
  return status >= 400 && status < 500 && status !== 429;
}

export function resetRequestQueueForTests(): void {
  activeRequests = 0;
  requestQueue.length = 0;
  totalRequestsStarted = 0;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Global request queue to prevent thundering herd
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 20; // Limit concurrent requests
const STAGGER_DELAY_MS = 50; // Delay between initial requests
const MAX_ATTEMPTS = 8;
const requestQueue: (() => void)[] = [];
let totalRequestsStarted = 0;

/**
 * Acquire a slot in the request queue
 */
async function acquireRequestSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests++;

    // Stagger initial requests to prevent thundering herd
    if (totalRequestsStarted < MAX_CONCURRENT_REQUESTS) {
      const delayMs = totalRequestsStarted * STAGGER_DELAY_MS;
      totalRequestsStarted++;
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }

    return;
  }

  // Wait in queue
  return new Promise((resolve) => {
    requestQueue.push(resolve);
  });
}

/**
 * Release a slot in the request queue
 */
function releaseRequestSlot(): void {
  activeRequests--;
  const next = requestQueue.shift();
  if (next) {
    activeRequests++;
    next();
  }
}

/**
 * Retry schema for rate limit errors
 */
const RateLimitErrorSchema = z.object({
  statusCode: z.literal(429),
  message: z.string(),
});

function isRateLimitResponse(
  data: unknown,
): data is z.infer<typeof RateLimitErrorSchema> {
  return RateLimitErrorSchema.safeParse(data).success;
}

function getRateLimitWaitMs(message: string): number {
  const match = /(\d+)\s+seconds?/.exec(message);
  const waitSeconds = match ? Number.parseInt(match[1], 10) : 5;
  return waitSeconds * 1000;
}

async function waitForRateLimit(message: string): Promise<void> {
  await sleep(getRateLimitWaitMs(message));
}

export async function safeFetch<T extends z.ZodType>(
  url: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  params: Record<string, unknown> | null,
  parser: T,
  cacheTtlMs: number,
): Promise<z.infer<T>> {
  // Use consistent cache key (params object is sorted during serialization)
  const cacheKey = { url, method, params };
  let data = cacheAdapter
    ? await cacheAdapter.getCachedResult(cacheKey, cacheTtlMs)
    : null;
  const wasCacheHit = !!data;

  if (!wasCacheHit) {
    // Acquire a request slot to limit concurrency
    await acquireRequestSlot();

    try {
      let attemptCount = 0;
      let lastError: Error | null = null;
      let fetchSucceeded = false;

      while (attemptCount < MAX_ATTEMPTS) {
        attemptCount++;

        try {
          const res = await fetch(url, {
            method,
            headers: {
              accept: "application/json, text/plain, */*",
              authorization: `Bearer ${getAuthToken()}`,
              "content-type": "application/json",
              "x-subscription-key": getSubscriptionKey(),
            },
            body: params ? JSON.stringify(params) : undefined,
          });

          const responseText = await res.text();
          if (responseText === "") {
            data = null;
          } else {
            try {
              data = JSON.parse(responseText);
            } catch {
              if (res.ok) {
                const parseError = new Error(
                  `Failed to parse response body from ${url.split("?")[0]}`,
                );
                parseError.name = "FspParseError";
                throw parseError;
              }
              data = null;
            }
          }

          if (res.ok && (res.status === 204 || responseText === "")) {
            fetchSucceeded = true;
            data = {};
            break;
          }

          if (isRateLimitResponse(data)) {
            releaseRequestSlot();
            try {
              await waitForRateLimit(data.message);
            } finally {
              await acquireRequestSlot();
            }
            continue;
          }

          // Check for other HTTP errors
          if (!res.ok) {
            if (res.status === 429) {
              releaseRequestSlot();
              try {
                await waitForRateLimit(
                  typeof data === "object" &&
                    data !== null &&
                    "message" in data &&
                    typeof data.message === "string"
                    ? data.message
                    : "Try again in 5 seconds",
                );
              } finally {
                await acquireRequestSlot();
              }
              continue;
            }

            log.error("HTTP error from FSP API", {
              status: res.status,
              url: url.split("?")[0],
              response:
                typeof data === "object" && data !== null ? "[redacted]" : data,
            });
            throw new FspHttpError(res.status, data);
          }

          fetchSucceeded = true;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          if (
            isNonRetryableHttpError(error) ||
            (error instanceof Error && error.name === "FspRateLimitError") ||
            (error instanceof Error && error.name === "FspParseError")
          ) {
            throw error;
          }

          if (attemptCount >= MAX_ATTEMPTS) {
            throw lastError;
          }

          // Exponential backoff for other errors
          const backoffMs = Math.min(
            Math.pow(2, attemptCount - 1) * 1000,
            30000,
          );

          await sleep(backoffMs);
        }
      }

      if (!fetchSucceeded) {
        if (isRateLimitResponse(data)) {
          throw new FspRateLimitError(`Rate limit exceeded: ${data.message}`);
        }
        throw lastError ?? new Error("Failed to fetch data after retries");
      }
    } finally {
      // Always release the request slot
      releaseRequestSlot();
    }
  }

  const result = parser.safeParse(data);

  if (!result.success) {
    if (isRateLimitResponse(data)) {
      throw new FspRateLimitError(`Rate limit exceeded: ${data.message}`);
    }

    log.error("Failed to parse FSP API response", {
      response: data,
      zodError: result.error,
    });
    throw new Error("Failed to parse");
  }

  if (!wasCacheHit && cacheAdapter && cacheTtlMs > 0) {
    await cacheAdapter.setCachedResult(cacheKey, result.data);
  }

  return result.data;
}

/**
 * Invalidate cache entries matching a pattern
 * @param pattern - Optional pattern to match for selective invalidation
 */
export async function invalidateCache(pattern?: string): Promise<void> {
  if (cacheAdapter) {
    await cacheAdapter.invalidateCache(pattern);
  }
}
