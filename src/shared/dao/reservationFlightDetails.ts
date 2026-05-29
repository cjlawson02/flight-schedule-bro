import { getFieldState, type ReservationType } from "./reservationTypes.js";

export const FLIGHT_TYPE_LOCAL = 1;
export const FLIGHT_TYPE_CROSS_COUNTRY = 2;
export const FLIGHT_RULES_VFR = 1;
export const FLIGHT_RULES_IFR = 2;

export interface ActivityFlightDetails {
  flightType?: number;
  flightRules?: number;
  estimatedFlightHours?: string;
  flightRoute?: string;
}

export function reservationTypeUsesFlightDetails(
  reservationType: ReservationType,
): boolean {
  return (
    getFieldState(reservationType, "flightType").enabled ||
    getFieldState(reservationType, "flightRules").enabled ||
    getFieldState(reservationType, "flightHours").enabled ||
    getFieldState(reservationType, "flightRoute").enabled
  );
}

export function formatFlightType(value: number | undefined): string {
  if (value === FLIGHT_TYPE_LOCAL) {
    return "Local";
  }
  if (value === FLIGHT_TYPE_CROSS_COUNTRY) {
    return "Cross Country";
  }
  return "Unknown";
}

export function formatFlightRules(value: number | undefined): string {
  if (value === FLIGHT_RULES_VFR) {
    return "VFR";
  }
  if (value === FLIGHT_RULES_IFR) {
    return "IFR";
  }
  return "Unknown";
}

export function validateActivityFlightDetails(
  reservationType: ReservationType,
  details: ActivityFlightDetails,
): string | null {
  const flightType = getFieldState(reservationType, "flightType");
  if (
    flightType.enabled &&
    flightType.required &&
    (details.flightType === undefined || details.flightType <= 0)
  ) {
    return "Flight type is required.";
  }

  const flightRules = getFieldState(reservationType, "flightRules");
  if (
    flightRules.enabled &&
    flightRules.required &&
    (details.flightRules === undefined || details.flightRules <= 0)
  ) {
    return "Flight rules are required.";
  }

  const flightHours = getFieldState(reservationType, "flightHours");
  if (
    flightHours.enabled &&
    flightHours.required &&
    !details.estimatedFlightHours?.trim()
  ) {
    return "Estimated flight hours are required.";
  }

  const flightRoute = getFieldState(reservationType, "flightRoute");
  if (
    flightRoute.enabled &&
    flightRoute.required &&
    !details.flightRoute?.trim()
  ) {
    return "Flight route is required.";
  }

  return null;
}
