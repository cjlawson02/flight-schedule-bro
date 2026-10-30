import type { SchedulerBLO } from "../shared/blo/scheduler.js";
import type { BookableAvailability } from "../shared/dao/availability.js";
import {
  hasReservationOnSameDay,
  type ExistingReservation,
} from "../shared/dao/existingReservations.js";
import { nilToOptionalResourceId } from "../shared/dao/aircraft.js";
import { FLIGHT_RULES_VFR, FLIGHT_TYPE_LOCAL } from "../shared/dao/reservationFlightDetails.js";
import type { ReservationType } from "../shared/dao/reservationTypes.js";
import type { ReservationResponse } from "../shared/dao/reservations.js";
import { intervalsOverlap, type BusyInterval } from "../shared/util/calendarBusy.js";
import { filterSlotsBookable } from "../shared/util/slots.js";
import { getErrorMessage } from "../shared/util/errors.js";
import { formatFspError } from "../shared/dao/fspErrors.js";
import { createLogger } from "../shared/util/logger.js";
import { canMakeSubrequest, type SubrequestBudget } from "../shared/util/subrequestBudget.js";
import type { FspMetadata } from "../shared/blo/fspMetadata.js";
import { toOperatorZoned } from "../shared/util/flightTime.js";

const log = createLogger("auto-book");

export interface AutoBookCandidate extends BookableAvailability {
  aircraftTail: string;
}

export interface AutoBookResult {
  slot: AutoBookCandidate;
  response: ReservationResponse;
}

const DEFAULT_TAIL_PREFERENCE = ["N65411", "N737BC", "N734UZ"];
/** Default: ignore personal-calendar busy for slots starting at/after 3:30pm local. */
export const DEFAULT_IGNORE_CALENDAR_AFTER_MINUTES = 15 * 60 + 30;

function localMinutesSinceMidnight(instant: Date, timeZone: string): number {
  const zoned = toOperatorZoned(instant, timeZone);
  return zoned.getHours() * 60 + zoned.getMinutes();
}

export function selectAutoBookCandidates(options: {
  slots: BookableAvailability[];
  existingReservations: ExistingReservation[];
  busyIntervals: BusyInterval[];
  metadata: FspMetadata;
  timeZone: string;
  maxPerRun: number;
  now?: Date;
  preferredTails?: string[];
  /** Skip iCal busy checks when slot starts at/after this many minutes past midnight. */
  ignoreCalendarBusyAfterMinutes?: number;
}): AutoBookCandidate[] {
  const {
    slots,
    existingReservations,
    busyIntervals,
    metadata,
    timeZone,
    maxPerRun,
    now = new Date(),
    preferredTails = DEFAULT_TAIL_PREFERENCE,
    ignoreCalendarBusyAfterMinutes = DEFAULT_IGNORE_CALENDAR_AFTER_MINUTES,
  } = options;

  if (maxPerRun <= 0) {
    return [];
  }

  const tailById = new Map(metadata.aircraft.map((a) => [a.aircraftId, a.tailNumber]));

  const bookable = filterSlotsBookable(slots, now);
  const ranked = bookable
    .map((slot) => ({
      ...slot,
      aircraftTail: tailById.get(slot.aircraftId) ?? slot.aircraftId,
    }))
    .filter((slot) => {
      if (hasReservationOnSameDay(slot.startDateTime, existingReservations, timeZone)) {
        return false;
      }
      const startMinutes = localMinutesSinceMidnight(slot.startDateTime, timeZone);
      const ignoreCalendar = startMinutes >= ignoreCalendarBusyAfterMinutes;
      if (
        !ignoreCalendar &&
        intervalsOverlap(slot.startDateTime.getTime(), slot.endDateTime.getTime(), busyIntervals)
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const startDiff = a.startDateTime.getTime() - b.startDateTime.getTime();
      if (startDiff !== 0) {
        return startDiff;
      }
      const aPref = preferredTails.indexOf(a.aircraftTail);
      const bPref = preferredTails.indexOf(b.aircraftTail);
      const aRank = aPref === -1 ? 99 : aPref;
      const bRank = bPref === -1 ? 99 : bPref;
      return aRank - bRank;
    });

  const picked: AutoBookCandidate[] = [];
  const usedDays = new Set<string>();

  for (const slot of ranked) {
    if (picked.length >= maxPerRun) {
      break;
    }
    const dayKey = slot.startDateTime.toLocaleDateString("en-CA", {
      timeZone,
    });
    if (usedDays.has(dayKey)) {
      continue;
    }
    // Also avoid days we'll book in this same run after FSP updates.
    usedDays.add(dayKey);
    picked.push(slot);
  }

  return picked;
}

export async function autoBookSlots(options: {
  scheduler: SchedulerBLO;
  reservationType: ReservationType;
  locationId: number;
  candidates: AutoBookCandidate[];
  budget?: SubrequestBudget;
}): Promise<AutoBookResult[]> {
  const { scheduler, reservationType, locationId, candidates, budget } = options;
  const booked: AutoBookResult[] = [];

  for (const slot of candidates) {
    if (budget && !canMakeSubrequest(budget)) {
      log.warn("Stopping auto-book: subrequest budget exhausted");
      break;
    }

    try {
      const response = await scheduler.bookReservation({
        aircraftId: nilToOptionalResourceId(slot.aircraftId),
        instructorId: nilToOptionalResourceId(slot.instructorId),
        startTime: slot.startDateTime,
        endTime: slot.endDateTime,
        reservationType,
        locationId,
        flightDetails: {
          flightType: FLIGHT_TYPE_LOCAL,
          flightRules: FLIGHT_RULES_VFR,
        },
      });
      log.info("Auto-booked reservation", {
        id: response.id,
        date: slot.date,
        startTime: slot.startTime,
        aircraft: slot.aircraftTail,
      });
      booked.push({ slot, response });
    } catch (error) {
      log.warn("Auto-book failed for slot", {
        date: slot.date,
        startTime: slot.startTime,
        aircraft: slot.aircraftTail,
        message: formatFspError(error) || getErrorMessage(error),
      });
    }
  }

  return booked;
}
