import { parseFspLocal } from "../util/flightTime.js";

export interface TimeInterval {
  start: Date;
  end: Date;
}

/** Parse FSP schedule grid local timestamp: "2026-07-06 17:00:00". */
export function parseScheduleLocal(
  localDateTime: string,
  timeZone: string,
): Date {
  const normalized = localDateTime.includes("T")
    ? localDateTime
    : localDateTime.replace(" ", "T");
  return parseFspLocal(normalized, timeZone);
}

function sortByStart(a: TimeInterval, b: TimeInterval): number {
  return a.start.getTime() - b.start.getTime();
}

/** Clip an interval to [dayStart, dayEnd]. Returns null when no overlap. */
export function clipInterval(
  interval: TimeInterval,
  dayStart: Date,
  dayEnd: Date,
): TimeInterval | null {
  const start = new Date(
    Math.max(interval.start.getTime(), dayStart.getTime()),
  );
  const end = new Date(Math.min(interval.end.getTime(), dayEnd.getTime()));

  if (start >= end) {
    return null;
  }

  return { start, end };
}

/** Union overlapping or adjacent busy intervals. */
export function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  if (intervals.length === 0) {
    return [];
  }

  const sorted = [...intervals].sort(sortByStart);
  const merged: TimeInterval[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.start.getTime() <= last.end.getTime()) {
      if (current.end.getTime() > last.end.getTime()) {
        last.end = current.end;
      }
      continue;
    }

    merged.push(current);
  }

  return merged;
}

/** Invert busy intervals within [dayStart, dayEnd] to free windows. */
export function invertIntervals(
  busy: TimeInterval[],
  dayStart: Date,
  dayEnd: Date,
): TimeInterval[] {
  const mergedBusy = mergeIntervals(busy);
  const free: TimeInterval[] = [];
  let cursor = dayStart;

  for (const block of mergedBusy) {
    if (block.start.getTime() > cursor.getTime()) {
      free.push({ start: cursor, end: block.start });
    }
    if (block.end.getTime() > cursor.getTime()) {
      cursor = block.end;
    }
  }

  if (cursor.getTime() < dayEnd.getTime()) {
    free.push({ start: cursor, end: dayEnd });
  }

  return free;
}

/** Generate candidate slots from free windows at a fixed step. */
export function slotsFromFree(
  free: TimeInterval[],
  durationMs: number,
  stepMs: number,
): TimeInterval[] {
  const slots: TimeInterval[] = [];

  for (const window of free) {
    let slotStart = window.start;

    while (slotStart.getTime() + durationMs <= window.end.getTime()) {
      slots.push({
        start: slotStart,
        end: new Date(slotStart.getTime() + durationMs),
      });
      slotStart = new Date(slotStart.getTime() + stepMs);
    }
  }

  return slots;
}

/** True when [start, end] fits entirely inside a free window. */
export function isIntervalFree(
  start: Date,
  end: Date,
  free: TimeInterval[],
): boolean {
  return free.some(
    (window) =>
      start.getTime() >= window.start.getTime() &&
      end.getTime() <= window.end.getTime(),
  );
}

export const SLOT_STEP_MINUTES = 30;

export function slotStepMs(): number {
  return SLOT_STEP_MINUTES * 60 * 1000;
}
