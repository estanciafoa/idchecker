import { parseValidityDate } from '../utils/dateUtils';

describe('parseValidityDate', () => {
  // DD/MM/YYYY format
  test('parses DD/MM/YYYY', () => {
    const d = parseValidityDate('25/12/2025');
    expect(d).toBeInstanceOf(Date);
    expect(d!.getDate()).toBe(25);
    expect(d!.getMonth()).toBe(11); // December = 11
    expect(d!.getFullYear()).toBe(2025);
  });

  test('parses D/M/YYYY (single digit day/month)', () => {
    const d = parseValidityDate('1/3/2026');
    expect(d!.getDate()).toBe(1);
    expect(d!.getMonth()).toBe(2); // March = 2
    expect(d!.getFullYear()).toBe(2026);
  });

  test('parses DD-MM-YYYY (dash separator)', () => {
    const d = parseValidityDate('15-06-2026');
    expect(d!.getDate()).toBe(15);
    expect(d!.getMonth()).toBe(5);
    expect(d!.getFullYear()).toBe(2026);
  });

  test('parses DD.MM.YYYY (dot separator)', () => {
    const d = parseValidityDate('01.01.2027');
    expect(d!.getDate()).toBe(1);
    expect(d!.getMonth()).toBe(0);
    expect(d!.getFullYear()).toBe(2027);
  });

  // "DD Month YYYY" format
  test('parses "25 December 2025"', () => {
    const d = parseValidityDate('25 December 2025');
    expect(d!.getDate()).toBe(25);
    expect(d!.getMonth()).toBe(11);
    expect(d!.getFullYear()).toBe(2025);
  });

  test('parses "1 January 2026" (single digit day)', () => {
    const d = parseValidityDate('1 January 2026');
    expect(d!.getDate()).toBe(1);
    expect(d!.getMonth()).toBe(0);
  });

  test('parses case-insensitive month names', () => {
    const d = parseValidityDate('15 MARCH 2026');
    expect(d!.getMonth()).toBe(2);
  });

  test('parses ordinal suffixes (1st, 2nd, 3rd, 4th)', () => {
    expect(parseValidityDate('1st January 2026')!.getDate()).toBe(1);
    expect(parseValidityDate('2nd February 2026')!.getDate()).toBe(2);
    expect(parseValidityDate('3rd March 2026')!.getDate()).toBe(3);
    expect(parseValidityDate('4th April 2026')!.getDate()).toBe(4);
  });

  // Edge cases
  test('returns null for empty string', () => {
    expect(parseValidityDate('')).toBeNull();
  });

  test('returns null for whitespace', () => {
    expect(parseValidityDate('   ')).toBeNull();
  });

  test('returns null for invalid month name', () => {
    expect(parseValidityDate('1 Foo 2026')).toBeNull();
  });

  test('returns null for garbage input', () => {
    expect(parseValidityDate('not-a-date')).toBeNull();
  });

  test('trims whitespace', () => {
    const d = parseValidityDate('  25/12/2025  ');
    expect(d).not.toBeNull();
    expect(d!.getDate()).toBe(25);
  });

  test('all 12 months parse correctly', () => {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    months.forEach((month, idx) => {
      const d = parseValidityDate(`15 ${month} 2026`);
      expect(d).not.toBeNull();
      expect(d!.getMonth()).toBe(idx);
    });
  });
});
