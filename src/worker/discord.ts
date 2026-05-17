import {
  DiscordPayloadSchema,
  type DiscordPayload,
  type DiscordEmbed,
  type Env,
  type FspMetadata,
} from "./types.js";
import { BookableAvailability } from "../shared/dao/availability.js";
import type { ExistingReservation } from "../shared/dao/existingReservations.js";
import {
  getReservationEnd,
  getReservationStart,
} from "../shared/dao/existingReservations.js";
import {
  createOperatorDateKey,
  DEFAULT_TIMEZONE,
  isOperatorWeekend,
} from "../shared/util/flightTime.js";
import { formatInTimeZone } from "date-fns-tz";
import { createLogger } from "../shared/util/logger.js";

const log = createLogger("discord");

/**
 * Color codes for Discord embeds (based on day of week)
 */
const COLORS = {
  WEEKDAY: 0x3498db, // Blue
  WEEKEND: 0xe74c3c, // Red
  SUCCESS: 0x2ecc71, // Green
};

/**
 * Get color based on day of week
 * @param date - Date object
 * @returns Discord color code
 */
function getColorForDay(instant: Date, timeZone: string): number {
  return isOperatorWeekend(instant, timeZone) ? COLORS.WEEKEND : COLORS.WEEKDAY;
}

/**
 * Create lookup maps for efficient O(1) access during formatting
 * @param metadata - FSP metadata
 * @param existingReservations - Array of existing reservations
 * @returns Object with lookup maps
 */
function createLookupMaps(
  metadata: FspMetadata,
  existingReservations: ExistingReservation[],
  timeZone: string,
): {
  aircraftMap: Map<string, string>;
  instructorMap: Map<string, string>;
  reservationsByDate: Map<string, ExistingReservation>;
} {
  // Create aircraft ID -> tail number map
  const aircraftMap = new Map<string, string>();
  for (const aircraft of metadata.aircraft) {
    aircraftMap.set(aircraft.aircraftId, aircraft.tailNumber);
  }

  // Create instructor ID -> display name map
  const instructorMap = new Map<string, string>();
  for (const instructor of metadata.instructors) {
    instructorMap.set(instructor.instructorId, instructor.displayName);
  }

  // Create date key -> reservation map for conflict checking
  // Date key format: "YYYY-MM-DD" (using local date components)
  const reservationsByDate = new Map<string, ExistingReservation>();
  for (const reservation of existingReservations) {
    const resStart = getReservationStart(reservation, timeZone);
    const dateKey = createOperatorDateKey(resStart, timeZone);
    reservationsByDate.set(dateKey, reservation);
  }

  return { aircraftMap, instructorMap, reservationsByDate };
}

/**
 * Format availability slot for Discord embed field
 * @param slot - Availability slot
 * @param aircraftMap - Map of aircraft ID -> tail number
 * @param instructorMap - Map of instructor ID -> display name
 * @param reservationsByDate - Map of date key -> reservation for conflict checking
 * @returns Formatted string for Discord
 */
function formatSlotField(
  slot: BookableAvailability,
  aircraftMap: Map<string, string>,
  instructorMap: Map<string, string>,
  reservationsByDate: Map<string, ExistingReservation>,
  timeZone: string,
): {
  name: string;
  value: string;
  inline: boolean;
} {
  // Format: "Wed, Jan 15"
  const dateStr = formatInTimeZone(slot.startDateTime, timeZone, "EEE, MMM d");

  // Format: "5:00 PM - 7:00 PM"
  // Use pre-formatted strings from slot to avoid timezone issues and extra formatting
  // (these are already formatted when the slot is created)
  const timeStr = `${slot.startTime} - ${slot.endTime}`;

  // Resolve aircraft ID to tail number using map (O(1) lookup)
  const aircraftName = aircraftMap.get(slot.aircraftId) ?? slot.aircraftId;

  // Resolve instructor ID to name using map (O(1) lookup)
  const instructorName =
    instructorMap.get(slot.instructorId) ?? slot.instructorId;

  // Check if there's an existing booking on the same day using map (O(1) lookup)
  const dateKey = createOperatorDateKey(slot.startDateTime, timeZone);
  const conflictingReservation = reservationsByDate.get(dateKey);

  // Build conflict info if reservation exists
  let conflictInfo = "";
  if (conflictingReservation) {
    const existingStart = getReservationStart(conflictingReservation, timeZone);
    const existingEnd = getReservationEnd(conflictingReservation, timeZone);
    const existingTimeStr = `${formatInTimeZone(existingStart, timeZone, "h:mm a")} - ${formatInTimeZone(existingEnd, timeZone, "h:mm a")}`;
    conflictInfo = `\n⚠️ *You have: ${existingTimeStr}*`;
    if (conflictingReservation.instructor) {
      conflictInfo += `\n   *with ${conflictingReservation.instructor}*`;
    }
    if (conflictingReservation.resource) {
      conflictInfo += `\n   *in ${conflictingReservation.resource}*`;
    }
  }

  return {
    name: dateStr,
    value: `**${timeStr}**\n✈️ ${aircraftName}\n👨‍✈️ ${instructorName}${conflictInfo}`,
    inline: true,
  };
}

