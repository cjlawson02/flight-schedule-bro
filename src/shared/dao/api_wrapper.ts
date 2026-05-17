import z from "zod";
import { getSubscriptionKey, getAuthToken } from "./auth.js";

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
 * Check if caching is available
 */
export function isCacheAvailable(): boolean {
  return cacheAdapter !== null;
}

/**
 * Rate Limiting and Retry Strategy
 *
 * The Flight Schedule Pro API has rate limits to prevent abuse and ensure
 * fair usage. This module implements a multi-layered strategy to handle
 * rate limiting gracefully:
 *
 * 1. **Request Queue Management**
 *    - MAX_CONCURRENT_REQUESTS = 50: Limits parallel API calls
 *    - STAGGER_DELAY_MS = 50ms: Staggers initial requests to prevent thundering herd
 *    - Request queue: Waits for slots when at capacity
 *
 * 2. **Caching (30 minutes default)**
 *    - Reduces API calls by caching responses
 *    - Prevents redundant requests for the same data
 *    - Configured per-request with TTL parameter
 *
 * 3. **Exponential Backoff Retry**
 *    - MAX_RETRIES = 3 attempts per request (4 total attempts: initial + 3 retries)
 *    - Base delay = 1000ms (1 second)
 *    - Exponential growth: 1s → 2s → 4s between retries
 *    - Helps handle transient errors and rate limit windows
 *
 * 4. **Request Chunking (in index.ts)**
 *    - Limits concurrent availability searches to 3 instructors at a time
 *    - Prevents overwhelming the API with parallel requests
 *    - See chunk() function documentation in index.ts for details
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
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Global request queue to prevent thundering herd
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 50; // Limit concurrent requests
const STAGGER_DELAY_MS = 50; // Delay between initial requests
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

export async function safeFetch<T extends z.ZodType>(
  url: string,
  method: "GET" | "POST",
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
      // Implement exponential backoff for rate limiting
      const maxRetries = 3;
      let retryCount = 0;
      let lastError: Error | null = null;

      while (retryCount <= maxRetries) {
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

          data = await res.json();

          // Check if it's a rate limit error
          const rateLimitCheck = RateLimitErrorSchema.safeParse(data);
          if (rateLimitCheck.success) {
            // Extract wait time from message (e.g., "Try again in 34 seconds")
            const match = /(\d+)\s+seconds/.exec(rateLimitCheck.data.message);
            const waitSeconds = match ? parseInt(match[1], 10) : 5;

            // Use the API's suggested wait time
            const backoffMs = waitSeconds * 1000;

            await sleep(backoffMs);
            retryCount++;
            continue;
          }

          // Check for other HTTP errors
          if (!res.ok) {
            console.error(`HTTP ${res.status} error for ${url}`);
            console.error("Request params:", JSON.stringify(params, null, 2));
            console.error("Response data:", JSON.stringify(data, null, 2));
            throw new Error(
              `HTTP error! status: ${res.status}, response: ${JSON.stringify(
                data,
              )}`,
            );
          }

          // Success - break out of retry loop
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          if (retryCount >= maxRetries) {
            throw lastError;
          }

          // Exponential backoff for other errors
          const backoffMs = Math.min(Math.pow(2, retryCount) * 1000, 30000);

          await sleep(backoffMs);
          retryCount++;
        }
      }

      if (!data) {
        throw lastError ?? new Error("Failed to fetch data after retries");
      }
    } finally {
      // Always release the request slot
      releaseRequestSlot();
    }
  }

  const result = parser.safeParse(data);

  if (!result.success) {
    console.error("Response data:", data);
    console.error("Failed to parse:", result.error);
    throw new Error("Failed to parse");
  }

  if (!wasCacheHit && cacheAdapter) {
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
