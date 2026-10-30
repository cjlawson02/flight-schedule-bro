import { describe, expect, it, vi, beforeEach } from "vitest";
import { releaseWorkerRunLock, tryAcquireWorkerRunLock } from "./runLock.js";

function createMockKv(holder: string | null): {
  kv: KVNamespace;
  mocks: {
    get: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
    put: ReturnType<typeof vi.fn<() => Promise<void>>>;
    delete: ReturnType<typeof vi.fn<() => Promise<void>>>;
  };
} {
  const mocks = {
    get: vi.fn<() => Promise<string | null>>(async () => holder),
    put: vi.fn<() => Promise<void>>(async () => undefined),
    delete: vi.fn<() => Promise<void>>(async () => undefined),
  };
  return { kv: mocks as unknown as KVNamespace, mocks };
}

describe("worker run lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("acquires the lock when none is held", async () => {
    const { kv, mocks } = createMockKv(null);

    await expect(tryAcquireWorkerRunLock(kv, "run-a")).resolves.toBe(true);
    expect(mocks.put).toHaveBeenCalledWith(
      "worker_run_lock",
      "run-a",
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
  });

  it("skips when another run holds the lock", async () => {
    const { kv, mocks } = createMockKv("run-b");

    await expect(tryAcquireWorkerRunLock(kv, "run-a")).resolves.toBe(false);
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("releases the lock only for the holder", async () => {
    const { kv, mocks } = createMockKv("run-a");

    await releaseWorkerRunLock(kv, "run-a");

    expect(mocks.delete).toHaveBeenCalledWith("worker_run_lock");
  });
});
