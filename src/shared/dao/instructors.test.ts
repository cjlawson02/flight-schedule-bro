import { describe, expect, it, vi, beforeEach } from "vitest";
import { getInstructors } from "./instructors.js";
import * as apiWrapper from "./api_wrapper.js";

vi.mock("./api_wrapper.js");

describe("getInstructors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches instructors successfully", async () => {
    const mockResponse = {
      results: [
        { instructorId: "inst-1", displayName: "John Doe" },
        { instructorId: "inst-2", displayName: "Jane Smith" },
      ],
    };

    vi.mocked(apiWrapper.safeFetch).mockResolvedValue(mockResponse);

    const result = await getInstructors(12345);

    expect(result).toEqual(mockResponse);
    expect(apiWrapper.safeFetch).toHaveBeenCalledWith(
      expect.stringContaining("operatorId=12345"),
      "GET",
      null,
      expect.any(Object), // Schema
      3 * 24 * 60 * 60 * 1000, // 3 days TTL
    );
  });

  it("constructs correct API URL", async () => {
    vi.mocked(apiWrapper.safeFetch).mockResolvedValue({ results: [] });

    await getInstructors(54321);

    const url = vi.mocked(apiWrapper.safeFetch).mock.calls[0][0];
    expect(url).toContain("api-external.flightschedulepro.com/api/instructors");
    expect(url).toContain("operatorId=54321");
  });
});
