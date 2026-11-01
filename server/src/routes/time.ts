import { Router } from 'express';
import type { Types } from 'mongoose';
import { Membership } from '../models/Workspace.js';
import { Project } from '../models/Project.js';
import { Task } from '../models/Task.js';
import { ActiveTimer } from '../models/ActiveTimer.js';
import { TimeEntry } from '../models/TimeEntry.js';
import { requireAuth } from '../middleware/auth.js';
import { loadTask, requireMembership } from '../services/access.js';
import { can } from '../permissions.js';
import { logActivity } from '../services/activity.js';
import { oid, wrap } from '../utils/async.js';
import { dayRange, isValidTimeZone, localDay, parseDay } from '../utils/dates.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { MAX_ENTRY_MINUTES, canModifyEntry, computeVariance, elapsedToMinutes, reportScope } from '../utils/timeMath.js';
import {
  historyQuery, rangeQuery, taskEntriesQuery, timeEntryCreateSchema, timeEntryUpdateSchema, timerStartSchema, timerStopSchema,
} from '../validators/time.js';

export const timeRouter = Router();
timeRouter.use(requireAuth);

const DAY = 86400000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const hm = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;

/** Validates a work day: real calendar date, not in the future (1 day slack for time zones), not older than 400 days. */
function resolveWorkDate(input?: string): Date {
  const date = input ? parseDay(input) : parseDay(isoDay(new Date()));
  if (!date) throw badRequest('Invalid date');
  const now = Date.now();
  if (date.getTime() > now + DAY) throw badRequest('Cannot log time in the future');
  if (date.getTime() < now - 400 * DAY) throw badRequest('Date is too far in the past');
  return date;
}

/** A person cannot hold more than 24 h of logged time on one day (across all workspaces). */
async function assertDailyCap(userId: Types.ObjectId, date: Date, minutes: number, excludeId?: Types.ObjectId) {
  const match: Record<string, unknown> = { user: userId, date };
  if (excludeId) match._id = { $ne: excludeId };
  const [row] = await TimeEntry.aggregate<{ m: number }>([{ $match: match }, { $group: { _id: null, m: { $sum: '$minutes' } } }]);
  const existing = row?.m ?? 0;
  if (existing + minutes > MAX_ENTRY_MINUTES) {
    throw badRequest(`That would put more than 24 hours on ${isoDay(date)} (${hm(existing)} already logged)`);
  }
}

function rangeOrThrow(from: string, to: string) {
  try {
    return dayRange(from, to);
  } catch (e) {
    throw badRequest((e as Error).message);
  }
}

const populateEntry = [
  { path: 'user', select: 'name' },
  { path: 'task', select: 'key title' },
  { path: 'project', select: 'name key' },
];

/* ------------------------------ active timer ------------------------------ */
// Registered before "/:id" routes so "timer" is never parsed as an id.

timeRouter.get(
  '/timer',
  wrap(async (req, res) => {
    const me = req.user!._id;
    const serverNow = new Date().toISOString();
    const timer = await ActiveTimer.findOne({ user: me }).populate('task', 'key title').populate('project', 'name key').lean();
    if (!timer) return res.json({ timer: null, serverNow });
    // Drop timers whose task is gone or whose owner lost write access, so they cannot get stuck.
    const membership = await Membership.findOne({ workspace: timer.workspace, user: me });
    if (!timer.task || !membership || !can(membership.role, 'time.log')) {
      await ActiveTimer.deleteOne({ _id: timer._id });
      return res.json({ timer: null, serverNow });
    }
    res.json({ timer, serverNow });
  }),
);

timeRouter.post(
  '/timer/start',
  wrap(async (req, res) => {
    const me = req.user!._id;
    const body = timerStartSchema.parse(req.body);
    if (body.timezone && !isValidTimeZone(body.timezone)) throw badRequest('Invalid time zone');
    const { task } = await loadTask(me, oid(body.taskId, 'taskId'), 'time.log');
    await ActiveTimer.init(); // make sure the unique index exists before relying on it
    try {
      const timer = await ActiveTimer.create({
        workspace: task.workspace, project: task.project, task: task._id, user: me,
        startedAt: new Date(), timezone: body.timezone ?? 'UTC', note: body.note ?? '',
      });
      await logActivity({ workspace: task.workspace, project: task.project, task: task._id, actor: me, action: 'timer.started', meta: { key: task.key } });
      res.status(201).json({ timer, serverNow: new Date().toISOString() });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) {
        const existing = await ActiveTimer.findOne({ user: me }).populate('task', 'key');
        const key = (existing?.task as unknown as { key?: string } | null)?.key;
        throw conflict(`A timer is already running${key ? ` on ${key}` : ''}. Stop it before starting another.`);
      }
      throw e;
    }
  }),
);

