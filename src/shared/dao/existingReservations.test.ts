import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getExistingReservations,
  hasReservationOnSameDay,
  ExistingReservation,
} from "./existingReservations.js";
import * as apiWrapper from "./api_wrapper.js";

vi.mock("./api_wrapper.js");

describe("getExistingReservations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches existing reservations from the API", async () => {
    const mockResponse = {
      total: 2,
      results: [
        {
          reservationId: "res-1",
          start: "2025-11-04T17:00:00",
          end: "2025-11-04T19:00:00",
          instructor: "Doug Libal",
          resource: "N65411",
        },
        {
          reservationId: "res-2",
          start: "2025-11-05T11:00:00",
          end: "2025-11-05T13:00:00",
          instructor: "Jason Hull",
          resource: "N734UZ",
        },
      ],
    };

    vi.mocked(apiWrapper.safeFetch).mockResolvedValue(mockResponse);

    const result = await getExistingReservations(191057, -420);

    expect(apiWrapper.safeFetch).toHaveBeenCalledWith(
      expect.stringContaining("api/V2/Reservation"),
      "GET",
      null,
      expect.any(Object),
      5 * 60 * 1000,
    );
    expect(result).toEqual(mockResponse.results);
  });

  it("uses correct query parameters", async () => {
    vi.mocked(apiWrapper.safeFetch).mockResolvedValue({
      total: 0,
      results: [],
    });

    await getExistingReservations(12345, -480);

    const url = vi.mocked(apiWrapper.safeFetch).mock.calls[0][0];
    expect(url).toContain("operatorId=12345");
    expect(url).toContain("timeZoneBias=-480");
    expect(url).toContain("dateTypeFilter=1");
    expect(url).toContain("pageSize=100");
  });
});

describe("hasReservationOnSameDay", () => {
  const existingReservations: ExistingReservation[] = [
    {
      reservationId: "res-1",
      start: "2025-11-04T17:00:00",
      end: "2025-11-04T19:00:00",
      instructor: "Doug Libal",
      resource: "N65411",
    },
    {
      reservationId: "res-2",
      start: "2025-11-06T11:00:00",
      end: "2025-11-06T13:00:00",
      instructor: "Jason Hull",
      resource: "N734UZ",
    },
  ];

  it("returns true when slot is on same day as existing reservation (same time)", () => {
    const slotStart = new Date("2025-11-04T17:00:00");
    expect(hasReservationOnSameDay(slotStart, existingReservations)).toBe(true);
  });

  it("returns true when slot is on same day as existing reservation (different time)", () => {
    const slotStart = new Date("2025-11-04T09:00:00"); // Earlier in the day
    expect(hasReservationOnSameDay(slotStart, existingReservations)).toBe(true);
  });

  it("returns true when slot is on same day as existing reservation (late in day)", () => {
    const slotStart = new Date("2025-11-06T20:00:00"); // Later in the day
    expect(hasReservationOnSameDay(slotStart, existingReservations)).toBe(true);
  });

  it("returns false when slot is on different day with no reservations", () => {
    const slotStart = new Date("2025-11-05T17:00:00"); // Day with no reservations
    expect(hasReservationOnSameDay(slotStart, existingReservations)).toBe(
      false,
    );
  });

  it("returns false when slot is day before existing reservation", () => {
    const slotStart = new Date("2025-11-03T17:00:00"); // Day before
    expect(hasReservationOnSameDay(slotStart, existingReservations)).toBe(
      false,
    );
  });

  it("returns false when slot is day after existing reservation", () => {
    const slotStart = new Date("2025-11-07T17:00:00"); // Day after
    expect(hasReservationOnSameDay(slotStart, existingReservations)).toBe(
      false,
    );
  });

  it("returns false when there are no existing reservations", () => {
    const slotStart = new Date("2025-11-04T17:00:00");
    expect(hasReservationOnSameDay(slotStart, [])).toBe(false);
  });

  it("handles multiple reservations on same day correctly", () => {
    const multipleOnSameDay: ExistingReservation[] = [
      {
        reservationId: "res-1",
        start: "2025-11-04T09:00:00",
        end: "2025-11-04T11:00:00",
      },
      {
        reservationId: "res-2",
        start: "2025-11-04T17:00:00",
        end: "2025-11-04T19:00:00",
      },
    ];

    const slotStart = new Date("2025-11-04T13:00:00"); // Between the two
    expect(hasReservationOnSameDay(slotStart, multipleOnSameDay)).toBe(true);
  });
});
