import { fromZonedTime } from "date-fns-tz";
import { DEFAULT_TIMEZONE } from "./flightTime.js";
import { recordActiveSubrequest } from "./subrequestBudget.js";
import { createLogger } from "./logger.js";

const log = createLogger("calendar-busy");

export interface BusyInterval {
  startMs: number;
  endMs: number;
  summary: string;
}

function unfoldICalLines(content: string): string[] {
  const lines: string[] = [];
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
      continue;
    }
    lines.push(line);
  }
  return lines;
}

function parseUtcICalDateTime(value: string): Date {
  const normalized = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
  return new Date(normalized);
}

function parseFloatingOrZonedDateTime(
  value: string,
  tzid: string | undefined,
  fallbackTimeZone: string,
): Date {
  const local = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}`;
  return fromZonedTime(local, tzid || fallbackTimeZone);
}

function parseAllDayDate(value: string, timeZone: string): Date {
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(4, 6));
  const d = Number(value.slice(6, 8));
  // Interpret midnight in the operator timezone.
  const local = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00`;
  return fromZonedTime(local, timeZone);
}

function parseICalProperty(line: string): {
  name: string;
  params: Record<string, string>;
  value: string;
} | null {
  const colon = line.indexOf(":");
  if (colon < 0) {
    return null;
  }
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = left.split(";");
  const name = parts[0]?.toUpperCase() ?? "";
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return { name, params, value };
}

function propertyToInstant(
  prop: { params: Record<string, string>; value: string },
  timeZone: string,
): Date | null {
  const valueParam = prop.params.VALUE?.toUpperCase();
  if (valueParam === "DATE" || /^\d{8}$/.test(prop.value)) {
    return parseAllDayDate(prop.value, timeZone);
  }

  const match = /^(\d{8}T\d{6})(Z)?$/.exec(prop.value);
  if (!match) {
    return null;
  }
  const [, dateTime, isUtc] = match;
  if (isUtc) {
    return parseUtcICalDateTime(dateTime);
  }
  return parseFloatingOrZonedDateTime(dateTime, prop.params.TZID, timeZone);
}

/**
 * Parse VEVENTs from an iCal document into busy intervals.
 * Skips cancelled and transparent (free) events.
 */
export function parseICalBusyIntervals(
  content: string,
  timeZone: string = DEFAULT_TIMEZONE,
): BusyInterval[] {
  const intervals: BusyInterval[] = [];
  let inEvent = false;
  let summary = "";
  let status = "";
  let transp = "";
  let dtStart: { params: Record<string, string>; value: string } | null = null;
  let dtEnd: { params: Record<string, string>; value: string } | null = null;
  let durationDays: number | null = null;

  const flush = () => {
    if (!dtStart) {
      return;
    }
    if (status.toUpperCase() === "CANCELLED") {
      return;
    }
    if (transp.toUpperCase() === "TRANSPARENT") {
      return;
    }

    const start = propertyToInstant(dtStart, timeZone);
    if (!start) {
      return;
    }

    let end: Date | null = null;
    if (dtEnd) {
      end = propertyToInstant(dtEnd, timeZone);
    } else if (durationDays !== null) {
      end = new Date(start.getTime() + durationDays * 24 * 60 * 60 * 1000);
    }

    if (!end) {
      // All-day with no end: busy for that local day.
      end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    }

    if (end.getTime() <= start.getTime()) {
      return;
    }

    intervals.push({
      startMs: start.getTime(),
      endMs: end.getTime(),
      summary: summary || "(busy)",
    });
  };

  for (const line of unfoldICalLines(content)) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      summary = "";
      status = "";
      transp = "";
      dtStart = null;
      dtEnd = null;
      durationDays = null;
      continue;
    }
    if (line === "END:VEVENT") {
      if (inEvent) {
        flush();
      }
      inEvent = false;
      continue;
    }
    if (!inEvent) {
      continue;
    }

    const prop = parseICalProperty(line);
    if (!prop) {
      continue;
    }

    switch (prop.name) {
      case "SUMMARY":
        summary = prop.value.replace(/\\n/g, " ").replace(/\\,/g, ",");
        break;
      case "STATUS":
        status = prop.value;
        break;
      case "TRANSP":
        transp = prop.value;
        break;
      case "DTSTART":
        dtStart = { params: prop.params, value: prop.value };
        break;
      case "DTEND":
        dtEnd = { params: prop.params, value: prop.value };
        break;
      case "DURATION": {
        // Only need day-level durations for all-day style; ignore complex ones.
        const dayMatch = /^P(\d+)D$/.exec(prop.value);
        if (dayMatch) {
          durationDays = Number(dayMatch[1]);
        }
        break;
      }
      default:
        break;
    }
  }

  return intervals.sort((a, b) => a.startMs - b.startMs);
}

export function intervalsOverlap(
  startMs: number,
  endMs: number,
  busy: BusyInterval[],
): BusyInterval | undefined {
  return busy.find((interval) => startMs < interval.endMs && endMs > interval.startMs);
}

/** Normalize webcal:// subscribe links to https:// for fetch(). */
export function normalizeCalendarIcalUrl(url: string): string {
  const trimmed = url.trim();
  if (/^webcal:/i.test(trimmed)) {
    return trimmed.replace(/^webcal:/i, "https:");
  }
  return trimmed;
}

/**
 * Fetch a private/secret iCal URL and parse busy intervals.
 */
export async function fetchCalendarBusyFromIcalUrl(
  url: string,
  timeZone: string = DEFAULT_TIMEZONE,
): Promise<BusyInterval[]> {
  const fetchUrl = normalizeCalendarIcalUrl(url);
  recordActiveSubrequest();
  const response = await fetch(fetchUrl, {
    method: "GET",
    headers: {
      Accept: "text/calendar, text/plain, */*",
    },
  });

  if (!response.ok) {
    throw new Error(`Calendar iCal fetch failed (${response.status}): ${response.statusText}`);
  }

  const content = await response.text();
  const intervals = parseICalBusyIntervals(content, timeZone);
  log.info("Loaded calendar busy intervals", { count: intervals.length });
  return intervals;
}
