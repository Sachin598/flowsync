import { describe, expect, it } from 'vitest';
import { canModifyEntry, computeVariance, elapsedToMinutes, reportScope } from '../src/utils/timeMath.js';
import { dayRange, isValidTimeZone, localDay, parseDay } from '../src/utils/dates.js';
import { MINUTES, historyQuery, timeEntryCreateSchema, timeEntryUpdateSchema, timerStartSchema, timerStopSchema } from '../src/validators/time.js';

const t = (iso: string) => new Date(iso);

describe('timer duration rule (server-side)', () => {
  it('rounds elapsed time UP to whole minutes', () => {
    expect(elapsedToMinutes(t('2026-10-29T10:00:00Z'), t('2026-10-29T10:01:00Z')).minutes).toBe(1);
    expect(elapsedToMinutes(t('2026-10-29T10:00:00Z'), t('2026-10-29T10:01:01Z')).minutes).toBe(2);
    expect(elapsedToMinutes(t('2026-10-29T10:00:00Z'), t('2026-10-29T11:30:00Z')).minutes).toBe(90);
  });
  it('logs at least 1 minute, even for an instant stop or a clock that went backwards', () => {
    expect(elapsedToMinutes(t('2026-10-29T10:00:00Z'), t('2026-10-29T10:00:00Z')).minutes).toBe(1);
    expect(elapsedToMinutes(t('2026-10-29T10:00:30Z'), t('2026-10-29T10:00:00Z')).minutes).toBe(1);
  });
  it('caps at 24 hours and reports that it capped', () => {
    expect(elapsedToMinutes(t('2026-10-29T00:00:00Z'), t('2026-10-30T00:00:00Z'))).toEqual({ minutes: 1440, capped: false });
    expect(elapsedToMinutes(t('2026-10-29T00:00:00Z'), t('2026-11-05T00:00:00Z'))).toEqual({ minutes: 1440, capped: true });
  });
});

describe('estimate vs actual variance', () => {
  it('over estimate -> positive variance', () => {
    expect(computeVariance(2, 180)).toEqual({ estimateMinutes: 120, actualMinutes: 180, varianceMinutes: 60, variancePct: 50 });
  });
  it('under estimate -> negative variance', () => {
    expect(computeVariance(4, 180)).toEqual({ estimateMinutes: 240, actualMinutes: 180, varianceMinutes: -60, variancePct: -25 });
  });
  it('exactly on estimate -> zero', () => {
    expect(computeVariance(1.5, 90)).toMatchObject({ varianceMinutes: 0, variancePct: 0 });
  });
  it('no estimate -> percentage is null, never divides by zero', () => {
    expect(computeVariance(0, 45)).toEqual({ estimateMinutes: 0, actualMinutes: 45, varianceMinutes: 45, variancePct: null });
  });
});

