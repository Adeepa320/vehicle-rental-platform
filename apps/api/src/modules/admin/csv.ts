/**
 * Minimal RFC 4180 CSV writer for the admin report exports (Phase 9). UTF-8
 * with a byte-order mark (so spreadsheets on Windows read Sinhala / Tamil
 * names correctly), CRLF line ends, every cell quoted when it needs it, and
 * **spreadsheet formula injection defused**: a cell starting with `=`, `+`,
 * `-`, `@`, a tab or a carriage return is prefixed with a single quote so
 * user-controlled text (provider names, place names) can never execute when
 * the file is opened in Excel or Sheets. A plain signed number (`-1000.00`,
 * e.g. a negative revenue estimate) is a numeric literal, not a formula, and
 * keeps its sign.
 */
export type CsvCell = string | number | boolean | null | undefined;

const FORMULA_LEADERS = ['=', '+', '-', '@', '\t', '\r'];

/** A plain, optionally negative decimal number: a numeric literal cannot be a formula. */
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : String(value);
  if (text.length > 0 && FORMULA_LEADERS.includes(text.charAt(0)) && !PLAIN_NUMBER.test(text))
    text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replaceAll('"', '""')}"`;
  return text;
}

/** UTF-8 byte-order mark; Excel on Windows needs it to read non-ASCII names correctly. */
export const CSV_BOM = String.fromCharCode(0xfeff);

export function toCsv(headers: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))];
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`;
}

export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';
