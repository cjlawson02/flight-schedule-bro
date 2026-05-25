import type { ReservationType } from "./reservationTypes.js";

export function createReservationTypeFixture(
  overrides: Partial<ReservationType> &
    Pick<ReservationType, "reservationTypeId" | "reservationTypeName">,
): ReservationType {
  return {
    aircraftEnabled: false,
    instructorEnabled: false,
    flightTypeEnabled: false,
    flightRulesEnabled: false,
    flightHoursEnabled: false,
    flightRouteEnabled: false,
    aircraftRequirement: 0,
    instructorRequirement: 0,
    flightTypeRequirement: 0,
    flightRulesRequirement: 0,
    flightHoursRequirement: 0,
    flightRouteRequirement: 0,
    defaultLength: 120,
    ...overrides,
  };
}

export const dualFlightTraining = createReservationTypeFixture({
  reservationTypeId: "09c58400-bd2a-49a3-a35e-9ab0e81fcebc",
  reservationTypeName: "Dual Flight Training",
  aircraftEnabled: true,
  instructorEnabled: true,
  aircraftRequirement: 2,
  instructorRequirement: 2,
});

export const groundTraining = createReservationTypeFixture({
  reservationTypeId: "a4ce734f-c9f9-44f0-bf5c-0e308f8aad27",
  reservationTypeName: "Ground Training",
  instructorEnabled: true,
  instructorRequirement: 2,
});

export const rental = createReservationTypeFixture({
  reservationTypeId: "11111111-1111-4111-8111-111111111111",
  reservationTypeName: "Rental",
  aircraftEnabled: true,
  aircraftRequirement: 2,
  flightTypeEnabled: true,
  flightRulesEnabled: true,
  flightHoursEnabled: true,
  flightRouteEnabled: true,
});
