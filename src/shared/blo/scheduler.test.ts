import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SchedulerBLO } from "./scheduler.js";
import * as instructorsDAO from "../dao/instructors.js";
import * as reservationTypesDAO from "../dao/reservationTypes.js";
import * as aircraftDAO from "../dao/aircraft.js";
import * as availabilityDAO from "../dao/availability.js";
import * as reservationsDAO from "../dao/reservations.js";
import * as authDAO from "../dao/auth.js";

// Mock all DAO modules
vi.mock("../dao/instructors.js");
vi.mock("../dao/reservationTypes.js");
vi.mock("../dao/aircraft.js");
vi.mock("../dao/availability.js");
vi.mock("../dao/reservations.js");
vi.mock("../dao/auth.js");

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
    it("loads instructors, aircraft, and activity types successfully", async () => {
      // Mock DAO responses
      vi.mocked(instructorsDAO.getInstructors).mockResolvedValue({
        results: [
          { instructorId: "inst-1", displayName: "John Doe" },
          { instructorId: "inst-2", displayName: "Jane Smith" },
        ],
      });

      vi.mocked(reservationTypesDAO.getReservationTypes).mockResolvedValue([
        {
          reservationTypeId: "type-1",
          reservationTypeName: "Dual Instruction",
        },
        { reservationTypeId: "type-2", reservationTypeName: "Solo" },
      ]);

      vi.mocked(aircraftDAO.getAircraft).mockResolvedValue({
        results: [
          { aircraftId: "ac-1", tailNumber: "N12345", model: "172S" },
          { aircraftId: "ac-2", tailNumber: "N67890", model: "172N" },
        ],
      });

      vi.mocked(authDAO.getPilotId).mockReturnValue("pilot-123");

      await scheduler.initialize();

      // Verify all DAOs were called with correct parameters
      expect(instructorsDAO.getInstructors).toHaveBeenCalledWith(
        mockOperatorId
      );
      expect(reservationTypesDAO.getReservationTypes).toHaveBeenCalledWith(
        mockOperatorId
      );
      expect(aircraftDAO.getAircraft).toHaveBeenCalledWith(mockOperatorId);

      // Verify data was loaded correctly
      expect(scheduler.getInstructorIds()).toEqual(["inst-1", "inst-2"]);
      expect(scheduler.getAircraftIds()).toEqual(["ac-1", "ac-2"]);
    });

    it("trims aircraft tail numbers when loading", async () => {
      vi.mocked(instructorsDAO.getInstructors).mockResolvedValue({
        results: [],
      });
      vi.mocked(reservationTypesDAO.getReservationTypes).mockResolvedValue([]);
      vi.mocked(aircraftDAO.getAircraft).mockResolvedValue({
        results: [
          { aircraftId: "ac-1", tailNumber: "  N12345  ", model: "172S" },
        ],
      });
      vi.mocked(authDAO.getPilotId).mockReturnValue("pilot-123");

      await scheduler.initialize();

      expect(scheduler.getAircraftName("ac-1")).toBe("N12345");
    });
  });

  describe("getter methods", () => {
    beforeEach(async () => {
      vi.mocked(instructorsDAO.getInstructors).mockResolvedValue({
        results: [
          { instructorId: "inst-1", displayName: "John Doe" },
          { instructorId: "inst-2", displayName: "Jane Smith" },
        ],
      });

      vi.mocked(reservationTypesDAO.getReservationTypes).mockResolvedValue([
        {
          reservationTypeId: "type-1",
          reservationTypeName: "Dual Instruction",
        },
      ]);

      vi.mocked(aircraftDAO.getAircraft).mockResolvedValue({
        results: [
          { aircraftId: "ac-1", tailNumber: "N12345", model: "172S" },
          { aircraftId: "ac-2", tailNumber: "N67890", model: "172N" },
        ],
      });

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

    describe("getInstructorName", () => {
      it("returns instructor name when ID exists", () => {
        expect(scheduler.getInstructorName("inst-1")).toBe("John Doe");
        expect(scheduler.getInstructorName("inst-2")).toBe("Jane Smith");
      });

      it("returns undefined when ID does not exist", () => {
        expect(scheduler.getInstructorName("non-existent")).toBeUndefined();
      });
    });

    describe("getAircraftName", () => {
      it("returns aircraft tail number when ID exists", () => {
        expect(scheduler.getAircraftName("ac-1")).toBe("N12345");
        expect(scheduler.getAircraftName("ac-2")).toBe("N67890");
      });

      it("returns undefined when ID does not exist", () => {
        expect(scheduler.getAircraftName("non-existent")).toBeUndefined();
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

    describe("getActivityTypesMapEntries", () => {
      it("returns an iterator of activity type ID to name mappings", () => {
        const entries = Array.from(scheduler.getActivityTypesMapEntries());
        expect(entries).toEqual([["type-1", "Dual Instruction"]]);
      });
    });
  });

  describe("getBookableAvailability", () => {
    beforeEach(async () => {
      vi.mocked(instructorsDAO.getInstructors).mockResolvedValue({
        results: [{ instructorId: "inst-1", displayName: "John Doe" }],
      });

      vi.mocked(reservationTypesDAO.getReservationTypes).mockResolvedValue([]);
      vi.mocked(aircraftDAO.getAircraft).mockResolvedValue({
        results: [{ aircraftId: "ac-1", tailNumber: "N12345", model: "172S" }],
      });

      vi.mocked(authDAO.getPilotId).mockReturnValue("pilot-123");

      await scheduler.initialize();
    });

    it("fetches availability and enriches with human-readable names", async () => {
      const mockAvailability = [
        {
          flightInstructorId: "inst-1",
          aircraftId: "ac-1",
          timeBlocks: [
            {
              startAt: "2024-07-15T10:00:00",
              endAt: "2024-07-15T12:00:00",
            },
          ],
        },
      ];

      vi.mocked(availabilityDAO.fetchAvailability).mockResolvedValue(
        mockAvailability
      );

      const params = {
        customerUserGuid: "user-123",
        locationId: 1,
        activityTypeId: "type-1",
        instructors: ["inst-1"],
        aircraftIds: ["ac-1"],
        startDate: "2024-07-15",
        endDate: "2024-07-16",
      };

      const result = await scheduler.getBookableAvailability(params);

      expect(availabilityDAO.fetchAvailability).toHaveBeenCalledWith({
        ...params,
        operatorId: mockOperatorId,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        instructor: "John Doe", // Enriched name
        aircraft: "N12345", // Enriched name
        instructorId: "inst-1",
        aircraftId: "ac-1",
      });

      // Check date/time formatting
      expect(result[0].date).toBeDefined();
      expect(result[0].startTime).toBeDefined();
      expect(result[0].endTime).toBeDefined();
      expect(result[0].startDateTime).toBeInstanceOf(Date);
      expect(result[0].endDateTime).toBeInstanceOf(Date);
    });

    it("handles multiple time blocks for the same instructor/aircraft", async () => {
      const mockAvailability = [
        {
          flightInstructorId: "inst-1",
          aircraftId: "ac-1",
          timeBlocks: [
            {
              startAt: "2024-07-15T10:00:00",
              endAt: "2024-07-15T12:00:00",
            },
            {
              startAt: "2024-07-15T14:00:00",
              endAt: "2024-07-15T16:00:00",
            },
          ],
        },
      ];

      vi.mocked(availabilityDAO.fetchAvailability).mockResolvedValue(
        mockAvailability
      );

      const result = await scheduler.getBookableAvailability({
        customerUserGuid: "user-123",
        locationId: 1,
        activityTypeId: "type-1",
        instructors: ["inst-1"],
        aircraftIds: ["ac-1"],
        startDate: "2024-07-15",
        endDate: "2024-07-16",
      });

      expect(result).toHaveLength(2); // Two time blocks
    });

    it("falls back to ID if instructor name not found", async () => {
      const mockAvailability = [
        {
          flightInstructorId: "unknown-instructor",
          aircraftId: "ac-1",
          timeBlocks: [
            {
              startAt: "2024-07-15T10:00:00",
              endAt: "2024-07-15T12:00:00",
            },
          ],
        },
      ];

      vi.mocked(availabilityDAO.fetchAvailability).mockResolvedValue(
        mockAvailability
      );

      const result = await scheduler.getBookableAvailability({
        customerUserGuid: "user-123",
        locationId: 1,
        activityTypeId: "type-1",
        instructors: ["unknown-instructor"],
        aircraftIds: ["ac-1"],
        startDate: "2024-07-15",
        endDate: "2024-07-16",
      });

      expect(result[0].instructorId).toBe("unknown-instructor"); // Falls back to ID
    });

    it("falls back to ID if aircraft name not found", async () => {
      const mockAvailability = [
        {
          flightInstructorId: "inst-1",
          aircraftId: "unknown-aircraft",
          timeBlocks: [
            {
              startAt: "2024-07-15T10:00:00",
              endAt: "2024-07-15T12:00:00",
            },
          ],
        },
      ];

      vi.mocked(availabilityDAO.fetchAvailability).mockResolvedValue(
        mockAvailability
      );

      const result = await scheduler.getBookableAvailability({
        customerUserGuid: "user-123",
        locationId: 1,
        activityTypeId: "type-1",
        instructors: ["inst-1"],
        aircraftIds: ["unknown-aircraft"],
        startDate: "2024-07-15",
        endDate: "2024-07-16",
      });

      expect(result[0].aircraftId).toBe("unknown-aircraft"); // Falls back to ID
    });
  });

  describe("bookReservation", () => {
    beforeEach(async () => {
      vi.mocked(instructorsDAO.getInstructors).mockResolvedValue({
        results: [],
      });
      vi.mocked(reservationTypesDAO.getReservationTypes).mockResolvedValue([]);
      vi.mocked(aircraftDAO.getAircraft).mockResolvedValue({ results: [] });
      vi.mocked(authDAO.getPilotId).mockReturnValue("pilot-123");

      await scheduler.initialize();
    });

    it("books a reservation successfully", async () => {
      const mockResponse = {
        id: "reservation-123",
        reservationTypeId: "type-1",
        errors: [],
      };

      vi.mocked(reservationsDAO.createReservation).mockResolvedValue(
        mockResponse
      );

      const params = {
        aircraftId: "ac-1",
        instructorId: "inst-1",
        startTime: new Date("2024-07-15T10:00:00"),
        endTime: new Date("2024-07-15T12:00:00"),
        reservationTypeId: "type-1",
        locationId: 1,
      };

      const result = await scheduler.bookReservation(params);

      expect(result).toEqual(mockResponse);
      expect(reservationsDAO.createReservation).toHaveBeenCalledWith({
        aircraftId: "ac-1",
        instructorId: "inst-1",
        start: "2024-07-15T10:00",
        end: "2024-07-15T12:00",
        reservationTypeId: "type-1",
        locationId: 1,
        operatorId: mockOperatorId,
        pilotId: "pilot-123",
      });
    });

    it("formats dates to local timezone ISO string without seconds", async () => {
      vi.mocked(reservationsDAO.createReservation).mockResolvedValue({
        id: "res-1",
        errors: [],
      });

      const params = {
        aircraftId: "ac-1",
        instructorId: "inst-1",
        startTime: new Date("2024-07-15T14:30:45"), // With seconds
        endTime: new Date("2024-07-15T16:30:45"),
        reservationTypeId: "type-1",
        locationId: 1,
      };

      await scheduler.bookReservation(params);

      const call = vi.mocked(reservationsDAO.createReservation).mock
        .calls[0][0];
      expect(call.start).toBe("2024-07-15T14:30"); // No seconds
      expect(call.end).toBe("2024-07-15T16:30");
    });

    it("wraps errors with BOOKING_FAILED code", async () => {
      vi.mocked(reservationsDAO.createReservation).mockRejectedValue(
        new Error("Network error")
      );

      const params = {
        aircraftId: "ac-1",
        instructorId: "inst-1",
        startTime: new Date("2024-07-15T10:00:00"),
        endTime: new Date("2024-07-15T12:00:00"),
        reservationTypeId: "type-1",
        locationId: 1,
      };

      await expect(scheduler.bookReservation(params)).rejects.toThrow(
        "Failed to book reservation: Network error"
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
        customError
      );

      const params = {
        aircraftId: "ac-1",
        instructorId: "inst-1",
        startTime: new Date("2024-07-15T10:00:00"),
        endTime: new Date("2024-07-15T12:00:00"),
        reservationTypeId: "type-1",
        locationId: 1,
      };

      try {
        await scheduler.bookReservation(params);
      } catch (error: any) {
        expect(error.code).toBe("VALIDATION_ERROR"); // Original code preserved
        expect(error.message).toBe("Validation failed");
      }
    });
  });
});
