import { z } from "zod";
import { resolveResourceId } from "./aircraft.js";
import type { ActivityFlightDetails } from "./reservationFlightDetails.js";
import { type ReservationType, getFieldState } from "./reservationTypes.js";
import { safeFetch, invalidateCache } from "./api_wrapper.js";

/**
 * Parameters for booking a reservation
 */
export interface ReservationBookingParams {
  aircraftId?: string;
  instructorId?: string;
  startTime: Date;
  endTime: Date;
  reservationType: ReservationType;
  locationId: number;
  flightDetails?: ActivityFlightDetails;
}

const UserReservationRequestSchema = z.object({
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
const FullReservationRequestSchema = UserReservationRequestSchema.extend({
  additionalEmailNotifications: z.array(z.string()),
  additionalUserNotifications: z.array(z.string()),
  application: z.number(),
  client: z.string(),
  comments: z.string(),
  equipmentIds: z.array(z.string()),
  estimatedFlightHours: z.string().optional(),
  flightRoute: z.string().optional(),
  flightRules: z.number().nullish(),
  flightType: z.number().nullish(),
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
});

/**
 * Zod schema for validating reservation API response
 */
const ReservationResponseSchema = z.object({
  errors: z.array(z.object({ message: z.string().optional() })),
  id: z.uuid().nullish(),
});

type UserReservationRequest = z.infer<typeof UserReservationRequestSchema>;
type FullReservationRequest = z.infer<typeof FullReservationRequestSchema>;
export type ReservationResponse = z.infer<typeof ReservationResponseSchema>;

export function buildUserReservationRequest(params: {
  reservationType: ReservationType;
  aircraftId?: string;
  instructorId?: string;
  end: string;
  start: string;
  locationId: number;
  operatorId: number;
  pilotId: string;
}): UserReservationRequest {
  const aircraft = getFieldState(params.reservationType, "aircraft");
  const instructor = getFieldState(params.reservationType, "instructor");

  return {
    aircraftId: resolveResourceId(aircraft.enabled, params.aircraftId),
    instructorId: resolveResourceId(instructor.enabled, params.instructorId),
    end: params.end,
    start: params.start,
    locationId: params.locationId,
    operatorId: params.operatorId,
    pilotId: params.pilotId,
    reservationTypeId: params.reservationType.reservationTypeId,
  };
}

export function buildFullReservationRequest(
  reservationType: ReservationType,
  reservationData: UserReservationRequest,
  flightDetails?: ActivityFlightDetails,
): FullReservationRequest {
  const flightHours = getFieldState(reservationType, "flightHours");
  const flightRoute = getFieldState(reservationType, "flightRoute");
  const flightRules = getFieldState(reservationType, "flightRules");
  const flightType = getFieldState(reservationType, "flightType");
  const details = flightDetails ?? {};

  return {
    ...reservationData,
    additionalEmailNotifications: [],
    additionalUserNotifications: [],
    application: 2,
    client: "V4",
    comments: "",
    equipmentIds: [],
    estimatedFlightHours: flightHours.enabled
      ? (details.estimatedFlightHours ?? "")
      : undefined,
    flightRoute: flightRoute.enabled ? (details.flightRoute ?? "") : undefined,
    flightRules: flightRules.enabled ? (details.flightRules ?? null) : undefined,
    flightType: flightType.enabled ? (details.flightType ?? null) : undefined,
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
}

/**
 * Creates a new reservation
 * @param reservationData - The reservation request payload
 * @param reservationTypeId - The reservation type ID for the booking
 * @returns Promise<ReservationResponse> - The reservation response
 * @throws {Error} - When reservation creation fails
 */
export async function createReservation(
  reservationType: ReservationType,
  reservationData: UserReservationRequest,
  flightDetails?: ActivityFlightDetails,
): Promise<ReservationResponse> {
  try {
    const requestData = FullReservationRequestSchema.parse(
      buildFullReservationRequest(
        reservationType,
        reservationData,
        flightDetails,
      ),
    );

    const response = await safeFetch(
      "https://api-external.flightschedulepro.com/api/V2/Reservation",
      "POST",
      requestData,
      ReservationResponseSchema,
      // No caching for mutations (TTL = 0)
      0,
    );

    // Check if there are errors in the response
    if (response.errors.length > 0) {
      const errorMessages = response.errors
        .map((error) => error.message ?? "Unknown error")
        .join(", ");
      const err = new Error(`Reservation creation failed: ${errorMessages}`);
      (err as Error & { code: string }).code = "CREATION_FAILED";
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
      }`,
    );
    (err as Error & { code: string }).code = "API_ERROR";
    throw err;
  }
}
