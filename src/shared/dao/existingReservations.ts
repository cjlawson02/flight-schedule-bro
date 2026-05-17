import { z } from "zod";
import { safeFetch } from "./api_wrapper.js";

// Minimal schema - only extract what we need for conflict detection
const ExistingReservationSchema = z.object({
  reservationId: z.uuid(),
  start: z.string(), // Local time like "2025-11-04T17:00:00"
  end: z.string(), // Local time like "2025-11-04T19:00:00"
  instructor: z.string().optional(),
  resource: z.string().optional(), // Aircraft tail number
});

const ExistingReservationsResponseSchema = z.object({
  total: z.number(),
  results: z.array(ExistingReservationSchema),
});

export type ExistingReservation = z.infer<typeof ExistingReservationSchema>;

/**
 * Fetch existing reservations for the user
 * @param operatorId - The operator ID
 * @param timeZoneBias - Timezone offset in minutes (e.g., -420 for PST)
 * @returns Promise<ExistingReservation[]> - Array of existing reservations
 */
export async function getExistingReservations(
  operatorId: number,
  timeZoneBias = -420,
): Promise<ExistingReservation[]> {
  const response = await safeFetch(
    `https://api-external.flightschedulepro.com/api/V2/Reservation?dateTypeFilter=1&operatorId=${operatorId}&pageIndex=0&pageSize=100&timeZoneBias=${timeZoneBias}`,
    "GET",
    null,
    ExistingReservationsResponseSchema,
    // Cache for 5 minutes (reservations don't change that often during a session)
    5 * 60 * 1000,
  );

  return response.results;
}

/**
 * Check if a time slot is on the same day as any existing reservation
 * Uses local date components (year, month, day) to avoid timezone issues
 * @param slotStart - Start time of the slot to check
 * @param existingReservations - Array of existing reservations
 * @returns boolean - True if there's a reservation on the same day
 */
export function hasReservationOnSameDay(
  slotStart: Date,
  existingReservations: ExistingReservation[],
): boolean {
  const slotYear = slotStart.getFullYear();
  const slotMonth = slotStart.getMonth();
  const slotDay = slotStart.getDate();

  return existingReservations.some((reservation) => {
    const resStart = new Date(reservation.start);
    const resYear = resStart.getFullYear();
    const resMonth = resStart.getMonth();
    const resDay = resStart.getDate();

    return slotYear === resYear && slotMonth === resMonth && slotDay === resDay;
  });
}
