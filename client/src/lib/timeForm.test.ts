import { describe, expect, it } from 'vitest';
import { clock, timerElapsedMs, validateLogForm, varianceLabel } from './timeForm';

const base = { projectId: 'p1', taskId: 't1', duration: '1h30m', date: '2026-10-29', note: '' };
const TODAY = '2026-10-29';

describe('validateLogForm', () => {
  it('accepts a valid form and returns the parsed minutes', () => {
    expect(validateLogForm(base, TODAY)).toMatchObject({ valid: true, minutes: 90, errors: {} });
    expect(validateLogForm({ ...base, duration: '1440' }, TODAY).valid).toBe(true);
  });
  it('requires project and task when creating, not when editing', () => {
    const r = validateLogForm({ ...base, projectId: '', taskId: '' }, TODAY);
    expect(r.errors).toMatchObject({ projectId: expect.any(String), taskId: expect.any(String) });
    expect(validateLogForm({ ...base, projectId: '', taskId: '' }, TODAY, { requireTask: false }).valid).toBe(true);
  });
  it('rejects empty, unreadable, zero and over-24h durations', () => {
    expect(validateLogForm({ ...base, duration: '' }, TODAY).errors.duration).toMatch(/Enter a duration/);
    expect(validateLogForm({ ...base, duration: 'abc' }, TODAY).errors.duration).toMatch(/format/);
    expect(validateLogForm({ ...base, duration: '0' }, TODAY).errors.duration).toMatch(/at least 1 minute/);
    expect(validateLogForm({ ...base, duration: '25h' }, TODAY).errors.duration).toMatch(/24 hours/);
    expect(validateLogForm({ ...base, duration: '1441' }, TODAY).errors.duration).toMatch(/24 hours/);
  });
  it('rejects missing, impossible and future dates', () => {
    expect(validateLogForm({ ...base, date: '' }, TODAY).errors.date).toMatch(/valid/);
    expect(validateLogForm({ ...base, date: '2026-02-30' }, TODAY).errors.date).toMatch(/valid/);
    expect(validateLogForm({ ...base, date: '2026-10-30' }, TODAY).errors.date).toMatch(/future/);
    expect(validateLogForm({ ...base, date: '2026-10-28' }, TODAY).valid).toBe(true);
  });
  it('limits the description to 200 characters', () => {
    expect(validateLogForm({ ...base, note: 'x'.repeat(201) }, TODAY).errors.note).toMatch(/200/);
    expect(validateLogForm({ ...base, note: 'x'.repeat(200) }, TODAY).valid).toBe(true);
  });
});

describe('timer clock', () => {
  const started = '2026-10-29T10:00:00.000Z';
  const at = (iso: string) => new Date(iso).getTime();
  it('measures elapsed time from the server start timestamp', () => {
    expect(timerElapsedMs(started, 0, at('2026-10-29T11:30:00.000Z'))).toBe(90 * 60000);
  });
  it('corrects for a device clock that is ahead of or behind the server', () => {
    // device clock 5 min fast => server is 5 min behind (skew -5m): displayed time must not include the 5 extra minutes
    expect(timerElapsedMs(started, -5 * 60000, at('2026-10-29T10:35:00.000Z'))).toBe(30 * 60000);
    expect(timerElapsedMs(started, 5 * 60000, at('2026-10-29T10:25:00.000Z'))).toBe(30 * 60000);
  });
  it('never goes negative', () => {
    expect(timerElapsedMs(started, 0, at('2026-10-29T09:00:00.000Z'))).toBe(0);
  });
  it('formats as HH:MM:SS', () => {
    expect(clock(0)).toBe('00:00:00');
    expect(clock(3723000)).toBe('01:02:03');
    expect(clock(-5)).toBe('00:00:00');
  });
});

describe('varianceLabel', () => {
  it('over estimate is red with a plus sign', () => {
    expect(varianceLabel({ estimateMinutes: 120, varianceMinutes: 60, variancePct: 50 })).toEqual({ text: '+1h (+50%)', tone: 'over' });
  });
  it('under estimate is green with a minus sign', () => {
    expect(varianceLabel({ estimateMinutes: 240, varianceMinutes: -60, variancePct: -25 })).toEqual({ text: '−1h (−25%)', tone: 'under' });
  });
  it('handles exact, missing and hidden values', () => {
    expect(varianceLabel({ estimateMinutes: 90, varianceMinutes: 0, variancePct: 0 }).tone).toBe('even');
    expect(varianceLabel({ estimateMinutes: 0, varianceMinutes: 45, variancePct: null })).toEqual({ text: 'no estimate', tone: 'none' });
    expect(varianceLabel({ estimateMinutes: null, varianceMinutes: null, variancePct: null })).toEqual({ text: '—', tone: 'none' });
  });
});
