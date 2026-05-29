import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getExistingReservations,
  getReservationStart,
  getUpcomingReservations,
  hasReservationOnSameDay,
  ExistingReservation,
} from "./existingReservations.js";
import * as apiWrapper from "./api_wrapper.js";
import { parseFspLocal } from "../util/flightTime.js";

vi.mock("./api_wrapper.js");

const LA = "America/Los_Angeles";

const sampleReservations: ExistingReservation[] = [
  {
    reservationId: "7fd24fb6-977f-4b4a-89ac-dc949030d234",
    start: "2025-11-04T17:00:00",
    end: "2025-11-04T19:00:00",
    startUtc: "2025-11-05T01:00:00",
    endUtc: "2025-11-05T03:00:00",
    instructor: "Doug Libal",
    resource: "N65411",
  },
  {
    reservationId: "7e63e451-783a-4323-98ba-10b556d12d07",
    start: "2025-11-06T11:00:00",
    end: "2025-11-06T13:00:00",
    instructor: "Jason Hull",
    resource: "N734UZ",
  },
];

describe("getExistingReservations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches existing reservations from the API", async () => {
    const mockResponse = {
      total: 2,
      results: [
        {
          reservationId: "7fd24fb6-977f-4b4a-89ac-dc949030d234",
          start: "2025-11-04T17:00:00",
          end: "2025-11-04T19:00:00",
          startUtc: "2025-11-05T01:00:00",
          endUtc: "2025-11-05T03:00:00",
          instructor: "Doug Libal",
          resource: "N65411",
        },
        {
          reservationId: "7e63e451-783a-4323-98ba-10b556d12d07",
          start: "2025-11-05T11:00:00",
          end: "2025-11-05T13:00:00",
          instructor: "Jason Hull",
          resource: "N734UZ",
        },
      ],
    };

    vi.mocked(apiWrapper.safeFetch).mockResolvedValue(mockResponse);

    const result = await getExistingReservations(191057, LA);

    expect(apiWrapper.safeFetch).toHaveBeenCalledWith(
      expect.stringContaining("api/V2/Reservation"),
      "GET",
      null,
      expect.any(Object),
      5 * 60 * 1000,
    );
    expect(result).toEqual(mockResponse.results);
  });

  it("uses FSP timeZoneBias derived from the operator timezone", async () => {
    vi.mocked(apiWrapper.safeFetch).mockResolvedValue({
      total: 0,
      results: [],
    });

    await getExistingReservations(12345, LA);

    const url = vi.mocked(apiWrapper.safeFetch).mock.calls[0][0];
    expect(url).toContain("operatorId=12345");
    expect(url).toMatch(/timeZoneBias=-(420|480)/);
    expect(url).toContain("dateTypeFilter=1");
    expect(url).toContain("pageSize=100");
  });
});

describe("getReservationStart", () => {
  it("prefers startUtc over local wall-clock time", () => {
    const reservation: ExistingReservation = {
      reservationId: "7fd24fb6-977f-4b4a-89ac-dc949030d234",
      start: "2025-11-04T09:00:00",
      end: "2025-11-04T11:00:00",
      startUtc: "2025-11-05T01:00:00",
    };

    expect(getReservationStart(reservation, LA).toISOString()).toBe(
      "2025-11-05T01:00:00.000Z",
    );
  });
});

describe("hasReservationOnSameDay", () => {
  const existingReservations = sampleReservations;

  it("returns true when slot is on same operator calendar day (same time)", () => {
    const slotStart = parseFspLocal("2025-11-04T17:00:00", LA);
    expect(hasReservationOnSameDay(slotStart, existingReservations, LA)).toBe(
      true,
    );
  });

  it("returns true for a different time on the same day", () => {
    const slotStart = parseFspLocal("2025-11-04T09:00:00", LA);
    expect(hasReservationOnSameDay(slotStart, existingReservations, LA)).toBe(
      true,
    );
  });

  it("returns true when slot is on same day as existing reservation (late in day)", () => {
    const slotStart = parseFspLocal("2025-11-06T20:00:00", LA);
    expect(hasReservationOnSameDay(slotStart, existingReservations, LA)).toBe(
      true,
    );
  });

  it("returns false when slot is on a different day with no reservations", () => {
    const slotStart = parseFspLocal("2025-11-05T17:00:00", LA);
    expect(hasReservationOnSameDay(slotStart, existingReservations, LA)).toBe(
      false,
    );
  });

  it("returns false when slot is day before existing reservation", () => {
    const slotStart = parseFspLocal("2025-11-03T17:00:00", LA);
    expect(hasReservationOnSameDay(slotStart, existingReservations, LA)).toBe(
      false,
    );
  });

  it("returns false when slot is day after existing reservation", () => {
    const slotStart = parseFspLocal("2025-11-07T17:00:00", LA);
    expect(hasReservationOnSameDay(slotStart, existingReservations, LA)).toBe(
      false,
    );
  });

  it("returns false when there are no existing reservations", () => {
    const slotStart = parseFspLocal("2025-11-04T17:00:00", LA);
    expect(hasReservationOnSameDay(slotStart, [], LA)).toBe(false);
  });

  it("returns true when a reservation exists on the same day", () => {
    const slotStart = parseFspLocal("2025-11-04T17:00:00", LA);
    expect(hasReservationOnSameDay(slotStart, existingReservations, LA)).toBe(
      true,
    );
  });
});

describe("getUpcomingReservations", () => {
  it("returns only reservations that have not ended yet, sorted by start time", () => {
    const now = parseFspLocal("2025-11-05T12:00:00", LA);

    expect(getUpcomingReservations(sampleReservations, LA, now)).toEqual([
      sampleReservations[1],
    ]);
  });

  it("includes reservations that are currently in progress", () => {
    const now = parseFspLocal("2025-11-04T18:00:00", LA);

    expect(getUpcomingReservations(sampleReservations, LA, now)).toEqual([
      sampleReservations[0],
      sampleReservations[1],
    ]);
  });
});
