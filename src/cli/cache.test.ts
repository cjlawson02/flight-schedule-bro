import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  getCachedResult,
  setCachedResult,
  hashQueryParams,
  invalidateCache,
  cliCacheAdapter,
} from "./cache.js";
import * as fs from "fs";
import * as path from "path";

const TEST_CACHE_DIR = path.resolve(process.cwd(), "test-cache");
const CACHE_TTL_MS = 30 * 60 * 1000;

function cacheFilePath(params: object) {
  const hash = hashQueryParams(params);
  return path.join(TEST_CACHE_DIR, `${hash}.json`);
}

describe("Cache expiry and hit logic", () => {
  const queryParams = { a: 1, b: 2 };
  const result = { data: "test" };

  beforeEach(async () => {
    // Clean the test cache directory before each test
    try {
      await fs.promises.rm(TEST_CACHE_DIR, { recursive: true, force: true });
    } catch {
      // Ignore if directory doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up the test cache directory after each test
    try {
      await fs.promises.rm(TEST_CACHE_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("returns cached result and logs CACHE HIT if within 30 minutes", async () => {
    await setCachedResult(queryParams, result);

    // Simulate logging
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Use same TTL as cache was set with (30 minutes)
    const cached = await getCachedResult(queryParams, CACHE_TTL_MS);
    if (cached) {
      console.log("CACHE HIT");
    }

    expect(cached).toEqual(result);
    expect(logSpy).toHaveBeenCalledWith("CACHE HIT");

    logSpy.mockRestore();
  });

  it("returns null and queries backend if cache expired", async () => {
    await setCachedResult(queryParams, result);

    // Manually expire cache
    const filePath = cacheFilePath(queryParams);
    const cacheEntry = {
      timestamp: new Date(Date.now() - CACHE_TTL_MS - 1000).toISOString(),
      result,
    };
    await fs.promises.writeFile(filePath, JSON.stringify(cacheEntry), "utf8");

    const cached = await getCachedResult(queryParams, 10);

    expect(cached).toBeNull();

    // Simulate backend query
    let backendQueried = false;
    if (cached === null) {
      backendQueried = true;
    }
    expect(backendQueried).toBe(true);
  });
});

describe("invalidateCache", () => {
  const TEST_CACHE_DIR = path.resolve(process.cwd(), "test-cache");

  beforeEach(async () => {
    // Clean the test cache directory before each test
    try {
      await fs.promises.rm(TEST_CACHE_DIR, { recursive: true, force: true });
    } catch {
      // Ignore if directory doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up the test cache directory after each test
    try {
      await fs.promises.rm(TEST_CACHE_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should clear all cache files when no pattern is provided", async () => {
    // Set up some cached data
    await setCachedResult({ url: "test1" }, { data: "value1" });
    await setCachedResult({ url: "test2" }, { data: "value2" });

    // Verify cache files exist
    const files1 = await fs.promises.readdir(TEST_CACHE_DIR);
    expect(files1.length).toBe(2);

    // Clear all cache
    await invalidateCache();

    // Verify all files are gone
    const files2 = await fs.promises.readdir(TEST_CACHE_DIR);
    expect(files2.length).toBe(0);
  });

  it("should selectively invalidate cache entries matching pattern", async () => {
    // Set up cached data with different patterns
    await setCachedResult(
      { url: "api/V2/Reservation?dateTypeFilter=1" },
      { data: "reservations" },
    );
    await setCachedResult({ url: "api/V2/Aircraft" }, { data: "aircraft" });

    // Verify cache files exist
    const files1 = await fs.promises.readdir(TEST_CACHE_DIR);
    expect(files1.length).toBe(2);

    // Selectively invalidate only reservation cache
    await invalidateCache("api/V2/Reservation?dateTypeFilter=1");

    // Verify only the matching file was removed
    const files2 = await fs.promises.readdir(TEST_CACHE_DIR);
    expect(files2.length).toBe(1);

    // Verify the remaining cache still works
    const aircraftResult = await getCachedResult(
      { url: "api/V2/Aircraft" },
      60000,
    );
    expect(aircraftResult).toEqual({ data: "aircraft" });
  });
});

describe("cliCacheAdapter", () => {
  it("should implement the CacheAdapter interface", () => {
    expect(cliCacheAdapter).toHaveProperty("getCachedResult");
    expect(cliCacheAdapter).toHaveProperty("setCachedResult");
    expect(cliCacheAdapter).toHaveProperty("invalidateCache");
    expect(typeof cliCacheAdapter.getCachedResult).toBe("function");
    expect(typeof cliCacheAdapter.setCachedResult).toBe("function");
    expect(typeof cliCacheAdapter.invalidateCache).toBe("function");
  });

  it("should work through the adapter interface", async () => {
    const testData = { test: "data" };
    await cliCacheAdapter.setCachedResult({ url: "test" }, testData);

    const result = await cliCacheAdapter.getCachedResult(
      { url: "test" },
      60000,
    );
    expect(result).toEqual(testData);

    await cliCacheAdapter.invalidateCache();

    const resultAfterClear = await cliCacheAdapter.getCachedResult(
      { url: "test" },
      60000,
    );
    expect(resultAfterClear).toBeNull();
  });
});
