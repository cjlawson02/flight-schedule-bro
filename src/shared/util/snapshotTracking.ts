import {
  addOperatorDays,
  formatOperatorIsoDate,
  parseOperatorDateString,
} from "./flightTime.js";

export interface SnapshotTrackingMetadata {
  lastSearchDate: string;
  trackedThroughDate?: string;
  /** @deprecated Legacy snapshots only — use trackedThroughDate. */
  daysAhead?: number;
}

export function resolveTrackedThroughDate(
  metadata: SnapshotTrackingMetadata,
  timeZone: string,
): string {
  if (metadata.trackedThroughDate) {
    return metadata.trackedThroughDate;
  }

  const legacyDaysAhead = (metadata as { daysAhead?: number }).daysAhead;
  if (legacyDaysAhead != null) {
    const lastSearchDate = parseOperatorDateString(
      metadata.lastSearchDate,
      timeZone,
    );
    const trackedThrough = addOperatorDays(
      lastSearchDate,
      legacyDaysAhead,
      timeZone,
    );
    return formatOperatorIsoDate(trackedThrough, timeZone);
  }

  throw new Error(
    "Snapshot metadata must include trackedThroughDate or legacy daysAhead",
  );
}
