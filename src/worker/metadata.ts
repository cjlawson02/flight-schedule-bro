import { FspMetadataSchema, type FspMetadata } from "./types.js";
import { getInstructors } from "../shared/dao/instructors.js";
import { getReservationTypes } from "../shared/dao/reservationTypes.js";
import { getAircraft } from "../shared/dao/aircraft.js";

const METADATA_KEY = "fsp-metadata";

/**
 * Fetch metadata from KV store
 */
export async function getMetadataFromKV(
  kv: KVNamespace,
): Promise<FspMetadata | null> {
  try {
    const data = await kv.get(METADATA_KEY, "json");
    if (!data) {
      return null;
    }

    const parsed = FspMetadataSchema.safeParse(data);
    if (!parsed.success) {
      console.error("Invalid metadata in KV:", parsed.error);
      return null;
    }

    return parsed.data;
  } catch (error) {
    console.error("Failed to fetch metadata from KV:", error);
    return null;
  }
}

/**
 * Store metadata in KV
 */
export async function setMetadataInKV(
  kv: KVNamespace,
  metadata: FspMetadata,
): Promise<void> {
  try {
    // Validate before storing
    const validated = FspMetadataSchema.parse(metadata);
    await kv.put(METADATA_KEY, JSON.stringify(validated));
    console.log("Metadata stored in KV successfully");
  } catch (error) {
    console.error("Failed to store metadata in KV:", error);
    throw error;
  }
}

/**
 * Fetch fresh metadata from FSP API and store in KV
 */
export async function refreshMetadata(
  operatorId: number,
  kv: KVNamespace,
): Promise<FspMetadata> {
  console.log("Fetching fresh metadata from FSP API...");

  const [instructors, reservationTypes, aircraft] = await Promise.all([
    getInstructors(operatorId),
    getReservationTypes(operatorId),
    getAircraft(operatorId),
  ]);

  const metadata: FspMetadata = {
    instructors: instructors.results.map((i) => ({
      instructorId: i.instructorId,
      displayName: i.displayName,
    })),
    reservationTypes: reservationTypes.map((r) => ({
      reservationTypeId: r.reservationTypeId,
      reservationTypeName: r.reservationTypeName,
    })),
    aircraft: aircraft.results
      .filter(
        (a) =>
          a.aircraftId !== "00000000-0000-0000-0000-000000000000" &&
          a.tailNumber.trim() !== "",
      )
      .map((a) => ({
        aircraftId: a.aircraftId,
        tailNumber: a.tailNumber.trim(),
      })),
    lastUpdated: new Date().toISOString(),
  };

  // Store in KV
  await setMetadataInKV(kv, metadata);

  console.log(
    `Metadata refreshed: ${metadata.instructors.length} instructors, ${metadata.reservationTypes.length} types, ${metadata.aircraft.length} aircraft`,
  );

  return metadata;
}

/**
 * Get metadata from KV, or fetch from API if not available
 */
export async function getOrFetchMetadata(
  operatorId: number,
  kv: KVNamespace,
): Promise<FspMetadata> {
  // Try to get from KV first
  const metadata = await getMetadataFromKV(kv);

  if (metadata) {
    console.log(
      `Using cached metadata from KV (last updated: ${metadata.lastUpdated})`,
    );
    return metadata;
  }

  // Fall back to fetching from API
  console.log("No metadata in KV, fetching from API...");
  return await refreshMetadata(operatorId, kv);
}
