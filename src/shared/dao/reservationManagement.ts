import { z } from "zod";
import { formatInTimeZone } from "date-fns-tz";
import {
  nilToOptionalResourceId,
  resolveMutationResourceId,
} from "./aircraft.js";
import { DEFAULT_TIMEZONE, parseFspLocal } from "../util/flightTime.js";
import type { ActivityFlightDetails } from "./reservationFlightDetails.js";
import { getFieldState, type ReservationType } from "./reservationTypes.js";
import { invalidateCache, safeFetch } from "./api_wrapper.js";

const ReservationDetailSchema = z.object({
  reservationId: z.uuid(),
  reservationTypeId: z.uuid(),
  reservationType: z
    .object({
      reservationTypeName: z.string(),
    })
    .optional(),
  locationId: z.number(),
  start: z.string(),
  end: z.string(),
  comments: z.string().optional(),
  orFor: z.string().nullable().optional(),
  pilot: z.object({
    pilotId: z.uuid(),
    userId: z.uuid(),
  }),
  instructor: z
    .object({
      instructorId: z.uuid(),
    })
    .nullable()
    .optional(),
  aircraftSummary: z
    .object({
      aircraftId: z.uuid(),
      schedulingGroupId: z.uuid().nullable().optional(),
      schedulingGroupSlotId: z.uuid().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export type ReservationDetail = z.infer<typeof ReservationDetailSchema>;

const CancellationReasonSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  requiresExplanation: z.boolean(),
});

const CancellationReasonListSchema = z.array(CancellationReasonSchema);

export type CancellationReason = z.infer<typeof CancellationReasonSchema>;

const ReservationMutationResponseSchema = z.object({
  errors: z.array(z.object({ message: z.string().optional() })).default([]),
});

export interface UpdateReservationParams {
  reservationId: string;
  reservationType: ReservationType;
  operatorId: number;
  locationId: number;
  pilotId: string;
  aircraftId?: string;
  instructorId?: string;
  startTime: Date;
  endTime: Date;
  timeZone?: string;
  schedulingGroupId?: string | null;
  schedulingGroupSlotId?: string | null;
  flightDetails?: ActivityFlightDetails;
  comments?: string;
  orFor?: string | null;
  validateOnly: boolean;
}

export function buildUpdateReservationRequest(
  params: UpdateReservationParams,
): Record<string, unknown> {
  const timeZone = params.timeZone ?? DEFAULT_TIMEZONE;
  const aircraft = getFieldState(params.reservationType, "aircraft");
  const instructor = getFieldState(params.reservationType, "instructor");
  const flightHours = getFieldState(params.reservationType, "flightHours");
  const flightRoute = getFieldState(params.reservationType, "flightRoute");
  const flightRules = getFieldState(params.reservationType, "flightRules");
  const flightType = getFieldState(params.reservationType, "flightType");
  const flightDetails = params.flightDetails ?? {};

  return {
    reservationId: params.reservationId,
    reservationTypeId: params.reservationType.reservationTypeId,
    operatorId: params.operatorId,
    locationId: params.locationId,
    pilotId: params.pilotId,
    aircraftId: resolveMutationResourceId(aircraft.enabled, params.aircraftId),
    instructorId: resolveMutationResourceId(
      instructor.enabled,
      params.instructorId,
    ),
    start: formatInTimeZone(params.startTime, timeZone, "yyyy-MM-dd'T'HH:mm"),
    end: formatInTimeZone(params.endTime, timeZone, "yyyy-MM-dd'T'HH:mm"),
    schedulingGroupId: aircraft.enabled
      ? (params.schedulingGroupId ?? null)
      : null,
    schedulingGroupSlotId: aircraft.enabled
      ? (params.schedulingGroupSlotId ?? null)
      : null,
    additionalEmailNotifications: [],
    additionalUserNotifications: [],
    application: 2,
    client: "V4",
    comments: params.comments ?? "",
    equipmentIds: [],
    estimatedFlightHours: flightHours.enabled
      ? (flightDetails.estimatedFlightHours ?? "")
      : undefined,
    flightRoute: flightRoute.enabled
      ? (flightDetails.flightRoute ?? "")
      : undefined,
    flightRules: flightRules.enabled ? (flightDetails.flightRules ?? "") : "",
    flightType: flightType.enabled ? (flightDetails.flightType ?? "") : "",
    internalComments: "",
    orFor: params.orFor ?? null,
    overrideExceptions: false,
    recurring: false,
    recurringForceReservations: null,
    recurringOverrideExceptions: null,
    recurringRepeatEveryMonthsDayOfMonth: null,
    recurringRepeatEveryMonthsDayOfWeek: null,
    sendEmailNotification: true,
    standby: false,
    trainingSessions: [],
    validateOnly: params.validateOnly,
    checkStudentAvailability: true,
  };
}

export function buildCancelReservationRequest(params: {
  reservationId: string;
  operatorId: number;
  reasonId: string;
  reasonText?: string;
}): Record<string, unknown> {
  return {
    reservationId: params.reservationId,
    operatorId: params.operatorId,
    overrideErrors: false,
    SendEmailNotification: true,
    client: "V4",
    recurring: false,
    reasonId: params.reasonId,
    reasonText: params.reasonText ?? "",
  };
}

export async function getReservationById(
  operatorId: number,
  reservationId: string,
): Promise<ReservationDetail> {
  return safeFetch(
    `https://api-external.flightschedulepro.com/api/V2/Reservation/${reservationId}?operatorId=${operatorId}`,
    "GET",
    null,
    ReservationDetailSchema,
    0,
  );
}

export async function getCancellationReasons(
  operatorId: number,
): Promise<CancellationReason[]> {
  return safeFetch(
    `https://api-external.flightschedulepro.com/api/V2/operator/${operatorId}/operators/cancellationreasons`,
    "GET",
    null,
    CancellationReasonListSchema,
    5 * 60 * 1000,
  );
}

function assertNoMutationErrors(
  response: z.infer<typeof ReservationMutationResponseSchema>,
  action: "update" | "cancel",
): void {
  if (response.errors.length === 0) {
    return;
  }

  const errorMessages = response.errors
    .map((error) => error.message ?? "Unknown error")
    .join(", ");
  throw new Error(`Reservation ${action} failed: ${errorMessages}`);
}

export async function updateReservation(
  params: UpdateReservationParams,
): Promise<void> {
  const requestData = buildUpdateReservationRequest(params);

  const response = await safeFetch(
    "https://api-external.flightschedulepro.com/api/V2/Reservation",
    "PUT",
    requestData,
    ReservationMutationResponseSchema,
    0,
  );

  assertNoMutationErrors(response, "update");

  if (!params.validateOnly) {
    await invalidateReservationCaches();
  }
}

export async function cancelReservation(params: {
  reservationId: string;
  operatorId: number;
  reasonId: string;
  reasonText?: string;
}): Promise<void> {
  const response = await safeFetch(
    "https://api-external.flightschedulepro.com/api/V2/Reservation",
    "DELETE",
    buildCancelReservationRequest(params),
    ReservationMutationResponseSchema,
    0,
  );

  assertNoMutationErrors(response, "cancel");
  await invalidateReservationCaches();
}

async function invalidateReservationCaches(): Promise<void> {
  await Promise.allSettled([
    invalidateCache("api/V2/Reservation?dateTypeFilter=1"),
    invalidateCache("api/v2/schedule"),
  ]);
}

export function parseReservationDetailTimes(
  detail: ReservationDetail,
  timeZone: string = DEFAULT_TIMEZONE,
): { startTime: Date; endTime: Date } {
  return {
    startTime: parseFspLocal(detail.start, timeZone),
    endTime: parseFspLocal(detail.end, timeZone),
  };
}

export function resolveUpdateResourcesForType(
  detail: ReservationDetail,
  reservationType: ReservationType,
): { aircraftId?: string; instructorId?: string } {
  const current = getReservationResourceIds(detail);

  return {
    aircraftId: getFieldState(reservationType, "aircraft").enabled
      ? current.aircraftId
      : undefined,
    instructorId: getFieldState(reservationType, "instructor").enabled
      ? current.instructorId
      : undefined,
  };
}

export function validateUpdateResourcesForType(
  detail: ReservationDetail,
  reservationType: ReservationType,
): string | null {
  const resources = resolveUpdateResourcesForType(detail, reservationType);

  if (
    getFieldState(reservationType, "aircraft").required &&
    !resources.aircraftId
  ) {
    return "The new activity type requires an aircraft, but this activity has none.";
  }

  return null;
}

export function getReservationResourceIds(detail: ReservationDetail): {
  aircraftId?: string;
  instructorId?: string;
} {
  return {
    aircraftId: nilToOptionalResourceId(detail.aircraftSummary?.aircraftId),
    instructorId: nilToOptionalResourceId(detail.instructor?.instructorId),
  };
}
