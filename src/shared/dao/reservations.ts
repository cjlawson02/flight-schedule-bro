import { z } from "zod";
import { safeFetch, invalidateCache } from "./api_wrapper.js";

/**
 * Parameters for booking a reservation
 */
export interface ReservationBookingParams {
  aircraftId: string;
  instructorId: string;
  startTime: Date;
  endTime: Date;
  reservationTypeId: string;
  locationId: number;
}

export const UserReservationRequestSchema = z.object({
  aircraftId: z.uuid(),
  end: z.string(),
  instructorId: z.uuid(),
  locationId: z.number(),
  operatorId: z.number(),
  pilotId: z.uuid(),
  start: z.string(),
  reservationTypeId: z.uuid(),
});

/**
 * Zod schema for validating reservation request payload
 */
export const FullReservationRequestSchema = UserReservationRequestSchema.extend(
  {
    additionalEmailNotifications: z.array(z.string()),
    additionalUserNotifications: z.array(z.string()),
    application: z.number(),
    client: z.string(),
    comments: z.string(),
    equipmentIds: z.array(z.string()),
    estimatedFlightHours: z.string(),
    internalComments: z.string(),
    overrideExceptions: z.boolean(),
    recurring: z.boolean(),
    recurringForceReservations: z.null(),
    recurringOverrideExceptions: z.null(),
    recurringRepeatEveryMonthsDayOfMonth: z.null(),
    recurringRepeatEveryMonthsDayOfWeek: z.null(),
    schedulingGroupId: z.null(),
    schedulingGroupSlotId: z.null(),
    sendEmailNotification: z.boolean(),
    trainingSessions: z.array(z.unknown()),
    validateOnly: z.boolean(),
  }
);

/**
 * Zod schema for validating reservation API response
 */
export const ReservationResponseSchema = z.object({
  errors: z.array(z.record(z.string(), z.any())),
  id: z.uuid().nullish(),
});
/**
 * TypeScript types exported for use in other modules
 */
export type UserReservationRequest = z.infer<
  typeof UserReservationRequestSchema
>;
export type FullReservationRequest = z.infer<
  typeof FullReservationRequestSchema
>;
export type ReservationResponse = z.infer<typeof ReservationResponseSchema>;

/**
 * Creates a new reservation
 * @param reservationData - The reservation request payload
 * @param reservationTypeId - The reservation type ID for the booking
 * @returns Promise<ReservationResponse> - The reservation response
 * @throws {Error} - When reservation creation fails
 */
export async function createReservation(
  reservationData: UserReservationRequest
): Promise<ReservationResponse> {
  try {
    const requestData: FullReservationRequest = {
      ...reservationData,
      additionalEmailNotifications: [],
      additionalUserNotifications: [],
      application: 2,
      client: "V4",
      comments: "",
      equipmentIds: [],
      estimatedFlightHours: "",
      internalComments: "",
      overrideExceptions: false,
      recurring: false,
      recurringForceReservations: null,
      recurringOverrideExceptions: null,
      recurringRepeatEveryMonthsDayOfMonth: null,
      recurringRepeatEveryMonthsDayOfWeek: null,
      schedulingGroupId: null,
      schedulingGroupSlotId: null,
      sendEmailNotification: true,
      trainingSessions: [],
      validateOnly: false,
    };

    const response = await safeFetch(
      "https://api-external.flightschedulepro.com/api/V2/Reservation",
      "POST",
      requestData,
      ReservationResponseSchema,
      // No caching for mutations (TTL = 0)
      0
    );

    // Check if there are errors in the response
    if (response.errors && response.errors.length > 0) {
      const errorMessages = response.errors
        .map((error) => error.message || "Unknown error")
        .join(", ");
      const err = new Error(`Reservation creation failed: ${errorMessages}`);
      (err as any).code = "CREATION_FAILED";
      throw err;
    }

    // Successfully created reservation - invalidate existing reservations cache
    // This ensures that subsequent calls to getExistingReservations() will fetch fresh data
    // that includes the newly created reservation
    await invalidateCache("api/V2/Reservation?dateTypeFilter=1");

    return response;
  } catch (error) {
    // If error already has a code property, re-throw it
    if (error instanceof Error && "code" in error) {
      throw error;
    }

    // Wrap other errors with code
    const err = new Error(
      `Failed to create reservation: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
    (err as any).code = "API_ERROR";
    throw err;
  }
}
