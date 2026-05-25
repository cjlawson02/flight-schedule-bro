import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getMetadataFromKV,
  setMetadataInKV,
  refreshMetadata,
  getOrFetchMetadata,
  metadataNeedsRefresh,
} from "./metadata.js";
import type { FspMetadata } from "./types.js";
import { FspMetadataSchema } from "./types.js";
import * as instructorsDao from "../shared/dao/instructors.js";
import * as reservationTypesDao from "../shared/dao/reservationTypes.js";
import * as aircraftDao from "../shared/dao/aircraft.js";
import { createReservationTypeFixture } from "../shared/dao/reservationTypes.fixtures.js";

const INSTRUCTOR_ID_1 = "123e4567-e89b-12d3-a456-426614174000";
const INSTRUCTOR_ID_2 = "223e4567-e89b-12d3-a456-426614174001";

// Mock the DAO modules
vi.mock("../shared/dao/instructors.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../shared/dao/instructors.js")>();
  return {
    ...actual,
    getInstructors: vi.fn(),
  };
});
vi.mock("../shared/dao/reservationTypes.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../shared/dao/reservationTypes.js")>();
  return {
    ...actual,
    getReservationTypes: vi.fn(),
  };
});
vi.mock("../shared/dao/aircraft.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../shared/dao/aircraft.js")>();
  return {
    ...actual,
    getAircraft: vi.fn(),
  };
});

function mockReservationType(
  id: string,
  name: string,
  overrides: Record<string, unknown> = {},
) {
  return createReservationTypeFixture({
    reservationTypeId: id,
    reservationTypeName: name,
    aircraftEnabled: true,
    instructorEnabled: true,
    aircraftRequirement: 2,
    instructorRequirement: 2,
    ...overrides,
  });
}

