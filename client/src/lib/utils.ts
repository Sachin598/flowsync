import type { Priority, TaskStatus } from '../types';

export const STATUSES: { id: TaskStatus; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'To Do' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review', label: 'In Review' },
  { id: 'done', label: 'Done' },
];
export const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];
export const statusLabel = (s: string) => STATUSES.find((x) => x.id === s)?.label ?? s;
export const priorityClass: Record<Priority, string> = {
  low: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  high: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
};

/** Mirrors the server's float-position ordering so optimistic drops match what gets saved. */
export function positionAt(positions: number[], index: number): number {
  const i = Math.max(0, Math.min(index, positions.length));
  if (positions.length === 0) return 1000;
  if (i === 0) return positions[0] - 1000;
  if (i === positions.length) return positions[positions.length - 1] + 1000;
  return (positions[i - 1] + positions[i]) / 2;
}

/** Due dates are stored as the chosen calendar day, so a task due today is NOT overdue until tomorrow. */
export const isOverdue = (due?: string, status?: string, today: string = localToday()) => !!due && status !== 'done' && due.slice(0, 10) < today;
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const STATUS_COLORS: Record<string, string> = {
  backlog: '#94a3b8', todo: '#3b82f6', in_progress: '#f59e0b', in_review: '#8b5cf6', done: '#10b981',
};

export function checklistProgress(items?: { done: boolean }[]) {
  const total = items?.length ?? 0;
  const done = items?.filter((i) => i.done).length ?? 0;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/** 135 -> "2h 15m" */
export function formatMinutes(total: number) {
  const m = Math.max(0, Math.round(total));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return `${h}h ${r}m`;
  if (h) return `${h}h`;
  return `${r}m`;
}

/** Accepts "90" (minutes), "45m", "1h", "1h30m", "1.5h", "1:30". Returns minutes, or null if not understood. */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  let m = s.match(/^(\d+):([0-5]?\d)$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = s.match(/^(\d+(?:\.\d+)?)h$/);
  if (m) return Math.round(parseFloat(m[1]) * 60);
  m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?$/);
  if (m && (m[1] || m[2])) return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
  m = s.match(/^(\d+)$/);
  if (m) return Number(m[1]);
  return null;
}

export const PRIORITY_COLORS: Record<string, string> = { low: '#94a3b8', medium: '#3b82f6', high: '#f59e0b', urgent: '#ef4444' };
