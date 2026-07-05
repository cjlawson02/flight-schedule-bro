import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildCancelReservationRequest,
  buildUpdateReservationRequest,
  cancelReservation,
  getReservationResourceIds,
  resolveUpdateResourcesForType,
  updateReservation,
  validateUpdateResourcesForType,
} from "./reservationManagement.js";
import {
  dualFlightTraining,
  groundTraining,
  rental,
} from "./reservationTypes.fixtures.js";
import {
  FLIGHT_RULES_VFR,
  FLIGHT_TYPE_LOCAL,
} from "./reservationFlightDetails.js";
import * as apiWrapper from "./api_wrapper.js";
import { parseFspLocal } from "../util/flightTime.js";

vi.mock("./api_wrapper.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api_wrapper.js")>();
  return {
    ...actual,
    safeFetch: vi.fn(),
    invalidateCache: vi.fn(),
  };
});

const LA = "America/Los_Angeles";

describe("buildUpdateReservationRequest", () => {
  it("builds a validate-only update payload matching the FSP web app", () => {
    const request = buildUpdateReservationRequest({
      reservationId: "845b8008-68d8-4b3f-bb6c-80753adc9ef5",
      reservationType: dualFlightTraining,
      operatorId: 191057,
      locationId: 20852,
      pilotId: "3fb9208a-b560-4bcc-a92b-31adcfc125e6",
      aircraftId: "ad2b4bb1-1946-4c20-b1f5-51fb4039597c",
      instructorId: "bc8dbb05-d939-4539-bdf6-d4633333a169",
      startTime: parseFspLocal("2026-05-30T14:00:00", LA),
      endTime: parseFspLocal("2026-05-30T16:00:00", LA),
      timeZone: LA,
      validateOnly: true,
    });

    expect(request).toMatchObject({
      reservationId: "845b8008-68d8-4b3f-bb6c-80753adc9ef5",
      start: "2026-05-30T14:00",
      end: "2026-05-30T16:00",
      validateOnly: true,
      checkStudentAvailability: true,
      client: "V4",
      flightRules: "",
      flightType: "",
    });
  });

  it("includes rental flight detail fields when provided", () => {
    const request = buildUpdateReservationRequest({
      reservationId: "845b8008-68d8-4b3f-bb6c-80753adc9ef5",
      reservationType: rental,
      operatorId: 191057,
      locationId: 20852,
      pilotId: "3fb9208a-b560-4bcc-a92b-31adcfc125e6",
      aircraftId: "ad2b4bb1-1946-4c20-b1f5-51fb4039597c",
      startTime: parseFspLocal("2026-05-30T14:00:00", LA),
      endTime: parseFspLocal("2026-05-30T16:00:00", LA),
      timeZone: LA,
      flightDetails: {
        flightType: FLIGHT_TYPE_LOCAL,
        flightRules: FLIGHT_RULES_VFR,
        estimatedFlightHours: "1.5",
        flightRoute: "KSBP-KPRB",
      },
      validateOnly: true,
    });

    expect(request).toMatchObject({
      flightType: FLIGHT_TYPE_LOCAL,
      flightRules: FLIGHT_RULES_VFR,
      estimatedFlightHours: "1.5",
      flightRoute: "KSBP-KPRB",
    });
  });

  it("preserves comments and orFor when provided", () => {
    const request = buildUpdateReservationRequest({
      reservationId: "845b8008-68d8-4b3f-bb6c-80753adc9ef5",
      reservationType: dualFlightTraining,
      operatorId: 191057,
      locationId: 20852,
      pilotId: "3fb9208a-b560-4bcc-a92b-31adcfc125e6",
      aircraftId: "ad2b4bb1-1946-4c20-b1f5-51fb4039597c",
      instructorId: "bc8dbb05-d939-4539-bdf6-d4633333a169",
      startTime: parseFspLocal("2026-05-30T14:00:00", LA),
      endTime: parseFspLocal("2026-05-30T16:00:00", LA),
      comments: "Keep this note",
      orFor: "Passenger",
      validateOnly: true,
    });

    expect(request).toMatchObject({
      comments: "Keep this note",
      orFor: "Passenger",
    });
  });

  it("clears scheduling groups when aircraft is disabled", () => {
    const request = buildUpdateReservationRequest({
      reservationId: "845b8008-68d8-4b3f-bb6c-80753adc9ef5",
      reservationType: groundTraining,
      operatorId: 191057,
      locationId: 20852,
      pilotId: "3fb9208a-b560-4bcc-a92b-31adcfc125e6",
      startTime: parseFspLocal("2026-05-30T14:00:00", LA),
      endTime: parseFspLocal("2026-05-30T16:00:00", LA),
      schedulingGroupId: "11111111-1111-4111-8111-111111111111",
      schedulingGroupSlotId: "22222222-2222-4222-8222-222222222222",
      validateOnly: true,
    });

    expect(request).toMatchObject({
      schedulingGroupId: null,
      schedulingGroupSlotId: null,
    });
  });

  it("nil aircraft and keeps instructor when switching to ground training", () => {
    const request = buildUpdateReservationRequest({
      reservationId: "845b8008-68d8-4b3f-bb6c-80753adc9ef5",
      reservationType: groundTraining,
      operatorId: 191057,
      locationId: 20852,
      pilotId: "3fb9208a-b560-4bcc-a92b-31adcfc125e6",
      aircraftId: "ad2b4bb1-1946-4c20-b1f5-51fb4039597c",
      instructorId: "bc8dbb05-d939-4539-bdf6-d4633333a169",
      startTime: parseFspLocal("2026-05-30T14:00:00", LA),
      endTime: parseFspLocal("2026-05-30T16:00:00", LA),
      validateOnly: true,
    });

    expect(request).toMatchObject({
      aircraftId: null,
      instructorId: "bc8dbb05-d939-4539-bdf6-d4633333a169",
      flightRules: "",
      flightType: "",
    });
  });

  it("nil instructor when switching to rental", () => {
    const request = buildUpdateReservationRequest({
      reservationId: "845b8008-68d8-4b3f-bb6c-80753adc9ef5",
      reservationType: rental,
      operatorId: 191057,
      locationId: 20852,
      pilotId: "3fb9208a-b560-4bcc-a92b-31adcfc125e6",
      aircraftId: "ad2b4bb1-1946-4c20-b1f5-51fb4039597c",
      instructorId: "bc8dbb05-d939-4539-bdf6-d4633333a169",
      startTime: parseFspLocal("2026-05-30T14:00:00", LA),
      endTime: parseFspLocal("2026-05-30T16:00:00", LA),
      validateOnly: true,
    });

    expect(request).toMatchObject({
      aircraftId: "ad2b4bb1-1946-4c20-b1f5-51fb4039597c",
      instructorId: null,
    });
  });
});

