export function startOfUtcDay(date: Date): Date {
  const normalized = new Date(date);
  normalized.setUTCHours(0, 0, 0, 0);
  return normalized;
}

export function endOfUtcDay(date: Date): Date {
  const normalized = new Date(date);
  normalized.setUTCHours(23, 59, 59, 999);
  return normalized;
}

export function addUtcDays(date: Date, days: number): Date {
  const normalized = startOfUtcDay(date);
  normalized.setUTCDate(normalized.getUTCDate() + days);
  return normalized;
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().split("T")[0];
}