timeRouter.post(
  '/timer/stop',
  wrap(async (req, res) => {
    const me = req.user!._id;
    const body = timerStopSchema.parse(req.body ?? {});
    // Atomically take the timer: a double-click or two tabs can only ever stop it once.
    const timer = await ActiveTimer.findOneAndDelete({ user: me });
    if (!timer) throw notFound('No active timer');
    try {
      const { task } = await loadTask(me, timer.task, 'time.log'); // re-check access at stop time
      const endedAt = new Date();
      const { minutes, capped } = elapsedToMinutes(timer.startedAt, endedAt);
      const date = parseDay(localDay(timer.startedAt, timer.timezone))!; // day the timer was started, in the user's zone
      await assertDailyCap(me, date, minutes);
      const entry = await TimeEntry.create({
        workspace: task.workspace, project: task.project, task: task._id, user: me, minutes,
        note: body.note ?? timer.note, date, source: 'timer', startedAt: timer.startedAt, endedAt, timezone: timer.timezone,
      });
      await logActivity({ workspace: task.workspace, project: task.project, task: task._id, actor: me, action: 'timer.stopped', meta: { key: task.key, minutes, capped, entryId: String(entry._id) } });
      res.status(201).json({ entry, minutes, capped });
    } catch (e) {
      // Put the timer back unless it is unusable (task gone / access lost), so a transient failure never loses time.
      if (!(e instanceof HttpError && e.status === 404)) {
        await ActiveTimer.create({
          workspace: timer.workspace, project: timer.project, task: timer.task, user: timer.user,
          startedAt: timer.startedAt, timezone: timer.timezone, note: timer.note,
        }).catch(() => undefined);
      }
      throw e;
    }
  }),
);

timeRouter.delete(
  '/timer',
  wrap(async (req, res) => {
    const timer = await ActiveTimer.findOneAndDelete({ user: req.user!._id });
    if (timer) await logActivity({ workspace: timer.workspace, project: timer.project, task: timer.task, actor: req.user!._id, action: 'timer.discarded' });
    res.json({ ok: true, discarded: !!timer });
  }),
);

/* ---------------------------- reports and history ---------------------------- */

