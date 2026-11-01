import { Router } from 'express';
import type { Types } from 'mongoose';
import { Project } from '../models/Project.js';
import { Task } from '../models/Task.js';
import { Comment } from '../models/Misc.js';
import { Membership, type Role } from '../models/Workspace.js';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { loadProject, loadTask } from '../services/access.js';
import { can } from '../permissions.js';
import { logActivity, notify } from '../services/activity.js';
import { emitToProject } from '../services/realtime.js';
import { escapeRegex, oid, wrap } from '../utils/async.js';
import { badRequest, forbidden } from '../utils/errors.js';
import { toCsv } from '../utils/csv.js';
import { wouldCreateCycle } from '../utils/dependencies.js';
import { positionAt } from '../utils/position.js';
import { commentSchema, taskCreateSchema, taskListQuery, taskMoveSchema, taskUpdateSchema } from '../validators/index.js';
import { z } from 'zod';
import { requireMembership } from '../services/access.js';

export const taskRouter = Router();
taskRouter.use(requireAuth);

const PRIORITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, urgent: 4 };

async function assertAssignable(workspace: Types.ObjectId, assigneeId: string | null | undefined) {
  if (!assigneeId) return;
  if (!(await Membership.exists({ workspace, user: assigneeId }))) throw badRequest('Assignee must be a member of the workspace');
}

/** Validates blockers belong to the same project and do not create a dependency cycle. */
async function assertDependencies(project: Types.ObjectId, taskId: string | null, blockedBy: string[]) {
  if (!blockedBy.length) return;
  const found = await Task.countDocuments({ _id: { $in: blockedBy }, project });
  if (found !== new Set(blockedBy).size) throw badRequest('Blocking tasks must exist in the same project');
  if (!taskId) return; // a brand-new task cannot be part of a cycle
  const all = await Task.find({ project }).select('blockedBy').lean();
  const graph = new Map(all.map((t) => [String(t._id), (t.blockedBy ?? []).map(String)]));
  graph.set(taskId, []); // evaluate the proposed edges from a clean slate for this task
  for (const b of blockedBy) {
    if (wouldCreateCycle(graph, taskId, b)) throw badRequest('That dependency would create a cycle');
    graph.set(taskId, [...(graph.get(taskId) ?? []), b]);
  }
}

taskRouter.get(
  '/',
  wrap(async (req, res) => {
    const q = taskListQuery.parse(req.query);
    const { project } = await loadProject(req.user!._id, oid(q.projectId, 'projectId'));
    const filter: Record<string, unknown> = { project: project._id };
    if (q.status) filter.status = q.status;
    if (q.priority) filter.priority = q.priority;
    if (q.label) filter.labels = q.label;
    if (q.assignee === 'me') filter.assignee = req.user!._id;
    else if (q.assignee === 'none') filter.assignee = null;
    else if (q.assignee) filter.assignee = q.assignee;
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      filter.$or = [{ title: rx }, { description: rx }, { key: rx }];
    }
    if (q.overdue === 'true') {
      filter.dueDate = { $lt: new Date() };
      filter.status = { $ne: 'done' };
    }
    const dir = q.order === 'asc' ? 1 : -1;
    const sort: Record<string, 1 | -1> = q.sort === 'priority' ? { priorityRank: dir } : { [q.sort]: dir };
    const skip = (q.page - 1) * q.limit;
    let tasks;
    if (q.sort === 'priority') {
      tasks = await Task.aggregate([
        { $match: filter },
        { $addFields: { priorityRank: { $switch: { branches: Object.entries(PRIORITY_RANK).map(([k, v]) => ({ case: { $eq: ['$priority', k] }, then: v })), default: 0 } } } },
        { $sort: sort },
        { $skip: skip },
        { $limit: q.limit },
      ]);
    } else {
      tasks = await Task.find(filter).sort(sort).skip(skip).limit(q.limit).lean();
    }
    const total = await Task.countDocuments(filter);
    res.json({ tasks, page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) });
  }),
);

