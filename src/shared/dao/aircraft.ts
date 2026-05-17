import { z } from "zod";
import { safeFetch } from "./api_wrapper.js";

const AircraftSchema = z.object({
  aircraftId: z.uuid(),
  tailNumber: z.string(),
  model: z.string(),
});

export type Aircraft = z.infer<typeof AircraftSchema>;

const AircraftResponseSchema = z.object({
  results: z.array(AircraftSchema),
});

export async function getAircraft(operatorId: number) {
  return await safeFetch(
    `https://api-external.flightschedulepro.com/api/V2/aircraft?includeSimulators=false&includeAircraftTypes=true&onlyReservable=true&operatorId=${operatorId}&page=1&pageSize=0`,
    "GET",
    null,
    AircraftResponseSchema,
    // 3 days
    3 * 24 * 60 * 60 * 1000,
  );
}