/** Summary + by-member + by-project (with estimate vs actual) for an inclusive day range. */
timeRouter.get(
  '/report',
  wrap(async (req, res) => {
    const q = rangeQuery.parse(req.query);
    const me = req.user!._id;
    const workspace = oid(q.workspaceId, 'workspaceId');
    const membership = await requireMembership(me, workspace);
    const { start, endExclusive } = rangeOrThrow(q.from, q.to);
    const scope = reportScope(membership.role);
    const match: Record<string, unknown> = { workspace, date: { $gte: start, $lt: endExclusive } };
    if (scope === 'self') match.user = me; // non-admins only ever aggregate their own rows

    const [summaryRows, byUser, byProjectMinutes, projects] = await Promise.all([
      TimeEntry.aggregate<{ minutes: number; entries: number; memberCount: number; projectCount: number }>([
        { $match: match },
        { $group: { _id: null, minutes: { $sum: '$minutes' }, entries: { $sum: 1 }, users: { $addToSet: '$user' }, projects: { $addToSet: '$project' } } },
        { $project: { _id: 0, minutes: 1, entries: 1, memberCount: { $size: '$users' }, projectCount: { $size: '$projects' } } },
      ]),
      TimeEntry.aggregate<{ _id: Types.ObjectId; minutes: number; entries: number; name?: string }>([
        { $match: match },
        { $group: { _id: '$user', minutes: { $sum: '$minutes' }, entries: { $sum: 1 } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
        { $project: { minutes: 1, entries: 1, name: { $arrayElemAt: ['$u.name', 0] } } },
        { $sort: { minutes: -1 } },
      ]),
      TimeEntry.aggregate<{ _id: Types.ObjectId; minutes: number }>([{ $match: match }, { $group: { _id: '$project', minutes: { $sum: '$minutes' } } }]),
      Project.find({ workspace, status: { $ne: 'archived' } }).select('name key').sort({ name: 1 }).limit(100).lean(),
    ]);

    // Estimate vs actual (admins only): tasks that had time logged in the range, their full estimate vs ALL-TIME actual.
    const est = new Map<string, { hours: number; tasks: number; unestimated: number }>();
    const act = new Map<string, number>();
    if (scope === 'all') {
      const taskIds = (await TimeEntry.aggregate<{ _id: Types.ObjectId }>([{ $match: match }, { $group: { _id: '$task' } }])).map((r) => r._id);
      if (taskIds.length) {
        const [estRows, actRows] = await Promise.all([
          Task.aggregate<{ _id: Types.ObjectId; hours: number; tasks: number; unestimated: number }>([
            { $match: { _id: { $in: taskIds } } },
            { $group: { _id: '$project', hours: { $sum: '$estimateHours' }, tasks: { $sum: 1 }, unestimated: { $sum: { $cond: [{ $gt: ['$estimateHours', 0] }, 0, 1] } } } },
          ]),
          TimeEntry.aggregate<{ _id: Types.ObjectId; minutes: number }>([
            { $match: { workspace, task: { $in: taskIds } } },
            { $group: { _id: '$project', minutes: { $sum: '$minutes' } } },
          ]),
        ]);
        estRows.forEach((r) => est.set(String(r._id), r));
        actRows.forEach((r) => act.set(String(r._id), r.minutes));
      }
    }
    const minutesBy = new Map(byProjectMinutes.map((r) => [String(r._id), r.minutes]));
    let sumHours = 0;
    let sumActual = 0;
    let unestimatedTotal = 0;
    const byProject = projects.map((p) => {
      const id = String(p._id);
      const base = { projectId: id, name: p.name, key: p.key, minutes: minutesBy.get(id) ?? 0 };
      if (scope !== 'all') return { ...base, tasksWorked: null, unestimatedTasks: null, estimateMinutes: null, actualMinutes: null, varianceMinutes: null, variancePct: null };
      const e = est.get(id);
      const v = computeVariance(e?.hours ?? 0, act.get(id) ?? 0);
      sumHours += e?.hours ?? 0;
      sumActual += v.actualMinutes;
      unestimatedTotal += e?.unestimated ?? 0;
      return { ...base, tasksWorked: e?.tasks ?? 0, unestimatedTasks: e?.unestimated ?? 0, ...v };
    });

    const s = summaryRows[0];
    res.json({
      scope,
      range: { from: q.from, to: q.to },
      summary: { totalMinutes: s?.minutes ?? 0, entryCount: s?.entries ?? 0, memberCount: s?.memberCount ?? 0, projectCount: s?.projectCount ?? 0 },
      byUser: byUser.map((r) => ({ userId: String(r._id), name: r.name ?? 'Unknown', minutes: r.minutes, entries: r.entries })),
      byProject,
      overall: scope === 'all' ? { ...computeVariance(sumHours, sumActual), unestimatedTasks: unestimatedTotal } : null,
    });
  }),
);

/** Paged entry history for a range. Admins see everyone (optionally filtered); others see only their own. */
timeRouter.get(
  '/history',
  wrap(async (req, res) => {
    const q = historyQuery.parse(req.query);
    const me = req.user!._id;
    const workspace = oid(q.workspaceId, 'workspaceId');
    const membership = await requireMembership(me, workspace);
    const { start, endExclusive } = rangeOrThrow(q.from, q.to);
    const scope = reportScope(membership.role);
    const match: Record<string, unknown> = { workspace, date: { $gte: start, $lt: endExclusive } };
    if (scope === 'self') match.user = me;
    else if (q.userId) match.user = oid(q.userId, 'userId');
    if (q.projectId) match.project = oid(q.projectId, 'projectId');
    const [entries, total] = await Promise.all([
      TimeEntry.find(match).sort({ date: -1, createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).populate(populateEntry).lean(),
      TimeEntry.countDocuments(match),
    ]);
    res.json({
      scope, page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit),
      entries: entries.map((e) => ({ ...e, canEdit: canModifyEntry((e.user as unknown as { _id: unknown })._id, me, membership.role) })),
    });
  }),
);

/* ------------------------------ entries (CRUD) ------------------------------ */

/** Entries on one task. Admins see all; others see only their own. `totalMinutes` is the task's all-time total. */
timeRouter.get(
  '/',
  wrap(async (req, res) => {
    const q = taskEntriesQuery.parse(req.query);
    const me = req.user!._id;
    const { task, membership } = await loadTask(me, oid(q.taskId, 'taskId'));
    const match: Record<string, unknown> = { task: task._id };
    if (reportScope(membership.role) === 'self') match.user = me;
    const [entries, total] = await Promise.all([
      TimeEntry.find(match).sort({ date: -1, createdAt: -1 }).limit(100).populate('user', 'name').lean(),
      TimeEntry.aggregate<{ m: number }>([{ $match: { task: task._id } }, { $group: { _id: null, m: { $sum: '$minutes' } } }]),
    ]);
    res.json({
      entries: entries.map((e) => ({ ...e, canEdit: canModifyEntry((e.user as unknown as { _id: unknown })._id, me, membership.role) })),
      totalMinutes: total[0]?.m ?? 0,
      scope: reportScope(membership.role),
    });
  }),
);

timeRouter.post(
  '/',
  wrap(async (req, res) => {
    const body = timeEntryCreateSchema.parse(req.body);
    const me = req.user!._id;
    const { task } = await loadTask(me, oid(body.taskId, 'taskId'), 'time.log');
    if (body.projectId && body.projectId !== String(task.project)) throw badRequest('That task does not belong to the selected project');
    const date = resolveWorkDate(body.date);
    await assertDailyCap(me, date, body.minutes);
    const entry = await TimeEntry.create({
      workspace: task.workspace, project: task.project, task: task._id, user: me,
      minutes: body.minutes, note: body.note ?? '', date, source: 'manual',
    });
    await logActivity({ workspace: task.workspace, project: task.project, task: task._id, actor: me, action: 'time.created', meta: { key: task.key, minutes: body.minutes, date: isoDay(date), entryId: String(entry._id) } });
    res.status(201).json({ entry });
  }),
);

async function loadEntry(userId: Types.ObjectId, id: Types.ObjectId) {
  const entry = await TimeEntry.findById(id);
  if (!entry) throw notFound('Time entry not found');
  const membership = await requireMembership(userId, entry.workspace).catch((e) => {
    throw e instanceof HttpError && e.status === 404 ? notFound('Time entry not found') : e;
  });
  return { entry, membership };
}

timeRouter.patch(
  '/:id',
  wrap(async (req, res) => {
    const me = req.user!._id;
    const { entry, membership } = await loadEntry(me, oid(req.params.id));
    if (!canModifyEntry(entry.user, me, membership.role)) throw forbidden('You can only edit your own time entries');
    const body = timeEntryUpdateSchema.parse(req.body);
    const before = { minutes: entry.minutes, note: entry.note, date: isoDay(entry.date) };
    const newDate = body.date ? resolveWorkDate(body.date) : entry.date;
    const newMinutes = body.minutes ?? entry.minutes;
    if (body.date || body.minutes) await assertDailyCap(entry.user as Types.ObjectId, newDate, newMinutes, entry._id);
    entry.minutes = newMinutes;
    entry.date = newDate;
    if (body.note !== undefined) entry.note = body.note;
    await entry.save();
    const after = { minutes: entry.minutes, note: entry.note, date: isoDay(entry.date) };
    await logActivity({ workspace: entry.workspace, project: entry.project, task: entry.task, actor: me, action: 'time.updated', meta: { entryId: String(entry._id), owner: String(entry.user), before, after } });
    res.json({ entry });
  }),
);

timeRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const me = req.user!._id;
    const { entry, membership } = await loadEntry(me, oid(req.params.id));
    if (!canModifyEntry(entry.user, me, membership.role)) throw forbidden('You can only delete your own time entries');
    await entry.deleteOne();
    await logActivity({
      workspace: entry.workspace, project: entry.project, task: entry.task, actor: me, action: 'time.deleted',
      meta: { entryId: String(entry._id), owner: String(entry.user), minutes: entry.minutes, date: isoDay(entry.date), source: entry.source },
    });
    res.json({ ok: true });
  }),
);
