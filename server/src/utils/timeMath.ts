import { can, type Role } from '../permissions.js';

export const MAX_ENTRY_MINUTES = 1440; // 24 h: the most one entry, or one user on one day, may hold

/**
 * Timer duration rule (server-side only):
 *   elapsed = server stop time - server start time (never negative)
 *   minutes = elapsed rounded UP to a whole minute, at least 1, at most 1440.
 * `capped` is true when the real elapsed time exceeded 24 h and was truncated.
 */
export function elapsedToMinutes(startedAt: Date, endedAt: Date): { minutes: number; capped: boolean } {
  const ms = Math.max(0, endedAt.getTime() - startedAt.getTime());
  const raw = Math.ceil(ms / 60000);
  return { minutes: Math.min(MAX_ENTRY_MINUTES, Math.max(1, raw)), capped: raw > MAX_ENTRY_MINUTES };
}

/** variance = actual - estimate (positive = over estimate). variancePct is null when there is no estimate. */
export function computeVariance(estimateHours: number, actualMinutes: number) {
  const estimateMinutes = Math.round(estimateHours * 60);
  const varianceMinutes = actualMinutes - estimateMinutes;
  const variancePct = estimateMinutes > 0 ? Math.round((varianceMinutes / estimateMinutes) * 100) : null;
  return { estimateMinutes, actualMinutes, varianceMinutes, variancePct };
}

export type ReportScope = 'all' | 'self';
/** Admins and owners see everyone's time; everyone else sees only their own. */
export const reportScope = (role: Role): ReportScope => (can(role, 'time.view.all') ? 'all' : 'self');

/** May this user edit or delete the entry? Own entries need member+; other people's need admin+. */
export function canModifyEntry(entryUserId: unknown, userId: unknown, role: Role): boolean {
  const own = String(entryUserId) === String(userId);
  return (own && can(role, 'time.log')) || can(role, 'time.manage.all');
}
