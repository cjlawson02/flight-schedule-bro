import { describe, it, expect } from "vitest";
import { chunk } from "./array.js";

describe("Array Utils", () => {
  describe("chunk", () => {
    it("chunks array into equal-sized chunks", () => {
      const input = [1, 2, 3, 4, 5, 6];
      const result = chunk(input, 2);
      expect(result).toEqual([
        [1, 2],
        [3, 4],
        [5, 6],
      ]);
    });

    it("handles array not evenly divisible by chunk size", () => {
      const input = [1, 2, 3, 4, 5];
      const result = chunk(input, 2);
      expect(result).toEqual([[1, 2], [3, 4], [5]]);
    });

    it("returns single chunk when array smaller than chunk size", () => {
      const input = [1, 2];
      const result = chunk(input, 5);
      expect(result).toEqual([[1, 2]]);
    });

    it("returns empty array for empty input", () => {
      const result = chunk([], 3);
      expect(result).toEqual([]);
    });

    it("handles chunk size of 1", () => {
      const input = [1, 2, 3];
      const result = chunk(input, 1);
      expect(result).toEqual([[1], [2], [3]]);
    });

    it("handles string arrays", () => {
      const input = ["a", "b", "c", "d", "e"];
      const result = chunk(input, 3);
      expect(result).toEqual([
        ["a", "b", "c"],
        ["d", "e"],
      ]);
    });

    it("handles the API limit use case (3 instructors per request)", () => {
      const instructorIds = ["id1", "id2", "id3", "id4", "id5", "id6", "id7"];
      const result = chunk(instructorIds, 3);
      expect(result).toEqual([
        ["id1", "id2", "id3"],
        ["id4", "id5", "id6"],
        ["id7"],
      ]);
      expect(result.length).toBe(3);
    });
  });
});
