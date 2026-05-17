/**
 * Progress Bar Utility
 *
 * Wrapper around cli-progress for consistent progress bar styling across the application.
 * Provides a centralized way to create and manage progress indicators for long-running operations.
 */

import * as cliProgress from "cli-progress";

/**
 * Create a progress bar for tracking long-running operations
 *
 * This utility provides a consistent progress bar style across the application.
 * The progress bar displays:
 * - A visual bar showing completion percentage
 * - Current value and total count
 * - Customizable message prefix
 *
 * Features:
 * - Unicode block characters for smooth visual feedback
 * - Auto-hides cursor during operation
 * - Clean terminal output
 *
 * @param message - The message to display before the progress bar (e.g., "🔄 Fetching schedules")
 * @returns A configured SingleBar instance ready to use
 *
 * @example
 * const progressBar = createProgressBar("🔄 Processing files");
 * progressBar.start(100, 0);
 *
 * for (let i = 0; i < 100; i++) {
 *   // Do work
 *   progressBar.increment();
 * }
 *
 * progressBar.stop();
 *
 * @example
 * // With total tracking
 * const items = [1, 2, 3, 4, 5];
 * const bar = createProgressBar("📦 Loading items");
 * bar.start(items.length, 0);
 *
 * for (const item of items) {
 *   await processItem(item);
 *   bar.increment();
 * }
 *
 * bar.stop();
 */
export function createProgressBar(message: string): cliProgress.SingleBar {
  return new cliProgress.SingleBar({
    format: `${message} |{bar}| {percentage}% | {value}/{total} requests`,
    barCompleteChar: "\u2588", // Full block: █
    barIncompleteChar: "\u2591", // Light shade: ░
    hideCursor: true,
  });
}

/**
 * Track progress of async operations with automatic start/stop
 *
 * This helper automatically manages progress bar lifecycle:
 * 1. Creates and starts the progress bar
 * 2. Wraps promises to track completion
 * 3. Stops the bar when all operations complete
 *
 * Perfect for tracking parallel operations like API calls.
 *
 * @param message - Message to display with the progress bar
 * @param promises - Array of promises to track
 * @returns Promise that resolves when all operations complete
 *
 * @example
 * const promises = instructors.map(id => fetchData(id));
 * const results = await trackProgress("🔄 Fetching data", promises);
 */
export async function trackProgress<T>(
  message: string,
  promises: Promise<T>[],
): Promise<T[]> {
  const progressBar = createProgressBar(message);
  progressBar.start(promises.length, 0);

  const trackedPromises = promises.map(async (promise) => {
    const result = await promise;
    progressBar.increment();
    return result;
  });

  try {
    const results = await Promise.all(trackedPromises);
    return results;
  } finally {
    progressBar.stop();
  }
}
