import { getSessionCookies } from "./auth.js";

/**
 * Fetches iCal content from the API for a given reservation
 * This endpoint requires cookie-based authentication from the login session
 * @param reservationId - The UUID of the reservation
 * @returns Promise<string> - The iCal file content
 * @throws {Error} - When the fetch fails
 */
export async function fetchICalContent(
  operatorId: number,
  reservationId: string
): Promise<string> {
  const iCalUrl = `https://app.flightschedulepro.com/AddToCalendar/iCal/${reservationId}?operatorId=${operatorId}`;

  const cookies = getSessionCookies();
  if (!cookies) {
    throw new Error("No session cookies available. Please login first.");
  }

  const response = await fetch(iCalUrl, {
    method: "GET",
    headers: {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.5",
      referer: "https://app.flightschedulepro.com/App/MyReservations",
      cookie: cookies,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.text();
}
