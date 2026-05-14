import { describe, it, expect, vi, beforeEach } from "vitest";
import { initializeWorker } from "./utils.js";
import * as apiWrapper from "../shared/dao/api_wrapper.js";

// Mock the api_wrapper module
vi.mock("../shared/dao/api_wrapper.js", () => ({
  setCacheAdapter: vi.fn(),
}));

describe("Worker Utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initializeWorker", () => {
    it("disables file-based caching", () => {
      initializeWorker();

      expect(apiWrapper.setCacheAdapter).toHaveBeenCalledOnce();
      expect(apiWrapper.setCacheAdapter).toHaveBeenCalledWith(null);
    });

    it("can be called multiple times safely", () => {
      initializeWorker();
      initializeWorker();
      initializeWorker();

      expect(apiWrapper.setCacheAdapter).toHaveBeenCalledTimes(3);
      expect(apiWrapper.setCacheAdapter).toHaveBeenCalledWith(null);
    });
  });
});
