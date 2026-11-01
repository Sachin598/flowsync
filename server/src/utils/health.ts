/**
 * Rule-based project health and workload flags. These are transparent heuristics, not predictions:
 * every flag comes with the plain-language reasons that triggered it, and the thresholds are the constants below.
 */
export const HEALTH = {
  OVERDUE_AT_RISK: 0.3, // >= 30% of open tasks overdue
  OVERDUE_WATCH: 0.1, // >= 10% of open tasks overdue
  SLIP_AT_RISK: 25, // actual progress is >= 25 points behind the date-based expectation
  SLIP_WATCH: 10,
} as const;
export const OVERLOAD = { OPEN_TASKS: 15, OPEN_ESTIMATE_HOURS: 40 } as const;

export type HealthLevel = 'healthy' | 'watch' | 'at_risk' | 'complete' | 'no_data';
export interface HealthInput {
  status: string;
  startDate?: Date | null;
  endDate?: Date | null;
  total: number;
  done: number;
  overdue: number; // open tasks whose due day is before today
  today: Date; // UTC midnight of the viewer's local "today"
}
const DAY = 86400000;

export function computeProjectHealth(i: HealthInput): { level: HealthLevel; reasons: string[]; progress: number; expectedProgress: number | null } {
  const progress = i.total ? Math.round((i.done / i.total) * 100) : 0;
  if (i.total === 0) return { level: 'no_data', reasons: ['No tasks yet'], progress: 0, expectedProgress: null };
  if (i.done === i.total || i.status === 'completed' || i.status === 'archived') return { level: 'complete', reasons: [], progress, expectedProgress: null };

  const open = i.total - i.done;
  const reasons: string[] = [];
  const ratio = open ? i.overdue / open : 0;
  let expected: number | null = null;
  if (i.startDate && i.endDate && i.endDate > i.startDate) {
    expected = Math.round(Math.min(100, Math.max(0, ((i.today.getTime() - i.startDate.getTime()) / (i.endDate.getTime() - i.startDate.getTime())) * 100)));
  }
  const slip = expected === null ? 0 : expected - progress;
  const endPassed = !!i.endDate && i.today.getTime() > i.endDate.getTime();

  let level: HealthLevel = 'healthy';
  if (ratio >= HEALTH.OVERDUE_WATCH || slip >= HEALTH.SLIP_WATCH || i.status === 'on_hold') level = 'watch';
  if (ratio >= HEALTH.OVERDUE_AT_RISK || slip >= HEALTH.SLIP_AT_RISK || endPassed) level = 'at_risk';

  if (i.overdue > 0) reasons.push(`${i.overdue} of ${open} open tasks are overdue (${Math.round(ratio * 100)}%)`);
  if (expected !== null && slip >= HEALTH.SLIP_WATCH) reasons.push(`Behind schedule: about ${expected}% should be done by now, actual is ${progress}%`);
  if (endPassed) reasons.push(`Past its end date with ${open} open ${open === 1 ? 'task' : 'tasks'}`);
  if (i.status === 'on_hold') reasons.push('Project is on hold');
  return { level, reasons, progress, expectedProgress: expected };
}

export const isOverloaded = (openTasks: number, openEstimateHours: number) => openTasks >= OVERLOAD.OPEN_TASKS || openEstimateHours >= OVERLOAD.OPEN_ESTIMATE_HOURS;

/** The client sends its local "today" and time zone. Never trust them blindly: it must be within 2 days of the server's UTC day. */
export function isPlausibleToday(today: Date, now: Date = new Date()): boolean {
  return Math.abs(today.getTime() - Math.floor(now.getTime() / DAY) * DAY) <= 2 * DAY;
}
