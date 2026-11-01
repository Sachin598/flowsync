import { describe, expect, it } from 'vitest';
import { instantRange } from '../src/utils/dates.js';
import { auditExportQuery, auditQuery } from '../src/validators/audit.js';
import { toCsv } from '../src/utils/csv.js';

const id = 'a'.repeat(24);
const d = (iso: string) => new Date(iso);

describe('instantRange (audit log time window)', () => {
  it('accepts a normal window and keeps the end exclusive', () => {
    const r = instantRange(d('2026-10-28T18:30:00Z'), d('2026-10-29T18:30:00Z'));
    expect(r.start.toISOString()).toBe('2026-10-28T18:30:00.000Z');
    expect(r.endExclusive.toISOString()).toBe('2026-10-29T18:30:00.000Z');
  });
  it('rejects empty, reversed, invalid and oversized windows', () => {
    expect(() => instantRange(d('2026-10-29T00:00:00Z'), d('2026-10-29T00:00:00Z'))).toThrow(/must be after/);
    expect(() => instantRange(d('2026-10-29T00:00:01Z'), d('2026-10-29T00:00:00Z'))).toThrow(/must be after/);
    expect(() => instantRange(new Date('nope'), d('2026-10-29T00:00:00Z'))).toThrow(/valid/);
    expect(() => instantRange(d('2024-01-01T00:00:00Z'), d('2026-01-01T00:00:00Z'))).toThrow(/too large/);
  });
  it('allows exactly 366 days', () => {
    expect(() => instantRange(d('2026-01-01T00:00:00Z'), d('2027-01-02T00:00:00Z'))).not.toThrow();
  });
});

describe('audit query validation', () => {
  const base = { workspaceId: id, from: '2026-10-28T00:00:00Z', to: '2026-10-29T00:00:00Z' };
  it('applies defaults and bounds', () => {
    expect(auditQuery.parse(base)).toMatchObject({ page: 1, limit: 25 });
    expect(auditQuery.safeParse({ ...base, limit: 101 }).success).toBe(false);
    expect(auditQuery.safeParse({ ...base, page: 0 }).success).toBe(false);
  });
  it('rejects malformed ids, dates and action filters', () => {
    expect(auditQuery.safeParse({ ...base, workspaceId: 'x' }).success).toBe(false);
    expect(auditQuery.safeParse({ ...base, from: 'yesterday' }).success).toBe(false);
    expect(auditQuery.safeParse({ ...base, action: 'task.created; drop' }).success).toBe(false);
    expect(auditQuery.safeParse({ ...base, actorId: 'zz' }).success).toBe(false);
    expect(auditQuery.safeParse({ ...base, action: 'task.created', actorId: id, projectId: id }).success).toBe(true);
  });
  it('the export query has no paging fields', () => {
    expect(Object.keys(auditExportQuery.parse(base))).not.toContain('page');
  });
});

describe('csv export safety', () => {
  it('neutralises spreadsheet formulas in names', () => {
    expect(toCsv(['Actor'], [['=SUM(1)'], ['+1'], ['@x'], ['normal']])).toBe("Actor\n'=SUM(1)\n'+1\n'@x\nnormal");
  });
});
