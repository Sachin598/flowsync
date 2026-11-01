import { Router } from 'express';
import type { Types } from 'mongoose';
import { Activity } from '../models/Misc.js';
import { attachTargets } from '../services/auditFeed.js';
import { requireAuth } from '../middleware/auth.js';
import { requireMembership } from '../services/access.js';
import { oid, wrap } from '../utils/async.js';
import { toCsv } from '../utils/csv.js';
import { instantRange } from '../utils/dates.js';
import { badRequest } from '../utils/errors.js';
import { auditActionsQuery, auditExportQuery, auditQuery } from '../validators/audit.js';

/**
 * Audit log (read-only). Every row is written by the server when something happens (see logActivity);
 * there is deliberately NO endpoint that creates, edits or deletes a row, so nobody can rewrite history through the API.
 * Only workspace admins and owners may read it.
 */
export const auditRouter = Router();
auditRouter.use(requireAuth);

type Filters = { workspaceId: string; from: Date; to: Date; action?: string; actorId?: string; projectId?: string };

async function buildMatch(userId: Types.ObjectId, q: Filters) {
  const workspace = oid(q.workspaceId, 'workspaceId');
  await requireMembership(userId, workspace, 'audit.view'); // 403 for members/viewers, 404 for outsiders
  let range;
  try {
    range = instantRange(q.from, q.to);
  } catch (e) {
    throw badRequest((e as Error).message);
  }
  const match: Record<string, unknown> = { workspace, createdAt: { $gte: range.start, $lt: range.endExclusive } };
  if (q.action) match.action = q.action;
  if (q.actorId) match.actor = oid(q.actorId, 'actorId');
  if (q.projectId) match.project = oid(q.projectId, 'projectId');
  return match;
}

/** Distinct actions that exist in this workspace, for the filter dropdown. */
auditRouter.get(
  '/actions',
  wrap(async (req, res) => {
    const q = auditActionsQuery.parse(req.query);
    const workspace = oid(q.workspaceId, 'workspaceId');
    await requireMembership(req.user!._id, workspace, 'audit.view');
    const actions = (await Activity.distinct('action', { workspace })).sort();
    res.json({ actions });
  }),
);

auditRouter.get(
  '/export.csv',
  wrap(async (req, res) => {
    const q = auditExportQuery.parse(req.query);
    const match = await buildMatch(req.user!._id, q);
    const rows = await Activity.find(match)
      .sort({ createdAt: -1, _id: -1 })
      .limit(5000)
      .populate('actor', 'name')
      .populate('project', 'name key')
      .populate('task', 'key')
      .lean();
    const csv = toCsv(
      ['Time (UTC)', 'Actor', 'Action', 'Project', 'Task', 'Details'],
      rows.map((r) => [
        r.createdAt,
        (r.actor as unknown as { name?: string } | null)?.name ?? '',
        r.action,
        (r.project as unknown as { key?: string } | null)?.key ?? '',
        (r.task as unknown as { key?: string } | null)?.key ?? '',
        JSON.stringify(r.meta ?? {}),
      ]),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    res.send(csv);
  }),
);

auditRouter.get(
  '/',
  wrap(async (req, res) => {
    const q = auditQuery.parse(req.query);
    const match = await buildMatch(req.user!._id, q);
    const [entries, total] = await Promise.all([
      Activity.find(match)
        .sort({ createdAt: -1, _id: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .populate('actor', 'name')
        .populate('project', 'name key')
        .populate('task', 'key title')
        .lean(),
      Activity.countDocuments(match),
    ]);
    res.json({ page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit), entries: await attachTargets(entries) });
  }),
);
