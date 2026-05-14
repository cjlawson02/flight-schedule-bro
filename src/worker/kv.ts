import {
  SnapshotSchema,
  MetadataSchema,
  type Snapshot,
  type Metadata,
  type BookableAvailabilityKV,
  type Env,
} from "./types.js";
import { BookableAvailability } from "../shared/dao/availability.js";

const SNAPSHOT_KEY = "availability_snapshot";

/**
 * Convert BookableAvailability to KV-storable format (with Date objects as ISO strings)
 */
function serializeAvailability(
  availability: BookableAvailability
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
  availabilityKV: BookableAvailabilityKV
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
  const raw = await env.FSP_AVAILABILITY_KV.get(SNAPSHOT_KEY, "text");

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const validated = SnapshotSchema.parse(parsed);
    return validated;
  } catch (error) {
    console.error("Failed to parse snapshot from KV:", error);
    throw new Error(
      `Invalid snapshot data in KV: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
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
  metadata: Metadata
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
    console.error("Failed to validate snapshot before storing:", error);
    throw new Error(
      `Invalid snapshot data: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }

  await env.FSP_AVAILABILITY_KV.put(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

/**
 * Get all availability slots from a snapshot, converted to BookableAvailability objects
 * @param snapshot - Snapshot object (can be null)
 * @returns Array of BookableAvailability or empty array if snapshot is null
 */
export function getSlotsFromSnapshot(
  snapshot: Snapshot | null
): BookableAvailability[] {
  if (!snapshot) {
    return [];
  }

  return snapshot.slots.map(deserializeAvailability);
}

/**
 * Get all availability slots from the snapshot, converted to BookableAvailability objects
 * @param env - Worker environment with KV binding
 * @returns Array of BookableAvailability or empty array if not found
 */
export async function getSlots(env: Env): Promise<BookableAvailability[]> {
  const snapshot = await getSnapshot(env);
  return getSlotsFromSnapshot(snapshot);
}

/**
 * Remove availability slots that are in the past from a snapshot (in-memory operation)
 * @param snapshot - Snapshot object to clean
 * @param beforeDate - Remove slots before this date (typically today)
 * @returns Cleaned snapshot with past slots removed, or null if snapshot was null
 */
export function cleanPastSlotsFromSnapshot(
  snapshot: Snapshot | null,
  beforeDate: Date
): Snapshot | null {
  if (!snapshot) {
    return null;
  }

  // Filter out past slots
  const filteredSlots = snapshot.slots.filter((slot) => {
    const slotDate = new Date(slot.startDateTime);
    return slotDate >= beforeDate;
  });

  return {
    slots: filteredSlots,
    metadata: snapshot.metadata,
  };
}

/**
 * Remove availability slots that are in the past
 * @param env - Worker environment with KV binding
 * @param beforeDate - Remove slots before this date (typically today)
 */
export async function cleanPastSlots(
  env: Env,
  beforeDate: Date
): Promise<void> {
  const snapshot = await getSnapshot(env);

  if (!snapshot) {
    return;
  }

  const cleanedSnapshot = cleanPastSlotsFromSnapshot(snapshot, beforeDate);

  if (cleanedSnapshot) {
    // Update snapshot with cleaned slots
    await setSnapshot(
      env,
      cleanedSnapshot.slots.map(deserializeAvailability),
      cleanedSnapshot.metadata
    );
  }
}

/**
 * Initialize or reset the snapshot (used during setup)
 * @param env - Worker environment with KV binding
 * @param slots - Initial availability slots
 * @param daysAhead - Number of days ahead being tracked
 */
export async function initializeSnapshot(
  env: Env,
  slots: BookableAvailability[],
  daysAhead: number
): Promise<void> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayISO = today.toISOString().split("T")[0];

  const metadata: Metadata = {
    lastSearchDate: todayISO,
    lastUpdate: now.toISOString(),
    daysAhead,
  };

  await setSnapshot(env, slots, metadata);
}
