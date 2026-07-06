import { describe, expect, it } from "vitest";
import {
  CLOUDFLARE_FREE_EXTERNAL_SUBREQUEST_LIMIT,
  CLOUDFLARE_PAID_SUBREQUEST_LIMIT,
  createWorkerSubrequestBudget,
  parseWorkersPaidPlan,
  recordActiveKvSubrequest,
  recordActiveSubrequest,
  setActiveSubrequestBudget,
} from "./subrequestBudget.js";

describe("parseWorkersPaidPlan", () => {
  it("defaults to free plan", () => {
    expect(parseWorkersPaidPlan(undefined)).toBe(false);
    expect(parseWorkersPaidPlan("false")).toBe(false);
  });

  it("recognizes paid plan truthy values", () => {
    expect(parseWorkersPaidPlan("true")).toBe(true);
    expect(parseWorkersPaidPlan("1")).toBe(true);
    expect(parseWorkersPaidPlan("yes")).toBe(true);
  });
});

describe("createWorkerSubrequestBudget", () => {
  it("uses the free external limit and ignores KV by default", () => {
    const budget = createWorkerSubrequestBudget();
    expect(budget.limit).toBe(CLOUDFLARE_FREE_EXTERNAL_SUBREQUEST_LIMIT);
    expect(budget.countKvSubrequests).toBe(false);
  });

  it("uses the paid unified limit and counts KV", () => {
    const budget = createWorkerSubrequestBudget({ paidMode: true });
    expect(budget.limit).toBe(CLOUDFLARE_PAID_SUBREQUEST_LIMIT);
    expect(budget.countKvSubrequests).toBe(true);
  });

  it("allows a custom limit override", () => {
    const budget = createWorkerSubrequestBudget({
      paidMode: true,
      limit: 500,
    });
    expect(budget.limit).toBe(500);
  });
});

describe("recordActiveKvSubrequest", () => {
  it("does not count KV on the free plan", () => {
    const budget = createWorkerSubrequestBudget();
    setActiveSubrequestBudget(budget);
    recordActiveKvSubrequest();
    expect(budget.used).toBe(0);
    setActiveSubrequestBudget(null);
  });

  it("counts KV on the paid plan", () => {
    const budget = createWorkerSubrequestBudget({ paidMode: true });
    setActiveSubrequestBudget(budget);
    recordActiveKvSubrequest(2);
    recordActiveSubrequest(1);
    expect(budget.used).toBe(3);
    setActiveSubrequestBudget(null);
  });
});
