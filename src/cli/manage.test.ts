import { describe, expect, it, vi, beforeEach } from "vitest";
import { runManageExistingActivityWorkflow } from "./manage.js";
import { FspHttpError } from "../shared/dao/api_wrapper.js";
import { InteractiveCLI } from "../shared/util/interactive.js";
import {
  dualFlightTraining,
  groundTraining,
  rental,
} from "../shared/dao/reservationTypes.fixtures.js";
import type { ReservationDetail } from "../shared/dao/reservationManagement.js";
import * as existingReservationsModule from "../shared/dao/existingReservations.js";
import * as reservationManagementModule from "../shared/dao/reservationManagement.js";
import * as resolveUpgradeResourcesModule from "./resolveUpgradeResources.js";

vi.mock("../shared/dao/auth.js", () => ({
  getUserId: () => "354ccb15-6534-4c59-851d-c6b4d2694320",
}));

vi.mock("../shared/dao/existingReservations.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../shared/dao/existingReservations.js")
    >();
  return {
    ...actual,
    getExistingReservations: vi.fn(),
  };
});

vi.mock("./resolveUpgradeResources.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./resolveUpgradeResources.js")>();
  return {
    ...actual,
    resolveMissingInstructorForUpgrade: vi.fn(),
  };
});

vi.mock("../shared/dao/reservationManagement.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../shared/dao/reservationManagement.js")
    >();
  return {
    ...actual,
    getCancellationReasons: vi.fn(),
    getReservationById: vi.fn(),
    updateReservation: vi.fn(),
    cancelReservation: vi.fn(),
  };
});

const config = {
  WEEKDAY_MIN_HOUR: 15,
  MAX_HOUR: 19,
  EMAIL: "test@example.com",
  PASSWORD: "password",
  AIRCRAFT_REGEX: /172S/i,
  INSTRUCTOR_REGEX: /Doug Libal/i,
  DAYS_AHEAD: 14,
  TIMEZONE: "America/Los_Angeles",
};

const reservation = {
  reservationId: "845b8008-68d8-4b3f-bb6c-80753adc9ef5",
  start: "2026-06-30T16:00:00",
  end: "2026-06-30T18:00:00",
  resource: "N65411",
  instructor: "Doug Libal",
};

function buildReservationDetail(
  overrides: Partial<ReservationDetail> = {},
): ReservationDetail {
  return {
    reservationId: reservation.reservationId,
    reservationTypeId: dualFlightTraining.reservationTypeId,
    locationId: 20852,
    start: reservation.start,
    end: reservation.end,
    pilot: {
      pilotId: "3fb9208a-b560-4bcc-a92b-31adcfc125e6",
      userId: "354ccb15-6534-4c59-851d-c6b4d2694320",
    },
    instructor: {
      instructorId: "bc8dbb05-d939-4539-bdf6-d4633333a169",
    },
    aircraftSummary: {
      aircraftId: "ad2b4bb1-1946-4c20-b1f5-51fb4039597c",
    },
    ...overrides,
  };
}

