/** External subrequest limit per invocation on Workers Free. */
export const CLOUDFLARE_FREE_EXTERNAL_SUBREQUEST_LIMIT = 50;

/** Default unified subrequest limit per invocation on Workers Paid. */
export const CLOUDFLARE_PAID_SUBREQUEST_LIMIT = 10_000;

/** @deprecated Use CLOUDFLARE_FREE_EXTERNAL_SUBREQUEST_LIMIT */
export const CLOUDFLARE_SUBREQUEST_LIMIT =
  CLOUDFLARE_FREE_EXTERNAL_SUBREQUEST_LIMIT;

export interface SubrequestBudget {
  limit: number;
  used: number;
  /** Subrequests held back for work after schedule fetching (e.g. Discord). */
  reserve: number;
  /**
   * When true (Workers Paid), KV operations count toward the unified subrequest limit.
   * When false (Workers Free), only external fetch() calls are tracked — KV uses a
   * separate 1,000-op internal quota per Cloudflare docs.
   */
  countKvSubrequests: boolean;
}

export interface WorkerSubrequestBudgetOptions {
  paidMode?: boolean;
  /** Override limit (e.g. wrangler `limits.subrequests`). */
  limit?: number;
}

let activeBudget: SubrequestBudget | null = null;

export function parseWorkersPaidPlan(value?: string): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

export function createWorkerSubrequestBudget(
  options: WorkerSubrequestBudgetOptions = {},
): SubrequestBudget {
  const paidMode = options.paidMode ?? false;
  const limit =
    options.limit ??
    (paidMode
      ? CLOUDFLARE_PAID_SUBREQUEST_LIMIT
      : CLOUDFLARE_FREE_EXTERNAL_SUBREQUEST_LIMIT);

  return {
    limit,
    used: 0,
    reserve: 0,
    countKvSubrequests: paidMode,
  };
}

export function createSubrequestBudget(
  limit = CLOUDFLARE_FREE_EXTERNAL_SUBREQUEST_LIMIT,
  reserve = 0,
  countKvSubrequests = false,
): SubrequestBudget {
  return { limit, used: 0, reserve, countKvSubrequests };
}

export function setActiveSubrequestBudget(
  budget: SubrequestBudget | null,
): void {
  activeBudget = budget;
}

export function getActiveSubrequestBudget(): SubrequestBudget | null {
  return activeBudget;
}

export function canMakeSubrequest(budget: SubrequestBudget): boolean {
  return budget.used + 1 + budget.reserve <= budget.limit;
}

export function recordSubrequest(budget: SubrequestBudget, count = 1): void {
  budget.used += count;
}

/** Record an external fetch() subrequest against the active budget, if any. */
export function recordActiveSubrequest(count = 1): void {
  if (activeBudget) {
    recordSubrequest(activeBudget, count);
  }
}

/** Record a KV subrequest when the budget tracks internal ops (Workers Paid). */
export function recordActiveKvSubrequest(count = 1): void {
  if (activeBudget?.countKvSubrequests) {
    recordSubrequest(activeBudget, count);
  }
}

export function subrequestsRemaining(budget: SubrequestBudget): number {
  return Math.max(0, budget.limit - budget.used - budget.reserve);
}