describe("buildCancelReservationRequest", () => {
  it("builds a cancellation payload matching the FSP web app", () => {
    expect(
      buildCancelReservationRequest({
        reservationId: "845b8008-68d8-4b3f-bb6c-80753adc9ef5",
        operatorId: 191057,
        reasonId: "f69bc957-035a-4beb-9125-e8b0c2686f3e",
      }),
    ).toEqual({
      reservationId: "845b8008-68d8-4b3f-bb6c-80753adc9ef5",
      operatorId: 191057,
      overrideErrors: false,
      SendEmailNotification: true,
      client: "V4",
      recurring: false,
      reasonId: "f69bc957-035a-4beb-9125-e8b0c2686f3e",
      reasonText: "",
    });
  });
});

describe("resolveUpdateResourcesForType", () => {
  const detail = {
    reservationId: "845b8008-68d8-4b3f-bb6c-80753adc9ef5",
    reservationTypeId: dualFlightTraining.reservationTypeId,
    locationId: 20852,
    start: "2026-05-30T14:00:00",
    end: "2026-05-30T16:00:00",
    pilot: {
      pilotId: "3fb9208a-b560-4bcc-a92b-31adcfc125e6",
      userId: "354ccb15-6534-4c59-851d-c6b4d2694320",
    },
    instructor: {
      instructorId: "bc8dbb05-d939-4539-bdf6-d4633333a169",
    },
    aircraftSummary: {
      aircraftId: "ad2b4bb1-1946-4c20-b1f5-51fb4039597c",
    },
  };

  it("keeps aircraft but drops instructor when switching to rental", () => {
    expect(resolveUpdateResourcesForType(detail, rental)).toEqual({
      aircraftId: "ad2b4bb1-1946-4c20-b1f5-51fb4039597c",
      instructorId: undefined,
    });
  });

  it("keeps instructor but drops aircraft when switching to ground", () => {
    expect(resolveUpdateResourcesForType(detail, groundTraining)).toEqual({
      aircraftId: undefined,
      instructorId: "bc8dbb05-d939-4539-bdf6-d4633333a169",
    });
  });
});

describe("getReservationResourceIds", () => {
  it("returns undefined when aircraft and instructor are absent", () => {
    expect(
      getReservationResourceIds({
        reservationId: "845b8008-68d8-4b3f-bb6c-80753adc9ef5",
        reservationTypeId: dualFlightTraining.reservationTypeId,
        locationId: 20852,
        start: "2026-05-30T14:00:00",
        end: "2026-05-30T16:00:00",
        pilot: {
          pilotId: "3fb9208a-b560-4bcc-a92b-31adcfc125e6",
          userId: "354ccb15-6534-4c59-851d-c6b4d2694320",
        },
        aircraftSummary: null,
        instructor: null,
      }),
    ).toEqual({
      aircraftId: undefined,
      instructorId: undefined,
    });
  });
});

