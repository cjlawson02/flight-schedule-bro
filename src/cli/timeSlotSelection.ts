import { groupAvailabilitiesByTimeSlot } from "../shared/dao/availability.js";
import type { BookableAvailability } from "../shared/dao/availability.js";
import { InteractiveCLI } from "../shared/util/interactive.js";

export async function resolveSlotSelections(
  cli: InteractiveCLI,
  selectedAvailabilities: BookableAvailability[],
): Promise<BookableAvailability[]> {
  const timeSlotGroups = groupAvailabilitiesByTimeSlot(selectedAvailabilities);
  const finalSelections: BookableAvailability[] = [];

  for (const { availabilities: availabilitiesForSlot } of timeSlotGroups) {
    if (availabilitiesForSlot.length === 1) {
      finalSelections.push(availabilitiesForSlot[0]);
      console.log(
        `✅ Auto-selected: ${availabilitiesForSlot[0].instructor} with ${availabilitiesForSlot[0].aircraft}`,
      );
      continue;
    }

    const selectedAircraft = await cli.selectAircraft(
      availabilitiesForSlot[0],
      availabilitiesForSlot,
    );

    if (!selectedAircraft) {
      continue;
    }

    const availabilitiesForAircraft = availabilitiesForSlot.filter(
      (availability) => availability.aircraft === selectedAircraft,
    );

    const selectedInstructor = await cli.selectInstructor(
      availabilitiesForSlot[0],
      availabilitiesForAircraft,
    );

    if (selectedInstructor) {
      finalSelections.push(selectedInstructor);
      console.log(
        `✅ Selected: ${selectedInstructor.instructor} with ${selectedInstructor.aircraft}`,
      );
    }
  }

  return finalSelections;
}
