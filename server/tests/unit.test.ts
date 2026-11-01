import { describe, expect, it } from 'vitest';
import { wouldCreateCycle } from '../src/utils/dependencies.js';
import { csvCell, toCsv } from '../src/utils/csv.js';
import { positionAt } from '../src/utils/position.js';
import { roleAtLeast } from '../src/services/access.js';
import { parseDay } from '../src/utils/dates.js';

describe('dependency cycle detection', () => {
  it('rejects self dependency', () => {
    expect(wouldCreateCycle(new Map(), 'a', 'a')).toBe(true);
  });
  it('rejects direct and transitive cycles', () => {
    // b is blocked by a; c is blocked by b
    const g = new Map([['b', ['a']], ['c', ['b']], ['a', []]]);
    expect(wouldCreateCycle(g, 'a', 'c')).toBe(true); // a blocked by c => a->c->b->a
    expect(wouldCreateCycle(g, 'a', 'b')).toBe(true);
  });
  it('allows valid dependencies', () => {
    const g = new Map([['b', ['a']], ['a', []], ['d', []]]);
    expect(wouldCreateCycle(g, 'd', 'b')).toBe(false);
    expect(wouldCreateCycle(g, 'b', 'd')).toBe(false);
  });
});

describe('csv export', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });
  it('neutralises formula injection', () => {
    expect(csvCell('=HYPERLINK("x")').startsWith("\"'=") || csvCell('=1+1').startsWith("'")).toBe(true);
    expect(csvCell('@cmd')).toBe("'@cmd");
  });
  it('builds rows', () => {
    expect(toCsv(['A', 'B'], [[1, 'x']])).toBe('A,B\n1,x');
  });
});

describe('kanban position', () => {
  it('handles empty, start, middle and end', () => {
    expect(positionAt([], 0)).toBe(1000);
    expect(positionAt([1000, 2000], 0)).toBe(0);
    expect(positionAt([1000, 2000], 1)).toBe(1500);
    expect(positionAt([1000, 2000], 2)).toBe(3000);
    expect(positionAt([1000, 2000], 99)).toBe(3000);
  });
});

describe('role hierarchy', () => {
  it('orders viewer < member < admin < owner', () => {
    expect(roleAtLeast('admin', 'member')).toBe(true);
    expect(roleAtLeast('viewer', 'member')).toBe(false);
    expect(roleAtLeast('owner', 'owner')).toBe(true);
  });
});

describe('parseDay', () => {
  it('accepts real calendar days as UTC midnight', () => {
    expect(parseDay('2026-10-29')?.toISOString()).toBe('2026-10-29T00:00:00.000Z');
    expect(parseDay('2028-02-29')).not.toBeNull(); // leap day
  });
  it('rejects malformed and impossible dates', () => {
    for (const bad of ['', '2026-1-1', '2026-13-45', '2026-02-30', 'tomorrow', '2026-10-29T10:00:00Z']) expect(parseDay(bad), bad).toBeNull();
  });
});