describe("validateUpdateResourcesForType", () => {
  it("allows instructor resolution when the new type requires an instructor", () => {
    const detail = {
      reservationId: "845b8008-68d8-4b3f-bb6c-80753adc9ef5",
      reservationTypeId: rental.reservationTypeId,
      locationId: 20852,
      start: "2026-05-30T14:00:00",
      end: "2026-05-30T16:00:00",
      pilot: {
        pilotId: "3fb9208a-b560-4bcc-a92b-31adcfc125e6",
        userId: "354ccb15-6534-4c59-851d-c6b4d2694320",
      },
      aircraftSummary: {
        aircraftId: "ad2b4bb1-1946-4c20-b1f5-51fb4039597c",
      },
    };

    expect(
      validateUpdateResourcesForType(detail, dualFlightTraining),
    ).toBeNull();
  });
});

describe("updateReservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invalidates reservation cache after a successful update", async () => {
    vi.mocked(apiWrapper.safeFetch).mockResolvedValue({ errors: [] });

    await updateReservation({
      reservationId: "845b8008-68d8-4b3f-bb6c-80753adc9ef5",
      reservationType: dualFlightTraining,
      operatorId: 191057,
      locationId: 20852,
      pilotId: "3fb9208a-b560-4bcc-a92b-31adcfc125e6",
      aircraftId: "ad2b4bb1-1946-4c20-b1f5-51fb4039597c",
      instructorId: "bc8dbb05-d939-4539-bdf6-d4633333a169",
      startTime: parseFspLocal("2026-05-30T14:00:00", LA),
      endTime: parseFspLocal("2026-05-30T16:00:00", LA),
      timeZone: LA,
      validateOnly: false,
    });

    expect(apiWrapper.safeFetch).toHaveBeenCalledWith(
      "https://api-external.flightschedulepro.com/api/V2/Reservation",
      "PUT",
      expect.objectContaining({ validateOnly: false }),
      expect.any(Object),
      0,
    );
    expect(apiWrapper.invalidateCache).toHaveBeenCalledWith(
      "api/V2/Reservation?dateTypeFilter=1",
    );
    expect(apiWrapper.invalidateCache).toHaveBeenCalledWith("api/v2/schedule");
  });

  it("does not invalidate cache for validate-only updates", async () => {
    vi.mocked(apiWrapper.safeFetch).mockResolvedValue({ errors: [] });

    await updateReservation({
      reservationId: "845b8008-68d8-4b3f-bb6c-80753adc9ef5",
      reservationType: dualFlightTraining,
      operatorId: 191057,
      locationId: 20852,
      pilotId: "3fb9208a-b560-4bcc-a92b-31adcfc125e6",
      aircraftId: "ad2b4bb1-1946-4c20-b1f5-51fb4039597c",
      instructorId: "bc8dbb05-d939-4539-bdf6-d4633333a169",
      startTime: parseFspLocal("2026-05-30T14:00:00", LA),
      endTime: parseFspLocal("2026-05-30T16:00:00", LA),
      validateOnly: true,
    });

    expect(apiWrapper.invalidateCache).not.toHaveBeenCalled();
  });
});

describe("cancelReservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a DELETE request and invalidates reservation cache", async () => {
    vi.mocked(apiWrapper.safeFetch).mockResolvedValue({ errors: [] });

    await cancelReservation({
      reservationId: "845b8008-68d8-4b3f-bb6c-80753adc9ef5",
      operatorId: 191057,
      reasonId: "f69bc957-035a-4beb-9125-e8b0c2686f3e",
    });

    expect(apiWrapper.safeFetch).toHaveBeenCalledWith(
      "https://api-external.flightschedulepro.com/api/V2/Reservation",
      "DELETE",
      expect.objectContaining({
        reasonId: "f69bc957-035a-4beb-9125-e8b0c2686f3e",
      }),
      expect.any(Object),
      0,
    );
    expect(apiWrapper.invalidateCache).toHaveBeenCalledWith(
      "api/V2/Reservation?dateTypeFilter=1",
    );
    expect(apiWrapper.invalidateCache).toHaveBeenCalledWith("api/v2/schedule");
  });

  it("throws when cancellation returns errors", async () => {
    vi.mocked(apiWrapper.safeFetch).mockResolvedValue({
      errors: [{ message: "Cannot cancel within 24 hours" }],
    });

    await expect(
      cancelReservation({
        reservationId: "845b8008-68d8-4b3f-bb6c-80753adc9ef5",
        operatorId: 191057,
        reasonId: "f69bc957-035a-4beb-9125-e8b0c2686f3e",
      }),
    ).rejects.toThrow(/cancel failed/i);
  });
});
