import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import {
  FspHttpError,
  FspRateLimitError,
  resetRequestQueueForTests,
  safeFetch,
} from "./api_wrapper.js";

vi.mock("./auth.js", () => ({
  getAuthToken: () => "token",
  getSubscriptionKey: () => "key",
}));

const ResponseSchema = z.object({ ok: z.boolean() });

describe("safeFetch", () => {
  beforeEach(() => {
    resetRequestQueueForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => [{ code: 1011, message: "Instructor is not valid." }],
      }),
    );
  });

  afterEach(() => {
    resetRequestQueueForTests();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("does not retry 4xx client errors", async () => {
    await expect(
      safeFetch(
        "https://example.com/test",
        "POST",
        { foo: "bar" },
        ResponseSchema,
        0,
      ),
    ).rejects.toMatchObject({ name: "FspHttpError", status: 400 });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries rate limit responses until success", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          statusCode: 429,
          message: "Rate limit is exceeded. Try again in 0 seconds.",
        }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as any);

    await expect(
      safeFetch(
        "https://example.com/test",
        "POST",
        { foo: "bar" },
        ResponseSchema,
        0,
      ),
    ).resolves.toEqual({ ok: true });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("throws a rate limit error instead of failing zod parse", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        statusCode: 429,
        message: "Rate limit is exceeded. Try again in 0 seconds.",
      }),
    } as any);

    await expect(
      safeFetch(
        "https://example.com/test",
        "POST",
        { foo: "bar" },
        ResponseSchema,
        0,
      ),
    ).rejects.toBeInstanceOf(FspRateLimitError);

    expect(fetch).toHaveBeenCalledTimes(8);
  });
});
