import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SchedulerBLO } from "./scheduler.js";
import { parseFspLocal } from "../util/flightTime.js";

const LA = "America/Los_Angeles";
const bookableStart = parseFspLocal("2030-07-15T10:00:00", LA);
const bookableEnd = parseFspLocal("2030-07-15T12:00:00", LA);

import { dualFlightTraining as mockDualReservationType } from "../dao/reservationTypes.fixtures.js";
import * as fspMetadataModule from "./fspMetadata.js";
import * as scheduleDAO from "../dao/schedule.js";
import * as scheduleAvailability from "./scheduleAvailability.js";
import * as reservationsDAO from "../dao/reservations.js";
import * as authDAO from "../dao/auth.js";

vi.mock("./fspMetadata.js");
vi.mock("../dao/schedule.js");
vi.mock("./scheduleAvailability.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./scheduleAvailability.js")>();
  return {
    ...actual,
    computeBookableAvailabilityFromSnapshot: vi.fn(),
  };
});
vi.mock("../dao/reservations.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../dao/reservations.js")>();
  return {
    ...actual,
    createReservation: vi.fn(),
  };
});
vi.mock("../dao/auth.js");

function createMockMetadata(
  overrides: Partial<fspMetadataModule.FspMetadata> = {},
): fspMetadataModule.FspMetadata {
  return {
    instructors: [
      { instructorId: "inst-1", displayName: "John Doe" },
      { instructorId: "inst-2", displayName: "Jane Smith" },
    ],
    reservationTypes: [
      mockDualReservationType,
      {
        ...mockDualReservationType,
        reservationTypeId: "22222222-2222-4222-8222-222222222222",
        reservationTypeName: "Solo",
      },
    ],
    aircraft: [
      { aircraftId: "ac-1", tailNumber: "N12345" },
      { aircraftId: "ac-2", tailNumber: "N67890" },
    ],
    lastUpdated: "2024-01-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("SchedulerBLO", () => {
  const mockOperatorId = 12345;
  let scheduler: SchedulerBLO;

  beforeEach(() => {
    scheduler = new SchedulerBLO(mockOperatorId);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initialize", () => {
    it("hydrates maps from metadata without API calls", () => {
      scheduler.hydrateFromMetadata(createMockMetadata());

      expect(scheduler.getInstructorIds()).toEqual(["inst-1", "inst-2"]);
      expect(scheduler.getAircraftIds()).toEqual(["ac-1", "ac-2"]);
      expect(scheduler.getReservationTypes()).toHaveLength(2);
    });

    it("binds pilotId from auth session during hydrateFromMetadata", async () => {
      vi.mocked(authDAO.getAuthSession).mockReturnValue({
        sessionCookies: "session=abc",
        operatorId: mockOperatorId,
        subscriptionKey: "sub-key",
        authToken: "token",
        userId: "user-guid",
        pilotId: "123e4567-e89b-12d3-a456-426614174000",
        defaultLocationId: 456,
      });

      scheduler.hydrateFromMetadata(
        createMockMetadata({ reservationTypes: [mockDualReservationType] }),
      );

      vi.mocked(reservationsDAO.createReservation).mockResolvedValue({
        id: "66666666-6666-4666-8666-666666666666",
        errors: [],
      });

      await scheduler.bookReservation({
        aircraftId: "33333333-3333-4333-8333-333333333333",
        instructorId: "44444444-4444-4444-8444-444444444444",
        startTime: bookableStart,
        endTime: bookableEnd,
        reservationType: mockDualReservationType,
        locationId: 1,
      });

      expect(reservationsDAO.createReservation).toHaveBeenCalledWith(
        mockDualReservationType,
        expect.objectContaining({
          pilotId: "123e4567-e89b-12d3-a456-426614174000",
        }),
        undefined,
        undefined,
      );
    });

    it("loads instructors, aircraft, and activity types successfully", async () => {
      vi.mocked(fspMetadataModule.fetchFspMetadata).mockResolvedValue(
        createMockMetadata(),
      );
      vi.mocked(authDAO.getPilotId).mockReturnValue("pilot-123");

      await scheduler.initialize();

      expect(fspMetadataModule.fetchFspMetadata).toHaveBeenCalledWith(
        mockOperatorId,
      );
      expect(scheduler.getInstructorIds()).toEqual(["inst-1", "inst-2"]);
      expect(scheduler.getAircraftIds()).toEqual(["ac-1", "ac-2"]);
    });

    it("trims aircraft tail numbers when loading", async () => {
      vi.mocked(fspMetadataModule.fetchFspMetadata).mockResolvedValue(
        createMockMetadata({
          instructors: [],
          reservationTypes: [],
          aircraft: [{ aircraftId: "ac-1", tailNumber: "N12345" }],
        }),
      );
      vi.mocked(authDAO.getPilotId).mockReturnValue("pilot-123");

      await scheduler.initialize();

      const entries = Array.from(scheduler.getAircraftMapEntries());
      expect(entries.find(([id]) => id === "ac-1")?.[1]).toBe("N12345");
    });
  });

  describe("getter methods", () => {
    beforeEach(async () => {
      vi.mocked(fspMetadataModule.fetchFspMetadata).mockResolvedValue(
        createMockMetadata({
          reservationTypes: [mockDualReservationType],
        }),
      );
      vi.mocked(authDAO.getPilotId).mockReturnValue("pilot-123");
      await scheduler.initialize();
    });

    describe("getInstructorIds", () => {
      it("returns array of all instructor IDs", () => {
        const ids = scheduler.getInstructorIds();
        expect(ids).toEqual(["inst-1", "inst-2"]);
        expect(ids).toBeInstanceOf(Array);
      });
    });

    describe("getAircraftIds", () => {
      it("returns array of all aircraft IDs", () => {
        const ids = scheduler.getAircraftIds();
        expect(ids).toEqual(["ac-1", "ac-2"]);
        expect(ids).toBeInstanceOf(Array);
      });
    });

    describe("getAircraftMapEntries", () => {
      it("returns an iterator of aircraft ID to name mappings", () => {
        const entries = Array.from(scheduler.getAircraftMapEntries());
        expect(entries).toEqual([
          ["ac-1", "N12345"],
          ["ac-2", "N67890"],
        ]);
      });
    });
  });

  describe("getBookableAvailability", () => {
    const emptySnapshot = {
      resources: [],
      events: [],
      unavailability: [],
      closings: [],
    };

    beforeEach(async () => {
      vi.mocked(fspMetadataModule.fetchFspMetadata).mockResolvedValue(
        createMockMetadata({
          instructors: [{ instructorId: "inst-1", displayName: "John Doe" }],
          reservationTypes: [mockDualReservationType],
          aircraft: [{ aircraftId: "ac-1", tailNumber: "N12345" }],
        }),
      );
      vi.mocked(authDAO.getPilotId).mockReturnValue("pilot-123");
      vi.mocked(scheduleDAO.fetchScheduleDay).mockResolvedValue(emptySnapshot);
      await scheduler.initialize();
    });

    it("fetches schedule snapshot and computes bookable availability", async () => {
      const slot = {
        date: "7/15/2024",
        startTime: "10:00:00 AM",
        endTime: "12:00:00 PM",
        instructorId: "inst-1",
        aircraftId: "ac-1",
        instructor: "John Doe",
        aircraft: "N12345",
        startDateTime: parseFspLocal("2024-07-15T10:00:00", LA),
        endDateTime: parseFspLocal("2024-07-15T12:00:00", LA),
      };

      vi.mocked(
        scheduleAvailability.computeBookableAvailabilityFromSnapshot,
      ).mockReturnValue([slot]);

      const result = await scheduler.getBookableAvailability({
        locationId: 1,
        activityTypeId: mockDualReservationType.reservationTypeId,
        instructorIds: ["inst-1"],
        aircraftIds: ["ac-1"],
        startDate: "2024-07-15",
      });

      expect(scheduleDAO.fetchScheduleDay).toHaveBeenCalledWith(
        expect.objectContaining({
          operatorId: mockOperatorId,
          locationId: 1,
          start: "2024-07-15",
          timeZone: LA,
        }),
      );
      expect(
        scheduleAvailability.computeBookableAvailabilityFromSnapshot,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          day: "2024-07-15",
          aircraftIds: ["ac-1"],
          instructorIds: ["inst-1"],
          durationMinutes: mockDualReservationType.defaultLength,
        }),
      );
      expect(result).toEqual([slot]);
    });

    it("passes explicit lengthOfReservationInMinutes", async () => {
      vi.mocked(
        scheduleAvailability.computeBookableAvailabilityFromSnapshot,
      ).mockReturnValue([]);

      const workerScheduler = new SchedulerBLO(mockOperatorId, LA);
      workerScheduler.hydrateFromMetadata(
        createMockMetadata({
          reservationTypes: [mockDualReservationType],
        }),
      );

      await workerScheduler.getBookableAvailability({
        locationId: 1,
        activityTypeId: mockDualReservationType.reservationTypeId,
        instructorIds: ["inst-1"],
        aircraftIds: ["ac-1"],
        startDate: "2024-07-15",
        lengthOfReservationInMinutes: 90,
      });

      expect(
        scheduleAvailability.computeBookableAvailabilityFromSnapshot,
      ).toHaveBeenCalledWith(expect.objectContaining({ durationMinutes: 90 }));
    });
  });

  describe("bookReservation", () => {
    beforeEach(async () => {
      vi.mocked(authDAO.getAuthSession).mockReturnValue(null);
      vi.mocked(fspMetadataModule.fetchFspMetadata).mockResolvedValue(
        createMockMetadata({
          instructors: [],
          reservationTypes: [mockDualReservationType],
          aircraft: [],
        }),
      );
      vi.mocked(authDAO.getPilotId).mockReturnValue("pilot-123");

      await scheduler.initialize();
    });

    it("books a reservation successfully", async () => {
      const mockResponse = {
        id: "66666666-6666-4666-8666-666666666666",
        errors: [],
      };

      vi.mocked(reservationsDAO.createReservation).mockResolvedValue(
        mockResponse,
      );

      const params = {
        aircraftId: "33333333-3333-4333-8333-333333333333",
        instructorId: "44444444-4444-4444-8444-444444444444",
        startTime: bookableStart,
        endTime: bookableEnd,
        reservationType: mockDualReservationType,
        locationId: 1,
      };

      const result = await scheduler.bookReservation(params);

      expect(result).toEqual(mockResponse);
      expect(reservationsDAO.createReservation).toHaveBeenCalledWith(
        mockDualReservationType,
        {
          aircraftId: "33333333-3333-4333-8333-333333333333",
          instructorId: "44444444-4444-4444-8444-444444444444",
          start: "2030-07-15T10:00",
          end: "2030-07-15T12:00",
          reservationTypeId: mockDualReservationType.reservationTypeId,
          locationId: 1,
          operatorId: mockOperatorId,
          pilotId: "pilot-123",
        },
        undefined,
        undefined,
      );
    });

    it("formats dates to local timezone ISO string without seconds", async () => {
      vi.mocked(reservationsDAO.createReservation).mockResolvedValue({
        id: "66666666-6666-4666-8666-666666666666",
        errors: [],
      });

      const params = {
        aircraftId: "33333333-3333-4333-8333-333333333333",
        instructorId: "44444444-4444-4444-8444-444444444444",
        startTime: parseFspLocal("2030-07-15T14:30:45", LA),
        endTime: parseFspLocal("2030-07-15T16:30:45", LA),
        reservationType: mockDualReservationType,
        locationId: 1,
      };

      await scheduler.bookReservation(params);

      const call = vi.mocked(reservationsDAO.createReservation).mock
        .calls[0][1];
      expect(call.start).toBe("2030-07-15T14:30");
      expect(call.end).toBe("2030-07-15T16:30");
    });

    it("wraps errors with BOOKING_FAILED code", async () => {
      vi.mocked(reservationsDAO.createReservation).mockRejectedValue(
        new Error("Network error"),
      );

      const params = {
        aircraftId: "33333333-3333-4333-8333-333333333333",
        instructorId: "44444444-4444-4444-8444-444444444444",
        startTime: bookableStart,
        endTime: bookableEnd,
        reservationType: mockDualReservationType,
        locationId: 1,
      };

      await expect(scheduler.bookReservation(params)).rejects.toThrow(
        "Failed to book reservation: Network error",
      );

      try {
        await scheduler.bookReservation(params);
      } catch (error: any) {
        expect(error.code).toBe("BOOKING_FAILED");
      }
    });

    it("preserves error code if already present", async () => {
      const customError = new Error("Validation failed") as any;
      customError.code = "VALIDATION_ERROR";

      vi.mocked(reservationsDAO.createReservation).mockRejectedValue(
        customError,
      );

      const params = {
        aircraftId: "33333333-3333-4333-8333-333333333333",
        instructorId: "44444444-4444-4444-8444-444444444444",
        startTime: bookableStart,
        endTime: bookableEnd,
        reservationType: mockDualReservationType,
        locationId: 1,
      };

      try {
        await scheduler.bookReservation(params);
      } catch (error: any) {
        expect(error.code).toBe("VALIDATION_ERROR");
        expect(error.message).toBe("Validation failed");
      }
    });

    it("rejects bookings within 24 hours of start time", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(parseFspLocal("2024-07-15T10:00:00", LA));

      const params = {
        aircraftId: "33333333-3333-4333-8333-333333333333",
        instructorId: "44444444-4444-4444-8444-444444444444",
        startTime: parseFspLocal("2024-07-16T09:59:00", LA),
        endTime: parseFspLocal("2024-07-16T11:59:00", LA),
        reservationType: mockDualReservationType,
        locationId: 1,
      };

      await expect(scheduler.bookReservation(params)).rejects.toThrow(
        "Cannot book reservations within 24 hours of start time",
      );
      expect(reservationsDAO.createReservation).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
