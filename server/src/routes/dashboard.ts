import { Router } from 'express';
import { z } from 'zod';
import { Activity, Notification } from '../models/Misc.js';
import { Membership } from '../models/Workspace.js';
import { Task } from '../models/Task.js';
import { TimeEntry } from '../models/TimeEntry.js';
import { requireAuth } from '../middleware/auth.js';
import { requireMembership } from '../services/access.js';
import { attachTargets } from '../services/auditFeed.js';
import { DAY, isoDay, myProjects, overdueExpr, overview, projectRows, resolveDay, stages, sumIf, upcomingDeadlines } from '../services/dashboardData.js';
import { oid, wrap } from '../utils/async.js';
import { isOverloaded } from '../utils/health.js';
import type { Types } from 'mongoose';

/**
 * One endpoint per dashboard kind. Each checks its OWN permission, so a member cannot read the admin dashboard even by
 * calling the API directly, and the "personal" dashboard is always computed for the authenticated user (there is no userId parameter).
 */
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

const query = z.object({
  workspaceId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id'),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // the user's local calendar day
  timezone: z.string().max(64).optional(), // IANA zone, used to cut "per day" charts
});

/* --------------------------------- admin --------------------------------- */
dashboardRouter.get(
  '/admin',
  wrap(async (req, res) => {
    const q = query.parse(req.query);
    const workspace = oid(q.workspaceId, 'workspaceId');
    await requireMembership(req.user!._id, workspace, 'dashboard.admin');
    const { today, timezone } = resolveDay(q.today, q.timezone);
    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * DAY);
    const week = new Date(today.getTime() - 6 * DAY);

    const [ov, projects, members, roster, perAssignee, minutes7, upcoming, recent, auditFacet] = await Promise.all([
      overview(workspace, today, timezone),
      projectRows(workspace, today, true),
      Membership.countDocuments({ workspace }),
      Membership.find({ workspace }).populate('user', 'name').lean(),
      Task.aggregate<{ _id: Types.ObjectId; open: number; overdue: number; openEstimate: number; done30: number; due30: number; onTime30: number }>([
        { $match: { workspace, assignee: { $ne: null } } },
        {
          $group: {
            _id: '$assignee', open: sumIf(stages.isOpen), overdue: sumIf(overdueExpr(today)), openEstimate: sumIf(stages.isOpen, '$estimateHours'),
            done30: sumIf({ $and: [stages.isDone, { $gte: ['$completedAt', since30] }] }),
            due30: sumIf({ $and: [stages.isDone, { $gte: ['$completedAt', since30] }, stages.hasDue] }),
            onTime30: sumIf({ $and: [stages.isDone, { $gte: ['$completedAt', since30] }, stages.hasDue, { $lte: ['$completedAt', { $add: ['$dueDate', DAY] }] }] }),
          },
        },
      ]),
      TimeEntry.aggregate<{ _id: Types.ObjectId; minutes: number }>([
        { $match: { workspace, date: { $gte: week, $lt: new Date(today.getTime() + DAY) } } },
        { $group: { _id: '$user', minutes: { $sum: '$minutes' } } },
      ]),
      upcomingDeadlines(workspace, today),
      Activity.find({ workspace }).sort({ createdAt: -1 }).limit(10).populate('actor', 'name').populate('project', 'name key').populate('task', 'key title').lean(),
      Activity.aggregate<{ total: { n: number }[]; byCategory: { _id: string; n: number }[]; destructive: { n: number }[]; topActors: { _id: string; n: number; name?: string }[] }>([
        { $match: { workspace, createdAt: { $gte: new Date(now.getTime() - 7 * DAY) } } },
        {
          $facet: {
            total: [{ $count: 'n' }],
            byCategory: [{ $group: { _id: { $arrayElemAt: [{ $split: ['$action', '.'] }, 0] }, n: { $sum: 1 } } }, { $sort: { n: -1 } }],
            destructive: [{ $match: { action: { $regex: /\.(deleted|removed)$/ } } }, { $count: 'n' }],
            topActors: [
              { $group: { _id: '$actor', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 3 },
              { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
              { $project: { n: 1, name: { $arrayElemAt: ['$u.name', 0] } } },
            ],
          },
        },
      ]),
    ]);

    const stat = new Map(perAssignee.map((a) => [String(a._id), a]));
    const mins = new Map(minutes7.map((m) => [String(m._id), m.minutes]));
    const team = roster
      .filter((m) => m.user)
      .map((m) => {
        const uid = String((m.user as unknown as { _id: unknown })._id);
        const s = stat.get(uid);
        return {
          userId: uid, name: (m.user as unknown as { name: string }).name, role: m.role,
          openTasks: s?.open ?? 0, overdue: s?.overdue ?? 0, openEstimateHours: s?.openEstimate ?? 0,
          completed30d: s?.done30 ?? 0, onTimePct: s?.due30 ? Math.round((s.onTime30 / s.due30) * 100) : null,
          loggedMinutes7d: mins.get(uid) ?? 0, overloaded: isOverloaded(s?.open ?? 0, s?.openEstimate ?? 0),
        };
      })
      .sort((a, b) => b.openTasks - a.openTasks || a.name.localeCompare(b.name));

    const a = auditFacet[0];
    res.json({
      kind: 'admin',
      kpis: { projects: projects.length, activeProjects: projects.filter((p) => p.status === 'active').length, members, ...ov.kpis },
      tasksByStatus: ov.tasksByStatus, tasksByPriority: ov.tasksByPriority, completionTrend: ov.completionTrend,
      projects, team, upcomingDeadlines: upcoming,
      recentActivity: await attachTargets(recent),
      audit: { events7d: a?.total[0]?.n ?? 0, destructive7d: a?.destructive[0]?.n ?? 0, byCategory: (a?.byCategory ?? []).map((c) => ({ category: c._id, count: c.n })), topActors: (a?.topActors ?? []).map((t) => ({ userId: String(t._id), name: t.name ?? 'Unknown', count: t.n })) },
    });
  }),
);

/* -------------------------------- member --------------------------------- */
dashboardRouter.get(
  '/member',
  wrap(async (req, res) => {
    const q = query.parse(req.query);
    const workspace = oid(q.workspaceId, 'workspaceId');
    const me = req.user!._id; // always the authenticated user, never a client-supplied id
    await requireMembership(me, workspace, 'dashboard.member');
    const { today } = resolveDay(q.today, q.timezone);
    const tomorrow = new Date(today.getTime() + DAY);
    const mine = { workspace, assignee: me };
    const FAR = new Date('9999-12-31T00:00:00Z');
    const fields = { key: 1, title: 1, status: 1, priority: 1, dueDate: 1, project: 1, estimateHours: 1 };

    const [facet, myOpen, dueToday, upcoming, time7, projects, notifications, unread, activity] = await Promise.all([
      Task.aggregate<{ totals: { total: number; done: number; overdue: number; openEstimate: number }[]; status: { _id: string; n: number }[]; priority: { _id: string; n: number }[] }>([
        { $match: mine },
        {
          $facet: {
            totals: [{ $group: { _id: null, total: { $sum: 1 }, done: sumIf(stages.isDone), overdue: sumIf(overdueExpr(today)), openEstimate: sumIf(stages.isOpen, '$estimateHours') } }],
            status: [{ $match: { status: { $ne: 'done' } } }, { $group: { _id: '$status', n: { $sum: 1 } } }],
            priority: [{ $match: { status: { $ne: 'done' } } }, { $group: { _id: '$priority', n: { $sum: 1 } } }],
          },
        },
      ]),
      Task.aggregate([{ $match: { ...mine, status: { $ne: 'done' } } }, { $addFields: { sortDue: { $ifNull: ['$dueDate', FAR] } } }, { $sort: { sortDue: 1, createdAt: 1 } }, { $limit: 8 }, { $project: fields }]),
      Task.find({ ...mine, status: { $ne: 'done' }, dueDate: { $gte: today, $lt: tomorrow } }).sort({ priority: 1 }).limit(20).select(fields).lean(),
      Task.find({ ...mine, status: { $ne: 'done' }, dueDate: { $gte: tomorrow, $lt: new Date(today.getTime() + 8 * DAY) } }).sort({ dueDate: 1 }).limit(8).select(fields).lean(),
      TimeEntry.aggregate<{ _id: Date; minutes: number }>([
        { $match: { workspace, user: me, date: { $gte: new Date(today.getTime() - 6 * DAY), $lt: tomorrow } } },
        { $group: { _id: '$date', minutes: { $sum: '$minutes' } } },
      ]),
      myProjects(workspace, me, today),
      Notification.find({ user: me }).sort({ createdAt: -1 }).limit(5).lean(),
      Notification.countDocuments({ user: me, read: false }),
      Activity.find({ workspace, actor: me }).sort({ createdAt: -1 }).limit(10).populate('project', 'name key').populate('task', 'key title').lean(),
    ]);

    const f = facet[0];
    const t = f?.totals[0] ?? { total: 0, done: 0, overdue: 0, openEstimate: 0 };
    const perDay = new Map(time7.map((d) => [isoDay(d._id), d.minutes]));
    const daily = Array.from({ length: 7 }, (_, i) => { const d = isoDay(new Date(today.getTime() - (6 - i) * DAY)); return { date: d, minutes: perDay.get(d) ?? 0 }; });
    const open = t.total - t.done;
    res.json({
      kind: 'member',
      kpis: {
        assigned: t.total, completed: t.done, pending: open, overdue: t.overdue,
        loggedMinutes7d: daily.reduce((s, d) => s + d.minutes, 0), loggedMinutesToday: daily[6].minutes,
        activeProjects: projects.filter((p) => p.status === 'active').length,
      },
      myTasks: myOpen, todaysTasks: dueToday, upcomingDeadlines: upcoming,
      workload: { openTasks: open, overdue: t.overdue, openEstimateHours: t.openEstimate, byStatus: (f?.status ?? []).map((s) => ({ status: s._id, count: s.n })), byPriority: (f?.priority ?? []).map((p) => ({ priority: p._id, count: p.n })), overloaded: isOverloaded(open, t.openEstimate) },
      time: { daily },
      projects,
      notifications: { unread, items: notifications },
      activity: await attachTargets(activity.map((a) => ({ ...a, actor: { _id: String(me), name: req.user!.name } }))),
    });
  }),
);

/* -------------------------------- viewer --------------------------------- */
// Read-only workspace overview. No people-level data (no workload per person, no time, no audit, no notifications).
dashboardRouter.get(
  '/viewer',
  wrap(async (req, res) => {
    const q = query.parse(req.query);
    const workspace = oid(q.workspaceId, 'workspaceId');
    const membership = await requireMembership(req.user!._id, workspace, 'dashboard.viewer');
    const { today, timezone } = resolveDay(q.today, q.timezone);
    const [ov, projects, upcoming] = await Promise.all([overview(workspace, today, timezone), projectRows(workspace, today, false), upcomingDeadlines(workspace, today)]);
    res.json({
      kind: 'viewer', role: membership.role,
      kpis: { projects: projects.length, activeProjects: projects.filter((p) => p.status === 'active').length, ...ov.kpis },
      tasksByStatus: ov.tasksByStatus, projects, upcomingDeadlines: upcoming,
    });
  }),
);

