import { type ReservationType } from "../dao/reservationTypes.js";
import { fetchFspMetadata, type FspMetadata } from "./fspMetadata.js";
import { BookableAvailability } from "../dao/availability.js";
import { fetchScheduleDay } from "../dao/schedule.js";
import {
  buildScheduleFilterIds,
  computeBookableAvailabilityFromSnapshot,
} from "./scheduleAvailability.js";
import {
  buildUserReservationRequest,
  createReservation,
  ReservationResponse,
  ReservationBookingParams,
} from "../dao/reservations.js";
import { getPilotId, getAuthSession } from "../dao/auth.js";
import { FspHttpError } from "../dao/api_wrapper.js";
import {
  DEFAULT_TIMEZONE,
  formatFspLocalDateTime,
} from "../util/flightTime.js";
import { createLogger } from "../util/logger.js";
import {
  BOOKING_MIN_LEAD_HOURS,
  isSlotStartTooSoonForBooking,
} from "../util/slots.js";
import type { SubrequestBudget } from "../util/subrequestBudget.js";

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

  getTimeZone(): string {
    return this.timeZone;
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

  getInstructorMapEntries() {
    return this.instructorsMap.entries();
  }

  getOperatorId(): number {
    return this.operatorId;
  }

  getReservationTypes(): ReservationType[] {
    return Array.from(this.reservationTypesMap.values());
  }

  hydrateFromMetadata(metadata: FspMetadata): void {
    this.instructorsMap.clear();
    this.aircraftMap.clear();
    this.reservationTypesMap.clear();

    for (const instructor of metadata.instructors) {
      this.instructorsMap.set(instructor.instructorId, instructor.displayName);
    }

    for (const reservationType of metadata.reservationTypes) {
      this.reservationTypesMap.set(
        reservationType.reservationTypeId,
        reservationType,
      );
    }

    for (const aircraft of metadata.aircraft) {
      this.aircraftMap.set(aircraft.aircraftId, aircraft.tailNumber);
    }

    const session = getAuthSession();
    if (session) {
      this.pilotId = session.pilotId;
    }
  }

  async initialize() {
    const metadata = await fetchFspMetadata(this.operatorId);
    this.hydrateFromMetadata(metadata);
    if (!this.pilotId) {
      this.pilotId = getPilotId();
    }
    log.info("Scheduler initialized");
  }

  /**
   * Get bookable availability from the FSP Schedule v2 grid snapshot.
   */
  async getBookableAvailability(params: {
    locationId: number;
    activityTypeId: string;
    aircraftIds: string[];
    instructorIds: string[];
    startDate: string;
    lengthOfReservationInMinutes?: number;
    budget?: SubrequestBudget;
  }): Promise<BookableAvailability[]> {
    const result = await this.getBookableAvailabilityForDay(params);
    return result.availability;
  }

  async getBookableAvailabilityForDay(params: {
    locationId: number;
    activityTypeId: string;
    aircraftIds: string[];
    instructorIds: string[];
    startDate: string;
    lengthOfReservationInMinutes?: number;
    budget?: SubrequestBudget;
  }): Promise<{ availability: BookableAvailability[]; complete: boolean }> {
    const reservationType = this.reservationTypesMap.get(params.activityTypeId);
    const durationMinutes =
      params.lengthOfReservationInMinutes ??
      reservationType?.defaultLength ??
      120;

    const filters = buildScheduleFilterIds(
      params.aircraftIds,
      params.instructorIds,
    );

    const { snapshot, complete } = await fetchScheduleDay({
      operatorId: this.operatorId,
      locationId: params.locationId,
      start: params.startDate,
      timeZone: this.timeZone,
      aircraftIds: filters.aircraftIds,
      instructorIds: filters.instructorIds,
      reservationTypeIds: filters.reservationTypeIds,
      budget: params.budget,
    });

    if (!reservationType || !complete) {
      return { availability: [], complete: false };
    }

    return {
      availability: computeBookableAvailabilityFromSnapshot({
        snapshot,
        day: params.startDate,
        timeZone: this.timeZone,
        reservationType,
        aircraftIds: params.aircraftIds,
        instructorIds: params.instructorIds,
        durationMinutes,
        instructorsMap: this.instructorsMap,
        aircraftMap: this.aircraftMap,
      }),
      complete: true,
    };
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
      if (isSlotStartTooSoonForBooking(params.startTime)) {
        const err = new Error(
          `Cannot book reservations within ${BOOKING_MIN_LEAD_HOURS} hours of start time`,
        );
        (err as Error & { code: string }).code = "BOOKING_TOO_SOON";
        throw err;
      }

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
        params.flightDetails,
        params.overrideExceptions ? { overrideExceptions: true } : undefined,
      );
    } catch (error) {
      if (error instanceof FspHttpError) {
        throw error;
      }

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
