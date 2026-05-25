import { SchedulerBLO } from "../shared/blo/scheduler.js";
import {
  buildAvailabilityFetchTasks,
  fetchAllAvailability,
  filterValidAvailabilityBlocks,
  prepareAvailabilitySearch,
} from "../shared/blo/availabilitySearch.js";
import { CONFIG } from "../shared/util/config.js";
import { startOfOperatorDay } from "../shared/util/flightTime.js";
import {
  clearInvalidInstructorIds,
  getInvalidInstructorIds,
} from "../shared/dao/availability.js";
import {
  supportsScheduleMatchSearch,
  type ReservationType,
} from "../shared/dao/reservationTypes.js";
import { FSP_NIL_RESOURCE_ID } from "../shared/dao/aircraft.js";
import { InteractiveCLI } from "../shared/util/interactive.js";
import { createProgressBar } from "../shared/util/progressBar.js";
import { addReservationToCalendar } from "../shared/blo/calendar.js";
import {
  fetchAuth,
  getOperatorId,
  getUserId,
  getDefaultLocationId,
} from "../shared/dao/auth.js";
import {
  getExistingReservations,
  hasReservationOnSameDay,
} from "../shared/dao/existingReservations.js";
import { setCacheAdapter } from "../shared/dao/api_wrapper.js";
import type { BookableAvailability } from "../shared/dao/availability.js";
import { groupAvailabilitiesByTimeSlot } from "../shared/dao/availability.js";
import { cliCacheAdapter } from "./cache.js";
import { configureLogger, createLogger } from "../shared/util/logger.js";

configureLogger({ runtime: "cli" });
const log = createLogger("cli");

async function main() {
  setCacheAdapter(cliCacheAdapter);
  clearInvalidInstructorIds();
  await fetchAuth(CONFIG.EMAIL, CONFIG.PASSWORD);

  const operatorId = getOperatorId();
  const scheduler = new SchedulerBLO(operatorId, CONFIG.TIMEZONE);

  await scheduler.initialize();

  const today = startOfOperatorDay(new Date(), CONFIG.TIMEZONE);

  const allInstructorIds: string[] = scheduler.getInstructorIds();
  const cli = new InteractiveCLI();

  // Prompt user to select a reservation type
  const reservationType = await cli.selectReservationType(
    scheduler.getReservationTypes(),
    { preferredTypeId: CONFIG.RESERVATION_TYPE_ID },
  );

  if (!reservationType) {
    console.log("❌ No activity type selected. Exiting.");
    return;
  }

  const activityTypeId = reservationType.reservationTypeId;
  const selectedName = reservationType.reservationTypeName;

  if (!supportsScheduleMatchSearch(reservationType)) {
    console.log(
      `❌ "${selectedName}" is not supported for automated availability search.`,
    );
    return;
  }

  const preferredAircraftIds = Array.from(scheduler.getAircraftMapEntries())
    .filter(([, callsign]) => CONFIG.AIRCRAFT_REGEX.test(callsign))
    .map(([id]) => id);

  const aircraftIds =
    preferredAircraftIds.length > 0
      ? preferredAircraftIds
      : scheduler.getAircraftIds();

  const searchParams = {
    customerUserGuid: getUserId(),
    locationId: getDefaultLocationId(),
    operatorId,
    timeZone: CONFIG.TIMEZONE,
    activityTypeId,
    reservationType,
    allInstructorIds,
    aircraftIds,
  };

  const prepared = prepareAvailabilitySearch(searchParams);

  if (!prepared) {
    console.log(
      `❌ "${selectedName}" has no instructors or aircraft to search with.`,
    );
    return;
  }

  const skippedInstructors = allInstructorIds.filter((id) =>
    getInvalidInstructorIds().has(id),
  );
  if (skippedInstructors.length > 0) {
    log.warn("Skipped instructors not valid for scheduleMatch", {
      count: skippedInstructors.length,
      instructorIds: skippedInstructors,
    });
  }

  // Fetch existing reservations to filter out conflicts
  log.info("Checking existing reservations");
  const existingReservations = await getExistingReservations(operatorId);
  log.info("Existing reservations loaded", {
    count: existingReservations.length,
  });

  try {
    // Collect all bookable availability
    const bookablePromises = buildAvailabilityFetchTasks(scheduler, {
      params: searchParams,
      prepared,
      today,
      daysAhead: CONFIG.DAYS_AHEAD,
    });

    // Create progress bar
    const progressBar = createProgressBar("🔄 Fetching schedules");

    // Start progress bar
    progressBar.start(bookablePromises.length, 0);

    // Track promises completion with progress updates
    let completedCount = 0;
    const trackedPromises = bookablePromises.map((promise) =>
      promise
        .then((result) => {
          completedCount++;
          progressBar.update(completedCount);
          return result;
        })
        .catch((error: unknown) => {
          completedCount++;
          progressBar.update(completedCount);
          throw error;
        }),
    );

    const allBookableResults = await fetchAllAvailability(trackedPromises);

    // Stop progress bar
    progressBar.stop();

    // Filter valid results using reservation type duration and hour rules
    const validResults = filterValidAvailabilityBlocks(
      allBookableResults,
      CONFIG,
      reservationType.defaultLength,
    );

    // Filter out time slots on days where you already have a reservation
    const availableWithoutConflicts = validResults.filter((result) => {
      return !hasReservationOnSameDay(
        result.startDateTime,
        existingReservations,
        CONFIG.TIMEZONE,
      );
    });

    const conflictsFiltered =
      validResults.length - availableWithoutConflicts.length;
    if (conflictsFiltered > 0) {
      console.log(
        `\n⏭️  Filtered out ${conflictsFiltered} time slots on days where you already have reservations`,
      );
    }

    // Display availability results in a user-friendly format
    if (availableWithoutConflicts.length > 0) {
      // Go directly to booking flow
      await handleBookingFlow(
        cli,
        scheduler,
        availableWithoutConflicts,
        reservationType,
        operatorId,
      );
    } else {
      console.log("❌ No availability found for the specified criteria.");
      console.log(
        "💡 Try adjusting your time preferences in the configuration.",
      );
    }
  } catch (error) {
    log.error("An error occurred during availability search", {
      message: error instanceof Error ? error.message : "Unknown error",
      error,
    });
  }
}

