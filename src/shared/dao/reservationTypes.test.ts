import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getReservationTypes,
  ReservationTypeSchema,
} from "./reservationTypes.js";
import { createReservationTypeFixture } from "./reservationTypes.fixtures.js";
import * as apiWrapper from "./api_wrapper.js";

vi.mock("./api_wrapper.js");

describe("ReservationTypeSchema", () => {
  it("parses FSP responses that only include requirement levels", () => {
    const parsed = ReservationTypeSchema.parse({
      reservationTypeId: "22222222-2222-4222-8222-222222222222",
      reservationTypeName: "Rental",
      aircraftRequirement: 2,
      instructorRequirement: 0,
    });

    expect(parsed.aircraftEnabled).toBe(false);
    expect(parsed.aircraftRequirement).toBe(2);
  });

  it("applies defaults when FSP omits boolean and requirement fields", () => {
    const parsed = ReservationTypeSchema.parse({
      reservationTypeId: "11111111-1111-4111-8111-111111111111",
      reservationTypeName: "Legacy Type",
    });

    expect(parsed).toMatchObject({
      aircraftEnabled: false,
      instructorEnabled: false,
      flightTypeEnabled: false,
      flightRulesEnabled: false,
      flightHoursEnabled: false,
      flightRouteEnabled: false,
      aircraftRequirement: 0,
      instructorRequirement: 0,
      defaultLength: 120,
    });
  });
});

describe("getReservationTypes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches reservation types successfully", async () => {
    const mockResponse = [
      createReservationTypeFixture({
        reservationTypeId: "11111111-1111-4111-8111-111111111111",
        reservationTypeName: "Dual Instruction",
        aircraftEnabled: true,
        instructorEnabled: true,
        aircraftRequirement: 2,
        instructorRequirement: 2,
      }),
    ];

    vi.mocked(apiWrapper.safeFetch).mockResolvedValue(mockResponse);

    const result = await getReservationTypes(12345);

    expect(result).toEqual(mockResponse);
    expect(apiWrapper.safeFetch).toHaveBeenCalledWith(
      expect.stringContaining("operatorId=12345"),
      "GET",
      null,
      expect.any(Object), // Schema
      10 * 24 * 60 * 60 * 1000, // 10 days TTL
    );
  });

  it("constructs correct API URL", async () => {
    vi.mocked(apiWrapper.safeFetch).mockResolvedValue([]);

    await getReservationTypes(99999);

    const url = vi.mocked(apiWrapper.safeFetch).mock.calls[0][0];
    expect(url).toContain(
      "api-external.flightschedulepro.com/api/ReservationTypes",
    );
    expect(url).toContain("operatorId=99999");
  });

  it("refetches when cached reservation types lack field metadata", async () => {
    const legacy = [
      {
        reservationTypeId: "11111111-1111-4111-8111-111111111111",
        reservationTypeName: "Rental",
      },
    ];
    const fresh = [
      createReservationTypeFixture({
        reservationTypeId: "11111111-1111-4111-8111-111111111111",
        reservationTypeName: "Rental",
        aircraftEnabled: true,
        aircraftRequirement: 2,
      }),
    ];

    vi.mocked(apiWrapper.safeFetch)
      .mockResolvedValueOnce(legacy)
      .mockResolvedValueOnce(fresh);
    vi.mocked(apiWrapper.invalidateCache).mockResolvedValue(undefined);

    const result = await getReservationTypes(12345);

    expect(result).toEqual(fresh);
    expect(apiWrapper.invalidateCache).toHaveBeenCalledWith("ReservationTypes");
    expect(apiWrapper.safeFetch).toHaveBeenCalledTimes(2);
  });
});
