import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createReservation } from "./reservations.js";
import { dualFlightTraining as mockReservationType } from "./reservationTypes.fixtures.js";
import { setCacheAdapter, invalidateCache } from "./api_wrapper.js";

// Mock the safeFetch and invalidateCache function
vi.mock("./api_wrapper.js", async () => {
  const actual = await vi.importActual("./api_wrapper.js");
  return {
    ...actual,
    safeFetch: vi.fn(),
    invalidateCache: vi.fn(),
  };
});

describe("createReservation", () => {
  const mockCacheAdapter = {
    getCachedResult: vi.fn(),
    setCachedResult: vi.fn(),
    invalidateCache: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setCacheAdapter(mockCacheAdapter);
  });

  afterEach(() => {
    setCacheAdapter(null);
  });

  it("should invalidate existing reservations cache after successful booking", async () => {
    const { safeFetch } = await import("./api_wrapper.js");

    // Mock successful reservation response
    (safeFetch as any).mockResolvedValue({
      errors: [],
      id: "reservation-123",
    });

    const reservationData = {
      aircraftId: "00000000-0000-0000-0000-000000000000",
      end: "2025-11-04T19:00:00",
      instructorId: "00000000-0000-0000-0000-000000000000",
      locationId: 1,
      operatorId: 123,
      pilotId: "00000000-0000-0000-0000-000000000000",
      start: "2025-11-04T17:00:00",
      reservationTypeId: "00000000-0000-0000-0000-000000000000",
    };

    await createReservation(mockReservationType, reservationData);

    // Verify that cache invalidation was called with the correct pattern
    expect(invalidateCache).toHaveBeenCalledWith(
      "api/V2/Reservation?dateTypeFilter=1",
    );
  });

  it("should not invalidate cache if reservation creation fails", async () => {
    const { safeFetch } = await import("./api_wrapper.js");

    // Mock failed reservation response
    (safeFetch as any).mockResolvedValue({
      errors: [{ message: "Booking failed" }],
      id: null,
    });

    const reservationData = {
      aircraftId: "00000000-0000-0000-0000-000000000000",
      end: "2025-11-04T19:00:00",
      instructorId: "00000000-0000-0000-0000-000000000000",
      locationId: 1,
      operatorId: 123,
      pilotId: "00000000-0000-0000-0000-000000000000",
      start: "2025-11-04T17:00:00",
      reservationTypeId: "00000000-0000-0000-0000-000000000000",
    };

    await expect(
      createReservation(mockReservationType, reservationData),
    ).rejects.toThrow("Reservation creation failed");

    // Verify that cache invalidation was not called
    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it("should not invalidate cache if API call throws an error", async () => {
    const { safeFetch } = await import("./api_wrapper.js");

    // Mock API error
    (safeFetch as any).mockRejectedValue(new Error("Network error"));

    const reservationData = {
      aircraftId: "00000000-0000-0000-0000-000000000000",
      end: "2025-11-04T19:00:00",
      instructorId: "00000000-0000-0000-0000-000000000000",
      locationId: 1,
      operatorId: 123,
      pilotId: "00000000-0000-0000-0000-000000000000",
      start: "2025-11-04T17:00:00",
      reservationTypeId: "00000000-0000-0000-0000-000000000000",
    };

    await expect(
      createReservation(mockReservationType, reservationData),
    ).rejects.toThrow();

    // Verify that cache invalidation was not called
    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it("should send overrideExceptions when requested", async () => {
    const { safeFetch } = await import("./api_wrapper.js");

    (safeFetch as any).mockResolvedValue({
      errors: [],
      id: "reservation-123",
    });

    const reservationData = {
      aircraftId: "00000000-0000-0000-0000-000000000000",
      end: "2025-11-04T19:00:00",
      instructorId: "00000000-0000-0000-0000-000000000000",
      locationId: 1,
      operatorId: 123,
      pilotId: "00000000-0000-0000-0000-000000000000",
      start: "2025-11-04T17:00:00",
      reservationTypeId: "00000000-0000-0000-0000-000000000000",
    };

    await createReservation(mockReservationType, reservationData, undefined, {
      overrideExceptions: true,
    });

    expect(safeFetch).toHaveBeenCalledWith(
      "https://api-external.flightschedulepro.com/api/V2/Reservation",
      "POST",
      expect.objectContaining({ overrideExceptions: true }),
      expect.anything(),
      0,
    );
  });

  it("should treat overridden warnings as success when reservation id is returned", async () => {
    const { safeFetch } = await import("./api_wrapper.js");

    (safeFetch as any).mockResolvedValue({
      errors: [
        {
          message:
            "The time based maintenance reminder (100Hr Inspection) is expired.",
        },
      ],
      id: "reservation-123",
    });

    const reservationData = {
      aircraftId: "00000000-0000-0000-0000-000000000000",
      end: "2025-11-04T19:00:00",
      instructorId: "00000000-0000-0000-0000-000000000000",
      locationId: 1,
      operatorId: 123,
      pilotId: "00000000-0000-0000-0000-000000000000",
      start: "2025-11-04T17:00:00",
      reservationTypeId: "00000000-0000-0000-0000-000000000000",
    };

    const result = await createReservation(
      mockReservationType,
      reservationData,
      undefined,
      { overrideExceptions: true },
    );

    expect(result.id).toBe("reservation-123");
    expect(invalidateCache).toHaveBeenCalledWith(
      "api/V2/Reservation?dateTypeFilter=1",
    );
  });

  it("should rethrow FspHttpError without wrapping", async () => {
    const { safeFetch, FspHttpError } = await import("./api_wrapper.js");
    const apiError = new FspHttpError(400, {
      errors: [{ message: "Expired inspection", overridable: true }],
    });

    (safeFetch as any).mockRejectedValue(apiError);

    const reservationData = {
      aircraftId: "00000000-0000-0000-0000-000000000000",
      end: "2025-11-04T19:00:00",
      instructorId: "00000000-0000-0000-0000-000000000000",
      locationId: 1,
      operatorId: 123,
      pilotId: "00000000-0000-0000-0000-000000000000",
      start: "2025-11-04T17:00:00",
      reservationTypeId: "00000000-0000-0000-0000-000000000000",
    };

    await expect(
      createReservation(mockReservationType, reservationData),
    ).rejects.toBe(apiError);
  });
});
