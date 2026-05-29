import { describe, expect, it, vi, beforeEach } from "vitest";
import { InteractiveCLI } from "./interactive.js";
import { checkbox, select, confirm, input } from "@inquirer/prompts";
import {
  createReservationTypeFixture,
  dualFlightTraining,
  rental,
} from "../dao/reservationTypes.fixtures.js";

vi.mock("@inquirer/prompts", () => ({
  checkbox: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  input: vi.fn(),
}));

describe("InteractiveCLI", () => {
  let cli: InteractiveCLI;

  beforeEach(() => {
    cli = new InteractiveCLI();
    vi.clearAllMocks();
  });

  describe("selectMultipleTimeSlots", () => {
    it("displays formatted time slots for selection", async () => {
      const mockAvailabilities = [
        {
          date: "7/15/2024",
          startTime: "10:00:00 AM",
          endTime: "12:00:00 PM",
          instructor: "John Doe",
          aircraft: "N12345",
          instructorId: "inst-1",
          aircraftId: "ac-1",
          startDateTime: new Date("2024-07-15T10:00:00"),
          endDateTime: new Date("2024-07-15T12:00:00"),
        },
        {
          date: "7/15/2024",
          startTime: "2:00:00 PM",
          endTime: "4:00:00 PM",
          instructor: "Jane Smith",
          aircraft: "N67890",
          instructorId: "inst-2",
          aircraftId: "ac-2",
          startDateTime: new Date("2024-07-15T14:00:00"),
          endDateTime: new Date("2024-07-15T16:00:00"),
        },
      ];

      vi.mocked(checkbox).mockResolvedValue([0]);

      const result = await cli.selectMultipleTimeSlots(mockAvailabilities);

      expect(checkbox).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockAvailabilities[0]);
    });

    it("returns empty array if user cancels", async () => {
      const mockAvailabilities = [
        {
          date: "7/15/2024",
          startTime: "10:00:00 AM",
          endTime: "12:00:00 PM",
          instructor: "John Doe",
          aircraft: "N12345",
          instructorId: "inst-1",
          aircraftId: "ac-1",
          startDateTime: new Date("2024-07-15T10:00:00"),
          endDateTime: new Date("2024-07-15T12:00:00"),
        },
      ];

      vi.mocked(checkbox).mockRejectedValue(new Error("User cancelled"));

      const result = await cli.selectMultipleTimeSlots(mockAvailabilities);

      expect(result).toEqual([]);
    });

    it("sorts availabilities by date and time", async () => {
      const unsortedAvailabilities = [
        {
          date: "7/16/2024",
          startTime: "2:00:00 PM",
          endTime: "4:00:00 PM",
          instructor: "John",
          aircraft: "N123",
          instructorId: "inst-1",
          aircraftId: "ac-1",
          startDateTime: new Date("2024-07-16T14:00:00"),
          endDateTime: new Date("2024-07-16T16:00:00"),
        },
        {
          date: "7/15/2024",
          startTime: "10:00:00 AM",
          endTime: "12:00:00 PM",
          instructor: "Jane",
          aircraft: "N456",
          instructorId: "inst-2",
          aircraftId: "ac-2",
          startDateTime: new Date("2024-07-15T10:00:00"),
          endDateTime: new Date("2024-07-15T12:00:00"),
        },
      ];

      vi.mocked(checkbox).mockResolvedValue([0, 1]);

      const result = await cli.selectMultipleTimeSlots(unsortedAvailabilities);

      // Result should be sorted by date/time
      expect(result[0].date).toBe("7/15/2024");
      expect(result[1].date).toBe("7/16/2024");
    });
  });

  describe("selectAircraft", () => {
    const mockTimeSlot = {
      date: "7/15/2024",
      startTime: "10:00:00 AM",
      endTime: "12:00:00 PM",
      instructor: "John Doe",
      aircraft: "N12345",
      instructorId: "inst-1",
      aircraftId: "ac-1",
      startDateTime: new Date("2024-07-15T10:00:00"),
      endDateTime: new Date("2024-07-15T12:00:00"),
    };

    it("auto-selects if only one aircraft available", async () => {
      const availabilities = [mockTimeSlot];

      const result = await cli.selectAircraft(mockTimeSlot, availabilities);

      expect(result).toBe("N12345");
      expect(select).not.toHaveBeenCalled();
    });

    it("prompts user to select when multiple aircraft available", async () => {
      const availabilities = [
        mockTimeSlot,
        { ...mockTimeSlot, aircraft: "N67890", aircraftId: "ac-2" },
      ];

      vi.mocked(select).mockResolvedValue("N67890");

      const result = await cli.selectAircraft(mockTimeSlot, availabilities);

      expect(result).toBe("N67890");
      expect(select).toHaveBeenCalled();
    });

    it("returns null if user cancels", async () => {
      const availabilities = [
        mockTimeSlot,
        { ...mockTimeSlot, aircraft: "N67890" },
      ];

      vi.mocked(select).mockRejectedValue(new Error("Cancelled"));

      const result = await cli.selectAircraft(mockTimeSlot, availabilities);

      expect(result).toBeNull();
    });
  });

  describe("selectInstructor", () => {
    const mockTimeSlot = {
      date: "7/15/2024",
      startTime: "10:00:00 AM",
      endTime: "12:00:00 PM",
      instructor: "John Doe",
      aircraft: "N12345",
      instructorId: "inst-1",
      aircraftId: "ac-1",
      startDateTime: new Date("2024-07-15T10:00:00"),
      endDateTime: new Date("2024-07-15T12:00:00"),
    };

    it("auto-selects if only one instructor available", async () => {
      const availabilities = [mockTimeSlot];

      const result = await cli.selectInstructor(mockTimeSlot, availabilities);

      expect(result).toEqual(mockTimeSlot);
      expect(select).not.toHaveBeenCalled();
    });

    it("prompts user to select when multiple instructors available", async () => {
      const availabilities = [
        mockTimeSlot,
        {
          ...mockTimeSlot,
          instructor: "Jane Smith",
          instructorId: "inst-2",
        },
      ];

      vi.mocked(select).mockResolvedValue(1);

      const result = await cli.selectInstructor(mockTimeSlot, availabilities);

      expect(result).toEqual(availabilities[1]);
      expect(select).toHaveBeenCalled();
    });

    it("deduplicates instructors by name", async () => {
      const availabilities = [
        mockTimeSlot,
        { ...mockTimeSlot, aircraft: "N67890" }, // Same instructor, different aircraft
      ];

      const result = await cli.selectInstructor(mockTimeSlot, availabilities);

      // Should auto-select since there's only one unique instructor
      expect(result).toEqual(mockTimeSlot);
      expect(select).not.toHaveBeenCalled();
    });

    it("returns null if user cancels", async () => {
      const availabilities = [
        mockTimeSlot,
        {
          ...mockTimeSlot,
          instructor: "Jane Smith",
          instructorId: "inst-2",
        },
      ];

      vi.mocked(select).mockRejectedValue(new Error("Cancelled"));

      const result = await cli.selectInstructor(mockTimeSlot, availabilities);

      expect(result).toBeNull();
    });
  });

  describe("confirmAction", () => {
    it("returns true when user confirms", async () => {
      vi.mocked(confirm).mockResolvedValue(true);

      const result = await cli.confirmAction("Proceed?");

      expect(result).toBe(true);
      expect(confirm).toHaveBeenCalledWith({
        message: "Proceed?",
      });
    });

    it("returns false when user declines", async () => {
      vi.mocked(confirm).mockResolvedValue(false);

      const result = await cli.confirmAction("Proceed?");

      expect(result).toBe(false);
    });

    it("returns false if user cancels", async () => {
      vi.mocked(confirm).mockRejectedValue(new Error("Cancelled"));

      const result = await cli.confirmAction("Proceed?");

      expect(result).toBe(false);
    });
  });

  describe("selectMainAction", () => {
    it("prompts user to choose between booking and managing existing activities", async () => {
      vi.mocked(select).mockResolvedValue("manage-existing-activity");

      const result = await cli.selectMainAction();

      expect(result).toBe("manage-existing-activity");
      expect(select).toHaveBeenCalledWith({
        message: "What do you want to do?",
        choices: [
          { name: "Book a new activity", value: "book" },
          {
            name: "Manage existing activity",
            value: "manage-existing-activity",
          },
          { name: "Exit", value: "exit" },
        ],
        loop: false,
      });
    });

    it("returns null when user cancels", async () => {
      vi.mocked(select).mockRejectedValue(new Error("Cancelled"));

      const result = await cli.selectMainAction();

      expect(result).toBeNull();
    });
  });

  describe("selectManageActivityAction", () => {
    it("prompts for change activity type or cancel", async () => {
      vi.mocked(select).mockResolvedValue("cancel");

      const result = await cli.selectManageActivityAction();

      expect(result).toBe("cancel");
      expect(select).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "What would you like to do with this activity?",
        }),
      );
    });
  });

  describe("selectExistingActivity", () => {
    it("returns the selected activity", async () => {
      const reservation = {
        reservationId: "845b8008-68d8-4b3f-bb6c-80753adc9ef5",
        start: "2026-05-27T16:00:00",
        end: "2026-05-27T18:00:00",
        resource: "N713RE",
        instructor: "Thomas Lindstaedt",
      };
      vi.mocked(select).mockResolvedValue(reservation.reservationId);

      const result = await cli.selectExistingActivity(
        [reservation],
        "America/Los_Angeles",
      );

      expect(result).toEqual(reservation);
      expect(select).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Select an activity",
          pageSize: 15,
        }),
      );
    });

    it("returns null when back is selected", async () => {
      vi.mocked(select).mockResolvedValue("__back__");

      const result = await cli.selectExistingActivity(
        [
          {
            reservationId: "845b8008-68d8-4b3f-bb6c-80753adc9ef5",
            start: "2026-05-27T16:00:00",
            end: "2026-05-27T18:00:00",
          },
        ],
        "America/Los_Angeles",
      );

      expect(result).toBeNull();
    });
  });

  describe("selectCancellationReason", () => {
    it("returns the selected cancellation reason", async () => {
      vi.mocked(select).mockResolvedValue(
        "f69bc957-035a-4beb-9125-e8b0c2686f3e",
      );

      const result = await cli.selectCancellationReason([
        {
          id: "f69bc957-035a-4beb-9125-e8b0c2686f3e",
          name: "Scheduling Conflict (Customer)",
          requiresExplanation: false,
        },
      ]);

      expect(result?.name).toBe("Scheduling Conflict (Customer)");
    });
  });

  describe("collectActivityFlightDetails", () => {
    it("collects rental flight detail fields", async () => {
      vi.mocked(select).mockResolvedValueOnce(1).mockResolvedValueOnce(1);
      vi.mocked(input)
        .mockResolvedValueOnce("1.5")
        .mockResolvedValueOnce("KSBP-KPRB");

      const result = await cli.collectActivityFlightDetails(rental);

      expect(result).toEqual({
        flightType: 1,
        flightRules: 1,
        estimatedFlightHours: "1.5",
        flightRoute: "KSBP-KPRB",
      });
    });

    it("returns null when required input is cancelled", async () => {
      vi.mocked(select)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1);
      vi.mocked(input).mockRejectedValue(new Error("Cancelled"));

      await expect(cli.collectActivityFlightDetails(rental)).resolves.toBeNull();
    });
  });

  describe("promptText", () => {
    it("returns entered text", async () => {
      vi.mocked(input).mockResolvedValue("Weather moved in");

      await expect(cli.promptText("Explain:")).resolves.toBe(
        "Weather moved in",
      );
    });

    it("returns null when user cancels", async () => {
      vi.mocked(input).mockRejectedValue(new Error("Cancelled"));

      await expect(cli.promptText("Explain:")).resolves.toBeNull();
    });
  });

  describe("selectReservationType", () => {
    it("prompts user to select a reservation type", async () => {
      const reservationTypes = [
        createReservationTypeFixture({
          reservationTypeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          reservationTypeName: "Solo Flight",
        }),
        dualFlightTraining,
        createReservationTypeFixture({
          reservationTypeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          reservationTypeName: "Ground School",
          instructorEnabled: true,
          instructorRequirement: 2,
        }),
      ];

      vi.mocked(select).mockResolvedValue(dualFlightTraining.reservationTypeId);

      const result = await cli.selectReservationType(reservationTypes);

      expect(result).toEqual(dualFlightTraining);
      expect(select).toHaveBeenCalledWith({
        message: "Select activity type:",
        choices: [
          {
            name: "Solo Flight",
            value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          },
          {
            name: "Dual Flight Training",
            value: dualFlightTraining.reservationTypeId,
          },
          {
            name: "Ground School",
            value: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          },
        ],
        loop: false,
        default: dualFlightTraining.reservationTypeId,
      });
    });

    it("defaults to preferred reservation type when configured", async () => {
      const reservationTypes = [
        createReservationTypeFixture({
          reservationTypeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          reservationTypeName: "Solo Flight",
        }),
        rental,
      ];

      vi.mocked(select).mockResolvedValue(rental.reservationTypeId);

      await cli.selectReservationType(reservationTypes, {
        preferredTypeId: rental.reservationTypeId,
      });

      expect(select).toHaveBeenCalledWith(
        expect.objectContaining({
          default: rental.reservationTypeId,
        }),
      );
    });

  it("returns null when user cancels", async () => {
    vi.mocked(select).mockRejectedValue(new Error("Cancelled"));

    const result = await cli.selectReservationType([dualFlightTraining]);

    expect(result).toBeNull();
  });

  it("excludes activity types that are already selected", async () => {
    const reservationTypes = [dualFlightTraining, rental];

    vi.mocked(select).mockResolvedValue(rental.reservationTypeId);

    const result = await cli.selectReservationType(reservationTypes, {
      excludeTypeIds: [dualFlightTraining.reservationTypeId],
    });

    expect(result).toEqual(rental);
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [{ name: "Rental", value: rental.reservationTypeId }],
      }),
    );
  });
});
});
