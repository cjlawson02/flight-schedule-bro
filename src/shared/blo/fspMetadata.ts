import { z } from "zod";
import {
  AircraftMetadataSchema,
  getAircraft,
  isReservableAircraft,
} from "../dao/aircraft.js";
import {
  getInstructors,
  InstructorMetadataSchema,
} from "../dao/instructors.js";
import {
  getReservationTypes,
  ReservationTypeSchema,
} from "../dao/reservationTypes.js";

export const FspMetadataSchema = z.object({
  instructors: z.array(InstructorMetadataSchema),
  reservationTypes: z.array(ReservationTypeSchema),
  aircraft: z.array(AircraftMetadataSchema),
  lastUpdated: z.iso.datetime(),
});

export type FspMetadata = z.infer<typeof FspMetadataSchema>;

export async function fetchFspMetadata(
  operatorId: number,
): Promise<FspMetadata> {
  const [instructors, reservationTypes, aircraft] = await Promise.all([
    getInstructors(operatorId),
    getReservationTypes(operatorId),
    getAircraft(operatorId),
  ]);

  return {
    instructors: instructors.results.map((i) => ({
      instructorId: i.instructorId,
      displayName: i.displayName,
    })),
    reservationTypes,
    aircraft: aircraft.results.filter(isReservableAircraft).map((a) => ({
      aircraftId: a.aircraftId,
      tailNumber: a.tailNumber.trim(),
    })),
    lastUpdated: new Date().toISOString(),
  };
}
