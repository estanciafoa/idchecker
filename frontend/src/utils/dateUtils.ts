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
  let text = String(validity || '').trim();
  if (!text) return null;
  // Ignore any trailing time component, e.g. "31-Aug-2026 23:00" or "...T09:30".
  text = text.replace(/[ T]\d{1,2}:\d{2}(?::\d{2})?\s*$/, '').trim();

  // Day [ordinal] <sep> Month <sep> Year, where the separator is a space, '-',
  // '/', or '.', and the month is either a number (1-12) or a name/abbreviation
  // (Aug, August, …). This covers "25/12/2025", "15-06-2026", "25 December
  // 2025", AND "31-Aug-2026" / "6-Sep-2026" (dash + month name), which the old
  // parser rejected — so dates in that style no longer read as "never expires".
  const m = text.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s./-]+([A-Za-z]+|\d{1,2})[\s./-]+(\d{4})$/i);
  if (m) {
    const day = Number(m[1]);
    const year = Number(m[3]);
    const monToken = m[2];
    let month: number | undefined;
    if (/^\d+$/.test(monToken)) {
      month = Number(monToken) - 1;
    } else {
      const key = monToken.toLowerCase();
      month = MONTH_MAP[key];
      if (month === undefined) month = MONTH_ABBR_MAP[key.slice(0, 3)];
    }
    if (month === undefined || month < 0 || month > 11) return null;
    const parsed = new Date(year, month, day);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  // ISO YYYY-MM-DD
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const parsed = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}
