import { getInstructors } from "../dao/instructors.js";
import {
  getReservationTypes,
  type ReservationType,
} from "../dao/reservationTypes.js";
import {
  getAircraft,
  isReservableAircraft,
  FSP_NIL_RESOURCE_ID,
} from "../dao/aircraft.js";
import {
  fetchAvailability,
  BookableAvailability,
} from "../dao/availability.js";
import {
  buildUserReservationRequest,
  createReservation,
  ReservationResponse,
  ReservationBookingParams,
} from "../dao/reservations.js";
import { getPilotId } from "../dao/auth.js";
import {
  DEFAULT_TIMEZONE,
  formatFspLocalDateTime,
  formatOperatorDisplayDate,
  formatOperatorDisplayTime,
  parseFspLocal,
} from "../util/flightTime.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("scheduler");

export class SchedulerBLO {
  private timeZone: string;
  private instructorsMap = new Map<string, string>();
  private aircraftMap = new Map<string, string>();
  private reservationTypesMap = new Map<string, ReservationType>();
  private pilotId = "";
  private operatorId: number;

  constructor(operatorId: number, timeZone: string = DEFAULT_TIMEZONE) {
    this.operatorId = operatorId;
    this.timeZone = timeZone;
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

  getAircraftMapEntries() {
    return this.aircraftMap.entries();
  }

  getReservationTypes(): ReservationType[] {
    return Array.from(this.reservationTypesMap.values());
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
      this.reservationTypesMap.set(act.reservationTypeId, act);
    }

    for (const a of aircraft.results.filter(isReservableAircraft)) {
      this.aircraftMap.set(a.aircraftId, a.tailNumber.trim());
    }
    log.info("Scheduler initialized");
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
    lengthOfReservationInMinutes?: number;
  }): Promise<BookableAvailability[]> {
    const reservationType = this.reservationTypesMap.get(params.activityTypeId);
    const results = await fetchAvailability({
      customerUserGuid: params.customerUserGuid,
      locationId: params.locationId,
      activityTypeId: params.activityTypeId,
      instructors: params.instructors,
      aircraftIds: params.aircraftIds,
      startDate: params.startDate,
      endDate: params.endDate,
      operatorId: this.operatorId,
      timeZone: this.timeZone,
      lengthOfReservationInMinutes:
        params.lengthOfReservationInMinutes ?? reservationType?.defaultLength,
    });

    const bookableResults: BookableAvailability[] = [];

    for (const result of results) {
      for (const timeBlock of result.timeBlocks) {
        const startDateTime = parseFspLocal(timeBlock.startAt, this.timeZone);
        const endDateTime = parseFspLocal(timeBlock.endAt, this.timeZone);
        const instructorId = result.flightInstructorId ?? FSP_NIL_RESOURCE_ID;
        const aircraftId = result.aircraftId ?? FSP_NIL_RESOURCE_ID;

        bookableResults.push({
          date: formatOperatorDisplayDate(startDateTime, this.timeZone),
          startTime: formatOperatorDisplayTime(startDateTime, this.timeZone),
          endTime: formatOperatorDisplayTime(endDateTime, this.timeZone),
          instructorId,
          aircraftId,
          instructor:
            instructorId === FSP_NIL_RESOURCE_ID
              ? undefined
              : (this.instructorsMap.get(instructorId) ??
                `Instructor ${instructorId}`),
          aircraft:
            aircraftId === FSP_NIL_RESOURCE_ID
              ? undefined
              : (this.aircraftMap.get(aircraftId) ?? `Aircraft ${aircraftId}`),
          startDateTime,
          endDateTime,
        });
      }
    }

    return bookableResults;
  }

  /**
   * Book a reservation with validation
   * @param params - Reservation booking parameters
   * @returns Promise<ReservationResponse> - The reservation response
   * @throws {Error} - When booking fails
   */
  async bookReservation(
    params: ReservationBookingParams,
  ): Promise<ReservationResponse> {
    try {
      // Construct the reservation request using CONFIG values and stored pilot ID
      const reservationRequest = buildUserReservationRequest({
        reservationType: params.reservationType,
        aircraftId: params.aircraftId,
        instructorId: params.instructorId,
        end: formatFspLocalDateTime(params.endTime, this.timeZone),
        start: formatFspLocalDateTime(params.startTime, this.timeZone),
        locationId: params.locationId,
        operatorId: this.operatorId,
        pilotId: this.pilotId,
      });

      return await createReservation(
        params.reservationType,
        reservationRequest,
      );
    } catch (error) {
      // If error already has a code property, re-throw it
      if (error instanceof Error && "code" in error) {
        throw error;
      }

      // Wrap other errors with code
      const err = new Error(
        `Failed to book reservation: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      (err as Error & { code: string }).code = "BOOKING_FAILED";
      throw err;
    }
  }
}
