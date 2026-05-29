import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getAircraft,
  isReservableAircraft,
  FSP_NIL_RESOURCE_ID,
  nilToOptionalResourceId,
  resolveMutationResourceId,
  resolveResourceId,
  selectPreferredAircraftIds,
} from "./aircraft.js";
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
      3 * 24 * 60 * 60 * 1000, // 3 days TTL
    );
  });

  it("includes correct query parameters", async () => {
    vi.mocked(apiWrapper.safeFetch).mockResolvedValue({ results: [] });

    await getAircraft(99999);

    const url = vi.mocked(apiWrapper.safeFetch).mock.calls[0][0];
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
      expect.any(Number),
    );
  });
});

describe("isReservableAircraft", () => {
  it("rejects nil aircraft ids and empty tail numbers", () => {
    expect(
      isReservableAircraft({
        aircraftId: FSP_NIL_RESOURCE_ID,
        tailNumber: "172N",
      }),
    ).toBe(false);
    expect(
      isReservableAircraft({
        aircraftId: "cc20d524-b205-43df-9670-5db41a761f87",
        tailNumber: "",
      }),
    ).toBe(false);
    expect(
      isReservableAircraft({
        aircraftId: "cc20d524-b205-43df-9670-5db41a761f87",
        tailNumber: "N713RE",
      }),
    ).toBe(true);
  });
});

describe("nilToOptionalResourceId", () => {
  it("returns undefined for nil UUIDs and missing values", () => {
    expect(nilToOptionalResourceId(FSP_NIL_RESOURCE_ID)).toBeUndefined();
    expect(nilToOptionalResourceId(undefined)).toBeUndefined();
    expect(nilToOptionalResourceId(null)).toBeUndefined();
    expect(
      nilToOptionalResourceId("cc20d524-b205-43df-9670-5db41a761f87"),
    ).toBe("cc20d524-b205-43df-9670-5db41a761f87");
  });
});

describe("resolveResourceId", () => {
  it("uses nil UUID for disabled resources on create payloads", () => {
    expect(resolveResourceId(false, "ac-1")).toBe(FSP_NIL_RESOURCE_ID);
    expect(resolveResourceId(true, undefined)).toBe(FSP_NIL_RESOURCE_ID);
    expect(resolveResourceId(true, "ac-1")).toBe("ac-1");
  });
});

describe("resolveMutationResourceId", () => {
  it("uses null for disabled resources on mutation payloads", () => {
    expect(resolveMutationResourceId(false, "ac-1")).toBeNull();
    expect(resolveMutationResourceId(true, undefined)).toBe(
      FSP_NIL_RESOURCE_ID,
    );
    expect(resolveMutationResourceId(true, "ac-1")).toBe("ac-1");
  });
});

describe("selectPreferredAircraftIds", () => {
  const aircraft = [
    { aircraftId: "ac-1", tailNumber: "N172S" },
    { aircraftId: "ac-2", tailNumber: "N172N" },
    { aircraftId: "ac-3", tailNumber: "N152" },
  ];

  it("returns preferred aircraft when regex matches", () => {
    expect(selectPreferredAircraftIds(aircraft, /172S|172N/i)).toEqual([
      "ac-1",
      "ac-2",
    ]);
  });

  it("returns all aircraft when nothing matches", () => {
    expect(selectPreferredAircraftIds(aircraft, /999/i)).toEqual([
      "ac-1",
      "ac-2",
      "ac-3",
    ]);
  });
});