describe('time zone safe work day', () => {
  const instant = t('2026-10-29T20:00:00Z');
  it('maps one instant to the right calendar day per zone', () => {
    expect(localDay(instant, 'UTC')).toBe('2026-10-29');
    expect(localDay(instant, 'Asia/Kolkata')).toBe('2026-10-30'); // 01:30 next day in India
    expect(localDay(instant, 'America/Los_Angeles')).toBe('2026-10-29');
    expect(localDay(t('2026-10-29T23:59:59Z'), 'Asia/Kolkata')).toBe('2026-10-30');
    expect(localDay(t('2026-10-29T18:29:59Z'), 'Asia/Kolkata')).toBe('2026-10-29'); // just before IST midnight
    expect(localDay(t('2026-10-29T18:30:00Z'), 'Asia/Kolkata')).toBe('2026-10-30'); // exactly IST midnight
  });
  it('validates IANA zones', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('date range boundaries', () => {
  it('is inclusive of both days and half-open in UTC', () => {
    const { start, endExclusive } = dayRange('2026-10-23', '2026-10-29');
    expect(start.toISOString()).toBe('2026-10-23T00:00:00.000Z');
    expect(endExclusive.toISOString()).toBe('2026-10-30T00:00:00.000Z');
    const entryOn = (d: string) => parseDay(d)!;
    const inRange = (d: string) => entryOn(d) >= start && entryOn(d) < endExclusive;
    expect(inRange('2026-10-23')).toBe(true); // first day included
    expect(inRange('2026-10-29')).toBe(true); // last day included
    expect(inRange('2026-10-22')).toBe(false);
    expect(inRange('2026-10-30')).toBe(false);
  });
  it('a single day range contains exactly that day', () => {
    const { start, endExclusive } = dayRange('2026-10-29', '2026-10-29');
    expect(endExclusive.getTime() - start.getTime()).toBe(86400000);
  });
  it('handles month and leap-year edges', () => {
    expect(dayRange('2028-02-28', '2028-03-01').endExclusive.toISOString()).toBe('2028-03-02T00:00:00.000Z');
  });
  it('rejects reversed, invalid and oversized ranges', () => {
    expect(() => dayRange('2026-10-29', '2026-10-28')).toThrow(/must not be before/);
    expect(() => dayRange('2026-02-30', '2026-03-01')).toThrow(/valid/);
    expect(() => dayRange('2024-01-01', '2026-01-01')).toThrow(/too large/);
  });
});

describe('report scope and edit permissions', () => {
  it('only admin and owner see everyone', () => {
    expect(reportScope('owner')).toBe('all');
    expect(reportScope('admin')).toBe('all');
    expect(reportScope('member')).toBe('self');
    expect(reportScope('viewer')).toBe('self');
  });
  it('own entries need member+, others need admin+', () => {
    expect(canModifyEntry('u1', 'u1', 'member')).toBe(true);
    expect(canModifyEntry('u1', 'u1', 'viewer')).toBe(false);
    expect(canModifyEntry('u1', 'u2', 'member')).toBe(false);
    expect(canModifyEntry('u1', 'u2', 'admin')).toBe(true);
    expect(canModifyEntry('u1', 'u2', 'owner')).toBe(true);
  });
});

describe('manual time entry validation', () => {
  const id = 'a'.repeat(24);
  it('accepts a valid entry', () => {
    expect(timeEntryCreateSchema.safeParse({ taskId: id, minutes: 90, note: 'work', date: '2026-10-29' }).success).toBe(true);
  });
  it('rejects invalid durations', () => {
    for (const minutes of [0, -5, 1441, 1.5, NaN, '90' as unknown as number]) {
      expect(MINUTES.safeParse(minutes).success, String(minutes)).toBe(false);
    }
    expect(MINUTES.safeParse(1).success).toBe(true);
    expect(MINUTES.safeParse(1440).success).toBe(true);
  });
  it('rejects bad ids, dates and over-long descriptions', () => {
    expect(timeEntryCreateSchema.safeParse({ taskId: 'nope', minutes: 5 }).success).toBe(false);
    expect(timeEntryCreateSchema.safeParse({ taskId: id, minutes: 5, date: '29/10/2026' }).success).toBe(false);
    expect(timeEntryCreateSchema.safeParse({ taskId: id, minutes: 5, note: 'x'.repeat(201) }).success).toBe(false);
  });
  it('update needs at least one field', () => {
    expect(timeEntryUpdateSchema.safeParse({}).success).toBe(false);
    expect(timeEntryUpdateSchema.safeParse({ minutes: 30 }).success).toBe(true);
  });
  it('the stop-timer schema has no duration field (client cannot choose the duration)', () => {
    const parsed = timerStopSchema.parse({ minutes: 999, note: 'done' });
    expect(parsed).toEqual({ note: 'done' });
    expect(timerStartSchema.safeParse({ taskId: id, timezone: 'Asia/Kolkata' }).success).toBe(true);
  });
  it('history query is bounded', () => {
    const base = { workspaceId: id, from: '2026-10-01', to: '2026-10-07' };
    expect(historyQuery.parse(base)).toMatchObject({ page: 1, limit: 20 });
    expect(historyQuery.safeParse({ ...base, limit: 101 }).success).toBe(false);
  });
});
