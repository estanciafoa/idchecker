const MONTH_MAP: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

export function parseValidityDate(validity: string): Date | null {
  const text = validity.trim();

  let match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  match = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})$/i);
  if (match) {
    const [, day, monthName, year] = match;
    const month = MONTH_MAP[monthName.toLowerCase()];
    if (month === undefined) return null;
    const parsed = new Date(Number(year), month, Number(day));
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}
