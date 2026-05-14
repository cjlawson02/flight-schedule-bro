import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getMetadataFromKV,
  setMetadataInKV,
  refreshMetadata,
  getOrFetchMetadata,
} from "./metadata.js";
import type { FspMetadata } from "./types.js";
import * as instructorsDao from "../shared/dao/instructors.js";
import * as reservationTypesDao from "../shared/dao/reservationTypes.js";
import * as aircraftDao from "../shared/dao/aircraft.js";

// Mock the DAO modules
vi.mock("../shared/dao/instructors.js");
vi.mock("../shared/dao/reservationTypes.js");
vi.mock("../shared/dao/aircraft.js");

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
        instructors: [{ instructorId: "id1", displayName: "John Doe" }],
        reservationTypes: [
          { reservationTypeId: "rt1", reservationTypeName: "Dual" },
        ],
        aircraft: [{ aircraftId: "ac1", tailNumber: "N12345" }],
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
        instructors: [{ instructorId: "id1", displayName: "John Doe" }],
        reservationTypes: [
          { reservationTypeId: "rt1", reservationTypeName: "Dual" },
        ],
        aircraft: [{ aircraftId: "ac1", tailNumber: "N12345" }],
        lastUpdated: "2024-01-01T00:00:00Z",
      };

      await setMetadataInKV(mockKV, metadata);

      expect(mockKV.put).toHaveBeenCalledWith(
        "fsp-metadata",
        JSON.stringify(metadata)
      );
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
          { instructorId: "id1", displayName: "John Doe" },
          { instructorId: "id2", displayName: "Jane Smith" },
        ],
      };
      const mockReservationTypes = [
        { reservationTypeId: "rt1", reservationTypeName: "Dual" },
        { reservationTypeId: "rt2", reservationTypeName: "Solo" },
      ];
      const mockAircraft = {
        results: [
          { aircraftId: "ac1", tailNumber: "N12345" },
          { aircraftId: "ac2", tailNumber: "N67890" },
          {
            aircraftId: "00000000-0000-0000-0000-000000000000",
            tailNumber: "",
          }, // Should be filtered
        ],
      };

      vi.mocked(instructorsDao.getInstructors).mockResolvedValue(
        mockInstructors as any
      );
      vi.mocked(reservationTypesDao.getReservationTypes).mockResolvedValue(
        mockReservationTypes as any
      );
      vi.mocked(aircraftDao.getAircraft).mockResolvedValue(mockAircraft as any);

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
          { aircraftId: "ac1", tailNumber: "N12345" },
          {
            aircraftId: "00000000-0000-0000-0000-000000000000",
            tailNumber: "Invalid",
          },
          { aircraftId: "ac2", tailNumber: "  " }, // Empty after trim
          { aircraftId: "ac3", tailNumber: "N67890" },
        ],
      };

      vi.mocked(instructorsDao.getInstructors).mockResolvedValue({
        results: [],
      } as any);
      vi.mocked(reservationTypesDao.getReservationTypes).mockResolvedValue(
        [] as any
      );
      vi.mocked(aircraftDao.getAircraft).mockResolvedValue(mockAircraft as any);

      const result = await refreshMetadata(123, mockKV);

      expect(result.aircraft).toHaveLength(2);
      expect(result.aircraft).toEqual([
        { aircraftId: "ac1", tailNumber: "N12345" },
        { aircraftId: "ac3", tailNumber: "N67890" },
      ]);
    });

    it("trims aircraft tail numbers", async () => {
      const mockAircraft = {
        results: [{ aircraftId: "ac1", tailNumber: "  N12345  " }],
      };

      vi.mocked(instructorsDao.getInstructors).mockResolvedValue({
        results: [],
      } as any);
      vi.mocked(reservationTypesDao.getReservationTypes).mockResolvedValue(
        [] as any
      );
      vi.mocked(aircraftDao.getAircraft).mockResolvedValue(mockAircraft as any);

      const result = await refreshMetadata(123, mockKV);

      expect(result.aircraft[0].tailNumber).toBe("N12345");
    });
  });

  describe("getOrFetchMetadata", () => {
    it("returns cached metadata when available", async () => {
      const cachedMetadata: FspMetadata = {
        instructors: [{ instructorId: "id1", displayName: "John Doe" }],
        reservationTypes: [
          { reservationTypeId: "rt1", reservationTypeName: "Dual" },
        ],
        aircraft: [{ aircraftId: "ac1", tailNumber: "N12345" }],
        lastUpdated: "2024-01-01T00:00:00Z",
      };
      mockKV.get.mockResolvedValue(cachedMetadata);

      const result = await getOrFetchMetadata(123, mockKV);

      expect(result).toEqual(cachedMetadata);
      expect(mockKV.get).toHaveBeenCalled();
      // Should not call API if cache hit
      expect(instructorsDao.getInstructors).not.toHaveBeenCalled();
    });

    it("fetches from API when cache is empty", async () => {
      mockKV.get.mockResolvedValue(null);

      const mockInstructors = {
        results: [{ instructorId: "id1", displayName: "John" }],
      };
      const mockReservationTypes = [
        { reservationTypeId: "rt1", reservationTypeName: "Dual" },
      ];
      const mockAircraft = {
        results: [{ aircraftId: "ac1", tailNumber: "N12345" }],
      };

      vi.mocked(instructorsDao.getInstructors).mockResolvedValue(
        mockInstructors as any
      );
      vi.mocked(reservationTypesDao.getReservationTypes).mockResolvedValue(
        mockReservationTypes as any
      );
      vi.mocked(aircraftDao.getAircraft).mockResolvedValue(mockAircraft as any);

      const result = await getOrFetchMetadata(123, mockKV);

      expect(result.instructors).toHaveLength(1);
      expect(mockKV.put).toHaveBeenCalled();
    });
  });
});
