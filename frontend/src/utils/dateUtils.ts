const MONTH_MAP: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

const MONTH_ABBR_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse a ZOHO sheet check-in/check-out timestamp into a Date.
 * Handles the mixed formats seen in the sheet, e.g.:
 *   "27-Jul-2026 6:00", "27 Jul 2026 11:00", "7-Aug-2026 11:00:00".
 * Day/month separator may be '-' or space; time (H:MM[:SS], 24-hour) is optional.
 * When the time is absent it defaults to end-of-day (23:59:59) so a check-out
 * given as a bare date stays valid through that whole day.
 * Returns null if the text can't be parsed.
 */
export function parseZohoDateTime(value: string): Date | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const m = text.match(
    /^(\d{1,2})[\s-]([A-Za-z]{3,})[\s-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!m) return null;
  const [, day, monthName, year, hh, mm, ss] = m;
  const month = MONTH_ABBR_MAP[monthName.slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  const hasTime = hh !== undefined;
  const parsed = new Date(
    Number(year), month, Number(day),
    hasTime ? Number(hh) : 23,
    hasTime ? Number(mm) : 59,
    hasTime ? Number(ss || 0) : 59,
  );
  return isNaN(parsed.getTime()) ? null : parsed;
}

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
