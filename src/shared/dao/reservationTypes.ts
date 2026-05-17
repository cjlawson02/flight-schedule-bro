import { z } from "zod";
import { safeFetch } from "./api_wrapper.js";

const ReservationTypeSchema = z.object({
  reservationTypeId: z.uuid(),
  reservationTypeName: z.string(),
});

const ReservationTypeListSchema = z.array(ReservationTypeSchema);

export async function getReservationTypes(operatorId: number) {
  return await safeFetch(
    `https://api-external.flightschedulepro.com/api/ReservationTypes?includeInactive=false&includeInstructorTimeOff=false&includeMaintenance=false&includeMeeting=false&operatorId=${operatorId}`,
    "GET",
    null,
    ReservationTypeListSchema,
    // 10 days
    10 * 24 * 60 * 60 * 1000,
  );
}
