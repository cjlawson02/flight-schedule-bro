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
