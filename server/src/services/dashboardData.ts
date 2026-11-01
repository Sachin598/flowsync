import { Types } from 'mongoose';
import { Project } from '../models/Project.js';
import { Task } from '../models/Task.js';
import { TimeEntry } from '../models/TimeEntry.js';
import { isValidTimeZone, parseDay } from '../utils/dates.js';
import { badRequest } from '../utils/errors.js';
import { computeProjectHealth, isPlausibleToday } from '../utils/health.js';

export const DAY = 86400000;
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The client tells us its local calendar day and time zone, because "today" depends on where the user is.
 * Both are validated; they only change how days are cut, never which workspace or user the data belongs to.
 * Due dates are stored as UTC midnight of the chosen day, so "overdue" means: open and due before the start of the user's today.
 */
export function resolveDay(todayStr?: string, tz?: string) {
  const timezone = tz ?? 'UTC';
  if (!isValidTimeZone(timezone)) throw badRequest('Invalid time zone');
  const today = parseDay(todayStr ?? isoDay(new Date()));
  if (!today) throw badRequest('today must be a valid YYYY-MM-DD date');
  if (!isPlausibleToday(today)) throw badRequest('today is too far from the server date');
  return { today, timezone };
}

// Aggregation building blocks. A due date counts only when it really is a date (null/missing never means "overdue").
const isOpen = { $ne: ['$status', 'done'] };
const isDone = { $eq: ['$status', 'done'] };
const hasDue = { $eq: [{ $type: '$dueDate' }, 'date'] };
export const overdueExpr = (today: Date) => ({ $and: [isOpen, hasDue, { $lt: ['$dueDate', today] }] });
export const sumIf = (cond: unknown, value: unknown = 1) => ({ $sum: { $cond: [cond, value, 0] } });
export const stages = { isOpen, isDone, hasDue };

type Count = { _id: string; n: number };