describe("runManageExistingActivityWorkflow", () => {
  let cli: InteractiveCLI;

  beforeEach(() => {
    cli = new InteractiveCLI();
    vi.clearAllMocks();
    vi.spyOn(cli, "selectExistingActivity").mockResolvedValue(reservation);
    vi.mocked(
      existingReservationsModule.getExistingReservations,
    ).mockResolvedValue([reservation]);
  });

  it("stops before confirm when validate-only update fails", async () => {
    const scheduler = {
      getReservationTypes: () => [dualFlightTraining, rental],
    };
    const confirmSpy = vi.spyOn(cli, "confirmAction");

    vi.spyOn(cli, "selectManageActivityAction").mockResolvedValue(
      "change-activity-type",
    );
    vi.spyOn(cli, "selectReservationType").mockResolvedValue(rental);
    vi.spyOn(cli, "collectActivityFlightDetails").mockResolvedValue({
      flightType: 1,
      flightRules: 1,
    });
    vi.mocked(reservationManagementModule.getReservationById).mockResolvedValue(
      buildReservationDetail(),
    );
    vi.mocked(reservationManagementModule.updateReservation).mockRejectedValue(
      new Error("Reservation update failed: Aircraft unavailable"),
    );

    await runManageExistingActivityWorkflow(
      cli,
      scheduler as never,
      config,
      191057,
    );

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(reservationManagementModule.updateReservation).toHaveBeenCalledTimes(
      1,
    );
    expect(reservationManagementModule.updateReservation).toHaveBeenCalledWith(
      expect.objectContaining({ validateOnly: true }),
    );
  });

  it("runs validate-only update before commit", async () => {
    const scheduler = {
      getReservationTypes: () => [dualFlightTraining, rental],
    };

    vi.spyOn(cli, "selectManageActivityAction").mockResolvedValue(
      "change-activity-type",
    );
    vi.spyOn(cli, "selectReservationType").mockResolvedValue(rental);
    vi.spyOn(cli, "collectActivityFlightDetails").mockResolvedValue({
      flightType: 1,
      flightRules: 1,
    });
    vi.spyOn(cli, "confirmAction").mockResolvedValue(true);
    vi.mocked(reservationManagementModule.getReservationById).mockResolvedValue(
      buildReservationDetail(),
    );
    vi.mocked(reservationManagementModule.updateReservation).mockResolvedValue(
      undefined,
    );

    await runManageExistingActivityWorkflow(
      cli,
      scheduler as never,
      config,
      191057,
    );

    expect(
      reservationManagementModule.updateReservation,
    ).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ validateOnly: true }),
    );
    expect(
      reservationManagementModule.updateReservation,
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ validateOnly: false }),
    );
  });

  it("searches for instructors when upgrading rental to dual", async () => {
    const scheduler = {
      getReservationTypes: () => [dualFlightTraining, rental],
    };

    vi.spyOn(cli, "selectManageActivityAction").mockResolvedValue(
      "change-activity-type",
    );
    vi.spyOn(cli, "selectReservationType").mockResolvedValue(
      dualFlightTraining,
    );
    vi.spyOn(cli, "confirmAction").mockResolvedValue(true);
    vi.mocked(reservationManagementModule.getReservationById).mockResolvedValue(
      buildReservationDetail({
        reservationTypeId: rental.reservationTypeId,
        instructor: undefined,
      }),
    );
    vi.mocked(
      resolveUpgradeResourcesModule.resolveMissingInstructorForUpgrade,
    ).mockResolvedValue({
      instructorId: "bc8dbb05-d939-4539-bdf6-d4633333a169",
      instructorName: "Doug Libal",
    });
    vi.mocked(reservationManagementModule.updateReservation).mockResolvedValue(
      undefined,
    );

    await runManageExistingActivityWorkflow(
      cli,
      scheduler as never,
      config,
      191057,
    );

    expect(
      resolveUpgradeResourcesModule.resolveMissingInstructorForUpgrade,
    ).toHaveBeenCalledWith(
      cli,
      scheduler,
      expect.objectContaining({
        reservationType: dualFlightTraining,
        aircraftId: "ad2b4bb1-1946-4c20-b1f5-51fb4039597c",
      }),
    );
    expect(reservationManagementModule.updateReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        instructorId: "bc8dbb05-d939-4539-bdf6-d4633333a169",
        validateOnly: false,
      }),
    );
  });

  it("surfaces FSP error messages from validate-only update", async () => {
    const scheduler = {
      getReservationTypes: () => [dualFlightTraining, groundTraining],
    };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    vi.spyOn(cli, "selectManageActivityAction").mockResolvedValue(
      "change-activity-type",
    );
    vi.spyOn(cli, "selectReservationType").mockResolvedValue(groundTraining);
    vi.mocked(reservationManagementModule.getReservationById).mockResolvedValue(
      buildReservationDetail(),
    );
    vi.mocked(reservationManagementModule.updateReservation).mockRejectedValue(
      new FspHttpError(400, {
        errors: [{ message: "Invalid aircraft provided" }],
      }),
    );

    await runManageExistingActivityWorkflow(
      cli,
      scheduler as never,
      config,
      191057,
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid aircraft provided"),
    );
    logSpy.mockRestore();
  });

  it("does not commit when the user declines confirmation", async () => {
    const scheduler = {
      getReservationTypes: () => [dualFlightTraining, groundTraining],
    };

    vi.spyOn(cli, "selectManageActivityAction").mockResolvedValue(
      "change-activity-type",
    );
    vi.spyOn(cli, "selectReservationType").mockResolvedValue(groundTraining);
    vi.spyOn(cli, "confirmAction").mockResolvedValue(false);
    vi.mocked(reservationManagementModule.getReservationById).mockResolvedValue(
      buildReservationDetail(),
    );
    vi.mocked(reservationManagementModule.updateReservation).mockResolvedValue(
      undefined,
    );

    await runManageExistingActivityWorkflow(
      cli,
      scheduler as never,
      config,
      191057,
    );

    expect(reservationManagementModule.updateReservation).toHaveBeenCalledTimes(
      1,
    );
    expect(reservationManagementModule.updateReservation).toHaveBeenCalledWith(
      expect.objectContaining({ validateOnly: true }),
    );
  });

  it("cancels an activity when confirmed", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    vi.spyOn(cli, "selectManageActivityAction").mockResolvedValue("cancel");
    vi.spyOn(cli, "selectCancellationReason").mockResolvedValue({
      id: "f69bc957-035a-4beb-9125-e8b0c2686f3e",
      name: "Scheduling Conflict (Customer)",
      requiresExplanation: false,
    });
    vi.spyOn(cli, "confirmAction").mockResolvedValue(true);
    vi.mocked(
      reservationManagementModule.getCancellationReasons,
    ).mockResolvedValue([
      {
        id: "f69bc957-035a-4beb-9125-e8b0c2686f3e",
        name: "Scheduling Conflict (Customer)",
        requiresExplanation: false,
      },
    ]);
    vi.mocked(reservationManagementModule.cancelReservation).mockResolvedValue(
      undefined,
    );

    await runManageExistingActivityWorkflow(cli, {} as never, config, 191057);

    expect(reservationManagementModule.cancelReservation).toHaveBeenCalledWith({
      reservationId: reservation.reservationId,
      operatorId: 191057,
      reasonId: "f69bc957-035a-4beb-9125-e8b0c2686f3e",
      reasonText: "",
    });
    expect(logSpy).toHaveBeenCalledWith("✅ Activity cancelled.");
    logSpy.mockRestore();
  });

  it("requires a cancellation explanation when the reason demands one", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    vi.spyOn(cli, "selectManageActivityAction").mockResolvedValue("cancel");
    vi.spyOn(cli, "selectCancellationReason").mockResolvedValue({
      id: "f69bc957-035a-4beb-9125-e8b0c2686f3e",
      name: "Other",
      requiresExplanation: true,
    });
    vi.spyOn(cli, "promptText").mockResolvedValue("   ");
    vi.mocked(
      reservationManagementModule.getCancellationReasons,
    ).mockResolvedValue([
      {
        id: "f69bc957-035a-4beb-9125-e8b0c2686f3e",
        name: "Other",
        requiresExplanation: true,
      },
    ]);

    await runManageExistingActivityWorkflow(cli, {} as never, config, 191057);

    expect(
      reservationManagementModule.cancelReservation,
    ).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      "❌ Cancellation explanation is required.",
    );
    logSpy.mockRestore();
  });

  it("stops when no cancellation reasons are available", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    vi.spyOn(cli, "selectManageActivityAction").mockResolvedValue("cancel");
    vi.mocked(
      reservationManagementModule.getCancellationReasons,
    ).mockResolvedValue([]);

    await runManageExistingActivityWorkflow(cli, {} as never, config, 191057);

    expect(
      reservationManagementModule.cancelReservation,
    ).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      "❌ No cancellation reasons are available.",
    );
    logSpy.mockRestore();
  });

  it("searches for instructors without aircraft when upgrading rental to ground", async () => {
    const scheduler = {
      getReservationTypes: () => [dualFlightTraining, rental, groundTraining],
    };

    vi.spyOn(cli, "selectManageActivityAction").mockResolvedValue(
      "change-activity-type",
    );
    vi.spyOn(cli, "selectReservationType").mockResolvedValue(groundTraining);
    vi.spyOn(cli, "confirmAction").mockResolvedValue(true);
    vi.mocked(reservationManagementModule.getReservationById).mockResolvedValue(
      buildReservationDetail({
        reservationTypeId: rental.reservationTypeId,
        instructor: undefined,
      }),
    );
    vi.mocked(
      resolveUpgradeResourcesModule.resolveMissingInstructorForUpgrade,
    ).mockResolvedValue({
      instructorId: "bc8dbb05-d939-4539-bdf6-d4633333a169",
      instructorName: "Doug Libal",
    });
    vi.mocked(reservationManagementModule.updateReservation).mockResolvedValue(
      undefined,
    );

    await runManageExistingActivityWorkflow(
      cli,
      scheduler as never,
      config,
      191057,
    );

    expect(
      resolveUpgradeResourcesModule.resolveMissingInstructorForUpgrade,
    ).toHaveBeenCalledWith(
      cli,
      scheduler,
      expect.objectContaining({
        reservationType: groundTraining,
        aircraftId: undefined,
      }),
    );
  });
});
