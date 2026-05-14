import { describe, expect, it, vi, beforeEach } from "vitest";
import { InteractiveCLI } from "./interactive.js";
import { checkbox, select, confirm } from "@inquirer/prompts";

vi.mock("@inquirer/prompts", () => ({
  checkbox: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
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

  describe("selectActivityType", () => {
    it("prompts user to select activity type", async () => {
      const activityTypes: [string, string][] = [
        ["id-1", "Solo Flight"],
        ["id-2", "Dual Flight Training"],
        ["id-3", "Ground School"],
      ];

      vi.mocked(select).mockResolvedValue("Dual Flight Training");

      const result = await cli.selectActivityType(activityTypes);

      expect(result).toBe("Dual Flight Training");
      expect(select).toHaveBeenCalledWith({
        message: "Select activity type:",
        choices: [
          { name: "Solo Flight", value: "Solo Flight" },
          { name: "Dual Flight Training", value: "Dual Flight Training" },
          { name: "Ground School", value: "Ground School" },
        ],
        loop: false,
        default: "Dual Flight Training", // Should default to dual option
      });
    });

    it("defaults to 'dual' option when available", async () => {
      const activityTypes: [string, string][] = [
        ["id-1", "Solo Flight"],
        ["id-2", "Dual Instruction"], // Has "dual" in name
        ["id-3", "Ground School"],
      ];

      vi.mocked(select).mockResolvedValue("Dual Instruction");

      await cli.selectActivityType(activityTypes);

      expect(select).toHaveBeenCalledWith(
        expect.objectContaining({
          default: "Dual Instruction",
        })
      );
    });

    it("returns null when user cancels", async () => {
      const activityTypes: [string, string][] = [
        ["id-1", "Solo Flight"],
        ["id-2", "Dual Flight Training"],
      ];

      vi.mocked(select).mockRejectedValue(new Error("Cancelled"));

      const result = await cli.selectActivityType(activityTypes);

      expect(result).toBeNull();
    });
  });
});
