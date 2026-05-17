// File system cache utility for query results

import { promises as fs } from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { CacheAdapter } from "../shared/dao/api_wrapper.js";

const CACHE_DIR =
  process.env.NODE_ENV === "test"
    ? path.resolve(process.cwd(), "test-cache")
    : path.resolve(process.cwd(), "cache");

function serializeQueryParams(params: object): string {
  // Stable serialization: sort keys recursively
  function sortObject(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map(sortObject);
    } else if (obj && typeof obj === "object") {
      return Object.keys(obj)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = sortObject((obj as Record<string, unknown>)[key]);
          return acc;
        }, {});
    }
    return obj;
  }
  return JSON.stringify(sortObject(params));
}

export function hashQueryParams(params: object): string {
  const serialized = serializeQueryParams(params);
  return createHash("sha256").update(serialized).digest("hex");
}

async function ensureCacheDir(): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch {
    // Cache directory already exists
  }
}

export async function getCachedResult(
  queryParams: object,
  ttl: number,
): Promise<unknown> {
  await ensureCacheDir();
  const hash = hashQueryParams(queryParams);
  const filePath = path.join(CACHE_DIR, `${hash}.json`);
  try {
    const data = await fs.readFile(filePath, "utf8");
    const { timestamp, result } = JSON.parse(data) as {
      timestamp: unknown;
      result: unknown;
    };
    const now = Date.now();
    if (typeof timestamp === "string") {
      const ts = Date.parse(timestamp);
      if (!isNaN(ts) && now - ts <= ttl) {
        return result;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function setCachedResult(
  queryParams: object,
  result: unknown,
): Promise<void> {
  await ensureCacheDir();
  const hash = hashQueryParams(queryParams);
  const filePath = path.join(CACHE_DIR, `${hash}.json`);
  const cacheEntry = {
    timestamp: new Date().toISOString(),
    queryParams,
    result,
  };
  await fs.writeFile(filePath, JSON.stringify(cacheEntry), "utf8");
}

/**
 * Invalidate cached entries
 * @param pattern - Optional pattern to match URLs for selective invalidation
 */
export async function invalidateCache(pattern?: string): Promise<void> {
  await ensureCacheDir();
  try {
    const files = await fs.readdir(CACHE_DIR);

    if (!pattern) {
      // Clear all cache files
      await Promise.all(
        files.map((file) =>
          fs.unlink(path.join(CACHE_DIR, file)).catch(() => undefined),
        ),
      );
      return;
    }

    // Selective invalidation based on URL pattern
    for (const file of files) {
      try {
        const filePath = path.join(CACHE_DIR, file);
        const data = await fs.readFile(filePath, "utf8");
        const { queryParams } = JSON.parse(data) as { queryParams: unknown };

        // Check if this cache entry matches the pattern
        if (
          typeof queryParams === "object" &&
          JSON.stringify(queryParams).includes(pattern)
        ) {
          await fs.unlink(filePath).catch(() => undefined);
        }
      } catch {
        // Ignore errors reading individual cache files
      }
    }
  } catch {
    // Ignore errors if cache directory doesn't exist or can't be read
  }
}

/**
 * Cache adapter implementation for CLI using file system
 */
export const cliCacheAdapter: CacheAdapter = {
  getCachedResult,
  setCachedResult,
  invalidateCache,
};
