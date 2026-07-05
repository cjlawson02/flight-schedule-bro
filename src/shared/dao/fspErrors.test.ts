import { describe, expect, it } from "vitest";
import { FspHttpError } from "./api_wrapper.js";
import {
  areAllErrorsOverridable,
  formatFspError,
  formatFspValidationErrors,
  parseFspValidationErrors,
} from "./fspErrors.js";

describe("fspErrors", () => {
  const maintenanceErrors = [
    {
      code: 0,
      message:
        "The time based maintenance reminder (100Hr Inspection) is expired.",
      overridable: true,
      category: 11,
      groupLabel: "Aircraft: N737BC Cessna 172N",
      universallyOverridable: true,
    },
    {
      code: 0,
      message:
        "The date based reminder (Annual Inspection) will expire.  It is due - 7/31/2026 11:59:59 PM.",
      overridable: true,
      category: 11,
      groupLabel: "Aircraft: N737BC Cessna 172N",
      universallyOverridable: true,
    },
  ];

  it("parses validation errors from FspHttpError responses", () => {
    const error = new FspHttpError(400, { errors: maintenanceErrors });

    expect(parseFspValidationErrors(error)).toEqual([
      {
        message:
          "The time based maintenance reminder (100Hr Inspection) is expired.",
        overridable: true,
        groupLabel: "Aircraft: N737BC Cessna 172N",
      },
      {
        message:
          "The date based reminder (Annual Inspection) will expire.  It is due - 7/31/2026 11:59:59 PM.",
        overridable: true,
        groupLabel: "Aircraft: N737BC Cessna 172N",
      },
    ]);
  });

  it("detects when all parsed errors are overridable", () => {
    const errors = parseFspValidationErrors(
      new FspHttpError(400, { errors: maintenanceErrors }),
    );

    expect(areAllErrorsOverridable(errors)).toBe(true);
  });

  it("returns false when any error is not overridable", () => {
    expect(
      areAllErrorsOverridable([
        {
          message: "Expired inspection",
          overridable: true,
        },
        {
          message: "Pilot not authorized",
          overridable: false,
        },
      ]),
    ).toBe(false);
  });

  it("formats validation errors for display", () => {
    const errors = parseFspValidationErrors(
      new FspHttpError(400, { errors: [maintenanceErrors[0]] }),
    );

    expect(formatFspValidationErrors(errors)).toBe(
      "Aircraft: N737BC Cessna 172N: The time based maintenance reminder (100Hr Inspection) is expired.",
    );
  });

  it("formats generic errors when no FSP validation payload exists", () => {
    expect(formatFspError(new Error("Network error"))).toBe("Network error");
  });
});