describe("Worker Metadata", () => {
  let mockKV: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock KV namespace
    mockKV = {
      get: vi.fn(),
      put: vi.fn(),
    };
  });

  describe("getMetadataFromKV", () => {
    it("returns null when no metadata in KV", async () => {
      mockKV.get.mockResolvedValue(null);

      const result = await getMetadataFromKV(mockKV);

      expect(result).toBeNull();
      expect(mockKV.get).toHaveBeenCalledWith("fsp-metadata", "json");
    });

    it("returns parsed metadata when valid data in KV", async () => {
      const mockMetadata: FspMetadata = {
        instructors: [
          { instructorId: INSTRUCTOR_ID_1, displayName: "John Doe" },
        ],
        reservationTypes: [
          mockReservationType("11111111-1111-4111-8111-111111111111", "Dual"),
        ],
        aircraft: [
          {
            aircraftId: "33333333-3333-4333-8333-333333333333",
            tailNumber: "N12345",
          },
        ],
        lastUpdated: "2024-01-01T00:00:00Z",
      };
      mockKV.get.mockResolvedValue(mockMetadata);

      const result = await getMetadataFromKV(mockKV);

      expect(result).toEqual(mockMetadata);
    });

    it("returns null when metadata fails validation", async () => {
      const invalidData = { invalid: "data" };
      mockKV.get.mockResolvedValue(invalidData);

      const result = await getMetadataFromKV(mockKV);

      expect(result).toBeNull();
    });

    it("returns null when KV throws error", async () => {
      mockKV.get.mockRejectedValue(new Error("KV error"));

      const result = await getMetadataFromKV(mockKV);

      expect(result).toBeNull();
    });
  });

  describe("setMetadataInKV", () => {
    it("stores valid metadata in KV", async () => {
      const metadata: FspMetadata = {
        instructors: [
          { instructorId: INSTRUCTOR_ID_1, displayName: "John Doe" },
        ],
        reservationTypes: [
          mockReservationType("11111111-1111-4111-8111-111111111111", "Dual"),
        ],
        aircraft: [
          {
            aircraftId: "33333333-3333-4333-8333-333333333333",
            tailNumber: "N12345",
          },
        ],
        lastUpdated: "2024-01-01T00:00:00Z",
      };

      await setMetadataInKV(mockKV, metadata);

      expect(mockKV.put).toHaveBeenCalledWith(
        "fsp-metadata",
        expect.any(String),
      );
      expect(JSON.parse(String(mockKV.put.mock.calls[0][1]))).toEqual(metadata);
    });

    it("throws error when metadata is invalid", async () => {
      const invalidMetadata = { invalid: "data" } as any;

      await expect(setMetadataInKV(mockKV, invalidMetadata)).rejects.toThrow();
      expect(mockKV.put).not.toHaveBeenCalled();
    });
  });

  describe("refreshMetadata", () => {
    it("fetches metadata from API and stores in KV", async () => {
      const mockInstructors = {
        results: [
          { instructorId: INSTRUCTOR_ID_1, displayName: "John Doe" },
          { instructorId: INSTRUCTOR_ID_2, displayName: "Jane Smith" },
        ],
      };
      const mockReservationTypes = [
        mockReservationType("11111111-1111-4111-8111-111111111111", "Dual"),
        mockReservationType("22222222-2222-4222-8222-222222222222", "Solo"),
      ];
      const mockAircraft = {
        results: [
          {
            aircraftId: "33333333-3333-4333-8333-333333333333",
            tailNumber: "N12345",
            model: "172S",
          },
          {
            aircraftId: "44444444-4444-4444-8444-444444444444",
            tailNumber: "N67890",
            model: "172N",
          },
          {
            aircraftId: "00000000-0000-0000-0000-000000000000",
            tailNumber: "",
            model: "",
          }, // Should be filtered
        ],
      };

      vi.mocked(instructorsDao.getInstructors).mockResolvedValue(
        mockInstructors,
      );
      vi.mocked(reservationTypesDao.getReservationTypes).mockResolvedValue(
        mockReservationTypes,
      );
      vi.mocked(aircraftDao.getAircraft).mockResolvedValue(mockAircraft);

      const result = await refreshMetadata(123, mockKV);

      expect(result.instructors).toHaveLength(2);
      expect(result.reservationTypes).toHaveLength(2);
      expect(result.aircraft).toHaveLength(2); // Invalid aircraft filtered out
      expect(result.lastUpdated).toBeDefined();
      expect(mockKV.put).toHaveBeenCalled();
    });

    it("filters out invalid aircraft IDs", async () => {
      const mockAircraft = {
        results: [
          {
            aircraftId: "33333333-3333-4333-8333-333333333333",
            tailNumber: "N12345",
            model: "172S",
          },
          {
            aircraftId: "00000000-0000-0000-0000-000000000000",
            tailNumber: "Invalid",
            model: "",
          },
          {
            aircraftId: "44444444-4444-4444-8444-444444444444",
            tailNumber: "  ",
            model: "",
          },
          {
            aircraftId: "55555555-5555-4555-8555-555555555555",
            tailNumber: "N67890",
            model: "172N",
          },
        ],
      };

      vi.mocked(instructorsDao.getInstructors).mockResolvedValue({
        results: [],
      });
      vi.mocked(reservationTypesDao.getReservationTypes).mockResolvedValue([]);
      vi.mocked(aircraftDao.getAircraft).mockResolvedValue(mockAircraft);

      const result = await refreshMetadata(123, mockKV);

      expect(result.aircraft).toHaveLength(2);
      expect(result.aircraft).toEqual([
        {
          aircraftId: "33333333-3333-4333-8333-333333333333",
          tailNumber: "N12345",
        },
        {
          aircraftId: "55555555-5555-4555-8555-555555555555",
          tailNumber: "N67890",
        },
      ]);
    });

    it("trims aircraft tail numbers", async () => {
      const mockAircraft = {
        results: [
          {
            aircraftId: "33333333-3333-4333-8333-333333333333",
            tailNumber: "  N12345  ",
            model: "172S",
          },
        ],
      };

      vi.mocked(instructorsDao.getInstructors).mockResolvedValue({
        results: [],
      });
      vi.mocked(reservationTypesDao.getReservationTypes).mockResolvedValue([]);
      vi.mocked(aircraftDao.getAircraft).mockResolvedValue(mockAircraft);

      const result = await refreshMetadata(123, mockKV);

      expect(result.aircraft[0].tailNumber).toBe("N12345");
    });
  });

  describe("metadataNeedsRefresh", () => {
    it("detects legacy reservation types missing field metadata", () => {
      const legacy = FspMetadataSchema.parse({
        instructors: [],
        reservationTypes: [
          {
            reservationTypeId: "11111111-1111-4111-8111-111111111111",
            reservationTypeName: "Dual",
          },
        ],
        aircraft: [],
        lastUpdated: "2024-01-01T00:00:00Z",
      });

      expect(metadataNeedsRefresh(legacy)).toBe(true);
    });

    it("accepts reservation types with enabled fields", () => {
      expect(
        metadataNeedsRefresh({
          instructors: [],
          reservationTypes: [
            mockReservationType("11111111-1111-4111-8111-111111111111", "Dual"),
          ],
          aircraft: [],
          lastUpdated: "2024-01-01T00:00:00Z",
        }),
      ).toBe(false);
    });
  });

  describe("getOrFetchMetadata", () => {
    it("returns cached metadata when available", async () => {
      const cachedMetadata: FspMetadata = {
        instructors: [
          { instructorId: INSTRUCTOR_ID_1, displayName: "John Doe" },
        ],
        reservationTypes: [
          mockReservationType("11111111-1111-4111-8111-111111111111", "Dual"),
        ],
        aircraft: [
          {
            aircraftId: "33333333-3333-4333-8333-333333333333",
            tailNumber: "N12345",
          },
        ],
        lastUpdated: "2024-01-01T00:00:00Z",
      };
      mockKV.get.mockResolvedValue(cachedMetadata);

      const result = await getOrFetchMetadata(123, mockKV);

      expect(result).toEqual(cachedMetadata);
      expect(mockKV.get).toHaveBeenCalled();
      // Should not call API if cache hit
      expect(instructorsDao.getInstructors).not.toHaveBeenCalled();
    });

    it("refreshes legacy cached metadata missing reservation type fields", async () => {
      const legacyMetadata = {
        instructors: [{ instructorId: INSTRUCTOR_ID_1, displayName: "John" }],
        reservationTypes: [
          {
            reservationTypeId: "11111111-1111-4111-8111-111111111111",
            reservationTypeName: "Dual",
          },
        ],
        aircraft: [
          {
            aircraftId: "33333333-3333-4333-8333-333333333333",
            tailNumber: "N12345",
          },
        ],
        lastUpdated: "2024-01-01T00:00:00Z",
      };
      mockKV.get.mockResolvedValue(legacyMetadata);

      const refreshed = {
        instructors: [{ instructorId: INSTRUCTOR_ID_1, displayName: "John" }],
        reservationTypes: [
          mockReservationType("11111111-1111-4111-8111-111111111111", "Dual"),
        ],
        aircraft: [
          {
            aircraftId: "33333333-3333-4333-8333-333333333333",
            tailNumber: "N12345",
          },
        ],
        lastUpdated: "2026-05-25T00:00:00.000Z",
      };

      vi.mocked(instructorsDao.getInstructors).mockResolvedValue({
        results: refreshed.instructors.map((i) => ({
          instructorId: i.instructorId,
          displayName: i.displayName,
        })),
      });
      vi.mocked(reservationTypesDao.getReservationTypes).mockResolvedValue(
        refreshed.reservationTypes,
      );
      vi.mocked(aircraftDao.getAircraft).mockResolvedValue({
        results: refreshed.aircraft.map((a) => ({
          aircraftId: a.aircraftId,
          tailNumber: a.tailNumber,
          model: "172S",
        })),
      });

      const result = await getOrFetchMetadata(123, mockKV);

      expect(result.reservationTypes[0].aircraftEnabled).toBe(true);
      expect(instructorsDao.getInstructors).toHaveBeenCalled();
    });

    it("fetches from API when cache is empty", async () => {
      mockKV.get.mockResolvedValue(null);

      const mockInstructors = {
        results: [{ instructorId: INSTRUCTOR_ID_1, displayName: "John" }],
      };
      const mockReservationTypes = [
        mockReservationType("11111111-1111-4111-8111-111111111111", "Dual"),
      ];
      const mockAircraft = {
        results: [
          {
            aircraftId: "33333333-3333-4333-8333-333333333333",
            tailNumber: "N12345",
            model: "172S",
          },
        ],
      };

      vi.mocked(instructorsDao.getInstructors).mockResolvedValue(
        mockInstructors,
      );
      vi.mocked(reservationTypesDao.getReservationTypes).mockResolvedValue(
        mockReservationTypes,
      );
      vi.mocked(aircraftDao.getAircraft).mockResolvedValue(mockAircraft);

      const result = await getOrFetchMetadata(123, mockKV);

      expect(result.instructors).toHaveLength(1);
      expect(mockKV.put).toHaveBeenCalled();
    });
  });
});
