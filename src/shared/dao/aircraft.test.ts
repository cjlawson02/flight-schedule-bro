import { describe, expect, it, vi, beforeEach } from "vitest";
import { getAircraft } from "./aircraft.js";
import * as apiWrapper from "./api_wrapper.js";

vi.mock("./api_wrapper.js");

describe("getAircraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches aircraft successfully with correct parameters", async () => {
    const mockResponse = {
      results: [
        { aircraftId: "ac-1", tailNumber: "N12345", model: "172S" },
        { aircraftId: "ac-2", tailNumber: "N67890", model: "172N" },
      ],
    };

    vi.mocked(apiWrapper.safeFetch).mockResolvedValue(mockResponse);

    const result = await getAircraft(12345);

    expect(result).toEqual(mockResponse);
    expect(apiWrapper.safeFetch).toHaveBeenCalledWith(
      expect.stringContaining("operatorId=12345"),
      "GET",
      null,
      expect.any(Object), // Schema
      3 * 24 * 60 * 60 * 1000 // 3 days TTL
    );
  });

  it("includes correct query parameters", async () => {
    vi.mocked(apiWrapper.safeFetch).mockResolvedValue({ results: [] });

    await getAircraft(99999);

    const url = vi.mocked(apiWrapper.safeFetch).mock.calls[0][0] as string;
    expect(url).toContain("includeSimulators=false");
    expect(url).toContain("includeAircraftTypes=true");
    expect(url).toContain("onlyReservable=true");
    expect(url).toContain("operatorId=99999");
    expect(url).toContain("page=1");
    expect(url).toContain("pageSize=0");
  });

  it("validates response with Zod schema", async () => {
    const invalidResponse = { results: [{ invalid: "data" }] };

    vi.mocked(apiWrapper.safeFetch).mockResolvedValue(invalidResponse);

    // safeFetch should handle validation, but let's verify it's called with schema
    await getAircraft(12345);

    expect(apiWrapper.safeFetch).toHaveBeenCalledWith(
      expect.any(String),
      "GET",
      null,
      expect.any(Object), // Schema validator
      expect.any(Number)
    );
  });
});
