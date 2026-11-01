import { formatMinutes, statusLabel } from './utils';

export interface AuditEntry {
  _id: string;
  action: string;
  createdAt: string;
  meta: Record<string, unknown>;
  actor: { _id: string; name: string } | null;
  project: { _id: string; name: string; key: string } | null;
  task: { key: string; title: string } | null;
  target: { _id: string; name: string } | null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const fields = (v: unknown) => (Array.isArray(v) && v.length ? ` (${v.join(', ')})` : '');

/**
 * One readable sentence per audit row. It uses the details saved IN the row (task key/title, project name, old and new values),
 * not the live record, so an old entry still reads the way it happened even after the task was renamed or deleted.
 */
export function describeAudit(e: AuditEntry): string {
  const m = e.meta ?? {};
  const key = str(m.key) || e.task?.key || 'a task';
  const target = e.target?.name ?? 'a member';
  const own = !!e.target && !!e.actor && e.target._id === e.actor._id;
  const owner = own ? 'their own' : `${target}'s`;
  switch (e.action) {
    case 'workspace.created': return 'created the workspace';
    case 'workspace.updated': return `updated workspace settings${fields(m.fields)}`;
    case 'member.added': return `added ${target} as ${str(m.role) || 'a member'}`;
    case 'member.role_changed': return `changed ${target}'s role to ${str(m.role)}`;
    case 'member.removed': return `removed ${target} from the workspace`;
    case 'project.created': return `created project “${str(m.name)}”`;
    case 'project.updated': return `updated project ${e.project?.key ?? ''}${fields(m.fields)}`.replace('  ', ' ');
    case 'project.deleted': return `deleted project “${str(m.name)}”`;
    case 'task.created': return `created task ${key}${str(m.title) ? `: ${str(m.title)}` : ''}`;
    case 'task.updated': return `updated task ${key}${fields(m.fields)}`;
    case 'task.moved': return `moved ${key} from ${statusLabel(str(m.from))} to ${statusLabel(str(m.to))}`;
    case 'task.deleted': return `deleted task ${key}${str(m.title) ? `: ${str(m.title)}` : ''}`;
    case 'comment.created': return `commented on ${key}`;
    case 'time.created': return `logged ${formatMinutes(num(m.minutes))} on ${key}${str(m.date) ? ` for ${str(m.date)}` : ''}`;
    case 'time.updated': {
      const b = (m.before ?? {}) as Record<string, unknown>;
      const a = (m.after ?? {}) as Record<string, unknown>;
      const changes: string[] = [];
      if (b.minutes !== a.minutes) changes.push(`${formatMinutes(num(b.minutes))} → ${formatMinutes(num(a.minutes))}`);
      if (b.date !== a.date) changes.push(`date ${str(b.date)} → ${str(a.date)}`);
      if (b.note !== a.note) changes.push('description');
      return `edited ${owner} time entry${changes.length ? `: ${changes.join(', ')}` : ''}`;
    }
    case 'time.deleted': return `deleted ${owner} ${formatMinutes(num(m.minutes))} time entry${str(m.date) ? ` from ${str(m.date)}` : ''}`;
    case 'timer.started': return `started a timer on ${key}`;
    case 'timer.stopped': return `stopped a timer on ${key} and logged ${formatMinutes(num(m.minutes))}${m.capped ? ' (capped at 24h)' : ''}`;
    case 'timer.discarded': return 'discarded a running timer';
    default: return e.action;
  }
}

/**
 * Turns the user's local calendar days (YYYY-MM-DD, inclusive) into the exact instants the API expects:
 * local midnight of the first day, and local midnight of the day AFTER the last day (exclusive).
 * Built from local date parts, so the boundary is the user's own midnight in any time zone, DST included.
 */
export function localDayRangeToInstants(from: string, to: string): { from: string; to: string } {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return { from: new Date(fy, fm - 1, fd, 0, 0, 0, 0).toISOString(), to: new Date(ty, tm - 1, td + 1, 0, 0, 0, 0).toISOString() };
}
