import { setCacheAdapter } from "../shared/dao/api_wrapper.js";
import { configureLogger } from "../shared/util/logger.js";

/**
 * Initialize Worker environment
 *
 * This centralized initialization ensures:
 * - File-based caching is disabled (Workers don't have filesystem access)
 * - JSON structured logging for observability (wrangler tail, log drains)
 * - Consistent setup across all Worker entry points
 *
 * Call this at the start of every Worker handler (scheduled, fetch, etc.)
 */
export function initializeWorker(): void {
  configureLogger({ runtime: "worker" });
  setCacheAdapter(null);
}
