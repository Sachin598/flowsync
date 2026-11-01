import { Router } from 'express';
import { Membership, Workspace } from '../models/Workspace.js';
import { Project } from '../models/Project.js';
import { Task } from '../models/Task.js';
import { Activity, Comment } from '../models/Misc.js';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { requireMembership } from '../services/access.js';
import { can, permissionsFor, permissionMatrix, type Role } from '../permissions.js';
import { logActivity, notify } from '../services/activity.js';
import { oid, wrap } from '../utils/async.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { addMemberSchema, roleSchema, workspaceSchema } from '../validators/index.js';

export const workspaceRouter = Router();
workspaceRouter.use(requireAuth);

workspaceRouter.get(
  '/',
  wrap(async (req, res) => {
    const memberships = await Membership.find({ user: req.user!._id }).populate('workspace');
    res.json({
      workspaces: memberships
        .filter((m) => m.workspace)
        .map((m) => ({ ...(m.workspace as unknown as { toJSON(): object }).toJSON(), myRole: m.role, permissions: permissionsFor(m.role as Role) })),
    });
  }),
);

workspaceRouter.post(
  '/',
  wrap(async (req, res) => {
    const body = workspaceSchema.parse(req.body);
    const ws = await Workspace.create({ ...body, owner: req.user!._id });
    await Membership.create({ workspace: ws._id, user: req.user!._id, role: 'owner' });
    await logActivity({ workspace: ws._id, actor: req.user!._id, action: 'workspace.created' });
    res.status(201).json({ workspace: { ...ws.toJSON(), myRole: 'owner', permissions: permissionsFor('owner') } });
  }),
);

workspaceRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const id = oid(req.params.id);
    const m = await requireMembership(req.user!._id, id);
    const ws = await Workspace.findById(id);
    res.json({ workspace: { ...ws!.toJSON(), myRole: m.role, permissions: permissionsFor(m.role as Role) } });
  }),
);

workspaceRouter.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = oid(req.params.id);
    await requireMembership(req.user!._id, id, 'workspace.update');
    const body = workspaceSchema.partial().parse(req.body);
    const ws = await Workspace.findByIdAndUpdate(id, body, { new: true });
    await logActivity({ workspace: id, actor: req.user!._id, action: 'workspace.updated', meta: { fields: Object.keys(body) } });
    res.json({ workspace: ws });
  }),
);

workspaceRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = oid(req.params.id);
    await requireMembership(req.user!._id, id, 'workspace.delete');
    // Cascade manually: MongoDB has no foreign keys.
    await Promise.all([
      Task.deleteMany({ workspace: id }),
      Comment.deleteMany({ workspace: id }),
      Project.deleteMany({ workspace: id }),
      Membership.deleteMany({ workspace: id }),
      Activity.deleteMany({ workspace: id }),
    ]);
    await Workspace.findByIdAndDelete(id);
    res.json({ ok: true });
  }),
);

workspaceRouter.get(
  '/:id/members',
  wrap(async (req, res) => {
    const id = oid(req.params.id);
    await requireMembership(req.user!._id, id);
    const members = await Membership.find({ workspace: id }).populate('user', 'name email avatarUrl');
    res.json({
      members: members.filter((m) => m.user).map((m) => ({ role: m.role, user: m.user, joinedAt: m.createdAt })),
    });
  }),
);

// Direct add of an existing user. A full invite/accept flow is listed as pending in docs/FEATURES.md.
workspaceRouter.post(
  '/:id/members',
  wrap(async (req, res) => {
    const id = oid(req.params.id);
    await requireMembership(req.user!._id, id, 'members.manage');
    const body = addMemberSchema.parse(req.body);
    const target = await User.findOne({ email: body.email, isActive: true });
    if (!target) throw notFound('No FlowSync user with that email. Ask them to register first.');
    if (await Membership.exists({ workspace: id, user: target._id })) throw conflict('Already a member');
    await Membership.create({ workspace: id, user: target._id, role: body.role });
    const ws = await Workspace.findById(id);
    await logActivity({ workspace: id, actor: req.user!._id, action: 'member.added', meta: { userId: String(target._id), role: body.role } });
    await notify(target._id, req.user!._id, 'member_added', `You were added to ${ws!.name}`, '/workspaces');
    res.status(201).json({ ok: true });
  }),
);

workspaceRouter.patch(
  '/:id/members/:userId',
  wrap(async (req, res) => {
    const id = oid(req.params.id);
    const userId = oid(req.params.userId, 'userId');
    const me = await requireMembership(req.user!._id, id, 'members.manage');
    const { role } = roleSchema.parse(req.body);
    const target = await Membership.findOne({ workspace: id, user: userId });
    if (!target) throw notFound('Member not found');
    if (target.role === 'owner') throw forbidden('The owner role cannot be changed');
    if (target.role === 'admin' && !can(me.role, 'admins.manage')) throw forbidden('Only the owner can change an admin');
    if (role === 'admin' && !can(me.role, 'admins.manage')) throw forbidden('Only the owner can grant admin');
    target.role = role;
    await target.save();
    await logActivity({ workspace: id, actor: req.user!._id, action: 'member.role_changed', meta: { userId: String(userId), role } });
    res.json({ ok: true });
  }),
);

workspaceRouter.delete(
  '/:id/members/:userId',
  wrap(async (req, res) => {
    const id = oid(req.params.id);
    const userId = oid(req.params.userId, 'userId');
    const isSelf = String(userId) === String(req.user!._id);
    const me = await requireMembership(req.user!._id, id, isSelf ? 'workspace.view' : 'members.manage');
    const target = await Membership.findOne({ workspace: id, user: userId });
    if (!target) throw notFound('Member not found');
    if (target.role === 'owner') throw badRequest('The owner cannot be removed');
    if (!isSelf && target.role === 'admin' && !can(me.role, 'admins.manage')) throw forbidden('Only the owner can remove an admin');
    await target.deleteOne();
    await Task.updateMany({ workspace: id, assignee: userId }, { $set: { assignee: null } });
    await logActivity({ workspace: id, actor: req.user!._id, action: 'member.removed', meta: { userId: String(userId) } });
    res.json({ ok: true });
  }),
);

/** Roles & Permissions page: the real permission matrix plus how many members hold each role. Admin/owner only. */
workspaceRouter.get(
  '/:id/roles',
  wrap(async (req, res) => {
    const id = oid(req.params.id);
    await requireMembership(req.user!._id, id, 'roles.view');
    const counts = await Membership.aggregate<{ _id: Role; n: number }>([{ $match: { workspace: id } }, { $group: { _id: '$role', n: { $sum: 1 } } }]);
    const memberCounts = Object.fromEntries(['owner', 'admin', 'member', 'viewer'].map((r) => [r, counts.find((c) => c._id === r)?.n ?? 0]));
    res.json({ ...permissionMatrix(), memberCounts });
  }),
);
