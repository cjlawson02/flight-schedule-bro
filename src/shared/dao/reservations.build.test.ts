import { describe, expect, it } from "vitest";
import {
  buildFullReservationRequest,
  buildUserReservationRequest,
} from "./reservations.js";
import {
  dualFlightTraining,
  groundTraining,
  rental,
} from "./reservationTypes.fixtures.js";

describe("buildUserReservationRequest", () => {
  const base = {
    end: "2026-05-25T15:00:00",
    start: "2026-05-25T13:00:00",
    locationId: 20852,
    operatorId: 191057,
    pilotId: "354ccb15-6534-4c59-851d-c6b4d2694320",
    aircraftId: "cc20d524-b205-43df-9670-5db41a761f87",
    instructorId: "f046d666-35dd-4ebf-b71b-6feb90677291",
  };

  it("includes both resources for dual flight training", () => {
    const request = buildUserReservationRequest({
      ...base,
      reservationType: dualFlightTraining,
    });

    expect(request.aircraftId).toBe(base.aircraftId);
    expect(request.instructorId).toBe(base.instructorId);
  });

  it("omits aircraft for ground training", () => {
    const request = buildUserReservationRequest({
      ...base,
      reservationType: groundTraining,
    });

    expect(request.aircraftId).toBeUndefined();
    expect(request.instructorId).toBe(base.instructorId);
  });

  it("omits instructor for rental", () => {
    const request = buildUserReservationRequest({
      ...base,
      reservationType: rental,
    });

    expect(request.aircraftId).toBe(base.aircraftId);
    expect(request.instructorId).toBeUndefined();
  });
});

describe("buildFullReservationRequest", () => {
  it("includes rental flight fields when enabled on the reservation type", () => {
    const userRequest = buildUserReservationRequest({
      reservationType: rental,
      aircraftId: "cc20d524-b205-43df-9670-5db41a761f87",
      end: "2026-05-25T15:00:00",
      start: "2026-05-25T13:00:00",
      locationId: 20852,
      operatorId: 191057,
      pilotId: "354ccb15-6534-4c59-851d-c6b4d2694320",
    });

    const fullRequest = buildFullReservationRequest(rental, userRequest);

    expect(fullRequest.flightRoute).toBe("");
    expect(fullRequest.flightType).toBeNull();
    expect(fullRequest.flightRules).toBeNull();
    expect(fullRequest.estimatedFlightHours).toBe("");
  });

  it("omits instructorId from serialized rental create payloads", () => {
    const userRequest = buildUserReservationRequest({
      reservationType: rental,
      aircraftId: "cc20d524-b205-43df-9670-5db41a761f87",
      instructorId: "f046d666-35dd-4ebf-b71b-6feb90677291",
      end: "2026-08-22T10:00",
      start: "2026-08-22T08:00",
      locationId: 20852,
      operatorId: 191057,
      pilotId: "354ccb15-6534-4c59-851d-c6b4d2694320",
    });

    const serialized = JSON.parse(
      JSON.stringify(buildFullReservationRequest(rental, userRequest)),
    ) as Record<string, unknown>;

    expect(serialized).not.toHaveProperty("instructorId");
    expect(serialized.aircraftId).toBe("cc20d524-b205-43df-9670-5db41a761f87");
  });

  it("omits aircraftId from serialized ground-training create payloads", () => {
    const userRequest = buildUserReservationRequest({
      reservationType: groundTraining,
      instructorId: "f046d666-35dd-4ebf-b71b-6feb90677291",
      end: "2026-08-22T10:00",
      start: "2026-08-22T08:00",
      locationId: 20852,
      operatorId: 191057,
      pilotId: "354ccb15-6534-4c59-851d-c6b4d2694320",
    });

    const serialized = JSON.parse(
      JSON.stringify(buildFullReservationRequest(groundTraining, userRequest)),
    ) as Record<string, unknown>;

    expect(serialized).not.toHaveProperty("aircraftId");
    expect(serialized.instructorId).toBe(
      "f046d666-35dd-4ebf-b71b-6feb90677291",
    );
  });

  it("omits flight hours when disabled on the reservation type", () => {
    const userRequest = buildUserReservationRequest({
      reservationType: dualFlightTraining,
      aircraftId: "cc20d524-b205-43df-9670-5db41a761f87",
      instructorId: "f046d666-35dd-4ebf-b71b-6feb90677291",
      end: "2026-05-25T15:00:00",
      start: "2026-05-25T13:00:00",
      locationId: 20852,
      operatorId: 191057,
      pilotId: "354ccb15-6534-4c59-851d-c6b4d2694320",
    });

    const fullRequest = buildFullReservationRequest(
      dualFlightTraining,
      userRequest,
    );

    expect(fullRequest.estimatedFlightHours).toBeUndefined();
  });
});
