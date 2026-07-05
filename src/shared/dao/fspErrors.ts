import { FspHttpError } from "./api_wrapper.js";

export interface FspValidationError {
  message: string;
  overridable: boolean;
  groupLabel?: string;
}

function parseErrorEntry(entry: unknown): FspValidationError | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const message =
    "message" in entry && typeof entry.message === "string"
      ? entry.message
      : null;
  if (!message) {
    return null;
  }

  return {
    message,
    overridable: "overridable" in entry && entry.overridable === true,
    groupLabel:
      "groupLabel" in entry && typeof entry.groupLabel === "string"
        ? entry.groupLabel
        : undefined,
  };
}

function extractErrorsFromResponse(response: unknown): FspValidationError[] {
  if (typeof response !== "object" || response === null) {
    return [];
  }

  if (!("errors" in response) || !Array.isArray(response.errors)) {
    return [];
  }

  return response.errors
    .map(parseErrorEntry)
    .filter((entry): entry is FspValidationError => entry !== null);
}

export function parseFspValidationErrors(error: unknown): FspValidationError[] {
  if (error instanceof FspHttpError) {
    return extractErrorsFromResponse(error.response);
  }

  return [];
}

export function areAllErrorsOverridable(errors: FspValidationError[]): boolean {
  return errors.length > 0 && errors.every((error) => error.overridable);
}

export function formatFspValidationErrors(
  errors: FspValidationError[],
): string {
  return errors
    .map((error) => {
      const prefix = error.groupLabel ? `${error.groupLabel}: ` : "";
      return `${prefix}${error.message}`;
    })
    .join("; ");
}

export function formatFspError(error: unknown): string {
  const validationErrors = parseFspValidationErrors(error);
  if (validationErrors.length > 0) {
    return formatFspValidationErrors(validationErrors);
  }

  return error instanceof Error ? error.message : "Unknown error";
}
