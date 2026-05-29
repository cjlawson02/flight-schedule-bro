import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import {
  FspRateLimitError,
  resetRequestQueueForTests,
  safeFetch,
} from "./api_wrapper.js";

vi.mock("./auth.js", () => ({
  getAuthToken: () => "token",
  getSubscriptionKey: () => "key",
}));

const ResponseSchema = z.object({ ok: z.boolean() });
const EmptyResponseSchema = z.object({});

function mockFetchResponse(options: {
  ok: boolean;
  status: number;
  body: string;
}): Response {
  return {
    ok: options.ok,
    status: options.status,
    text: async () => options.body,
  } as Response;
}

describe("safeFetch", () => {
  beforeEach(() => {
    resetRequestQueueForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockFetchResponse({
          ok: false,
          status: 400,
          body: JSON.stringify([
            { code: 1011, message: "Instructor is not valid." },
          ]),
        }),
      ),
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
      .mockResolvedValueOnce(
        mockFetchResponse({
          ok: true,
          status: 200,
          body: JSON.stringify({
            statusCode: 429,
            message: "Rate limit is exceeded. Try again in 0 seconds.",
          }),
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          ok: true,
          status: 200,
          body: JSON.stringify({ ok: true }),
        }),
      );

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
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse({
        ok: true,
        status: 200,
        body: JSON.stringify({
          statusCode: 429,
          message: "Rate limit is exceeded. Try again in 0 seconds.",
        }),
      }),
    );

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

  it("accepts 204 responses with an empty body", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse({
        ok: true,
        status: 204,
        body: "",
      }),
    );

    await expect(
      safeFetch(
        "https://example.com/test",
        "DELETE",
        { foo: "bar" },
        EmptyResponseSchema,
        0,
      ),
    ).resolves.toEqual({});
  });

  it("rejects ok responses with non-json bodies", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse({
        ok: true,
        status: 200,
        body: "<html>bad gateway</html>",
      }),
    );

    await expect(
      safeFetch(
        "https://example.com/test",
        "DELETE",
        { foo: "bar" },
        ResponseSchema,
        0,
      ),
    ).rejects.toThrow(/Failed to parse response body/);
  });
});
