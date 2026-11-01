import { Router } from 'express';
import { z } from 'zod';
import { Project } from '../models/Project.js';
import { Task } from '../models/Task.js';
import { Notification } from '../models/Misc.js';
import { requireAuth } from '../middleware/auth.js';
import { requireMembership } from '../services/access.js';
import { escapeRegex, oid, wrap } from '../utils/async.js';
import { badRequest, notFound } from '../utils/errors.js';

export const notificationRouter = Router();
notificationRouter.use(requireAuth);

notificationRouter.get(
  '/',
  wrap(async (req, res) => {
    const [items, unread] = await Promise.all([
      Notification.find({ user: req.user!._id }).sort({ createdAt: -1 }).limit(50).lean(),
      Notification.countDocuments({ user: req.user!._id, read: false }),
    ]);
    res.json({ notifications: items, unread });
  }),
);
// Registered before "/:id/read".
notificationRouter.post(
  '/read-all',
  wrap(async (req, res) => {
    await Notification.updateMany({ user: req.user!._id, read: false }, { read: true });
    res.json({ ok: true });
  }),
);
notificationRouter.patch(
  '/:id/read',
  wrap(async (req, res) => {
    const n = await Notification.findOneAndUpdate({ _id: oid(req.params.id), user: req.user!._id }, { read: true }, { new: true });
    if (!n) throw notFound('Notification not found');
    res.json({ notification: n });
  }),
);

export const calendarRouter = Router();
calendarRouter.use(requireAuth);

const calendarQuery = z.object({
  workspaceId: z.string(),
  from: z.coerce.date(),
  to: z.coerce.date(),
});

/** Tasks with a due date in [from, to) for one workspace the caller belongs to (max 500, range <= 62 days). */
calendarRouter.get(
  '/',
  wrap(async (req, res) => {
    const q = calendarQuery.parse(req.query);
    const workspace = oid(q.workspaceId, 'workspaceId');
    await requireMembership(req.user!._id, workspace);
    if (q.to <= q.from) throw badRequest('"to" must be after "from"');
    if (q.to.getTime() - q.from.getTime() > 62 * 86400000) throw badRequest('Date range is too large (max 62 days)');
    const LIMIT = 500;
    const tasks = await Task.find({ workspace, dueDate: { $gte: q.from, $lt: q.to } })
      .sort({ dueDate: 1 })
      .limit(LIMIT)
      .lean();
    res.json({ tasks, truncated: tasks.length === LIMIT });
  }),
);

export const searchRouter = Router();
searchRouter.use(requireAuth);

const searchQuery = z.object({ workspaceId: z.string(), q: z.string().trim().min(2).max(100) });

/** Searches projects and tasks, only inside a workspace the caller belongs to. */
searchRouter.get(
  '/',
  wrap(async (req, res) => {
    const q = searchQuery.parse(req.query);
    const workspace = oid(q.workspaceId, 'workspaceId');
    await requireMembership(req.user!._id, workspace);
    const rx = new RegExp(escapeRegex(q.q), 'i');
    const [projects, tasks] = await Promise.all([
      Project.find({ workspace, $or: [{ name: rx }, { key: rx }, { description: rx }] }).limit(10).select('name key status').lean(),
      Task.find({ workspace, $or: [{ title: rx }, { description: rx }, { key: rx }, { labels: rx }] })
        .sort({ updatedAt: -1 })
        .limit(25)
        .select('key title status priority project dueDate')
        .lean(),
    ]);
    res.json({ projects, tasks });
  }),
);
