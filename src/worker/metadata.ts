import { reservationTypeMissingFieldMetadata } from "../shared/dao/reservationTypes.js";
import {
  fetchFspMetadata,
  FspMetadataSchema,
  type FspMetadata,
} from "../shared/blo/fspMetadata.js";
import { createLogger } from "../shared/util/logger.js";
import { recordActiveKvSubrequest } from "../shared/util/subrequestBudget.js";

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
    recordActiveKvSubrequest();
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
    recordActiveKvSubrequest();
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
  const metadata = await fetchFspMetadata(operatorId);
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
  options: { allowApiRefresh?: boolean } = {},
): Promise<FspMetadata> {
  const allowApiRefresh = options.allowApiRefresh ?? true;

  // Try to get from KV first
  const metadata = await getMetadataFromKV(kv);

  if (metadata) {
    if (metadataNeedsRefresh(metadata)) {
      if (!allowApiRefresh) {
        log.warn(
          "Cached metadata is missing reservation type fields; using stale cache (run /refresh-metadata)",
        );
        return metadata;
      }

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

  if (!allowApiRefresh) {
    throw new Error(
      "No metadata in KV. Run /refresh-metadata before scheduled monitoring.",
    );
  }

  log.info("No metadata in KV, fetching from API");
  return await refreshMetadata(operatorId, kv);
}