main().catch((error: unknown) => {
  log.error("Fatal error", {
    message: error instanceof Error ? error.message : "Unknown error",
    error,
  });
  process.exit(1);
});

/**
 * Handle the interactive booking flow with multi-selection
 */
async function handleBookingFlow(
  cli: InteractiveCLI,
  scheduler: SchedulerBLO,
  availabilities: BookableAvailability[],
  reservationType: ReservationType,
  operatorId: number,
): Promise<void> {
  try {
    // Let user select multiple time slots using advanced interface
    const selectedAvailabilities =
      await cli.selectMultipleTimeSlots(availabilities);

    if (selectedAvailabilities.length === 0) {
      return; // User cancelled selection or selected nothing
    }

    // Group selected availabilities by time slot for instructor selection
    const timeSlotGroups = groupAvailabilitiesByTimeSlot(
      selectedAvailabilities,
    );

    // Collect final selections with instructor choices
    const finalSelections: BookableAvailability[] = [];

    for (const { availabilities: availabilitiesForSlot } of timeSlotGroups) {
      // If only one option, auto-select it
      if (availabilitiesForSlot.length === 1) {
        finalSelections.push(availabilitiesForSlot[0]);
        console.log(
          `✅ Auto-selected: ${availabilitiesForSlot[0].instructor} with ${availabilitiesForSlot[0].aircraft}`,
        );
      } else {
        // Step 1: Select aircraft (if multiple available)
        const selectedAircraft = await cli.selectAircraft(
          availabilitiesForSlot[0], // Use first as template for time slot info
          availabilitiesForSlot,
        );

        if (!selectedAircraft) {
          continue; // User cancelled aircraft selection
        }

        // Filter availabilities by selected aircraft
        const availabilitiesForAircraft = availabilitiesForSlot.filter(
          (avail) => avail.aircraft === selectedAircraft,
        );

        // Step 2: Select instructor (if multiple available for this aircraft)
        const selectedInstructor = await cli.selectInstructor(
          availabilitiesForSlot[0], // Use first as template for time slot info
          availabilitiesForAircraft,
        );

        if (selectedInstructor) {
          finalSelections.push(selectedInstructor);
          console.log(
            `✅ Selected: ${selectedInstructor.instructor} with ${selectedInstructor.aircraft}`,
          );
        }
      }
    }

    if (finalSelections.length === 0) {
      console.log("\n❌ No time slots selected for booking.");
      return;
    }

    // Confirm all bookings
    console.log(
      `\n📋 Ready to book ${finalSelections.length} time slot${
        finalSelections.length > 1 ? "s" : ""
      }:`,
    );
    finalSelections.forEach((selection, index) => {
      console.log(
        `${index + 1}. ${selection.date} ${selection.startTime} - ${
          selection.endTime
        } | ${selection.instructor} | ${selection.aircraft}`,
      );
    });

    const confirmed = await cli.confirmAction(
      "\n✅ Confirm and proceed with booking? (y/n): ",
    );
    if (!confirmed) {
      return;
    }

    // Process all bookings
    console.log("\n⏳ Processing your bookings...");
    const results: {
      success: { availability: BookableAvailability; reservationId?: string }[];
      failed: { availability: BookableAvailability; error: string }[];
    } = {
      success: [],
      failed: [],
    };

    for (const selection of finalSelections) {
      try {
        console.log(
          `📤 Booking request: Aircraft ID=${selection.aircraftId}, Instructor ID=${selection.instructorId}`,
        );
        const response = await scheduler.bookReservation({
          aircraftId:
            selection.aircraftId === FSP_NIL_RESOURCE_ID
              ? undefined
              : selection.aircraftId,
          instructorId:
            selection.instructorId === FSP_NIL_RESOURCE_ID
              ? undefined
              : selection.instructorId,
          startTime: selection.startDateTime,
          endTime: selection.endDateTime,
          reservationType,
          locationId: getDefaultLocationId(),
        });

        if (!response.id) {
          throw new Error("Reservation created without an id");
        }
        results.success.push({
          availability: selection,
          reservationId: response.id,
        });
        console.log(
          `✅ Booked: ${selection.date} ${selection.startTime} with ${selection.instructor}`,
        );
      } catch (error) {
        results.failed.push({
          availability: selection,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        console.log(
          `❌ Failed: ${selection.date} ${selection.startTime} - ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    }

    // Display final results
    console.log("\n" + "═".repeat(60));
    console.log("📊 Booking Results Summary");
    console.log("═".repeat(60));

    if (results.success.length > 0) {
      console.log(
        `\n🎉 Successfully booked ${results.success.length} time slot${
          results.success.length > 1 ? "s" : ""
        }:`,
      );
      results.success.forEach((booking) => {
        const { availability } = booking;
        console.log(
          `✅ ${availability.date} ${availability.startTime} - ${availability.endTime} | ${availability.instructor} | ${availability.aircraft}`,
        );
      });
    }

    if (results.failed.length > 0) {
      console.log(
        `\n❌ Failed to book ${results.failed.length} time slot${
          results.failed.length > 1 ? "s" : ""
        }:`,
      );
      results.failed.forEach(({ availability, error }) => {
        console.log(
          `❌ ${availability.date} ${availability.startTime} - ${availability.endTime} | ${availability.instructor} | Error: ${error}`,
        );
      });
    }

    console.log("═".repeat(60));

    // Add successful bookings to calendar
    if (results.success.length > 0) {
      const bookingsWithIds = results.success.filter(
        (booking) => booking.reservationId,
      );

      if (bookingsWithIds.length > 0) {
        const addToCalendarChoice = await cli.confirmAction(
          "\n📅 Would you like to add these bookings to your calendar? (y/n): ",
        );

        if (addToCalendarChoice) {
          console.log("\n📅 Adding bookings to calendar...");

          for (const booking of bookingsWithIds) {
            if (booking.reservationId) {
              console.log(
                `  📆 Adding ${booking.availability.date} ${booking.availability.startTime} to calendar...`,
              );
              try {
                await addReservationToCalendar(
                  operatorId,
                  booking.reservationId,
                );
                console.log(`     ✅ Added to calendar successfully`);
              } catch (error) {
                log.error("Failed to add reservation to calendar", {
                  reservationId: booking.reservationId,
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  error,
                });
              }
            }
          }
        }
      }
    }
  } catch (error) {
    log.error("An error occurred during the booking process", {
      message: error instanceof Error ? error.message : "Unknown error",
      error,
    });
  }
}
