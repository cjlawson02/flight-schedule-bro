import { checkbox, select, confirm } from "@inquirer/prompts";
import { BookableAvailability } from "../dao/availability.js";

interface TimeSlotGroup {
  date: string;
  startTime: string;
  endTime: string;
  availabilities: BookableAvailability[];
}

/**
 * Interactive CLI utility for user interaction during booking flow
 * Uses Inquirer.js for cross-platform terminal prompts
 */
export class InteractiveCLI {
  /**
   * Group availabilities by time slot for better selection experience
   */
  private groupAvailabilities(
    availabilities: BookableAvailability[]
  ): TimeSlotGroup[] {
    const grouped = new Map<string, TimeSlotGroup>();

    for (const avail of availabilities) {
      const key = `${avail.date}|${avail.startTime}|${avail.endTime}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          date: avail.date,
          startTime: avail.startTime,
          endTime: avail.endTime,
          availabilities: [],
        });
      }

      grouped.get(key)!.availabilities.push(avail);
    }

    return Array.from(grouped.values()).sort(
      (a, b) =>
        new Date(`${a.date} ${a.startTime}`).getTime() -
        new Date(`${b.date} ${b.startTime}`).getTime()
    );
  }

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
   * Format a time slot group for display with columns and borders
   */
  private formatTimeSlot(group: TimeSlotGroup): string {
    // Dedupe instructors for cleaner display
    const instructorList = [
      ...new Set(group.availabilities.map((a) => a.instructor)),
    ].join(", ");
    const aircraftList = [
      ...new Set(group.availabilities.map((a) => a.aircraft)),
    ].join(", ");

    const formattedDate = this.formatDate(group.date);
    const formattedStart = this.formatTime(group.startTime);
    const formattedEnd = this.formatTime(group.endTime);

    return `${formattedDate.padEnd(12)} │ ${(
      formattedStart +
      " - " +
      formattedEnd
    ).padEnd(20)} │ ${aircraftList.padEnd(20)} │ ${instructorList}`;
  }

  /**
   * Multi-select interface for choosing time slots
   * Uses space bar to toggle selections, enter to confirm
   */
  async selectMultipleTimeSlots(
    availabilities: BookableAvailability[]
  ): Promise<BookableAvailability[]> {
    if (availabilities.length === 0) {
      console.log("\nNo availability found to book.");
      return [];
    }

    const timeSlotGroups = this.groupAvailabilities(availabilities);

    // Create choices with group index as value
    const choices = timeSlotGroups.map((group, index) => ({
      name: this.formatTimeSlot(group),
      value: index,
    }));

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
    } catch (error) {
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
    availableOptions: BookableAvailability[]
  ): Promise<string | null> {
    if (availableOptions.length === 0) {
      return null;
    }

    // Get unique aircraft options
    const uniqueAircraft = [
      ...new Set(
        availableOptions
          .map((a) => a.aircraft)
          .filter((aircraft): aircraft is string => aircraft !== undefined)
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
    } catch (error) {
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
    availableInstructors: BookableAvailability[]
  ): Promise<BookableAvailability | null> {
    if (availableInstructors.length === 0) {
      return null;
    }

    // Get unique instructors (dedupe by instructor name)
    const uniqueInstructors = availableInstructors.filter(
      (avail, index, self) =>
        index === self.findIndex((a) => a.instructor === avail.instructor)
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
    } catch (error) {
      // User cancelled (Ctrl+C)
      return null;
    }
  }

  /**
   * Select activity type
   * Prompts user to select from available activity types
   * @param activityTypes - Array of [id, name] tuples
   * @returns Selected activity type name or null if cancelled
   */
  async selectActivityType(
    activityTypes: [string, string][]
  ): Promise<string | null> {
    // Check if there's a "dual" option (case-insensitive)
    const dualOption = activityTypes.find(([, name]) =>
      name.toLowerCase().includes("dual")
    );

    // Build choices
    const choices = activityTypes.map(([, name]) => ({
      name,
      value: name,
    }));

    try {
      return await select({
        message: "Select activity type:",
        choices,
        loop: false,
        default: dualOption?.[1], // Default to dual if available
      });
    } catch (error) {
      // User cancelled (Ctrl+C)
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
    } catch (error) {
      // User cancelled (Ctrl+C)
      return false;
    }
  }
}
