import { z } from "zod";
import { createLogger } from "../util/logger.js";
import { recordActiveSubrequest } from "../util/subrequestBudget.js";

const log = createLogger("auth");

export interface AuthSession {
  sessionCookies: string;
  operatorId: number;
  subscriptionKey: string;
  authToken: string;
  userId: string;
  pilotId: string;
  defaultLocationId: number;
}

let currentSession: AuthSession | null = null;

/**
 * Zod schema for AccountAppContext response
 */
const AccountAppContextSchema = z.object({
  subscriptionKey: z.string(),
  // Add other fields if needed, but we only care about subscriptionKey
});

/**
 * Zod schema for FspApp cookie data
 */
const FspAppCookieSchema = z.object({
  token: z.string(),
  operatorId: z.number(),
});

/**
 * Zod schema for MyOperators list response (without operator ID)
 */
const MyOperatorsListSchema = z.object({
  companies: z.array(
    z.object({
      id: z.number(),
    }),
  ),
});

/**
 * Zod schema for MyOperators detail response (with operator ID)
 */
const MyOperatorsDetailSchema = z.object({
  userId: z.uuid(),
  pilotId: z.uuid(),
  operatorId: z.number(),
  defaultLocationId: z.number(),
});

function getSetCookieHeaders(headers: Headers): string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] })
    .getSetCookie;
  return getSetCookie?.call(headers) ?? [];
}

function requireSession(): AuthSession {
  if (!currentSession) {
    throw new Error("Not authenticated. Please login first.");
  }
  return currentSession;
}

export function resetAuthForTests(): void {
  currentSession = null;
}

export function getAuthSession(): AuthSession | null {
  return currentSession;
}

export function getSessionCookies(): string | null {
  return currentSession?.sessionCookies ?? null;
}

export function getOperatorId(): number {
  return requireSession().operatorId;
}

export function getSubscriptionKey(): string {
  return requireSession().subscriptionKey;
}

export function getAuthToken(): string {
  return requireSession().authToken;
}

export function getUserId(): string {
  return requireSession().userId;
}

export function getPilotId(): string {
  return requireSession().pilotId;
}

export function getDefaultLocationId(): number {
  return requireSession().defaultLocationId;
}

export async function fetchAuth(
  email: string,
  password: string,
): Promise<AuthSession> {
  recordActiveSubrequest();
  const login = await fetch("https://app.flightschedulepro.com/Account/Login", {
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: `username=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}&checkEmail=false`,
    method: "POST",
    redirect: "manual",
  });

  const setCookieHeaders = getSetCookieHeaders(login.headers);
  let sessionCookies: string | null = null;

  if (setCookieHeaders.length > 0) {
    sessionCookies = setCookieHeaders
      .map((cookie: string) => cookie.split(";")[0])
      .join("; ");
  } else {
    const singleCookie = login.headers.get("set-cookie");
    if (singleCookie) {
      sessionCookies = singleCookie.split(";")[0];
    }
  }

  if (!sessionCookies) {
    throw new Error("Failed to obtain session cookies from login response");
  }

  // Extract and store the auth token from the FspApp cookie
  const authToken = extractTokenFromCookie(sessionCookies);
  if (!authToken) {
    throw new Error("Failed to extract auth token from cookies");
  }

  // Fetch the subscription key and operator ID from APIs
  const subscriptionKey = await fetchSubscriptionKey(sessionCookies);
  const operatorDetails = await fetchOperatorDetails(
    authToken,
    sessionCookies,
    subscriptionKey,
  );

  currentSession = {
    sessionCookies,
    subscriptionKey,
    authToken,
    ...operatorDetails,
  };

  return currentSession;
}

/**
 * Extracts the auth token from the FspApp cookie
 */
function extractTokenFromCookie(sessionCookies: string): string | null {
  // Find the FspApp cookie
  const fspAppMatch = /FspApp=([^;]+)/.exec(sessionCookies);
  if (!fspAppMatch) {
    return null;
  }

  try {
    // URL decode the cookie value
    const decodedValue = decodeURIComponent(fspAppMatch[1]);

    // Parse the JSON
    const data: unknown = JSON.parse(decodedValue);

    // Validate with Zod
    const result = FspAppCookieSchema.safeParse(data);

    if (!result.success) {
      log.error("Failed to validate FspApp cookie", { zodError: result.error });
      return null;
    }

    return result.data.token;
  } catch (error) {
    log.error("Failed to parse FspApp cookie", { error });
    return null;
  }
}

/**
 * Fetches the subscription key from AccountAppContext
 */
async function fetchSubscriptionKey(sessionCookies: string): Promise<string> {
  try {
    recordActiveSubrequest();
    const response = await fetch(
      "https://app.flightschedulepro.com/AccountAppContext",
      {
        headers: {
          accept: "*/*",
          "cache-control": "no-cache, no-store, must-revalidate",
          cookie: sessionCookies,
        },
        method: "GET",
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const result = AccountAppContextSchema.safeParse(data);

    if (!result.success) {
      log.error("Failed to validate AccountAppContext", {
        zodError: result.error,
      });
      throw new Error("Failed to parse AccountAppContext response");
    }

    return result.data.subscriptionKey;
  } catch (error) {
    log.error("Failed to fetch subscription key", { error });
    throw error;
  }
}

/**
 * Fetches the operator ID from MyOperators API
 */
async function fetchOperatorDetails(
  userToken: string,
  sessionCookies: string,
  subscriptionKey: string,
): Promise<{
  operatorId: number;
  userId: string;
  pilotId: string;
  defaultLocationId: number;
}> {
  try {
    const headers: Record<string, string> = {
      accept: "application/json, text/plain, */*",
      authorization: `Bearer ${userToken}`,
      "x-subscription-key": subscriptionKey,
      cookie: sessionCookies,
    };

    // Step 1: Get list of companies to find active operator ID
    recordActiveSubrequest();
    const listResponse = await fetch(
      "https://api-external.flightschedulepro.com/api/V1/myoperators",
      {
        headers,
        method: "GET",
      },
    );

    if (!listResponse.ok) {
      throw new Error(`HTTP error! status: ${listResponse.status}`);
    }

    const listData = await listResponse.json();
    const listResult = MyOperatorsListSchema.safeParse(listData);

    if (!listResult.success) {
      throw new Error("Failed to parse MyOperators list response");
    }

    if (listResult.data.companies.length === 0) {
      throw new Error("No company found");
    }
    const company = listResult.data.companies[0];

    // Step 2: Get detailed operator info using the operator ID
    recordActiveSubrequest();
    const detailResponse = await fetch(
      `https://api-external.flightschedulepro.com/api/V1/myoperators/${company.id}`,
      {
        headers,
        method: "GET",
      },
    );

    if (!detailResponse.ok) {
      throw new Error(`HTTP error! status: ${detailResponse.status}`);
    }

    const detailData = await detailResponse.json();
    const detailResult = MyOperatorsDetailSchema.safeParse(detailData);

    if (!detailResult.success) {
      throw new Error("Failed to parse MyOperators detail response");
    }

    return {
      operatorId: detailResult.data.operatorId,
      userId: detailResult.data.userId,
      pilotId: detailResult.data.pilotId,
      defaultLocationId: detailResult.data.defaultLocationId,
    };
  } catch (error) {
    log.error("Failed to fetch operator ID", { error });
    throw error;
  }
}
