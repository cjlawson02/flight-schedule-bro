import { z } from "zod";
import {
  createOperatorDateKey,
  DEFAULT_TIMEZONE,
  getFspTimeZoneBias,
  parseFspDateTime,
} from "../util/flightTime.js";
import { safeFetch } from "./api_wrapper.js";

// Minimal schema - only extract what we need for conflict detection
const ExistingReservationSchema = z.object({
  reservationId: z.uuid(),
  start: z.string(),
  end: z.string(),
  startUtc: z.string().optional(),
  endUtc: z.string().optional(),
  instructor: z.string().optional(),
  resource: z.string().optional(), // Aircraft tail number
});

const ExistingReservationsResponseSchema = z.object({
  total: z.number(),
  results: z.array(ExistingReservationSchema),
});

export type ExistingReservation = z.infer<typeof ExistingReservationSchema>;

/** UTC instant for an existing reservation. */
export function getReservationStart(
  reservation: ExistingReservation,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  return parseFspDateTime(
    { local: reservation.start, utc: reservation.startUtc },
    timeZone,
  );
}

export function getReservationEnd(
  reservation: ExistingReservation,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  return parseFspDateTime(
    { local: reservation.end, utc: reservation.endUtc },
    timeZone,
  );
}

export function getUpcomingReservations(
  reservations: ExistingReservation[],
  timeZone: string = DEFAULT_TIMEZONE,
  now: Date = new Date(),
): ExistingReservation[] {
  return reservations
    .filter((reservation) => getReservationEnd(reservation, timeZone) >= now)
    .sort(
      (left, right) =>
        getReservationStart(left, timeZone).getTime() -
        getReservationStart(right, timeZone).getTime(),
    );
}

/**
 * Fetch existing reservations for the user
 * @param operatorId - The operator ID
 * @param timeZone - The timezone of the operator
 * @returns Promise<ExistingReservation[]> - Array of existing reservations
 */
export async function getExistingReservations(
  operatorId: number,
  timeZone: string = DEFAULT_TIMEZONE,
): Promise<ExistingReservation[]> {
  const timeZoneBias = getFspTimeZoneBias(timeZone);

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
 * Check if a time slot is on the same operator calendar day as any existing reservation.
 * @param slotStart - Start time of the slot to check
 * @param existingReservations - Array of existing reservations
 * @param timeZone - The timezone of the operator
 * @returns boolean - True if the time slot is on the same operator calendar day as any existing reservation
 */
export function hasReservationOnSameDay(
  slotStart: Date,
  existingReservations: ExistingReservation[],
  timeZone: string = DEFAULT_TIMEZONE,
): boolean {
  const slotDateKey = createOperatorDateKey(slotStart, timeZone);

  return existingReservations.some((reservation) => {
    const resStart = getReservationStart(reservation, timeZone);
    return createOperatorDateKey(resStart, timeZone) === slotDateKey;
  });
}
