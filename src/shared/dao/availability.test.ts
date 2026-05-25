import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  clearInvalidInstructorIds,
  enabledDaysForSearchDates,
  excludeInvalidInstructors,
  fetchAvailability,
  AvailabilityResultSchema,
  getInvalidInstructorIds,
  prepareInstructorChunks,
} from "./availability.js";
import { FspHttpError } from "./api_wrapper.js";
import * as apiWrapper from "./api_wrapper.js";

vi.mock("./api_wrapper.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api_wrapper.js")>();
  return {
    ...actual,
    safeFetch: vi.fn(),
  };
});

describe("fetchAvailability", () => {
  beforeEach(() => {
    vi.mocked(apiWrapper.safeFetch).mockReset();
    clearInvalidInstructorIds();
  });

  const baseParams = {
    customerUserGuid: "customer-1",
    locationId: 20852,
    activityTypeId: "activity-1",
    aircraftIds: ["aircraft-1"],
    startDate: "2026-05-25",
    endDate: "2026-05-25",
    operatorId: 191057,
  };

  it("returns availability results when all instructors are valid", async () => {
    const mockResponse = [
      {
        timeBlocks: [
          { startAt: "2026-05-25T15:00", endAt: "2026-05-25T17:00" },
        ],
        flightInstructorId: "00000000-0000-0000-0000-000000000001",
        aircraftId: "00000000-0000-0000-0000-000000000002",
      },
    ];

    vi.mocked(apiWrapper.safeFetch).mockResolvedValue(mockResponse);

    const result = await fetchAvailability({
      ...baseParams,
      instructors: [
        "00000000-0000-0000-0000-000000000003",
        "00000000-0000-0000-0000-000000000004",
      ],
    });

    expect(result).toEqual(mockResponse);
    expect(apiWrapper.safeFetch).toHaveBeenCalledTimes(1);
  });

  it("searches aircraft-only reservation types with an empty instructors array", async () => {
    const mockResponse = [
      {
        timeBlocks: [
          { startAt: "2026-05-25T15:00", endAt: "2026-05-25T17:00" },
        ],
        flightInstructorId: null,
        aircraftId: "cc20d524-b205-43df-9670-5db41a761f87",
      },
    ];

    expect(
      AvailabilityResultSchema.array().safeParse(mockResponse).success,
    ).toBe(true);

    vi.mocked(apiWrapper.safeFetch).mockResolvedValue(mockResponse);

    const result = await fetchAvailability({
      ...baseParams,
      instructors: [],
    });

    expect(result).toEqual(mockResponse);
    expect(apiWrapper.safeFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiWrapper.safeFetch).mock.calls[0][2]).toMatchObject({
      instructors: [],
      aircrafts: ["aircraft-1"],
    });
  });

  it("returns an empty array when both instructors and aircraft are absent", async () => {
    const result = await fetchAvailability({
      ...baseParams,
      instructors: [],
      aircraftIds: [],
    });

    expect(result).toEqual([]);
    expect(apiWrapper.safeFetch).not.toHaveBeenCalled();
  });

  it("enables only the search date day of week in the request body", async () => {
    vi.mocked(apiWrapper.safeFetch).mockResolvedValue([]);

    await fetchAvailability({
      ...baseParams,
      instructors: ["00000000-0000-0000-0000-000000000001"],
      startDate: "2026-05-31",
      endDate: "2026-05-31",
      timeZone: "America/Los_Angeles",
    });

    expect(vi.mocked(apiWrapper.safeFetch).mock.calls[0][2]).toMatchObject({
      enabledDays: {
        sundayEnabled: true,
        mondayEnabled: false,
        tuesdayEnabled: false,
        wednesdayEnabled: false,
        thursdayEnabled: false,
        fridayEnabled: false,
        saturdayEnabled: false,
      },
    });
  });

  it("retries without invalid instructors and remembers them", async () => {
    vi.mocked(apiWrapper.safeFetch)
      .mockRejectedValueOnce(
        new FspHttpError(400, [
          {
            code: 1011,
            message: "Instructor is not valid.",
            dataField: "Instructors[0]",
          },
        ]),
      )
      .mockResolvedValueOnce([]);

    const result = await fetchAvailability({
      ...baseParams,
      instructors: ["invalid-inst", "valid-inst"],
    });

    expect(result).toEqual([]);
    expect(apiWrapper.safeFetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(apiWrapper.safeFetch).mock.calls[1][2]).toMatchObject({
      instructors: ["valid-inst"],
    });
    expect(getInvalidInstructorIds().has("invalid-inst")).toBe(true);
    expect(excludeInvalidInstructors(["invalid-inst", "valid-inst"])).toEqual([
      "valid-inst",
    ]);
  });

  it("clears instructor blacklist between invocations", async () => {
    vi.mocked(apiWrapper.safeFetch).mockRejectedValue(
      new FspHttpError(400, [
        {
          code: 1011,
          message: "Instructor is not valid.",
          dataField: "Instructors[0]",
        },
      ]),
    );

    await fetchAvailability({
      ...baseParams,
      instructors: ["invalid-inst"],
    });

    expect(getInvalidInstructorIds().has("invalid-inst")).toBe(true);

    clearInvalidInstructorIds();

    await fetchAvailability({
      ...baseParams,
      instructors: ["invalid-inst"],
    });

    expect(apiWrapper.safeFetch).toHaveBeenCalledTimes(2);
  });

  it("returns an empty array when every instructor in the chunk is invalid", async () => {
    vi.mocked(apiWrapper.safeFetch)
      .mockRejectedValueOnce(
        new FspHttpError(400, [
          {
            code: 1011,
            message: "Instructor is not valid.",
            dataField: "Instructors[0]",
          },
        ]),
      )
      .mockRejectedValueOnce(
        new FspHttpError(400, [
          {
            code: 1011,
            message: "Instructor is not valid.",
            dataField: "Instructors[0]",
          },
        ]),
      );

    const result = await fetchAvailability({
      ...baseParams,
      instructors: ["invalid-1", "invalid-2"],
    });

    expect(result).toEqual([]);
    expect(apiWrapper.safeFetch).toHaveBeenCalledTimes(2);
  });

  it("rethrows non-instructor validation errors", async () => {
    const error = new FspHttpError(400, [
      { code: 9999, message: "Bad request." },
    ]);
    vi.mocked(apiWrapper.safeFetch).mockRejectedValue(error);

    await expect(
      fetchAvailability({
        ...baseParams,
        instructors: ["inst-1"],
      }),
    ).rejects.toThrow(FspHttpError);
  });
});

