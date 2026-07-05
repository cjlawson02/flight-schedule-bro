import { checkbox, select, confirm, input } from "@inquirer/prompts";
import {
  selectPreferredAircraftIds,
  type AircraftMetadata,
} from "../dao/aircraft.js";
import { selectPreferredInstructorIds } from "../dao/instructors.js";
import type { ReservationType } from "../dao/reservationTypes.js";
import { getFieldState, pickReservationType } from "../dao/reservationTypes.js";
import {
  FLIGHT_RULES_IFR,
  FLIGHT_RULES_VFR,
  FLIGHT_TYPE_CROSS_COUNTRY,
  FLIGHT_TYPE_LOCAL,
  type ActivityFlightDetails,
} from "../dao/reservationFlightDetails.js";
import {
  groupAvailabilitiesByTimeSlot,
  type BookableAvailability,
} from "../dao/availability.js";
import type { CancellationReason } from "../dao/reservationManagement.js";
import type { ExistingReservation } from "../dao/existingReservations.js";
import {
  getReservationEnd,
  getReservationStart,
} from "../dao/existingReservations.js";
import {
  formatOperatorDisplayDate,
  formatOperatorDisplayTime,
} from "../util/flightTime.js";

export type CliMainAction = "book" | "manage-existing-activity" | "exit";
export type ManageActivityAction = "change-activity-type" | "cancel" | "back";

/** Common reservation lengths offered in the CLI duration prompt (minutes). */
export const CLI_DURATION_OPTIONS_MINUTES = [180, 150, 120, 90, 60, 45, 30];

export function formatDurationChoice(minutes: number): string {
  const wholeHours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (remainder === 0) {
    return wholeHours === 1 ? "1 hour" : `${wholeHours} hours`;
  }

  if (remainder === 30 && wholeHours > 0) {
    return `${wholeHours}.5 hours`;
  }

  return `${minutes} minutes`;
}

export function buildDurationChoices(
  defaultLength: number,
): { name: string; value: number }[] {
  const optionSet = new Set([defaultLength, ...CLI_DURATION_OPTIONS_MINUTES]);

  return [...optionSet]
    .sort((a, b) => b - a)
    .map((minutes) => ({
      name: formatDurationChoice(minutes),
      value: minutes,
    }));
}

export function buildTailNumberChoices(
  aircraft: Pick<AircraftMetadata, "aircraftId" | "tailNumber">[],
  defaultSelectedIds: string[],
): { name: string; value: string; checked?: boolean }[] {
  const selected = new Set(defaultSelectedIds);

  return [...aircraft]
    .sort((a, b) => a.tailNumber.localeCompare(b.tailNumber))
    .map((entry) => ({
      name: entry.tailNumber,
      value: entry.aircraftId,
      checked: selected.has(entry.aircraftId),
    }));
}

export function buildInstructorChoices(
  instructors: { instructorId: string; displayName: string }[],
  defaultSelectedIds: string[],
): { name: string; value: string; checked?: boolean }[] {
  const selected = new Set(defaultSelectedIds);

  return [...instructors]
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((entry) => ({
      name: entry.displayName,
      value: entry.instructorId,
      checked: selected.has(entry.instructorId),
    }));
}

/**
 * Interactive CLI utility for user interaction during booking flow
 * Uses Inquirer.js for cross-platform terminal prompts
 */
