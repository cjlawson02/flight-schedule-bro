import { formatInTimeZone } from "date-fns-tz";
import { DEFAULT_TIMEZONE, parseFspUtc } from "./flightTime.js";

const DATE_TIME_PROPERTY = /^(DTSTART|DTEND)(;[^:]*)?:(.+)$/;

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

function parseICalUtcDateTime(value: string): Date {
  const normalized = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
  return parseFspUtc(normalized);
}

function formatICalLocalDateTime(instant: Date, timeZone: string): string {
  return formatInTimeZone(instant, timeZone, "yyyyMMdd'T'HHmmss");
}

function tagDateTimeProperty(line: string, timeZone: string): string {
  const match = DATE_TIME_PROPERTY.exec(line);
  if (!match) {
    return line;
  }

  const [, property, params = "", value] = match;

  if (params.includes("TZID=")) {
    return line;
  }

  if (/^\d{8}$/.test(value)) {
    return line;
  }

  const dateTimeMatch = /^(\d{8}T\d{6})(Z)?$/.exec(value);
  if (!dateTimeMatch) {
    return line;
  }

  const [, dateTime, isUtc] = dateTimeMatch;
  const localDateTime = isUtc
    ? formatICalLocalDateTime(parseICalUtcDateTime(dateTime), timeZone)
    : dateTime;

  return `${property};TZID=${timeZone}:${localDateTime}`;
}

/**
 * Tag floating or UTC iCal event times with the operator timezone so calendar
 * apps interpret wall-clock times in Pacific (or configured) local time.
 */
export function tagICalWithTimeZone(
  iCalContent: string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const taggedLines = unfoldICalLines(iCalContent).map((line) =>
    tagDateTimeProperty(line, timeZone),
  );

  return taggedLines.join("\n");
}