const mineQuery = z.object({
  workspaceId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id'),
  status: z.enum(['open', 'backlog', 'todo', 'in_progress', 'in_review', 'done']).default('open'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** The caller's own assigned tasks across a workspace, soonest due first. Always about the authenticated user. */
taskRouter.get(
  '/mine',
  wrap(async (req, res) => {
    const q = mineQuery.parse(req.query);
    const workspace = oid(q.workspaceId, 'workspaceId');
    await requireMembership(req.user!._id, workspace, 'task.view');
    const match: Record<string, unknown> = { workspace, assignee: req.user!._id, ...(q.status === 'open' ? { status: { $ne: 'done' } } : { status: q.status }) };
    const [tasks, total] = await Promise.all([
      Task.aggregate([
        { $match: match },
        { $addFields: { sortDue: { $ifNull: ['$dueDate', new Date('9999-12-31T00:00:00Z')] } } },
        { $sort: { sortDue: 1, createdAt: -1 } }, { $skip: (q.page - 1) * q.limit }, { $limit: q.limit },
        { $lookup: { from: 'projects', localField: 'project', foreignField: '_id', as: 'p' } },
        { $project: { key: 1, title: 1, status: 1, priority: 1, dueDate: 1, estimateHours: 1, project: 1, projectName: { $arrayElemAt: ['$p.name', 0] } } },
      ]),
      Task.countDocuments(match),
    ]);
    res.json({ tasks, page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) });
  }),
);

// Registered before "/:id" so "export" is not parsed as an id.
taskRouter.get(
  '/export',
  wrap(async (req, res) => {
    const { project } = await loadProject(req.user!._id, oid(req.query.projectId, 'projectId'));
    const tasks = await Task.find({ project: project._id }).sort({ number: 1 }).limit(5000).populate('assignee', 'name').lean();
    const csv = toCsv(
      ['Key', 'Title', 'Status', 'Priority', 'Assignee', 'Due date', 'Estimate (h)', 'Labels', 'Created'],
      tasks.map((t) => [t.key, t.title, t.status, t.priority, (t.assignee as unknown as { name?: string })?.name ?? '', t.dueDate, t.estimateHours, (t.labels ?? []).join(';'), t.createdAt]),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${project.key}-tasks.csv"`);
    res.send(csv);
  }),
);

taskRouter.post(
  '/',
  wrap(async (req, res) => {
    const body = taskCreateSchema.parse(req.body);
    const { project } = await loadProject(req.user!._id, oid(body.projectId, 'projectId'), 'task.write');
    if (project.status === 'archived') throw badRequest('Archived projects are read-only');
    await assertAssignable(project.workspace, body.assignee);
    if (body.blockedBy) body.blockedBy = [...new Set(body.blockedBy)];
    await assertDependencies(project._id, null, body.blockedBy ?? []);
    const counter = await Project.findByIdAndUpdate(project._id, { $inc: { taskCounter: 1 } }, { new: true });
    const status = body.status ?? 'todo';
    const last = await Task.findOne({ project: project._id, status }).sort({ position: -1 }).select('position').lean();
    const { projectId: _p, ...rest } = body;
    const task = await Task.create({
      ...rest,
      workspace: project.workspace,
      project: project._id,
      number: counter!.taskCounter,
      key: `${project.key}-${counter!.taskCounter}`,
      status,
      position: (last?.position ?? 0) + 1000,
      creator: req.user!._id,
      completedAt: status === 'done' ? new Date() : undefined,
    });
    await logActivity({ workspace: project.workspace, project: project._id, task: task._id, actor: req.user!._id, action: 'task.created', meta: { key: task.key, title: task.title } });
    if (task.assignee) await notify(task.assignee, req.user!._id, 'task_assigned', `${req.user!.name} assigned you ${task.key}: ${task.title}`, `/projects/${project._id}`);
    emitToProject(project._id, 'task:created', task);
    res.status(201).json({ task });
  }),
);

taskRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const { task } = await loadTask(req.user!._id, oid(req.params.id));
    const full = await Task.findById(task._id).populate('assignee creator', 'name email').populate('blockedBy', 'key title status').lean();
    const blocking = await Task.find({ blockedBy: task._id }).select('key title status').lean();
    res.json({ task: full, blocking });
  }),
);

taskRouter.patch(
  '/:id',
  wrap(async (req, res) => {
    const { task } = await loadTask(req.user!._id, oid(req.params.id), 'task.write');
    const body = taskUpdateSchema.parse(req.body);
    if ('assignee' in body) await assertAssignable(task.workspace, body.assignee);
    if (body.blockedBy) {
      body.blockedBy = [...new Set(body.blockedBy)];
      await assertDependencies(task.project, String(task._id), body.blockedBy);
    }
    const previousAssignee = task.assignee ? String(task.assignee) : null;
    const previousStatus = task.status;
    task.set(body);
    if (body.status && body.status !== previousStatus) task.completedAt = body.status === 'done' ? new Date() : undefined;
    await task.save();
    await logActivity({ workspace: task.workspace, project: task.project, task: task._id, actor: req.user!._id, action: 'task.updated', meta: { key: task.key, fields: Object.keys(body) } });
    if (task.assignee && String(task.assignee) !== previousAssignee) {
      await notify(task.assignee, req.user!._id, 'task_assigned', `${req.user!.name} assigned you ${task.key}: ${task.title}`, `/projects/${task.project}`);
    }
    emitToProject(task.project, 'task:updated', task);
    res.json({ task });
  }),
);