/** Workspace-wide task numbers shared by the admin and viewer dashboards. */
export async function overview(workspace: Types.ObjectId, today: Date, timezone: string) {
  const [r] = await Task.aggregate<{ totals: { total: number; done: number; overdue: number }[]; status: Count[]; priority: Count[]; trend: Count[] }>([
    { $match: { workspace } },
    {
      $facet: {
        totals: [{ $group: { _id: null, total: { $sum: 1 }, done: sumIf(isDone), overdue: sumIf(overdueExpr(today)) } }],
        status: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
        priority: [{ $group: { _id: '$priority', n: { $sum: 1 } } }],
        trend: [
          { $match: { completedAt: { $gte: new Date(today.getTime() - 14 * DAY) } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt', timezone } }, n: { $sum: 1 } } },
        ],
      },
    },
  ]);
  const t = r.totals[0] ?? { total: 0, done: 0, overdue: 0 };
  const trendBy = new Map(r.trend.map((x) => [x._id, x.n]));
  const days = Array.from({ length: 14 }, (_, i) => isoDay(new Date(today.getTime() - (13 - i) * DAY)));
  return {
    kpis: { tasks: t.total, completed: t.done, pending: t.total - t.done, overdue: t.overdue, completionPct: t.total ? Math.round((t.done / t.total) * 100) : 0 },
    tasksByStatus: r.status.map((x) => ({ status: x._id, count: x.n })),
    tasksByPriority: r.priority.map((x) => ({ priority: x._id, count: x.n })),
    completionTrend: days.map((d) => ({ date: d, completed: trendBy.get(d) ?? 0 })),
  };
}

/** One row per project: progress, overdue, estimate, health with reasons. Logged time only when the caller may see it. */
export async function projectRows(workspace: Types.ObjectId, today: Date, includeTime: boolean) {
  const [projects, stats, minutes] = await Promise.all([
    Project.find({ workspace }).select('name key status priority startDate endDate').sort({ name: 1 }).limit(200).lean(),
    Task.aggregate<{ _id: Types.ObjectId; total: number; done: number; overdue: number; openEstimate: number }>([
      { $match: { workspace } },
      { $group: { _id: '$project', total: { $sum: 1 }, done: sumIf(isDone), overdue: sumIf(overdueExpr(today)), openEstimate: sumIf(isOpen, '$estimateHours') } },
    ]),
    includeTime ? TimeEntry.aggregate<{ _id: Types.ObjectId; minutes: number }>([{ $match: { workspace } }, { $group: { _id: '$project', minutes: { $sum: '$minutes' } } }]) : Promise.resolve([]),
  ]);
  const by = new Map(stats.map((s) => [String(s._id), s]));
  const mins = new Map(minutes.map((m) => [String(m._id), m.minutes]));
  return projects.map((p) => {
    const s = by.get(String(p._id)) ?? { total: 0, done: 0, overdue: 0, openEstimate: 0 };
    const health = computeProjectHealth({ status: p.status, startDate: p.startDate, endDate: p.endDate, total: s.total, done: s.done, overdue: s.overdue, today });
    return {
      id: String(p._id), name: p.name, key: p.key, status: p.status, priority: p.priority, startDate: p.startDate ?? null, endDate: p.endDate ?? null,
      tasks: s.total, done: s.done, overdue: s.overdue, openEstimateHours: s.openEstimate, progress: health.progress,
      loggedMinutes: includeTime ? mins.get(String(p._id)) ?? 0 : null,
      health: { level: health.level, reasons: health.reasons, expectedProgress: health.expectedProgress },
    };
  });
}

/** Open tasks due from today through the next 7 days (soonest first). */
export function upcomingDeadlines(workspace: Types.ObjectId, today: Date, extra: Record<string, unknown> = {}, limit = 8) {
  return Task.find({ workspace, status: { $ne: 'done' }, dueDate: { $gte: today, $lt: new Date(today.getTime() + 8 * DAY) }, ...extra })
    .sort({ dueDate: 1 })
    .limit(limit)
    .populate('assignee', 'name')
    .select('key title dueDate priority project assignee')
    .lean();
}

/** Projects the user is involved in (owns, or has tasks assigned), with their own progress next to the project's. */
export async function myProjects(workspace: Types.ObjectId, me: Types.ObjectId, today: Date) {
  const [mine, owned] = await Promise.all([
    Task.aggregate<{ _id: Types.ObjectId; total: number; done: number; overdue: number }>([
      { $match: { workspace, assignee: me } },
      { $group: { _id: '$project', total: { $sum: 1 }, done: sumIf(isDone), overdue: sumIf(overdueExpr(today)) } },
    ]),
    Project.find({ workspace, owner: me }).select('_id').lean(),
  ]);
  const ids = [...new Set([...mine.map((m) => String(m._id)), ...owned.map((o) => String(o._id))])];
  if (!ids.length) return [];
  const [projects, totals] = await Promise.all([
    Project.find({ _id: { $in: ids } }).select('name key status priority endDate owner').sort({ name: 1 }).lean(),
    Task.aggregate<{ _id: Types.ObjectId; total: number; done: number }>([{ $match: { project: { $in: ids.map((id) => new Types.ObjectId(id)) } } }, { $group: { _id: '$project', total: { $sum: 1 }, done: sumIf(isDone) } }]),
  ]);
  const myBy = new Map(mine.map((m) => [String(m._id), m]));
  const allBy = new Map(totals.map((t) => [String(t._id), t]));
  return projects.map((p) => {
    const my = myBy.get(String(p._id));
    const all = allBy.get(String(p._id));
    return {
      id: String(p._id), name: p.name, key: p.key, status: p.status, priority: p.priority, endDate: p.endDate ?? null, isOwner: String(p.owner) === String(me),
      myTasks: my?.total ?? 0, myDone: my?.done ?? 0, myOverdue: my?.overdue ?? 0,
      myProgress: my?.total ? Math.round((my.done / my.total) * 100) : 0,
      projectProgress: all?.total ? Math.round((all.done / all.total) * 100) : 0,
    };
  });
}
