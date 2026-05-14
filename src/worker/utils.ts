import { setCacheAdapter } from "../shared/dao/api_wrapper.js";

/**
 * Initialize Worker environment
 *
 * This centralized initialization ensures:
 * - File-based caching is disabled (Workers don't have filesystem access)
 * - Consistent setup across all Worker entry points
 *
 * Call this at the start of every Worker handler (scheduled, fetch, etc.)
 */
export function initializeWorker(): void {
  // Disable file-based caching in Worker (no filesystem access)
  setCacheAdapter(null);
}