export class InteractiveCLI {
  /**
   * Format a date string with day of week and no year (e.g., "Mon 11/4")
   */
  private formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayOfWeek = days[date.getDay()];
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${dayOfWeek} ${month}/${day}`;
  }

  /**
   * Format time string, removing :00 seconds and minutes unless necessary
   * Examples: "5:00:00 PM" → "5 PM", "5:30:00 PM" → "5:30 PM"
   */
  private formatTime(timeStr: string): string {
    // Remove seconds (:00 at the end before AM/PM)
    let formatted = timeStr.replace(/:00 (AM|PM)/, " $1");
    // Remove :00 minutes if present (e.g., "5:00 PM" → "5 PM")
    formatted = formatted.replace(/(\d+):00 (AM|PM)/, "$1 $2");
    return formatted;
  }

  /**
   * Format a row using the same columns as time slot selection.
   */
  private formatActivityRow(
    date: string,
    startTime: string,
    endTime: string,
    aircraft: string,
    instructor: string,
  ): string {
    const formattedDate = this.formatDate(date);
    const formattedStart = this.formatTime(startTime);
    const formattedEnd = this.formatTime(endTime);

    return `${formattedDate.padEnd(12)} │ ${(
      formattedStart +
      " - " +
      formattedEnd
    ).padEnd(20)} │ ${aircraft.padEnd(20)} │ ${instructor}`;
  }

  formatExistingActivity(
    reservation: ExistingReservation,
    timeZone: string,
  ): string {
    const start = getReservationStart(reservation, timeZone);
    const end = getReservationEnd(reservation, timeZone);

    return this.formatActivityAtTime(
      start,
      end,
      timeZone,
      reservation.resource ?? "—",
      reservation.instructor ?? "—",
    );
  }

  formatActivityAtTime(
    start: Date,
    end: Date,
    timeZone: string,
    aircraft: string,
    instructor: string,
  ): string {
    return this.formatActivityRow(
      formatOperatorDisplayDate(start, timeZone),
      formatOperatorDisplayTime(start, timeZone),
      formatOperatorDisplayTime(end, timeZone),
      aircraft,
      instructor,
    );
  }

  /**
   * Format a time slot group for display with columns and borders
   */
  private formatTimeSlot(group: {
    date: string;
    startTime: string;
    endTime: string;
    availabilities: BookableAvailability[];
  }): string {
    const instructorList = [
      ...new Set(group.availabilities.map((a) => a.instructor)),
    ].join(", ");
    const aircraftList = [
      ...new Set(group.availabilities.map((a) => a.aircraft)),
    ].join(", ");

    return this.formatActivityRow(
      group.date,
      group.startTime,
      group.endTime,
      aircraftList,
      instructorList,
    );
  }

  private buildTimeSlotChoices(availabilities: BookableAvailability[]) {
    const timeSlotGroups = groupAvailabilitiesByTimeSlot(availabilities);

    return {
      timeSlotGroups,
      choices: timeSlotGroups.map((group, index) => ({
        name: this.formatTimeSlot(group),
        value: index,
      })),
    };
  }

  /**
   * Multi-select interface for choosing time slots
   * Uses space bar to toggle selections, enter to confirm
   */
  async selectMultipleTimeSlots(
    availabilities: BookableAvailability[],
  ): Promise<BookableAvailability[]> {
    if (availabilities.length === 0) {
      console.log("\nNo availability found to book.");
      return [];
    }

    const { timeSlotGroups, choices } =
      this.buildTimeSlotChoices(availabilities);

    try {
      const selectedIndices = await checkbox({
        message: "Select time slots to book",
        choices,
        pageSize: 15, // Shows 15 items, auto-scrolls for more
        loop: false, // Don't wrap around when reaching top/bottom
      });

      // Flatten selected groups back to individual availabilities
      const selectedAvailabilities: BookableAvailability[] = [];
      for (const index of selectedIndices) {
        selectedAvailabilities.push(...timeSlotGroups[index].availabilities);
      }

      return selectedAvailabilities;
    } catch {
      // User cancelled (Ctrl+C)
      return [];
    }
  }

  /**
   * Single-select interface for choosing an aircraft
   * Uses arrow keys to navigate, enter to confirm
   */
  async selectAircraft(
    timeSlot: BookableAvailability,
    availableOptions: BookableAvailability[],
  ): Promise<string | null> {
    if (availableOptions.length === 0) {
      return null;
    }

    // Get unique aircraft options
    const uniqueAircraft = [
      ...new Set(
        availableOptions
          .map((a) => a.aircraft)
          .filter((aircraft): aircraft is string => aircraft !== undefined),
      ),
    ];

    if (uniqueAircraft.length === 0) {
      return null;
    }

    // If only one aircraft, return it directly (no need to prompt)
    if (uniqueAircraft.length === 1) {
      return uniqueAircraft[0];
    }

    // Format time strings for display
    const formattedDate = this.formatDate(timeSlot.date);
    const formattedStart = this.formatTime(timeSlot.startTime);
    const formattedEnd = this.formatTime(timeSlot.endTime);

    const choices = uniqueAircraft.map((aircraft) => ({
      name: aircraft,
      value: aircraft,
    }));

    try {
      const selectedAircraft = await select({
        message: `Select aircraft for ${formattedDate} ${formattedStart} - ${formattedEnd}`,
        choices,
        pageSize: 15,
        loop: false,
      });

      return selectedAircraft;
    } catch {
      // User cancelled (Ctrl+C)
      return null;
    }
  }

  /**
   * Single-select interface for choosing an instructor
   * Uses arrow keys to navigate, enter to confirm
   */
  async selectInstructor(
    timeSlot: BookableAvailability,
    availableInstructors: BookableAvailability[],
  ): Promise<BookableAvailability | null> {
    if (availableInstructors.length === 0) {
      return null;
    }

    // Get unique instructors (dedupe by instructor name)
    const uniqueInstructors = availableInstructors.filter(
      (avail, index, self) =>
        index === self.findIndex((a) => a.instructor === avail.instructor),
    );

    // If only one option, return it directly (no need to prompt)
    if (uniqueInstructors.length === 1) {
      return uniqueInstructors[0];
    }

    // Format time strings for display
    const formattedDate = this.formatDate(timeSlot.date);
    const formattedStart = this.formatTime(timeSlot.startTime);
    const formattedEnd = this.formatTime(timeSlot.endTime);

    const choices = uniqueInstructors.map((avail, index) => ({
      name: avail.instructor, // Just the instructor name, no aircraft
      value: index,
    }));

    try {
      const selectedIndex = await select({
        message: `Select instructor for ${formattedDate} ${formattedStart} - ${formattedEnd} (${timeSlot.aircraft})`,
        choices,
        pageSize: 15,
        loop: false,
      });

      return uniqueInstructors[selectedIndex];
    } catch {
      // User cancelled (Ctrl+C)
      return null;
    }
  }

  /**
   * Main menu for choosing between booking or managing existing activities.
   */
  async selectMainAction(): Promise<CliMainAction | null> {
    try {
      return await select({
        message: "What do you want to do?",
        choices: [
          { name: "Book a new activity", value: "book" },
          {
            name: "Manage existing activity",
            value: "manage-existing-activity",
          },
          { name: "Exit", value: "exit" },
        ],
        loop: false,
      });
    } catch {
      return null;
    }
  }

  /**
   * Select reservation duration in minutes.
   */
  async selectDurationMinutes(
    reservationType: ReservationType,
  ): Promise<number | null> {
    const choices = buildDurationChoices(reservationType.defaultLength);

    try {
      return await select({
        message: "Duration",
        choices,
        loop: false,
        default: reservationType.defaultLength,
      });
    } catch {
      return null;
    }
  }

  /**
   * Multi-select interface for choosing instructors to search.
   */
  async selectInstructors(
    instructors: { instructorId: string; displayName: string }[],
    preferredRegex: RegExp,
  ): Promise<string[] | null> {
    if (instructors.length === 0) {
      return null;
    }

    const defaultSelectedIds = selectPreferredInstructorIds(
      instructors,
      preferredRegex,
    );
    const choices = buildInstructorChoices(instructors, defaultSelectedIds);

    try {
      return await checkbox({
        message: "Instructors",
        choices,
        pageSize: 15,
        loop: false,
        validate: (selected) =>
          selected.length > 0 || "Select at least one instructor",
      });
    } catch {
      return null;
    }
  }

  /**
   * Multi-select interface for choosing tail numbers to search.
   */
  async selectTailNumbers(
    aircraft: Pick<AircraftMetadata, "aircraftId" | "tailNumber">[],
    preferredRegex: RegExp,
  ): Promise<string[] | null> {
    if (aircraft.length === 0) {
      return null;
    }

    const defaultSelectedIds = selectPreferredAircraftIds(
      aircraft,
      preferredRegex,
    );
    const choices = buildTailNumberChoices(aircraft, defaultSelectedIds);

    try {
      return await checkbox({
        message: "Tail numbers",
        choices,
        pageSize: 15,
        loop: false,
        validate: (selected) =>
          selected.length > 0 || "Select at least one tail number",
      });
    } catch {
      return null;
    }
  }

  /**
   * Select a reservation type for booking or search.
   */
  async selectReservationType(
    reservationTypes: ReservationType[],
    options?: { preferredTypeId?: string; excludeTypeIds?: string[] },
  ): Promise<ReservationType | null> {
    const excluded = new Set(options?.excludeTypeIds ?? []);
    const availableTypes = reservationTypes.filter(
      (type) => !excluded.has(type.reservationTypeId),
    );

    if (availableTypes.length === 0) {
      return null;
    }

    const preferred = pickReservationType(
      availableTypes,
      options?.preferredTypeId,
    );

    const choices = availableTypes.map((type) => ({
      name: type.reservationTypeName,
      value: type.reservationTypeId,
    }));

    try {
      const selectedId = await select({
        message: "Select activity type:",
        choices,
        loop: false,
        default: preferred?.reservationTypeId,
      });

      return (
        availableTypes.find((type) => type.reservationTypeId === selectedId) ??
        null
      );
    } catch {
      return null;
    }
  }

  async selectExistingActivity(
    reservations: ExistingReservation[],
    timeZone: string,
  ): Promise<ExistingReservation | null> {
    if (reservations.length === 0) {
      console.log("\nNo existing activities.");
      return null;
    }

    const choices = reservations.map((reservation) => ({
      name: this.formatExistingActivity(reservation, timeZone),
      value: reservation.reservationId,
    }));

    try {
      const selectedId = await select({
        message: "Select an activity",
        choices: [...choices, { name: "Back", value: "__back__" }],
        pageSize: 15,
        loop: false,
      });

      if (selectedId === "__back__") {
        return null;
      }

      return (
        reservations.find(
          (reservation) => reservation.reservationId === selectedId,
        ) ?? null
      );
    } catch {
      return null;
    }
  }

  async selectManageActivityAction(): Promise<ManageActivityAction | null> {
    try {
      return await select({
        message: "What would you like to do with this activity?",
        choices: [
          { name: "Change activity type", value: "change-activity-type" },
          { name: "Cancel activity", value: "cancel" },
          { name: "Back", value: "back" },
        ],
        loop: false,
      });
    } catch {
      return null;
    }
  }

  async collectActivityFlightDetails(
    reservationType: ReservationType,
  ): Promise<ActivityFlightDetails | null> {
    const details: ActivityFlightDetails = {};

    if (getFieldState(reservationType, "flightType").enabled) {
      try {
        details.flightType = await select({
          message: "Flight type:",
          choices: [
            { name: "Local", value: FLIGHT_TYPE_LOCAL },
            { name: "Cross Country", value: FLIGHT_TYPE_CROSS_COUNTRY },
          ],
          loop: false,
        });
      } catch {
        return null;
      }
    }

    if (getFieldState(reservationType, "flightRules").enabled) {
      try {
        details.flightRules = await select({
          message: "Flight rules:",
          choices: [
            { name: "VFR", value: FLIGHT_RULES_VFR },
            { name: "IFR", value: FLIGHT_RULES_IFR },
          ],
          loop: false,
        });
      } catch {
        return null;
      }
    }

    if (getFieldState(reservationType, "flightHours").enabled) {
      const required = getFieldState(reservationType, "flightHours").required;
      const estimatedFlightHours = await this.promptText(
        required
          ? "Estimated flight hours:"
          : "Estimated flight hours (optional):",
      );
      if (estimatedFlightHours === null) {
        return null;
      }
      details.estimatedFlightHours = estimatedFlightHours.trim();
    }

    if (getFieldState(reservationType, "flightRoute").enabled) {
      const required = getFieldState(reservationType, "flightRoute").required;
      const flightRoute = await this.promptText(
        required ? "Flight route/legs:" : "Flight route/legs (optional):",
      );
      if (flightRoute === null) {
        return null;
      }
      details.flightRoute = flightRoute.trim();
    }

    return details;
  }

  async selectCancellationReason(
    reasons: CancellationReason[],
  ): Promise<CancellationReason | null> {
    try {
      const reasonId = await select({
        message: "Select a cancellation reason:",
        choices: reasons.map((reason) => ({
          name: reason.name,
          value: reason.id,
        })),
        loop: false,
      });

      return reasons.find((reason) => reason.id === reasonId) ?? null;
    } catch {
      return null;
    }
  }

  async promptText(message: string): Promise<string | null> {
    try {
      return await input({ message });
    } catch {
      return null;
    }
  }

  /**
   * Confirmation prompt (Yes/No)
   * Uses arrow keys to navigate, enter to confirm
   */
  async confirmAction(message: string): Promise<boolean> {
    try {
      return await confirm({ message });
    } catch {
      // User cancelled (Ctrl+C)
      return false;
    }
  }
}
