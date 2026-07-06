import { describe, expect, it, vi, beforeEach } from "vitest";
import { releaseWorkerRunLock, tryAcquireWorkerRunLock } from "./runLock.js";

function createMockKv(holder: string | null): KVNamespace {
  return {
    get: vi.fn(async () => holder),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  } as unknown as KVNamespace;
}

describe("worker run lock", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("acquires the lock when none is held", async () => {
    kv = createMockKv(null);

    await expect(tryAcquireWorkerRunLock(kv, "run-a")).resolves.toBe(true);
    expect(kv.put).toHaveBeenCalledWith(
      "worker_run_lock",
      "run-a",
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
  });

  it("skips when another run holds the lock", async () => {
    kv = createMockKv("run-b");

    await expect(tryAcquireWorkerRunLock(kv, "run-a")).resolves.toBe(false);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("releases the lock only for the holder", async () => {
    kv = createMockKv("run-a");

    await releaseWorkerRunLock(kv, "run-a");

    expect(kv.delete).toHaveBeenCalledWith("worker_run_lock");
  });
});
