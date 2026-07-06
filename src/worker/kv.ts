import {
  SnapshotSchema,
  type Snapshot,
  type Metadata,
  type Env,
} from "./types.js";
import {
  BookableAvailability,
  type BookableAvailabilityKV,
} from "../shared/dao/availability.js";
import {
  DEFAULT_TIMEZONE,
  formatOperatorIsoDate,
  startOfOperatorDay,
} from "../shared/util/flightTime.js";
import { recordActiveKvSubrequest } from "../shared/util/subrequestBudget.js";
import { createLogger } from "../shared/util/logger.js";

const log = createLogger("kv");

const SNAPSHOT_KEY = "availability_snapshot";

/**
 * Convert BookableAvailability to KV-storable format (with Date objects as ISO strings)
 */
function serializeAvailability(
  availability: BookableAvailability,
): BookableAvailabilityKV {
  return {
    ...availability,
    startDateTime: availability.startDateTime.toISOString(),
    endDateTime: availability.endDateTime.toISOString(),
  };
}

/**
 * Convert KV-stored format back to BookableAvailability (with ISO strings as Date objects)
 */
function deserializeAvailability(
  availabilityKV: BookableAvailabilityKV,
): BookableAvailability {
  return {
    ...availabilityKV,
    startDateTime: new Date(availabilityKV.startDateTime),
    endDateTime: new Date(availabilityKV.endDateTime),
  };
}

/**
 * Get the complete snapshot from KV
 * @param env - Worker environment with KV binding
 * @returns Snapshot object or null if not found
 */
export async function getSnapshot(env: Env): Promise<Snapshot | null> {
  recordActiveKvSubrequest();
  const raw = await env.FSP_AVAILABILITY_KV.get(SNAPSHOT_KEY, "text");

  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    const validated = SnapshotSchema.parse(parsed);
    return validated;
  } catch (error) {
    log.error("Failed to parse snapshot from KV", { error });
    throw new Error(
      `Invalid snapshot data in KV: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      { cause: error },
    );
  }
}

/**
 * Store a complete snapshot in KV
 * @param env - Worker environment with KV binding
 * @param slots - Array of availability slots to store
 * @param metadata - Metadata about the snapshot
 */
export async function setSnapshot(
  env: Env,
  slots: BookableAvailability[],
  metadata: Metadata,
): Promise<void> {
  // Serialize slots to KV-storable format
  const serializedSlots = slots.map(serializeAvailability);

  const snapshot: Snapshot = {
    slots: serializedSlots,
    metadata,
  };

  // Validate before storing
  try {
    SnapshotSchema.parse(snapshot);
  } catch (error) {
    log.error("Failed to validate snapshot before storing", { error });
    throw new Error(
      `Invalid snapshot data: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      { cause: error },
    );
  }

  await putSnapshot(env, snapshot);
}

async function putSnapshot(env: Env, snapshot: Snapshot): Promise<void> {
  recordActiveKvSubrequest();
  await env.FSP_AVAILABILITY_KV.put(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

/**
 * Get all availability slots from a snapshot, converted to BookableAvailability objects
 * @param snapshot - Snapshot object (can be null)
 * @returns Array of BookableAvailability or empty array if snapshot is null
 */
export function getSlotsFromSnapshot(
  snapshot: Snapshot | null,
): BookableAvailability[] {
  if (!snapshot) {
    return [];
  }

  return snapshot.slots.map(deserializeAvailability);
}

/**
 * Remove availability slots that are in the past from a snapshot (in-memory operation)
 * @param snapshot - Snapshot object to clean
 * @param beforeInstant - Remove slots that start before this instant
 * @returns Cleaned snapshot with past slots removed, or null if snapshot was null
 */
export function cleanPastSlotsFromSnapshot(
  snapshot: Snapshot | null,
  beforeInstant: Date,
  _timeZone: string = DEFAULT_TIMEZONE,
): Snapshot | null {
  if (!snapshot) {
    return null;
  }

  const cutoffMs = beforeInstant.getTime();
  const filteredSlots = snapshot.slots.filter((slot) => {
    const slotStartMs = new Date(slot.startDateTime).getTime();
    return slotStartMs >= cutoffMs;
  });

  return {
    slots: filteredSlots,
    metadata: snapshot.metadata,
  };
}

/**
 * Initialize or reset the snapshot (used during setup)
 * @param env - Worker environment with KV binding
 * @param slots - Initial availability slots
 * @param trackedThroughDate - Last calendar day fully searched
 */
export async function initializeSnapshot(
  env: Env,
  slots: BookableAvailability[],
  trackedThroughDate: string,
  timeZone: string = DEFAULT_TIMEZONE,
): Promise<void> {
  const now = new Date();
  const todayISO = formatOperatorIsoDate(
    startOfOperatorDay(now, timeZone),
    timeZone,
  );

  const metadata: Metadata = {
    lastSearchDate: todayISO,
    lastUpdate: now.toISOString(),
    trackedThroughDate,
  };

  await setSnapshot(env, slots, metadata);
}
