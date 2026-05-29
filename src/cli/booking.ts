import { SchedulerBLO } from "../shared/blo/scheduler.js";
import { addReservationToCalendar } from "../shared/blo/macCalendar.js";
import type { BookableAvailability } from "../shared/dao/availability.js";
import { getDefaultLocationId } from "../shared/dao/auth.js";
import { nilToOptionalResourceId } from "../shared/dao/aircraft.js";
import type { ActivityFlightDetails } from "../shared/dao/reservationFlightDetails.js";
import type { ReservationType } from "../shared/dao/reservationTypes.js";
import { InteractiveCLI } from "../shared/util/interactive.js";
import { getErrorMessage } from "../shared/util/errors.js";
import { createLogger } from "../shared/util/logger.js";
import { resolveSlotSelections } from "./timeSlotSelection.js";

const log = createLogger("cli-booking");

export async function handleBookingFlow(
  cli: InteractiveCLI,
  scheduler: SchedulerBLO,
  availabilities: BookableAvailability[],
  reservationType: ReservationType,
  operatorId: number,
  flightDetails?: ActivityFlightDetails,
): Promise<void> {
  try {
    const selectedAvailabilities =
      await cli.selectMultipleTimeSlots(availabilities);

    if (selectedAvailabilities.length === 0) {
      return;
    }

    const finalSelections = await resolveSlotSelections(
      cli,
      selectedAvailabilities,
    );

    if (finalSelections.length === 0) {
      console.log("\n❌ No time slots selected for booking.");
      return;
    }

    console.log(
      `\n📋 Ready to book ${finalSelections.length} time slot${
        finalSelections.length > 1 ? "s" : ""
      }:`,
    );
    finalSelections.forEach((selection, index) => {
      console.log(
        `${index + 1}. ${selection.date} ${selection.startTime} - ${selection.endTime} | ${selection.instructor} | ${selection.aircraft}`,
      );
    });

    const confirmed = await cli.confirmAction(
      "\n✅ Confirm and proceed with booking? (y/n): ",
    );
    if (!confirmed) {
      return;
    }

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
          aircraftId: nilToOptionalResourceId(selection.aircraftId),
          instructorId: nilToOptionalResourceId(selection.instructorId),
          startTime: selection.startDateTime,
          endTime: selection.endDateTime,
          reservationType,
          locationId: getDefaultLocationId(),
          flightDetails,
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
          error: getErrorMessage(error),
        });
        console.log(
          `❌ Failed: ${selection.date} ${selection.startTime} - ${getErrorMessage(error)}`,
        );
      }
    }

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
                console.log("     ✅ Added to calendar successfully");
              } catch (error) {
                log.error("Failed to add reservation to calendar", {
                  reservationId: booking.reservationId,
                  message: getErrorMessage(error),
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
      message: getErrorMessage(error),
      error,
    });
  }
}
