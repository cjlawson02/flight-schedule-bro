import { SchedulerBLO } from "../shared/blo/scheduler.js";
import { addDays } from "date-fns";
import { CONFIG } from "../shared/util/config.js";
import { BookableAvailability } from "../shared/dao/availability.js";
import { InteractiveCLI } from "../shared/util/interactive.js";
import { isValidBlock } from "../shared/util/dates.js";
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
import { chunk } from "../shared/util/array.js";
import { cliCacheAdapter } from "./cache.js";

async function main() {
  // Inject file-based cache for CLI
  setCacheAdapter(cliCacheAdapter);
  await fetchAuth(CONFIG.EMAIL, CONFIG.PASSWORD);

  const operatorId = getOperatorId();
  const scheduler = new SchedulerBLO(operatorId);

  await scheduler.initialize();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const allInstructorIds: string[] = scheduler.getInstructorIds();
  const cli = new InteractiveCLI();

  // Get all available activity types and prompt user to select
  const activityTypes = Array.from(scheduler.getActivityTypesMapEntries());
  const selectedName = await cli.selectActivityType(activityTypes);

  if (!selectedName) {
    console.log("❌ No activity type selected. Exiting.");
    return;
  }

  const activityTypeId = activityTypes.find(
    ([, name]) => name === selectedName
  )?.[0];

  if (!activityTypeId) {
    throw new Error("Failed to determine activity type");
  }

  const preferredAircraftIds = Array.from(scheduler.getAircraftMapEntries())
    .filter(([, callsign]) => CONFIG.AIRCRAFT_REGEX.test(callsign))
    .map(([id]) => id);

  const aircraftIds =
    preferredAircraftIds.length > 0
      ? preferredAircraftIds
      : scheduler.getAircraftIds();

  const instructorChunks = chunk(allInstructorIds, 3); // API limit: max 3 instructors

  // Fetch existing reservations to filter out conflicts
  console.log("\n🔍 Checking your existing reservations...");
  const existingReservations = await getExistingReservations(operatorId);
  console.log(`Found ${existingReservations.length} existing reservations`);

  try {
    // Collect all bookable availability
    const bookablePromises: Promise<BookableAvailability[]>[] = [];

    for (let offset = 0; offset <= CONFIG.DAYS_AHEAD; offset++) {
      const day = addDays(today, offset);
      const dayISO = day.toISOString().split("T")[0];

      bookablePromises.push(
        ...instructorChunks.map(
          async (instructors) =>
            await scheduler.getBookableAvailability({
              customerUserGuid: getUserId(),
              locationId: getDefaultLocationId(),
              activityTypeId,
              instructors,
              aircraftIds,
              startDate: dayISO,
              endDate: dayISO,
            })
        )
      );
    }

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
        .catch((error) => {
          completedCount++;
          progressBar.update(completedCount);
          throw error;
        })
    );

    const allBookableResults: BookableAvailability[] = (
      await Promise.all(trackedPromises)
    ).flat();

    // Stop progress bar
    progressBar.stop();

    // Filter valid results using the existing validation logic
    const validResults = allBookableResults.filter((result) => {
      const isWeekend = [0, 6].includes(result.startDateTime.getDay());
      return isValidBlock(result.startDateTime, result.endDateTime, isWeekend);
    });

    // Filter out time slots on days where you already have a reservation
    const availableWithoutConflicts = validResults.filter((result) => {
      return !hasReservationOnSameDay(
        result.startDateTime,
        existingReservations
      );
    });

    const conflictsFiltered =
      validResults.length - availableWithoutConflicts.length;
    if (conflictsFiltered > 0) {
      console.log(
        `\n⏭️  Filtered out ${conflictsFiltered} time slots on days where you already have reservations`
      );
    }

    // Display availability results in a user-friendly format
    if (availableWithoutConflicts.length > 0) {
      // Go directly to booking flow
      await handleBookingFlow(
        cli,
        scheduler,
        availableWithoutConflicts,
        activityTypeId,
        operatorId
      );
    } else {
      console.log("❌ No availability found for the specified criteria.");
      console.log(
        "💡 Try adjusting your time preferences in the configuration."
      );
    }
  } catch (error) {
    console.error(
      "❌ An error occurred:",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

// Execute main function
main().catch((error) => {
  console.error(
    "❌ Fatal error:",
    error instanceof Error ? error.message : "Unknown error"
  );
  process.exit(1);
});

/**
 * Handle the interactive booking flow with multi-selection
 */
async function handleBookingFlow(
  cli: InteractiveCLI,
  scheduler: SchedulerBLO,
  availabilities: BookableAvailability[],
  activityTypeId: string,
  operatorId: number
): Promise<void> {
  try {
    // Let user select multiple time slots using advanced interface
    const selectedAvailabilities = await cli.selectMultipleTimeSlots(
      availabilities
    );

    if (selectedAvailabilities.length === 0) {
      return; // User cancelled selection or selected nothing
    }

    // Group selected availabilities by time slot for instructor selection
    const timeSlotMap = new Map<string, BookableAvailability[]>();
    for (const avail of selectedAvailabilities) {
      const key = `${avail.date}|${avail.startTime}|${avail.endTime}`;
      if (!timeSlotMap.has(key)) {
        timeSlotMap.set(key, []);
      }
      timeSlotMap.get(key)!.push(avail);
    }

    // Collect final selections with instructor choices
    const finalSelections: BookableAvailability[] = [];

    for (const [timeSlotKey, availabilitiesForSlot] of timeSlotMap) {
      const [date, startTime, endTime] = timeSlotKey.split("|");

      // If only one option, auto-select it
      if (availabilitiesForSlot.length === 1) {
        finalSelections.push(availabilitiesForSlot[0]);
        console.log(
          `✅ Auto-selected: ${availabilitiesForSlot[0].instructor} with ${availabilitiesForSlot[0].aircraft}`
        );
      } else {
        // Step 1: Select aircraft (if multiple available)
        const selectedAircraft = await cli.selectAircraft(
          availabilitiesForSlot[0], // Use first as template for time slot info
          availabilitiesForSlot
        );

        if (!selectedAircraft) {
          continue; // User cancelled aircraft selection
        }

        // Filter availabilities by selected aircraft
        const availabilitiesForAircraft = availabilitiesForSlot.filter(
          (avail) => avail.aircraft === selectedAircraft
        );

        // Step 2: Select instructor (if multiple available for this aircraft)
        const selectedInstructor = await cli.selectInstructor(
          availabilitiesForSlot[0], // Use first as template for time slot info
          availabilitiesForAircraft
        );

        if (selectedInstructor) {
          finalSelections.push(selectedInstructor);
          console.log(
            `✅ Selected: ${selectedInstructor.instructor} with ${selectedInstructor.aircraft}`
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
      }:`
    );
    finalSelections.forEach((selection, index) => {
      console.log(
        `${index + 1}. ${selection.date} ${selection.startTime} - ${
          selection.endTime
        } | ${selection.instructor} | ${selection.aircraft}`
      );
    });

    const confirmed = await cli.confirmAction(
      "\n✅ Confirm and proceed with booking? (y/n): "
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
          `📤 Booking request: Aircraft ID=${selection.aircraftId}, Instructor ID=${selection.instructorId}`
        );
        const response = await scheduler.bookReservation({
          aircraftId: selection.aircraftId,
          instructorId: selection.instructorId,
          startTime: selection.startDateTime,
          endTime: selection.endDateTime,
          reservationTypeId: activityTypeId,
          locationId: getDefaultLocationId(),
        });

        results.success.push({
          availability: selection,
          reservationId: response.id!,
        });
        console.log(
          `✅ Booked: ${selection.date} ${selection.startTime} with ${selection.instructor}`
        );
      } catch (error) {
        results.failed.push({
          availability: selection,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        console.log(
          `❌ Failed: ${selection.date} ${selection.startTime} - ${
            error instanceof Error ? error.message : "Unknown error"
          }`
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
        }:`
      );
      results.success.forEach((booking) => {
        const { availability } = booking;
        console.log(
          `✅ ${availability.date} ${availability.startTime} - ${availability.endTime} | ${availability.instructor} | ${availability.aircraft}`
        );
      });
    }

    if (results.failed.length > 0) {
      console.log(
        `\n❌ Failed to book ${results.failed.length} time slot${
          results.failed.length > 1 ? "s" : ""
        }:`
      );
      results.failed.forEach(({ availability, error }) => {
        console.log(
          `❌ ${availability.date} ${availability.startTime} - ${availability.endTime} | ${availability.instructor} | Error: ${error}`
        );
      });
    }

    console.log("═".repeat(60));

    // Add successful bookings to calendar
    if (results.success.length > 0) {
      const bookingsWithIds = results.success.filter(
        (booking) => booking.reservationId
      );

      if (bookingsWithIds.length > 0) {
        const addToCalendarChoice = await cli.confirmAction(
          "\n📅 Would you like to add these bookings to your calendar? (y/n): "
        );

        if (addToCalendarChoice) {
          console.log("\n📅 Adding bookings to calendar...");

          for (const booking of bookingsWithIds) {
            if (booking.reservationId) {
              console.log(
                `  📆 Adding ${booking.availability.date} ${booking.availability.startTime} to calendar...`
              );
              try {
                await addReservationToCalendar(
                  operatorId,
                  booking.reservationId
                );
                console.log(`     ✅ Added to calendar successfully`);
              } catch (error) {
                console.error(
                  `     ⚠️  Failed to add to calendar: ${
                    error instanceof Error ? error.message : "Unknown error"
                  }`
                );
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(
      "\n❌ An error occurred during the booking process:",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}
