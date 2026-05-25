import { z } from "zod";
import { safeFetch } from "./api_wrapper.js";

export const AircraftMetadataSchema = z.object({
  aircraftId: z.uuid(),
  tailNumber: z.string(),
});

export type AircraftMetadata = z.infer<typeof AircraftMetadataSchema>;

const AircraftSchema = AircraftMetadataSchema.extend({
  model: z.string(),
});

export type Aircraft = z.infer<typeof AircraftSchema>;

/** FSP nil UUID for optional instructor/aircraft on reservations. */
export const FSP_NIL_RESOURCE_ID = "00000000-0000-0000-0000-000000000000";

/** Skip aircraft-type placeholders returned when includeAircraftTypes=true. */
export function isReservableAircraft(
  aircraft: Pick<Aircraft, "aircraftId" | "tailNumber">,
): boolean {
  return (
    aircraft.aircraftId !== FSP_NIL_RESOURCE_ID &&
    aircraft.tailNumber.trim() !== ""
  );
}

export function nilToOptionalResourceId(id: string): string | undefined {
  return id === FSP_NIL_RESOURCE_ID ? undefined : id;
}

export function selectPreferredAircraftIds(
  aircraft: Pick<AircraftMetadata, "aircraftId" | "tailNumber">[],
  regex: RegExp,
): string[] {
  const preferred = aircraft
    .filter((a) => regex.test(a.tailNumber))
    .map((a) => a.aircraftId);

  return preferred.length > 0 ? preferred : aircraft.map((a) => a.aircraftId);
}

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
