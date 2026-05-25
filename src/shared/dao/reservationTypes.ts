import { z } from "zod";
import { safeFetch, invalidateCache } from "./api_wrapper.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("reservation-types");

const enabledField = () => z.boolean().default(false);
const requirementField = () => z.number().default(0);

export const ReservationTypeSchema = z.object({
  reservationTypeId: z.uuid(),
  reservationTypeName: z.string(),
  aircraftEnabled: enabledField(),
  instructorEnabled: enabledField(),
  flightTypeEnabled: enabledField(),
  flightRulesEnabled: enabledField(),
  flightHoursEnabled: enabledField(),
  flightRouteEnabled: enabledField(),
  aircraftRequirement: requirementField(),
  instructorRequirement: requirementField(),
  flightTypeRequirement: requirementField(),
  flightRulesRequirement: requirementField(),
  flightHoursRequirement: requirementField(),
  flightRouteRequirement: requirementField(),
  defaultLength: z.number().default(120),
});

export type ReservationType = z.infer<typeof ReservationTypeSchema>;

const ReservationTypeListSchema = z.array(ReservationTypeSchema);

function isFieldRequired(requirement: number): boolean {
  return requirement >= 2;
}

function isFieldEnabled(
  explicitEnabled: boolean,
  requirement: number,
): boolean {
  return explicitEnabled || requirement > 0;
}

/** True when cached data only contains id/name without field metadata. */
export function reservationTypeMissingFieldMetadata(
  type: ReservationType,
): boolean {
  const hasEnabledFlag =
    type.aircraftEnabled ||
    type.instructorEnabled ||
    type.flightTypeEnabled ||
    type.flightRulesEnabled ||
    type.flightHoursEnabled ||
    type.flightRouteEnabled;

  const hasRequirement =
    type.aircraftRequirement > 0 ||
    type.instructorRequirement > 0 ||
    type.flightTypeRequirement > 0 ||
    type.flightRulesRequirement > 0 ||
    type.flightHoursRequirement > 0 ||
    type.flightRouteRequirement > 0;

  return !hasEnabledFlag && !hasRequirement;
}

const RESERVATION_TYPE_FIELDS = {
  aircraft: { enabled: "aircraftEnabled", requirement: "aircraftRequirement" },
  instructor: {
    enabled: "instructorEnabled",
    requirement: "instructorRequirement",
  },
  flightType: {
    enabled: "flightTypeEnabled",
    requirement: "flightTypeRequirement",
  },
  flightRules: {
    enabled: "flightRulesEnabled",
    requirement: "flightRulesRequirement",
  },
  flightHours: {
    enabled: "flightHoursEnabled",
    requirement: "flightHoursRequirement",
  },
  flightRoute: {
    enabled: "flightRouteEnabled",
    requirement: "flightRouteRequirement",
  },
} as const satisfies Record<
  string,
  { enabled: keyof ReservationType; requirement: keyof ReservationType }
>;

type ReservationTypeField = keyof typeof RESERVATION_TYPE_FIELDS;

export function getFieldState(
  type: ReservationType,
  field: ReservationTypeField,
): { enabled: boolean; required: boolean } {
  const config = RESERVATION_TYPE_FIELDS[field];
  const explicitEnabled = type[config.enabled] as boolean;
  const requirement = type[config.requirement] as number;
  const enabled = isFieldEnabled(explicitEnabled, requirement);

  return {
    enabled,
    required: isFieldRequired(requirement),
  };
}

export function reservationTypeUsesAircraft(type: ReservationType): boolean {
  return getFieldState(type, "aircraft").enabled;
}

export function reservationTypeUsesInstructor(type: ReservationType): boolean {
  return getFieldState(type, "instructor").enabled;
}

export function reservationTypeRequiresAircraft(
  type: ReservationType,
): boolean {
  return getFieldState(type, "aircraft").required;
}

export function reservationTypeRequiresInstructor(
  type: ReservationType,
): boolean {
  return getFieldState(type, "instructor").required;
}

export function supportsScheduleMatchSearch(type: ReservationType): boolean {
  return (
    reservationTypeUsesAircraft(type) || reservationTypeUsesInstructor(type)
  );
}

export function getAvailabilitySearchResources(
  type: ReservationType,
  instructors: string[],
  aircraftIds: string[],
): { instructors: string[]; aircraftIds: string[] } {
  return {
    instructors: reservationTypeUsesInstructor(type) ? instructors : [],
    aircraftIds: reservationTypeUsesAircraft(type) ? aircraftIds : [],
  };
}

export function pickReservationType(
  types: ReservationType[],
  preferredTypeId?: string,
): ReservationType | undefined {
  if (preferredTypeId) {
    const preferred = types.find(
      (type) => type.reservationTypeId === preferredTypeId,
    );
    if (preferred) {
      return preferred;
    }
  }

  return (
    types.find(
      (type) =>
        reservationTypeRequiresAircraft(type) &&
        reservationTypeRequiresInstructor(type),
    ) ??
    types.find((type) => supportsScheduleMatchSearch(type)) ??
    types[0]
  );
}

/** Pick the reservation type used for automated availability monitoring. */
export function selectMonitoringReservationType(
  types: ReservationType[],
  preferredTypeId?: string,
): ReservationType | undefined {
  if (preferredTypeId) {
    const preferred = types.find(
      (type) => type.reservationTypeId === preferredTypeId,
    );
    if (preferred) {
      return preferred;
    }

    log.warn("Configured RESERVATION_TYPE_ID not found in metadata", {
      preferredTypeId,
    });
  }

  const picked = pickReservationType(types);
  if (!picked) {
    return undefined;
  }

  if (
    reservationTypeRequiresAircraft(picked) &&
    reservationTypeRequiresInstructor(picked)
  ) {
    return picked;
  }

  if (supportsScheduleMatchSearch(picked)) {
    log.warn(
      "Using first schedule-match reservation type as monitoring fallback",
      {
        reservationTypeName: picked.reservationTypeName,
        reservationTypeId: picked.reservationTypeId,
      },
    );
    return picked;
  }

  log.warn("Using first reservation type as monitoring fallback", {
    reservationTypeName: picked.reservationTypeName,
    reservationTypeId: picked.reservationTypeId,
  });
  return picked;
}

export async function getReservationTypes(operatorId: number) {
  const url = `https://api-external.flightschedulepro.com/api/ReservationTypes?includeInactive=false&includeInstructorTimeOff=false&includeMaintenance=false&includeMeeting=false&operatorId=${operatorId}`;
  const cacheTtlMs = 10 * 24 * 60 * 60 * 1000;

  let types = await safeFetch(
    url,
    "GET",
    null,
    ReservationTypeListSchema,
    cacheTtlMs,
  );

  if (types.some(reservationTypeMissingFieldMetadata)) {
    log.info("Refreshing reservation types with incomplete cached metadata");
    await invalidateCache("ReservationTypes");
    types = await safeFetch(
      url,
      "GET",
      null,
      ReservationTypeListSchema,
      cacheTtlMs,
    );
  }

  return types;
}
