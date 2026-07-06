import { describe, expect, it, beforeEach } from "vitest";
import {
  resetAuthForTests,
  getAuthSession,
  getOperatorId,
  getUserId,
  setActiveAuthSession,
} from "./auth.js";

describe("auth session", () => {
  beforeEach(() => {
    resetAuthForTests();
  });

  it("requires authentication before reading operator context", () => {
    expect(() => getOperatorId()).toThrow(/Not authenticated/);
    expect(() => getUserId()).toThrow(/Not authenticated/);
  });

  it("starts with no active session", () => {
    expect(getAuthSession()).toBeNull();
  });

  it("clears session state for tests", () => {
    resetAuthForTests();
    expect(getAuthSession()).toBeNull();
  });

  it("reads operator context from the active session", () => {
    setActiveAuthSession({
      sessionCookies: "session=abc",
      operatorId: 42,
      subscriptionKey: "sub",
      authToken: "token",
      userId: "11111111-1111-4111-8111-111111111111",
      pilotId: "22222222-2222-4222-8222-222222222222",
      defaultLocationId: 99,
    });

    expect(getOperatorId()).toBe(42);
    expect(getUserId()).toBe("11111111-1111-4111-8111-111111111111");
  });
});
