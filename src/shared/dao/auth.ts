import { z } from "zod";
import { createLogger } from "../util/logger.js";

const log = createLogger("auth");

// Store session cookies, operator ID, subscription key, auth token, user ID, pilot ID, and location ID for authenticated requests
let sessionCookies: string | null = null;
let operatorId: number | null = null;
let subscriptionKey: string | null = null;
let authToken: string | null = null;
let userId: string | null = null;
let pilotId: string | null = null;
let defaultLocationId: number | null = null;

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

export function getSessionCookies(): string | null {
  return sessionCookies;
}

export function getOperatorId(): number {
  if (operatorId === null) {
    throw new Error("Operator ID not set. Please login first.");
  }
  return operatorId;
}

export function getSubscriptionKey(): string {
  if (subscriptionKey === null) {
    throw new Error("Subscription key not set. Please login first.");
  }
  return subscriptionKey;
}

export function getAuthToken(): string {
  if (authToken === null) {
    throw new Error("Auth token not set. Please login first.");
  }
  return authToken;
}

export function getUserId(): string {
  if (userId === null) {
    throw new Error("User ID not set. Please login first.");
  }
  return userId;
}

export function getPilotId(): string {
  if (pilotId === null) {
    throw new Error("Pilot ID not set. Please login first.");
  }
  return pilotId;
}

export function getDefaultLocationId(): number {
  if (defaultLocationId === null) {
    throw new Error("Default location ID not set. Please login first.");
  }
  return defaultLocationId;
}

export async function fetchAuth(
  email: string,
  password: string,
): Promise<void> {
  // Login without operator ID
  const login = await fetch("https://app.flightschedulepro.com/Account/Login", {
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: `username=${email}&password=${password}&checkEmail=false`,
    method: "POST",
    redirect: "manual", // Don't follow redirects automatically
  });

  // Extract and store session cookies from Set-Cookie header
  // Node.js fetch may return multiple Set-Cookie headers
  const setCookieHeaders = getSetCookieHeaders(login.headers);

  if (setCookieHeaders.length > 0) {
    // Join all cookies with semicolon
    sessionCookies = setCookieHeaders
      .map((cookie: string) => cookie.split(";")[0]) // Get just the key=value part
      .join("; ");
  } else {
    // Fallback: try to get single set-cookie header
    const singleCookie = login.headers.get("set-cookie");
    if (singleCookie) {
      sessionCookies = singleCookie.split(";")[0];
    }
  }

  // Extract and store the auth token from the FspApp cookie
  authToken = extractTokenFromCookie();
  if (!authToken) {
    throw new Error("Failed to extract auth token from cookies");
  }

  // Fetch the subscription key and operator ID from APIs
  await fetchSubscriptionKey();
  await fetchOperatorId(authToken);
}

/**
 * Extracts the auth token from the FspApp cookie
 */
function extractTokenFromCookie(): string | null {
  if (!sessionCookies) {
    return null;
  }

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
 * Fetches and stores the subscription key from AccountAppContext
 */
async function fetchSubscriptionKey(): Promise<void> {
  try {
    const headers: Record<string, string> = {
      accept: "*/*",
      "cache-control": "no-cache, no-store, must-revalidate",
    };

    // Add cookies if available
    if (sessionCookies) {
      headers.cookie = sessionCookies;
    }

    const response = await fetch(
      "https://app.flightschedulepro.com/AccountAppContext",
      {
        headers,
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

    subscriptionKey = result.data.subscriptionKey;
  } catch (error) {
    log.error("Failed to fetch subscription key", { error });
    throw error;
  }
}

/**
 * Fetches and stores the operator ID from MyOperators API
 */
async function fetchOperatorId(userToken: string): Promise<void> {
  try {
    // We need to wait a moment to ensure subscription key is available
    if (!subscriptionKey) {
      throw new Error("Subscription key not available");
    }

    const headers: Record<string, string> = {
      accept: "application/json, text/plain, */*",
      authorization: `Bearer ${userToken}`,
      "x-subscription-key": subscriptionKey,
    };

    // Add cookies if available
    if (sessionCookies) {
      headers.cookie = sessionCookies;
    }

    // Step 1: Get list of companies to find active operator ID
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

    // Store the operator ID, user ID, pilot ID, and default location ID
    operatorId = detailResult.data.operatorId;
    userId = detailResult.data.userId;
    pilotId = detailResult.data.pilotId;
    defaultLocationId = detailResult.data.defaultLocationId;
  } catch (error) {
    log.error("Failed to fetch operator ID", { error });
    throw error;
  }
}
