import { formatMinutes, parseDuration } from './utils';

export interface LogForm { projectId: string; taskId: string; duration: string; date: string; note: string }
export type LogErrors = Partial<Record<keyof LogForm, string>>;

const isRealDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** Client-side validation mirrors the server rules so users get instant feedback; the server still re-validates everything. */
export function validateLogForm(f: LogForm, today: string, opts: { requireTask?: boolean } = {}) {
  const errors: LogErrors = {};
  if (opts.requireTask !== false) {
    if (!f.projectId) errors.projectId = 'Choose a project';
    if (!f.taskId) errors.taskId = 'Choose a task';
  }
  const minutes = parseDuration(f.duration);
  if (!f.duration.trim()) errors.duration = 'Enter a duration, e.g. 1h30m';
  else if (minutes === null) errors.duration = 'Use a format like 45m, 1h30m, 1.5h, 1:30 or 90';
  else if (minutes < 1) errors.duration = 'Duration must be at least 1 minute';
  else if (minutes > 1440) errors.duration = 'Duration cannot exceed 24 hours';
  if (!isRealDay(f.date)) errors.date = 'Choose a valid date';
  else if (f.date > today) errors.date = 'Date cannot be in the future';
  if (f.note.length > 200) errors.note = 'Description must be at most 200 characters';
  const valid = Object.keys(errors).length === 0;
  return { errors, valid, minutes: valid ? minutes : null };
}

/** Elapsed time of a server-started timer, corrected for the difference between the server's and this device's clock. */
export function timerElapsedMs(startedAtIso: string, skewMs: number, nowMs: number): number {
  return Math.max(0, nowMs + skewMs - new Date(startedAtIso).getTime());
}

export function clock(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

export type VarianceTone = 'over' | 'under' | 'even' | 'none';
/** Variance = actual - estimate. Positive means over the estimate. */
export function varianceLabel(v: { estimateMinutes: number | null; varianceMinutes: number | null; variancePct: number | null }): { text: string; tone: VarianceTone } {
  if (v.varianceMinutes === null || v.estimateMinutes === null) return { text: '—', tone: 'none' };
  if (v.estimateMinutes === 0) return { text: 'no estimate', tone: 'none' };
  if (v.varianceMinutes === 0) return { text: 'on estimate', tone: 'even' };
  const sign = v.varianceMinutes > 0 ? '+' : '−';
  const pct = v.variancePct === null ? '' : ` (${sign}${Math.abs(v.variancePct)}%)`;
  return { text: `${sign}${formatMinutes(Math.abs(v.varianceMinutes))}${pct}`, tone: v.varianceMinutes > 0 ? 'over' : 'under' };
}
export const toneClass: Record<VarianceTone, string> = {
  over: 'font-medium text-red-600', under: 'font-medium text-emerald-600', even: 'text-slate-600 dark:text-slate-300', none: 'text-slate-400',
};
