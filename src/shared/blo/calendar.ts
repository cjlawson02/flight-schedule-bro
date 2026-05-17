import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { fetchICalContent } from "../dao/calendar.js";

const execAsync = promisify(exec);

/**
 * Add a reservation to the system calendar by downloading the iCal file
 * and opening it with the Calendar application.
 *
 * @param operatorId - The operator ID
 * @param reservationId - The UUID of the reservation
 * @returns Promise<void>
 * @throws {Error} - When calendar integration fails
 */
export async function addReservationToCalendar(
  operatorId: number,
  reservationId: string,
): Promise<void> {
  let tempFilePath: string | null = null;

  try {
    // Fetch iCal content from the API
    const iCalContent = await fetchICalContent(operatorId, reservationId);

    // Ensure proper line endings (LF only, matching working files)
    const normalizedContent = iCalContent.replace(/\r\n/g, "\n");

    // Save to temporary file with ASCII encoding (matching working files)
    tempFilePath = join(tmpdir(), `flight-reservation-${reservationId}.ics`);
    await writeFile(tempFilePath, normalizedContent, "ascii");

    // Open with Calendar app on macOS
    await execAsync(`open -a Calendar "${tempFilePath}"`);

    // Longer delay to ensure Calendar has time to fully import the event
    // Calendar needs time to parse and import the event before we delete the file
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Clean up temporary file
    if (tempFilePath) {
      await unlink(tempFilePath).catch(() => {
        // Ignore cleanup errors
      });
    }
  } catch (error) {
    // Clean up temporary file on error
    if (tempFilePath) {
      await unlink(tempFilePath).catch(() => {
        // Ignore cleanup errors
      });
    }

    const err = new Error(
      `Failed to add reservation to calendar: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
    (err as Error & { code: string }).code = "CALENDAR_ADD_FAILED";
    throw err;
  }
}
