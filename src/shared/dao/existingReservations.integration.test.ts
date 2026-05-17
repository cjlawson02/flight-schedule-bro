import { describe, expect, it } from "vitest";
import { z } from "zod";

// Import the schemas to test
const ExistingReservationSchema = z.object({
  reservationId: z.uuid(),
  start: z.string(),
  end: z.string(),
  startUtc: z.string().optional(),
  endUtc: z.string().optional(),
  instructor: z.string().optional(),
  resource: z.string().optional(),
});

const ExistingReservationsResponseSchema = z.object({
  total: z.number(),
  results: z.array(ExistingReservationSchema),
});

describe("ExistingReservations Schema Validation - Real API Response", () => {
  it("successfully parses the actual API response format", () => {
    // Your actual API response
    const realApiResponse = {
      total: 19,
      pageIndex: 1,
      pageSize: 25,
      results: [
        {
          reservationId: "7fd24fb6-977f-4b4a-89ac-dc949030d234",
          flightRecordId: null,
          organizationId: 191057,
          displayType: 0,
          start: "2025-11-04T17:00:00",
          startTimeZone: "(PST)",
          end: "2025-11-04T19:00:00",
          startUtc: "2025-11-05T01:00:00",
          endUtc: "2025-11-05T03:00:00",
          endTimeZone: "(PST)",
          instructor: "Doug Libal",
          resource: "N65411",
          aircraftMake: "Cessna",
          aircraftModel: "172S      ",
          orFor: "",
          pilotFirstName: "Chris",
          pilotLastName: "Lawson",
          pilot2FirstName: "",
          pilot2LastName: "",
          awaitingSignature: false,
          isPilot: true,
          isInstructor: false,
          trainingStatus: 20,
          status: 0,
          lastSyncedWithLogTen: null,
          background: "#3399ff",
          foreground: "#ffffff",
          reservationTypeName: "Dual Flight Training",
          currentFlightAlert: null,
          trainingSessions: [],
        },
        {
          reservationId: "7e63e451-783a-4323-98ba-10b556d12d07",
          flightRecordId: null,
          organizationId: 191057,
          displayType: 0,
          start: "2025-11-06T17:00:00",
          startTimeZone: "(PST)",
          end: "2025-11-06T19:00:00",
          startUtc: "2025-11-07T01:00:00",
          endUtc: "2025-11-07T03:00:00",
          endTimeZone: "(PST)",
          instructor: "Jason Hull",
          resource: "N734UZ",
          aircraftMake: "Cessna",
          aircraftModel: "172N",
          orFor: "",
          pilotFirstName: "Chris",
          pilotLastName: "Lawson",
          pilot2FirstName: "",
          pilot2LastName: "",
          awaitingSignature: false,
          isPilot: true,
          isInstructor: false,
          trainingStatus: 20,
          status: 0,
          lastSyncedWithLogTen: null,
          background: "#3399ff",
          foreground: "#ffffff",
          reservationTypeName: "Dual Flight Training",
          currentFlightAlert: null,
          trainingSessions: [],
        },
        {
          reservationId: "a2ddc5dc-7fda-440f-8ec9-f940e74c7af6",
          flightRecordId: null,
          organizationId: 191057,
          displayType: 0,
          start: "2025-11-07T17:00:00",
          startTimeZone: "(PST)",
          end: "2025-11-07T19:00:00",
          startUtc: "2025-11-08T01:00:00",
          endUtc: "2025-11-08T03:00:00",
          endTimeZone: "(PST)",
          instructor: "Jason Hull",
          resource: "N734UZ",
          aircraftMake: "Cessna",
          aircraftModel: "172N",
          orFor: "",
          pilotFirstName: "Chris",
          pilotLastName: "Lawson",
          pilot2FirstName: "",
          pilot2LastName: "",
          awaitingSignature: false,
          isPilot: true,
          isInstructor: false,
          trainingStatus: 20,
          status: 0,
          lastSyncedWithLogTen: null,
          background: "#3399ff",
          foreground: "#ffffff",
          reservationTypeName: "Dual Flight Training",
          currentFlightAlert: null,
          trainingSessions: [],
        },
      ],
    };

    // Parse with our schema - this will strip out all the extra fields
    const parsed = ExistingReservationsResponseSchema.parse(realApiResponse);

    // Verify structure
    expect(parsed.total).toBe(19);
    expect(parsed.results).toHaveLength(3);

    // Verify first reservation has only the fields we need
    const firstReservation = parsed.results[0];
    expect(firstReservation).toEqual({
      reservationId: "7fd24fb6-977f-4b4a-89ac-dc949030d234",
      start: "2025-11-04T17:00:00",
      end: "2025-11-04T19:00:00",
      startUtc: "2025-11-05T01:00:00",
      endUtc: "2025-11-05T03:00:00",
      instructor: "Doug Libal",
      resource: "N65411",
    });

    // Verify unrelated API fields are stripped
    expect(firstReservation).not.toHaveProperty("flightRecordId");
    expect(firstReservation).not.toHaveProperty("organizationId");
    expect(firstReservation).not.toHaveProperty("aircraftMake");
    expect(firstReservation).not.toHaveProperty("pilotFirstName");

    // Verify second reservation
    expect(parsed.results[1]).toEqual({
      reservationId: "7e63e451-783a-4323-98ba-10b556d12d07",
      start: "2025-11-06T17:00:00",
      end: "2025-11-06T19:00:00",
      startUtc: "2025-11-07T01:00:00",
      endUtc: "2025-11-07T03:00:00",
      instructor: "Jason Hull",
      resource: "N734UZ",
    });

    // Verify third reservation
    expect(parsed.results[2]).toEqual({
      reservationId: "a2ddc5dc-7fda-440f-8ec9-f940e74c7af6",
      start: "2025-11-07T17:00:00",
      end: "2025-11-07T19:00:00",
      startUtc: "2025-11-08T01:00:00",
      endUtc: "2025-11-08T03:00:00",
      instructor: "Jason Hull",
      resource: "N734UZ",
    });
  });

  it("validates UUID format for reservationId", () => {
    const invalidResponse = {
      total: 1,
      results: [
        {
          reservationId: "not-a-uuid",
          start: "2025-11-04T17:00:00",
          end: "2025-11-04T19:00:00",
          instructor: "Test Instructor",
          resource: "N12345",
        },
      ],
    };

    expect(() =>
      ExistingReservationsResponseSchema.parse(invalidResponse),
    ).toThrow();
  });

  it("allows optional instructor and resource fields", () => {
    const responseWithoutOptionals = {
      total: 1,
      results: [
        {
          reservationId: "7fd24fb6-977f-4b4a-89ac-dc949030d234",
          start: "2025-11-04T17:00:00",
          end: "2025-11-04T19:00:00",
          // instructor and resource omitted
        },
      ],
    };

    const parsed = ExistingReservationsResponseSchema.parse(
      responseWithoutOptionals,
    );

    expect(parsed.results[0]).toEqual({
      reservationId: "7fd24fb6-977f-4b4a-89ac-dc949030d234",
      start: "2025-11-04T17:00:00",
      end: "2025-11-04T19:00:00",
    });
  });
});
