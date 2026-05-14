import { describe, expect, it, vi, beforeEach } from "vitest";
import { getReservationTypes } from "./reservationTypes.js";
import * as apiWrapper from "./api_wrapper.js";

vi.mock("./api_wrapper.js");

describe("getReservationTypes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches reservation types successfully", async () => {
    const mockResponse = [
      { reservationTypeId: "type-1", reservationTypeName: "Dual Instruction" },
      { reservationTypeId: "type-2", reservationTypeName: "Solo" },
      { reservationTypeId: "type-3", reservationTypeName: "Checkout" },
    ];

    vi.mocked(apiWrapper.safeFetch).mockResolvedValue(mockResponse);

    const result = await getReservationTypes(12345);

    expect(result).toEqual(mockResponse);
    expect(apiWrapper.safeFetch).toHaveBeenCalledWith(
      expect.stringContaining("operatorId=12345"),
      "GET",
      null,
      expect.any(Object), // Schema
      10 * 24 * 60 * 60 * 1000 // 10 days TTL
    );
  });

  it("constructs correct API URL", async () => {
    vi.mocked(apiWrapper.safeFetch).mockResolvedValue([]);

    await getReservationTypes(99999);

    const url = vi.mocked(apiWrapper.safeFetch).mock.calls[0][0] as string;
    expect(url).toContain(
      "api-external.flightschedulepro.com/api/ReservationTypes"
    );
    expect(url).toContain("operatorId=99999");
  });
});
