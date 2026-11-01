import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { can } from '../permissions.js';
import { requireMembership } from '../services/access.js';
import { projectRows, resolveDay } from '../services/dashboardData.js';
import { oid, wrap } from '../utils/async.js';
import { toCsv } from '../utils/csv.js';

/** Project performance report. Aggregate, project-level numbers only; logged hours appear only for roles that may see time data. */
export const reportRouter = Router();
reportRouter.use(requireAuth);
const query = z.object({ workspaceId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id'), today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

async function load(req: Parameters<Parameters<typeof wrap>[0]>[0]) {
  const q = query.parse(req.query);
  const workspace = oid(q.workspaceId, 'workspaceId');
  const membership = await requireMembership(req.user!._id, workspace, 'reports.view');
  const { today } = resolveDay(q.today);
  const showTime = can(membership.role, 'time.view.all');
  return { rows: await projectRows(workspace, today, showTime), showTime };
}

reportRouter.get('/projects/export.csv', wrap(async (req, res) => {
  const { rows, showTime } = await load(req);
  const header = ['Key', 'Project', 'Status', 'Priority', 'Start', 'End', 'Tasks', 'Done', 'Progress %', 'Overdue', 'Open estimate (h)', ...(showTime ? ['Logged (h)'] : []), 'Health', 'Why'];
  const day = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="project-report.csv"');
  res.send(toCsv(header, rows.map((r) => [r.key, r.name, r.status, r.priority, day(r.startDate), day(r.endDate), r.tasks, r.done, r.progress, r.overdue, r.openEstimateHours, ...(showTime ? [Math.round(((r.loggedMinutes ?? 0) / 60) * 10) / 10] : []), r.health.level, r.health.reasons.join('; ')])));
}));

reportRouter.get('/projects', wrap(async (req, res) => {
  const { rows } = await load(req);
  res.json({ projects: rows });
}));
