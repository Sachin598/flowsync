import { Router } from 'express';
import { z } from 'zod';
import type { Types } from 'mongoose';
import { Activity } from '../models/Misc.js';
import { Membership } from '../models/Workspace.js';
import { SecurityEvent } from '../models/SecurityEvent.js';
import { requireAuth } from '../middleware/auth.js';
import { requireMembership } from '../services/access.js';
import { attachTargets } from '../services/auditFeed.js';
import { oid, wrap } from '../utils/async.js';

/**
 * Security dashboard data for workspace admins. It only ever includes events of accounts that are members of THIS workspace,
 * so one workspace's admin cannot learn anything about people outside it.
 */
export const securityRouter = Router();
securityRouter.use(requireAuth);
const query = z.object({ workspaceId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id'), days: z.enum(['7', '30']).default('7') });
const ACCESS_ACTIONS = ['member.added', 'member.role_changed', 'member.removed'];
export const FAILED_LOGIN_FLAG = 3; // this many failed sign-ins in the window flags an account

securityRouter.get('/overview', wrap(async (req, res) => {
  const q = query.parse(req.query);
  const workspace = oid(q.workspaceId, 'workspaceId');
  await requireMembership(req.user!._id, workspace, 'security.view');
  const since = new Date(Date.now() - Number(q.days) * 86400000);
  const memberIds = await Membership.distinct('user', { workspace });
  const match = { user: { $in: memberIds }, createdAt: { $gte: since } };

  const [byType, failed, recent, access, recentAccess] = await Promise.all([
    SecurityEvent.aggregate<{ _id: string; n: number }>([{ $match: match }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
    SecurityEvent.aggregate<{ _id: Types.ObjectId; n: number; last: Date; name?: string; email?: string }>([
      { $match: { ...match, type: 'login_failed' } }, { $group: { _id: '$user', n: { $sum: 1 }, last: { $max: '$createdAt' } } }, { $match: { n: { $gte: FAILED_LOGIN_FLAG } } }, { $sort: { n: -1 } }, { $limit: 10 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
      { $project: { n: 1, last: 1, name: { $arrayElemAt: ['$u.name', 0] }, email: { $arrayElemAt: ['$u.email', 0] } } },
    ]),
    SecurityEvent.find(match).sort({ createdAt: -1 }).limit(25).populate('user', 'name email').lean(),
    Activity.aggregate<{ _id: string; n: number }>([{ $match: { workspace, createdAt: { $gte: since }, action: { $in: ACCESS_ACTIONS } } }, { $group: { _id: '$action', n: { $sum: 1 } } }]),
    Activity.find({ workspace, createdAt: { $gte: since }, action: { $in: ACCESS_ACTIONS } }).sort({ createdAt: -1 }).limit(10).populate('actor', 'name').lean(),
  ]);
  const n = (t: string) => byType.find((b) => b._id === t)?.n ?? 0;
  const a = (t: string) => access.find((b) => b._id === t)?.n ?? 0;
  res.json({
    days: Number(q.days), flagThreshold: FAILED_LOGIN_FLAG,
    counts: { signIns: n('login_success'), failedSignIns: n('login_failed'), passwordChanges: n('password_changed'), sessionsRevoked: n('sessions_revoked'), accountsCreated: n('register'), membersAdded: a('member.added'), roleChanges: a('member.role_changed'), membersRemoved: a('member.removed') },
    flaggedAccounts: failed.map((f) => ({ userId: String(f._id), name: f.name ?? 'Unknown', email: f.email ?? '', failedSignIns: f.n, lastAttempt: f.last })),
    recentEvents: recent.map((e) => ({ _id: String(e._id), type: e.type, createdAt: e.createdAt, ip: e.ip, userAgent: e.userAgent, user: e.user })),
    recentAccessChanges: await attachTargets(recentAccess),
  });
}));