/**
 * Create rich embeds for new availability slots
 * @param slots - Array of new availability slots
 * @param metadata - FSP metadata to resolve IDs to names
 * @param existingReservations - Array of existing reservations to check for conflicts
 * @returns Array of Discord embeds
 */
function createAvailabilityEmbeds(
  slots: BookableAvailability[],
  metadata: FspMetadata,
  existingReservations: ExistingReservation[],
  timeZone: string,
): DiscordEmbed[] {
  if (slots.length === 0) {
    return [];
  }

  // Create lookup maps once for O(1) access during formatting
  const { aircraftMap, instructorMap, reservationsByDate } = createLookupMaps(
    metadata,
    existingReservations,
    timeZone,
  );

  // Create embeds (max 10 fields per embed for Discord API limits)
  const embeds: DiscordEmbed[] = [];

  // Split into chunks of 10 for Discord field limits
  for (let i = 0; i < slots.length; i += 10) {
    const chunk = slots.slice(i, i + 10);
    const firstSlot = chunk[0];

    const embed: DiscordEmbed = {
      title:
        i === 0
          ? `🎉 New Flight Slots Available!`
          : `🎉 New Flight Slots (continued)`,
      description:
        i === 0
          ? `Found ${slots.length} new time slot${
              slots.length > 1 ? "s" : ""
            } for scheduling:`
          : undefined,
      color: getColorForDay(firstSlot.startDateTime, timeZone),
      fields: chunk.map((slot) =>
        formatSlotField(
          slot,
          aircraftMap,
          instructorMap,
          reservationsByDate,
          timeZone,
        ),
      ),
      timestamp: new Date().toISOString(),
      footer: {
        text: "Flight Schedule Bro",
      },
    };

    embeds.push(embed);
  }

  return embeds;
}

/**
 * Send availability notification to Discord webhook
 * @param env - Worker environment with webhook URL
 * @param slots - Array of new availability slots to notify about
 * @param metadata - FSP metadata to resolve IDs to names
 * @param existingReservations - Array of existing reservations to show conflicts
 * @throws {Error} - When Discord API request fails
 */
export async function sendAvailabilityNotification(
  env: Env,
  slots: BookableAvailability[],
  metadata: FspMetadata,
  existingReservations: ExistingReservation[] = [],
  timeZone: string = DEFAULT_TIMEZONE,
): Promise<void> {
  if (slots.length === 0) {
    log.debug("No new slots to notify about");
    return;
  }

  const embeds = createAvailabilityEmbeds(
    slots,
    metadata,
    existingReservations,
    timeZone,
  );

  const payload: DiscordPayload = {
    username: "Flight Schedule Bro",
    embeds,
  };

  // Validate payload before sending
  try {
    DiscordPayloadSchema.parse(payload);
  } catch (error) {
    log.error("Failed to validate Discord payload", { error });
    throw new Error(
      `Invalid Discord payload: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      { cause: error },
    );
  }

  try {
    const response = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Discord API error (${response.status}): ${errorText}`);
    }

    log.info("Discord notification sent", { slotCount: slots.length });
  } catch (error) {
    log.error("Failed to send Discord notification", { error });
    throw new Error(
      `Failed to send Discord notification: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      { cause: error },
    );
  }
}

/**
 * Send a simple text notification to Discord (for setup/status messages)
 * @param env - Worker environment with webhook URL
 * @param message - Message to send
 */
export async function sendSimpleNotification(
  env: Env,
  message: string,
): Promise<void> {
  const payload: DiscordPayload = {
    content: message,
    username: "Flight Schedule Bro",
  };

  try {
    DiscordPayloadSchema.parse(payload);

    const response = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Discord API error (${response.status}): ${errorText}`);
    }

    log.info("Simple Discord notification sent");
  } catch (error) {
    log.error("Failed to send simple Discord notification", { error });
  }
}
