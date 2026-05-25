import { reservationTypeMissingFieldMetadata } from "../shared/dao/reservationTypes.js";
import { FspMetadataSchema, type FspMetadata } from "./types.js";
import { getInstructors } from "../shared/dao/instructors.js";
import { getReservationTypes } from "../shared/dao/reservationTypes.js";
import { getAircraft, isReservableAircraft } from "../shared/dao/aircraft.js";
import { createLogger } from "../shared/util/logger.js";

const log = createLogger("metadata");

const METADATA_KEY = "fsp-metadata";

export function metadataNeedsRefresh(metadata: FspMetadata): boolean {
  return metadata.reservationTypes.some(reservationTypeMissingFieldMetadata);
}

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
      log.error("Invalid metadata in KV", { zodError: parsed.error });
      return null;
    }

    return parsed.data;
  } catch (error) {
    log.error("Failed to fetch metadata from KV", { error });
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
    log.info("Metadata stored in KV");
  } catch (error) {
    log.error("Failed to store metadata in KV", { error });
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
  log.info("Fetching fresh metadata from FSP API");

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
    reservationTypes,
    aircraft: aircraft.results.filter(isReservableAircraft).map((a) => ({
      aircraftId: a.aircraftId,
      tailNumber: a.tailNumber.trim(),
    })),
    lastUpdated: new Date().toISOString(),
  };

  // Store in KV
  await setMetadataInKV(kv, metadata);

  log.info("Metadata refreshed", {
    instructors: metadata.instructors.length,
    reservationTypes: metadata.reservationTypes.length,
    aircraft: metadata.aircraft.length,
  });

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
    if (metadataNeedsRefresh(metadata)) {
      log.info(
        "Cached metadata is missing reservation type fields, refreshing",
      );
      return await refreshMetadata(operatorId, kv);
    }

    log.info("Using cached metadata from KV", {
      lastUpdated: metadata.lastUpdated,
    });
    return metadata;
  }

  log.info("No metadata in KV, fetching from API");
  return await refreshMetadata(operatorId, kv);
}
