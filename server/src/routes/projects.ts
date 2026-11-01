import { Router } from 'express';
import { Project } from '../models/Project.js';
import { Task } from '../models/Task.js';
import { Activity, Comment } from '../models/Misc.js';
import { requireAuth } from '../middleware/auth.js';
import { loadProject, requireMembership } from '../services/access.js';
import { can, permissionsFor, type Role } from '../permissions.js';
import { logActivity } from '../services/activity.js';
import { oid, wrap } from '../utils/async.js';
import { badRequest, forbidden } from '../utils/errors.js';
import { projectCreateSchema, projectUpdateSchema } from '../validators/index.js';
import { myProjects, resolveDay } from '../services/dashboardData.js';

export const projectRouter = Router();
projectRouter.use(requireAuth);

projectRouter.get(
  '/',
  wrap(async (req, res) => {
    const workspaceId = oid(req.query.workspaceId, 'workspaceId');
    await requireMembership(req.user!._id, workspaceId);
    const includeArchived = req.query.includeArchived === 'true';
    const filter = { workspace: workspaceId, ...(includeArchived ? {} : { status: { $ne: 'archived' } }) };
    const projects = await Project.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    // Progress is computed from real task counts.
    const counts = await Task.aggregate([
      { $match: { workspace: workspaceId } },
      { $group: { _id: '$project', total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } } } },
    ]);
    const byProject = new Map(counts.map((c) => [String(c._id), c]));
    res.json({
      projects: projects.map((p) => {
        const c = byProject.get(String(p._id));
        const total = c?.total ?? 0;
        const done = c?.done ?? 0;
        return { ...p, taskTotal: total, taskDone: done, progress: total ? Math.round((done / total) * 100) : 0 };
      }),
    });
  }),
);

projectRouter.post(
  '/',
  wrap(async (req, res) => {
    const body = projectCreateSchema.parse(req.body);
    const workspaceId = oid(body.workspaceId, 'workspaceId');
    await requireMembership(req.user!._id, workspaceId, 'project.create');
    if (body.startDate && body.endDate && body.endDate < body.startDate) throw badRequest('End date must be after start date');
    const { workspaceId: _w, ...rest } = body;
    const project = await Project.create({ ...rest, workspace: workspaceId, owner: req.user!._id });
    await logActivity({ workspace: workspaceId, project: project._id, actor: req.user!._id, action: 'project.created', meta: { name: project.name } });
    res.status(201).json({ project });
  }),
);

/** Projects the caller owns or has tasks in, with their own progress. Access stays workspace-level (see docs/PERMISSIONS.md). */
projectRouter.get(
  '/mine',
  wrap(async (req, res) => {
    const workspaceId = oid(req.query.workspaceId, 'workspaceId');
    await requireMembership(req.user!._id, workspaceId, 'project.view');
    const { today } = resolveDay(req.query.today as string | undefined, req.query.timezone as string | undefined);
    res.json({ projects: await myProjects(workspaceId, req.user!._id, today) });
  }),
);

projectRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const { project, membership } = await loadProject(req.user!._id, oid(req.params.id));
    res.json({ project, myRole: membership.role, permissions: permissionsFor(membership.role as Role) });
  }),
);

projectRouter.patch(
  '/:id',
  wrap(async (req, res) => {
    const { project, membership } = await loadProject(req.user!._id, oid(req.params.id), 'project.update.own');
    const isOwner = String(project.owner) === String(req.user!._id);
    if (!isOwner && !can(membership.role, 'project.update')) throw forbidden('Only the project owner or an admin can edit this project');
    const body = projectUpdateSchema.parse(req.body);
    project.set(body);
    if (project.startDate && project.endDate && project.endDate < project.startDate) throw badRequest('End date must be after start date');
    await project.save();
    await logActivity({ workspace: project.workspace, project: project._id, actor: req.user!._id, action: 'project.updated', meta: { fields: Object.keys(body) } });
    res.json({ project });
  }),
);

projectRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const { project } = await loadProject(req.user!._id, oid(req.params.id), 'project.delete');
    // Activity (the audit trail) is deliberately kept: a deleted project must not erase the history of what happened to it.
    await Promise.all([Task.deleteMany({ project: project._id }), Comment.deleteMany({ project: project._id })]);
    await project.deleteOne();
    await logActivity({ workspace: project.workspace, actor: req.user!._id, action: 'project.deleted', meta: { name: project.name } });
    res.json({ ok: true });
  }),
);

projectRouter.get(
  '/:id/activity',
  wrap(async (req, res) => {
    const { project } = await loadProject(req.user!._id, oid(req.params.id));
    const items = await Activity.find({ project: project._id }).sort({ createdAt: -1 }).limit(50).populate('actor', 'name').lean();
    res.json({ activity: items });
  }),
);
