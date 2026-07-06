import { recordActiveKvSubrequest } from "../shared/util/subrequestBudget.js";
import { createLogger } from "../shared/util/logger.js";

const log = createLogger("run-lock");

const LOCK_KEY = "worker_run_lock";
/** Longer than a cron period so stale locks expire if a run crashes. */
const LOCK_TTL_SECONDS = 45 * 60;

export async function tryAcquireWorkerRunLock(
  kv: KVNamespace,
  runId: string,
): Promise<boolean> {
  recordActiveKvSubrequest();
  const holder = await kv.get(LOCK_KEY);
  if (holder !== null) {
    log.warn("Worker run skipped: lock already held", { holder, runId });
    return false;
  }

  recordActiveKvSubrequest();
  await kv.put(LOCK_KEY, runId, { expirationTtl: LOCK_TTL_SECONDS });
  return true;
}

export async function releaseWorkerRunLock(
  kv: KVNamespace,
  runId: string,
): Promise<void> {
  recordActiveKvSubrequest();
  const holder = await kv.get(LOCK_KEY);
  if (holder === runId) {
    recordActiveKvSubrequest();
    await kv.delete(LOCK_KEY);
  }
}
