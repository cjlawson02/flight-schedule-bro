import { getInstructors } from "../dao/instructors.js";
import { getReservationTypes } from "../dao/reservationTypes.js";
import { getAircraft, Aircraft } from "../dao/aircraft.js";
import {
  fetchAvailability,
  BookableAvailability,
} from "../dao/availability.js";
import {
  createReservation,
  UserReservationRequest,
  ReservationResponse,
  ReservationBookingParams,
} from "../dao/reservations.js";
import { getPilotId } from "../dao/auth.js";
import { format } from "date-fns";

export class SchedulerBLO {
  private instructorsMap = new Map<string, string>();
  private aircraftMap = new Map<string, string>();
  private activityTypesMap = new Map<string, string>();
  private pilotId: string = "";
  private operatorId: number;

  constructor(operatorId: number) {
    this.operatorId = operatorId;
  }

  /**
   * Get all instructor IDs
   * @returns Array of instructor IDs
   */
  getInstructorIds(): string[] {
    return Array.from(this.instructorsMap.keys());
  }

  /**
   * Get all aircraft IDs
   * @returns Array of aircraft IDs
   */
  getAircraftIds(): string[] {
    return Array.from(this.aircraftMap.keys());
  }

  /**
   * Get instructor name by ID
   * @param id - Instructor ID
   * @returns Instructor display name or undefined
   */
  getInstructorName(id: string): string | undefined {
    return this.instructorsMap.get(id);
  }

  /**
   * Get aircraft name by ID
   * @param id - Aircraft ID
   * @returns Aircraft display name or undefined
   */
  getAircraftName(id: string): string | undefined {
    return this.aircraftMap.get(id);
  }

  getAircraftMapEntries() {
    return this.aircraftMap.entries();
  }

  getActivityTypesMapEntries() {
    return this.activityTypesMap.entries();
  }

  async initialize() {
    const [instructors, activityTypes, aircraft] = await Promise.all([
      getInstructors(this.operatorId),
      getReservationTypes(this.operatorId),
      getAircraft(this.operatorId),
    ]);

    // Store the correct pilot ID from auth
    this.pilotId = getPilotId();

    for (const i of instructors.results) {
      this.instructorsMap.set(i.instructorId, i.displayName);
    }

    for (const act of activityTypes) {
      this.activityTypesMap.set(act.reservationTypeId, act.reservationTypeName);
    }

    for (const a of aircraft.results) {
      this.aircraftMap.set(a.aircraftId, a.tailNumber.trim()); // Show only callsign
    }
    console.log("Logged in!");
  }

  /**
   * Get enhanced availability results that include booking context
   * @param params - Availability search parameters
   * @returns Promise<BookableAvailability[]> - Enhanced availability with booking context
   */
  async getBookableAvailability(params: {
    customerUserGuid: string;
    locationId: number;
    activityTypeId: string;
    instructors: string[];
    aircraftIds: string[];
    startDate: string;
    endDate: string;
  }): Promise<BookableAvailability[]> {
    const results = await fetchAvailability({
      customerUserGuid: params.customerUserGuid,
      locationId: params.locationId,
      activityTypeId: params.activityTypeId,
      instructors: params.instructors,
      aircraftIds: params.aircraftIds,
      startDate: params.startDate,
      endDate: params.endDate,
      operatorId: this.operatorId,
    });

    const bookableResults: BookableAvailability[] = [];

    for (const result of results) {
      for (const timeBlock of result.timeBlocks) {
        const startDateTime = new Date(timeBlock.startAt);
        const endDateTime = new Date(timeBlock.endAt);

        bookableResults.push({
          date: startDateTime.toLocaleDateString(),
          startTime: startDateTime.toLocaleTimeString(),
          endTime: endDateTime.toLocaleTimeString(),
          instructorId: result.flightInstructorId,
          aircraftId: result.aircraftId,
          instructor: this.instructorsMap.get(result.flightInstructorId) || `Instructor ${result.flightInstructorId}`,
          aircraft: this.aircraftMap.get(result.aircraftId) || `Aircraft ${result.aircraftId}`,
          startDateTime,
          endDateTime,
        });
      }
    }

    return bookableResults;
  }

  /**
   * Format a Date object to local timezone ISO string (YYYY-MM-DDTHH:mm)
   * @param date - The date to format
   * @returns string - Formatted date string in local timezone
   */
  private formatLocalDateTime(date: Date): string {
    return format(date, "yyyy-MM-dd'T'HH:mm");
  }

  /**
   * Book a reservation with validation
   * @param params - Reservation booking parameters
   * @returns Promise<ReservationResponse> - The reservation response
   * @throws {Error} - When booking fails
   */
  async bookReservation(
    params: ReservationBookingParams
  ): Promise<ReservationResponse> {
    try {
      // Construct the reservation request using CONFIG values and stored pilot ID
      const reservationRequest: UserReservationRequest = {
        aircraftId: params.aircraftId,
        end: this.formatLocalDateTime(params.endTime),
        instructorId: params.instructorId,
        locationId: params.locationId,
        operatorId: this.operatorId,
        pilotId: this.pilotId,
        start: this.formatLocalDateTime(params.startTime),
        reservationTypeId: params.reservationTypeId,
      };

      return await createReservation(reservationRequest);
    } catch (error) {
      // If error already has a code property, re-throw it
      if (error instanceof Error && "code" in error) {
        throw error;
      }

      // Wrap other errors with code
      const err = new Error(
        `Failed to book reservation: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      (err as any).code = "BOOKING_FAILED";
      throw err;
    }
  }
}
