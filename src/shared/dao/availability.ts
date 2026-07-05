import { z } from "zod";

/**
 * Availability interface that includes all booking context
 * Note: Uses UUIDs only. Resolve to human-readable names at display time using metadata.
 */
export interface BookableAvailability {
  date: string;
  startTime: string;
  endTime: string;
  instructorId: string;
  aircraftId: string;
  instructor?: string; // Human-readable instructor name
  aircraft?: string; // Human-readable aircraft name
  startDateTime: Date;
  endDateTime: Date;
}

/** KV-storable subset of BookableAvailability (ISO datetimes, no display names). */
export const BookableAvailabilityKvSchema = z.object({
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  instructorId: z.uuid(),
  aircraftId: z.uuid(),
  startDateTime: z.iso.datetime(),
  endDateTime: z.iso.datetime(),
});

export type BookableAvailabilityKV = z.infer<
  typeof BookableAvailabilityKvSchema
>;

interface TimeSlotGroup {
  date: string;
  startTime: string;
  endTime: string;
  availabilities: BookableAvailability[];
}

export function groupAvailabilitiesByTimeSlot(
  availabilities: BookableAvailability[],
): TimeSlotGroup[] {
  const grouped = new Map<string, TimeSlotGroup>();

  for (const avail of availabilities) {
    const key = `${avail.date}|${avail.startTime}|${avail.endTime}`;
    const group = grouped.get(key);

    if (group) {
      group.availabilities.push(avail);
      continue;
    }

    grouped.set(key, {
      date: avail.date,
      startTime: avail.startTime,
      endTime: avail.endTime,
      availabilities: [avail],
    });
  }

  return Array.from(grouped.values()).sort(
    (a, b) =>
      new Date(`${a.date} ${a.startTime}`).getTime() -
      new Date(`${b.date} ${b.startTime}`).getTime(),
  );
}