describe("enabledDaysForSearchDates", () => {
  it("enables only the matching weekday for a single-day search", () => {
    expect(
      enabledDaysForSearchDates(
        "2026-05-31",
        "2026-05-31",
        "America/Los_Angeles",
      ),
    ).toEqual({
      sundayEnabled: true,
      mondayEnabled: false,
      tuesdayEnabled: false,
      wednesdayEnabled: false,
      thursdayEnabled: false,
      fridayEnabled: false,
      saturdayEnabled: false,
    });
  });

  it("enables all days for a multi-day search range", () => {
    expect(
      enabledDaysForSearchDates(
        "2026-05-31",
        "2026-06-07",
        "America/Los_Angeles",
      ).mondayEnabled,
    ).toBe(true);
  });
});

describe("prepareInstructorChunks", () => {
  beforeEach(() => {
    clearInvalidInstructorIds();
  });

  it("returns filtered instructor chunks when instructors are present", () => {
    expect(
      prepareInstructorChunks(
        [["inst-1", "inst-2"], ["inst-3"]],
        ["aircraft-1"],
      ),
    ).toEqual([["inst-1", "inst-2"], ["inst-3"]]);
  });

  it("returns a single empty chunk for aircraft-only searches", () => {
    expect(prepareInstructorChunks([], ["aircraft-1"])).toEqual([[]]);
  });

  it("returns an empty array when no instructors or aircraft are available", () => {
    expect(prepareInstructorChunks([], [])).toEqual([]);
  });
});
