import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { fetchICalContent } from "../dao/fetchIcal.js";
import { getErrorMessage } from "../util/errors.js";

const execAsync = promisify(exec);

/**
 * Add a reservation to the system calendar by downloading the iCal file
 * and opening it with the Calendar application (macOS).
 */
export async function addReservationToCalendar(
  operatorId: number,
  reservationId: string,
): Promise<void> {
  let tempFilePath: string | null = null;

  try {
    const iCalContent = await fetchICalContent(operatorId, reservationId);
    const normalizedContent = iCalContent.replace(/\r\n/g, "\n");
    tempFilePath = join(tmpdir(), `flight-reservation-${reservationId}.ics`);
    await writeFile(tempFilePath, normalizedContent, "ascii");
    await execAsync(`open -a Calendar "${tempFilePath}"`);
    await new Promise((resolve) => setTimeout(resolve, 5000));

    if (tempFilePath) {
      await unlink(tempFilePath).catch(() => undefined);
    }
  } catch (error) {
    if (tempFilePath) {
      await unlink(tempFilePath).catch(() => undefined);
    }

    const err = new Error(
      `Failed to add reservation to calendar: ${getErrorMessage(error)}`,
    );
    (err as Error & { code: string }).code = "CALENDAR_ADD_FAILED";
    throw err;
  }
}
