import { describe, expect, it } from 'vitest';

import { CSV_BOM, csvCell, toCsv } from './csv';

describe('csv writer', () => {
  it('quotes commas, quotes and newlines and keeps plain cells bare', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(true)).toBe('true');
  });

  it('defuses spreadsheet formulas in user-controlled text', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell('+1234')).toBe("'+1234");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell('safe-hyphen inside')).toBe('safe-hyphen inside');
    // Platform-computed negative amounts are numeric literals, not formulas.
    expect(csvCell('-1000.00')).toBe('-1000.00');
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell('-1000.00+cmd')).toBe("'-1000.00+cmd");
    expect(csvCell('-1e3')).toBe("'-1e3");
  });

  it('writes a BOM, a header row and CRLF line ends, preserving Unicode', () => {
    const csv = toCsv(
      ['name', 'count'],
      [
        ['මාතර', 3],
        ['Galle, Fort', 1],
      ],
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toBe(`${CSV_BOM}name,count\r\nමාතර,3\r\n"Galle, Fort",1\r\n`);
  });
});