taskRouter.post(
  '/:id/move',
  wrap(async (req, res) => {
    const { task } = await loadTask(req.user!._id, oid(req.params.id), 'task.write');
    const { status, index } = taskMoveSchema.parse(req.body);
    const column = await Task.find({ project: task.project, status, _id: { $ne: task._id } }).sort({ position: 1 }).select('position').lean();
    const from = task.status;
    task.status = status;
    task.position = positionAt(column.map((c) => c.position), index);
    if (from !== status) task.completedAt = status === 'done' ? new Date() : undefined;
    await task.save();
    if (from !== status) {
      await logActivity({ workspace: task.workspace, project: task.project, task: task._id, actor: req.user!._id, action: 'task.moved', meta: { key: task.key, from, to: status } });
    }
    emitToProject(task.project, 'task:updated', task);
    res.json({ task });
  }),
);

taskRouter.post(
  '/:id/duplicate',
  wrap(async (req, res) => {
    const { task } = await loadTask(req.user!._id, oid(req.params.id), 'task.write');
    const project = await Project.findByIdAndUpdate(task.project, { $inc: { taskCounter: 1 } }, { new: true });
    const copy = await Task.create({
      workspace: task.workspace, project: task.project, title: `${task.title} (copy)`, description: task.description,
      status: 'backlog', priority: task.priority, assignee: task.assignee, creator: req.user!._id, labels: task.labels,
      estimateHours: task.estimateHours, number: project!.taskCounter, key: `${project!.key}-${project!.taskCounter}`, position: Date.now(),
    });
    emitToProject(task.project, 'task:created', copy);
    res.status(201).json({ task: copy });
  }),
);

taskRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const { task, membership } = await loadTask(req.user!._id, oid(req.params.id), 'task.delete.own');
    const isCreator = String(task.creator) === String(req.user!._id);
    if (!isCreator && !can(membership.role as Role, 'task.delete')) throw forbidden('Only the creator or an admin can delete this task');
    await Comment.deleteMany({ task: task._id });
    await Task.updateMany({ blockedBy: task._id }, { $pull: { blockedBy: task._id } });
    await task.deleteOne();
    await logActivity({ workspace: task.workspace, project: task.project, actor: req.user!._id, action: 'task.deleted', meta: { key: task.key, title: task.title } });
    emitToProject(task.project, 'task:deleted', { _id: String(task._id) });
    res.json({ ok: true });
  }),
);

taskRouter.get(
  '/:id/comments',
  wrap(async (req, res) => {
    const { task } = await loadTask(req.user!._id, oid(req.params.id));
    const comments = await Comment.find({ task: task._id }).sort({ createdAt: 1 }).limit(200).populate('author', 'name').lean();
    res.json({ comments });
  }),
);

taskRouter.post(
  '/:id/comments',
  wrap(async (req, res) => {
    const { task } = await loadTask(req.user!._id, oid(req.params.id), 'comment.create');
    const { body } = commentSchema.parse(req.body);
    // @mentions: "@email@example.com" resolved only against members of this workspace.
    const emails = [...body.matchAll(/@([\w.+-]+@[\w-]+\.[\w.-]+)/g)].map((m) => m[1].toLowerCase());
    const users = emails.length ? await User.find({ email: { $in: emails } }).select('_id') : [];
    const memberIds = users.length ? (await Membership.find({ workspace: task.workspace, user: { $in: users.map((u) => u._id) } })).map((m) => m.user) : [];
    const comment = await Comment.create({ workspace: task.workspace, project: task.project, task: task._id, author: req.user!._id, body, mentions: memberIds });
    for (const id of memberIds) await notify(id, req.user!._id, 'mention', `${req.user!.name} mentioned you on ${task.key}`, `/projects/${task.project}`);
    await logActivity({ workspace: task.workspace, project: task.project, task: task._id, actor: req.user!._id, action: 'comment.created', meta: { key: task.key } });
    emitToProject(task.project, 'comment:created', { taskId: String(task._id) });
    res.status(201).json({ comment });
  }),
);
