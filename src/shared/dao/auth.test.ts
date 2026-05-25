import { describe, expect, it, beforeEach } from "vitest";
import {
  resetAuthForTests,
  getAuthSession,
  getOperatorId,
  getUserId,
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
});
