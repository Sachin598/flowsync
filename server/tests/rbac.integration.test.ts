import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { SecurityEvent } from '../src/models/SecurityEvent.js';

/**
 * Role-based dashboards, RBAC, workspace isolation, reports and the security overview, against a real MongoDB.
 * Skipped unless MONGODB_URI_TEST is set (use a throwaway database).
 *
 * Roles: A = owner, B = admin, C = member, F = member, D = viewer, E = outsider (owner of a different workspace).
 */
const enabled = Boolean(process.env.MONGODB_URI_TEST);
const H = { 'X-Requested-With': 'FlowSync' };
const DAY = 86400000;
const ymd = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);
const due = (daysAgo: number) => `${ymd(daysAgo)}T00:00:00.000Z`; // due dates are stored as UTC midnight of the chosen day
const TODAY = ymd(0);

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe.skipIf(!enabled)('RBAC, role dashboards and isolation', () => {
  const app = createApp();
  const stamp = Date.now();
  const names = ['A', 'B', 'C', 'F', 'D', 'E'] as const;
  const agents = Object.fromEntries(names.map((n) => [n, request.agent(app)])) as Record<(typeof names)[number], request.Agent>;
  const { A, B, C, F, D, E } = agents;
  const ids: Record<string, string> = {};
  const email = (n: string) => `rb${n.toLowerCase()}${stamp}@t.dev`;
  let ws = '', wsE = '', pA = '', pB = '';
  const t: Record<string, string> = {};

  const dash = (agent: request.Agent, kind: string, extra: object = {}, workspaceId = ws) => agent.get(`/api/dashboard/${kind}`).set(H).query({ workspaceId, today: TODAY, timezone: 'UTC', ...extra });
  const mkTask = async (project: string, key: string, extra: object) => {
    const r = await A.post('/api/tasks').set(H).send({ projectId: project, title: key, ...extra });
    expect(r.status, key).toBe(201);
    t[key] = r.body.task._id;
  };

  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI_TEST!);
    for (const n of names) {
      expect((await agents[n].post('/api/auth/register').set(H).send({ name: `User ${n}`, email: email(n), password: 'password123' })).status).toBe(201);
      ids[n] = (await agents[n].get('/api/auth/me').set(H)).body.user.id;
    }
    ws = (await A.post('/api/workspaces').set(H).send({ name: 'RBAC WS' })).body.workspace._id;
    wsE = (await E.post('/api/workspaces').set(H).send({ name: 'Outsider WS' })).body.workspace._id;
    for (const [n, role] of [['B', 'admin'], ['C', 'member'], ['F', 'member'], ['D', 'viewer']] as const) {
      expect((await A.post(`/api/workspaces/${ws}/members`).set(H).send({ email: email(n), role })).status).toBe(201);
    }
    pA = (await A.post('/api/projects').set(H).send({ workspaceId: ws, name: 'Alpha', key: 'AAA' })).body.project._id;
    pB = (await A.post('/api/projects').set(H).send({ workspaceId: ws, name: 'Bravo', key: 'BBB' })).body.project._id;
    expect((await A.post('/api/projects').set(H).send({ workspaceId: ws, name: 'Charlie (empty)', key: 'CCC' })).status).toBe(201);
    // Alpha: 6 tasks, 2 done, 2 open+overdue  ->  "at risk".  Bravo: 2 open, none overdue  ->  healthy.  Charlie: no tasks.
    await mkTask(pA, 't1', { assignee: ids.C, status: 'done', dueDate: due(5) }); // finished late
    await mkTask(pA, 't2', { assignee: ids.C, status: 'in_progress', dueDate: due(3), priority: 'urgent', estimateHours: 5 }); // overdue
    await mkTask(pA, 't3', { assignee: ids.C, status: 'todo', dueDate: due(0), estimateHours: 3 }); // due today: NOT overdue
    await mkTask(pA, 't4', { assignee: ids.F, status: 'todo', dueDate: due(2) }); // overdue
    await mkTask(pA, 't5', { assignee: ids.F, status: 'done', dueDate: due(-3) }); // finished early
    await mkTask(pA, 't6', { status: 'backlog' }); // unassigned, undated
    await mkTask(pB, 't7', { assignee: ids.C, status: 'todo', dueDate: due(-2), estimateHours: 2 });
    await mkTask(pB, 't8', { assignee: ids.F, status: 'in_review', dueDate: due(-10) });
    expect((await C.post('/api/time-entries').set(H).send({ taskId: t.t2, minutes: 90, date: ymd(0), note: 'today' })).status).toBe(201);
    expect((await C.post('/api/time-entries').set(H).send({ taskId: t.t2, minutes: 30, date: ymd(2) })).status).toBe(201);
    expect((await F.post('/api/time-entries').set(H).send({ taskId: t.t4, minutes: 60, date: ymd(0) })).status).toBe(201);
    expect((await C.post(`/api/tasks/${t.t2}/comments`).set(H).send({ body: 'on it' })).status).toBe(201);
    // outsider's own tiny workspace
    const pe = (await E.post('/api/projects').set(H).send({ workspaceId: wsE, name: 'Elsewhere', key: 'EEE' })).body.project._id;
    expect((await E.post('/api/tasks').set(H).send({ projectId: pe, title: 'secret task' })).status).toBe(201);
  });
  afterAll(async () => {
    await mongoose.disconnect();
  });

  /* ---------------------------------------------------------------- admin */
  describe('admin dashboard (admin and owner)', () => {
    it('computes every KPI from the real data', async () => {
      for (const agent of [A, B]) {
        const r = await dash(agent, 'admin');
        expect(r.status).toBe(200);
        expect(r.body.kind).toBe('admin');
        expect(r.body.kpis).toEqual({ projects: 3, activeProjects: 3, members: 5, tasks: 8, completed: 2, pending: 6, overdue: 2, completionPct: 25 });
      }
    });
    it('due-today tasks are not overdue; done tasks never are', async () => {
      const r = await dash(B, 'admin');
      expect(r.body.kpis.overdue).toBe(2); // t2 and t4 only (t3 is due today, t1 is done)
      const alpha = r.body.projects.find((p: Body) => p.key === 'AAA');
      expect(alpha.overdue).toBe(2);
    });
    it('breaks tasks down by status and priority and charts completions per day', async () => {
      const r = (await dash(B, 'admin')).body;
      const by = (rows: Body[], k: string) => Object.fromEntries(rows.map((x) => [x[k], x.count]));
      expect(by(r.tasksByStatus, 'status')).toEqual({ done: 2, in_progress: 1, todo: 3, backlog: 1, in_review: 1 });
      expect(by(r.tasksByPriority, 'priority')).toEqual({ urgent: 1, medium: 7 });
      expect(r.completionTrend).toHaveLength(14);
      expect(r.completionTrend.at(-1)).toEqual({ date: TODAY, completed: 2 }); // t1 and t5 were completed just now
      expect(r.completionTrend.reduce((s: number, d: Body) => s + d.completed, 0)).toBe(2);
    });
    it('rates project health with reasons', async () => {
      const r = (await dash(B, 'admin')).body;
      const p = (key: string) => r.projects.find((x: Body) => x.key === key);
      expect(p('AAA')).toMatchObject({ tasks: 6, done: 2, progress: 33, health: { level: 'at_risk', reasons: ['2 of 4 open tasks are overdue (50%)'] } });
      expect(p('BBB')).toMatchObject({ tasks: 2, done: 0, progress: 0, health: { level: 'healthy' } });
      expect(p('CCC')).toMatchObject({ tasks: 0, health: { level: 'no_data' } });
      expect(p('AAA').loggedMinutes).toBe(180); // 90 + 30 (C) + 60 (F)
      expect(p('BBB').loggedMinutes).toBe(0);
    });
    it('shows workload and team performance per member', async () => {
      const team = (await dash(B, 'admin')).body.team as Body[];
      expect(team).toHaveLength(5);
      const u = (n: string) => team.find((m) => m.userId === ids[n])!;
      expect(u('C')).toMatchObject({ role: 'member', openTasks: 3, overdue: 1, openEstimateHours: 10, completed30d: 1, onTimePct: 0, loggedMinutes7d: 120, overloaded: false });
      expect(u('F')).toMatchObject({ openTasks: 2, overdue: 1, completed30d: 1, onTimePct: 100, loggedMinutes7d: 60 });
      expect(u('B')).toMatchObject({ role: 'admin', openTasks: 0, onTimePct: null, loggedMinutes7d: 0 });
      expect(team[0].userId === ids.C).toBe(true); // busiest first
    });
    it('lists upcoming deadlines (open tasks, soonest first), recent activity and an audit summary', async () => {
      const r = (await dash(B, 'admin')).body;
      expect(r.upcomingDeadlines.map((x: Body) => x.title)).toEqual(['t3', 't7']); // today and +2d; t8 is +10d, t5 is done
      expect(r.recentActivity.length).toBeGreaterThan(0);
      expect(r.recentActivity.length).toBeLessThanOrEqual(10);
      expect(r.audit.events7d).toBeGreaterThan(8);
      expect(r.audit.destructive7d).toBe(0);
      expect(r.audit.byCategory.map((c: Body) => c.category)).toEqual(expect.arrayContaining(['task', 'project', 'member', 'time']));
      expect(r.audit.topActors[0]).toMatchObject({ name: 'User A' });
    });
    it('cuts the completion chart by the user\'s time zone', async () => {
      const r = (await dash(B, 'admin', { timezone: 'Asia/Kolkata' })).body;
      expect(r.completionTrend.reduce((s: number, d: Body) => s + d.completed, 0)).toBe(2);
    });
    it('rejects bad parameters instead of trusting them', async () => {
      expect((await dash(B, 'admin', { today: '2020-01-01' })).status).toBe(400); // far from the server's date
      expect((await dash(B, 'admin', { today: '2026-02-30' })).status).toBe(400);
      expect((await dash(B, 'admin', { today: 'today' })).status).toBe(400);
      expect((await dash(B, 'admin', { timezone: 'Mars/Base' })).status).toBe(400);
      expect((await dash(B, 'admin', { workspaceId: 'nope' })).status).toBe(400);
      expect((await B.get('/api/dashboard/admin').set(H)).status).toBe(400);
      expect((await B.get('/api/dashboard/admin').set(H).query({ workspaceId: ws })).status).toBe(200); // today/timezone are optional
    });
  });

  /* --------------------------------------------------------------- member */
  describe('employee (member) dashboard', () => {
    it('shows only my own numbers', async () => {
      const r = await dash(C, 'member');
      expect(r.status).toBe(200);
      expect(r.body.kind).toBe('member');
      expect(r.body.kpis).toEqual({ assigned: 4, completed: 1, pending: 3, overdue: 1, loggedMinutes7d: 120, loggedMinutesToday: 90, activeProjects: 2 });
    });
    it('lists my tasks soonest-due first, today\'s tasks and my upcoming deadlines', async () => {
      const r = (await dash(C, 'member')).body;
      expect(r.myTasks.map((x: Body) => x.title)).toEqual(['t2', 't3', 't7']); // overdue, due today, +2d
      expect(r.todaysTasks.map((x: Body) => x.title)).toEqual(['t3']);
      expect(r.upcomingDeadlines.map((x: Body) => x.title)).toEqual(['t7']);
    });
    it('shows my workload, my time per day and my project progress', async () => {
      const r = (await dash(C, 'member')).body;
      expect(r.workload).toMatchObject({ openTasks: 3, overdue: 1, openEstimateHours: 10, overloaded: false });
      expect(Object.fromEntries(r.workload.byStatus.map((s: Body) => [s.status, s.count]))).toEqual({ in_progress: 1, todo: 2 });
      expect(r.time.daily).toHaveLength(7);
      expect(r.time.daily[6]).toEqual({ date: TODAY, minutes: 90 });
      expect(r.time.daily[4]).toEqual({ date: ymd(2), minutes: 30 });
      const alpha = r.projects.find((p: Body) => p.key === 'AAA');
      expect(alpha).toMatchObject({ myTasks: 3, myDone: 1, myOverdue: 1, myProgress: 33, projectProgress: 33, isOwner: false });
      expect(r.projects.map((p: Body) => p.key).sort()).toEqual(['AAA', 'BBB']);
    });
    it('shows my notifications and my own activity history only', async () => {
      const r = (await dash(C, 'member')).body;
      expect(r.notifications.unread).toBeGreaterThanOrEqual(4); // four assignments (+ "you were added")
      expect(r.notifications.items.length).toBeLessThanOrEqual(5);
      expect(r.activity.length).toBeGreaterThanOrEqual(3);
      expect(r.activity.every((a: Body) => a.actor._id === ids.C)).toBe(true);
      expect(r.activity.map((a: Body) => a.action)).toEqual(expect.arrayContaining(['time.created', 'comment.created']));
    });
    it('never leaks another person\'s data and ignores a user id sent by the client (IDOR)', async () => {
      const normal = (await dash(C, 'member')).body;
      const spoof = await dash(C, 'member', { userId: ids.F, assignee: ids.F, user: ids.F });
      expect(spoof.body.kpis).toEqual(normal.kpis); // still C's numbers
      expect(JSON.stringify(normal)).not.toContain(ids.F);
      expect(JSON.stringify(normal)).not.toContain('User F');
      expect((await dash(F, 'member')).body.kpis).toEqual({ assigned: 3, completed: 1, pending: 2, overdue: 1, loggedMinutes7d: 60, loggedMinutesToday: 60, activeProjects: 2 });
    });
    it('an admin can open the personal view too (their own work), and it is empty for them', async () => {
      const r = await dash(B, 'member');
      expect(r.status).toBe(200);
      expect(r.body.kpis).toMatchObject({ assigned: 0, completed: 0, pending: 0, overdue: 0, loggedMinutes7d: 0 });
    });
  });

  /* --------------------------------------------------------------- viewer */
  describe('viewer dashboard (read-only)', () => {
    it('shows the permitted overview and nothing personal', async () => {
      const r = await dash(D, 'viewer');
      expect(r.status).toBe(200);
      expect(r.body.kind).toBe('viewer');
      expect(r.body.kpis).toEqual({ projects: 3, activeProjects: 3, tasks: 8, completed: 2, pending: 6, overdue: 2, completionPct: 25 });
      expect(r.body.projects.find((p: Body) => p.key === 'AAA').health.level).toBe('at_risk');
      expect(r.body.upcomingDeadlines).toHaveLength(2);
      for (const hidden of ['team', 'audit', 'notifications', 'recentActivity', 'activity', 'time']) expect(r.body, hidden).not.toHaveProperty(hidden);
      expect(r.body.projects.every((p: Body) => p.loggedMinutes === null)).toBe(true); // no time data for viewers
    });
    it('cannot open the admin or personal dashboards', async () => {
      expect((await dash(D, 'admin')).status).toBe(403);
      expect((await dash(D, 'member')).status).toBe(403);
    });
    it('members cannot open the admin dashboard either', async () => {
      expect((await dash(C, 'admin')).status).toBe(403);
      expect((await dash(F, 'admin')).status).toBe(403);
    });
  });

  /* ------------------------------------------------------- viewer is read-only */
  describe('viewer cannot change anything', () => {
    const writes: [string, string, () => string, object?][] = [
      ['post', '/api/projects', () => '', { workspaceId: 'W', name: 'x', key: 'XXX' }],
      ['post', '/api/tasks', () => '', { projectId: 'P', title: 'x' }],
      ['patch', '/api/tasks/', () => t.t2, { title: 'hacked' }],
      ['post', '/api/tasks/', () => `${t.t2}/move`, { status: 'done', index: 0 }],
      ['delete', '/api/tasks/', () => t.t2],
      ['post', '/api/tasks/', () => `${t.t2}/comments`, { body: 'hi' }],
      ['post', '/api/tasks/', () => `${t.t2}/duplicate`, {}],
      ['patch', '/api/projects/', () => pA, { name: 'hacked' }],
      ['delete', '/api/projects/', () => pA],
      ['post', '/api/time-entries', () => '', { taskId: 'T', minutes: 10 }],
      ['post', '/api/time-entries/timer/start', () => '', { taskId: 'T' }],
      ['patch', '/api/workspaces/', () => ws, { name: 'hacked' }],
      ['delete', '/api/workspaces/', () => ws],
      ['post', '/api/workspaces/', () => `${ws}/members`, { email: 'x@y.dev', role: 'member' }],
      ['patch', '/api/workspaces/', () => `${ws}/members/${ids.C}`, { role: 'admin' }],
    ];
    it.each(writes.map((w) => [`${w[0].toUpperCase()} ${w[1]}…`, w] as const))('%s is refused with 403', async (_label, [method, base, suffix, body]) => {
      const fill = (o: object | undefined) => JSON.parse(JSON.stringify(o ?? {}).replace('"W"', JSON.stringify(ws)).replace('"P"', JSON.stringify(pA)).replace('"T"', JSON.stringify(t.t2)));
      const res = await D[method as 'post'](`${base}${suffix()}`).set(H).send(fill(body));
      expect(res.status).toBe(403);
    });
    it('and nothing changed', async () => {
      const task = (await D.get(`/api/tasks/${t.t2}`).set(H)).body.task;
      expect(task.title).toBe('t2');
      expect((await dash(A, 'admin')).body.kpis.tasks).toBe(8);
    });
    it('but can read what it is permitted to see', async () => {
      expect((await D.get('/api/projects').set(H).query({ workspaceId: ws })).status).toBe(200);
      expect((await D.get('/api/tasks').set(H).query({ projectId: pA })).status).toBe(200);
      expect((await D.get(`/api/tasks/${t.t2}`).set(H)).status).toBe(200);
      expect((await D.get(`/api/workspaces/${ws}/members`).set(H)).status).toBe(200);
      expect((await D.get('/api/calendar').set(H).query({ workspaceId: ws, from: ymd(30), to: ymd(-30) })).status).toBe(200);
    });
    it('is blocked from administration pages', async () => {
      expect((await D.get('/api/audit-logs').set(H).query({ workspaceId: ws, from: new Date(Date.now() - DAY).toISOString(), to: new Date(Date.now() + DAY).toISOString() })).status).toBe(403);
      expect((await D.get('/api/security/overview').set(H).query({ workspaceId: ws })).status).toBe(403);
      expect((await D.get(`/api/workspaces/${ws}/roles`).set(H)).status).toBe(403);
    });
  });

  /* ---------------------------------------------------- members vs admins */
  describe('role boundaries for members and admins', () => {
    it('a member can work but not administer', async () => {
      expect((await C.patch(`/api/workspaces/${ws}`).set(H).send({ name: 'x' })).status).toBe(403);
      expect((await C.delete(`/api/projects/${pB}`).set(H)).status).toBe(403);
      expect((await C.post(`/api/workspaces/${ws}/members`).set(H).send({ email: email('E'), role: 'member' })).status).toBe(403);
      expect((await C.delete(`/api/tasks/${t.t7}`).set(H)).status).toBe(403); // created by A, not by C
      expect((await C.get(`/api/workspaces/${ws}/roles`).set(H)).status).toBe(403);
      expect((await C.get('/api/security/overview').set(H).query({ workspaceId: ws })).status).toBe(403);
      expect((await C.patch(`/api/tasks/${t.t7}`).set(H).send({ title: 't7' })).status).toBe(200); // may edit tasks
    });
    it('a member can edit only projects they own; an admin can edit any', async () => {
      const mine = (await C.post('/api/projects').set(H).send({ workspaceId: ws, name: 'Cs project', key: 'CCM' })).body.project._id;
      expect((await C.patch(`/api/projects/${mine}`).set(H).send({ description: 'mine' })).status).toBe(200);
      expect((await C.patch(`/api/projects/${pA}`).set(H).send({ description: 'not mine' })).status).toBe(403);
      expect((await B.patch(`/api/projects/${pA}`).set(H).send({ description: 'admin edit' })).status).toBe(200);
      expect((await C.delete(`/api/projects/${mine}`).set(H)).status).toBe(403); // delete is admin-only even for the owner of it
    });
    it('a member can delete a task they created', async () => {
      const own = (await C.post('/api/tasks').set(H).send({ projectId: pB, title: 'mine to delete' })).body.task._id;
      expect((await C.delete(`/api/tasks/${own}`).set(H)).status).toBe(200);
    });
    it('an admin manages people but cannot touch admins or delete the workspace (owner only)', async () => {
      expect((await B.patch(`/api/workspaces/${ws}/members/${ids.D}`).set(H).send({ role: 'member' })).status).toBe(200);
      expect((await B.patch(`/api/workspaces/${ws}/members/${ids.D}`).set(H).send({ role: 'viewer' })).status).toBe(200);
      expect((await B.patch(`/api/workspaces/${ws}/members/${ids.C}`).set(H).send({ role: 'admin' })).status).toBe(403); // granting admin is owner-only
      expect((await B.delete(`/api/workspaces/${ws}`).set(H)).status).toBe(403);
      expect((await A.patch(`/api/workspaces/${ws}/members/${ids.C}`).set(H).send({ role: 'admin' })).status).toBe(200); // the owner can
      expect((await A.patch(`/api/workspaces/${ws}/members/${ids.C}`).set(H).send({ role: 'member' })).status).toBe(200);
    });
    it('every workspace carries the caller\'s permission list from the server', async () => {
      const perms = async (agent: request.Agent) => ((await agent.get('/api/workspaces').set(H)).body.workspaces.find((w: Body) => w._id === ws).permissions as string[]);
      expect(await perms(D)).toContain('dashboard.viewer');
      expect(await perms(D)).not.toContain('task.write');
      expect(await perms(C)).toEqual(expect.arrayContaining(['task.write', 'dashboard.member']));
      expect(await perms(C)).not.toContain('audit.view');
      expect(await perms(B)).toEqual(expect.arrayContaining(['audit.view', 'dashboard.admin', 'security.view']));
      expect(await perms(B)).not.toContain('workspace.delete');
      expect(await perms(A)).toContain('workspace.delete');
    });
  });

  /* ---------------------------------------------------------------- isolation */
  describe('workspace isolation', () => {
    it('an outsider gets 404 for every dashboard, list and report of a workspace they do not belong to', async () => {
      for (const kind of ['admin', 'member', 'viewer']) expect((await dash(E, kind)).status, kind).toBe(404);
      expect((await E.get('/api/tasks/mine').set(H).query({ workspaceId: ws })).status).toBe(404);
      expect((await E.get('/api/projects/mine').set(H).query({ workspaceId: ws })).status).toBe(404);
      expect((await E.get('/api/reports/projects').set(H).query({ workspaceId: ws })).status).toBe(404);
      expect((await E.get('/api/reports/projects/export.csv').set(H).query({ workspaceId: ws })).status).toBe(404);
      expect((await E.get('/api/security/overview').set(H).query({ workspaceId: ws })).status).toBe(404);
      expect((await E.get(`/api/workspaces/${ws}/roles`).set(H)).status).toBe(404);
      expect((await E.get(`/api/tasks/${t.t2}`).set(H)).status).toBe(404); // a task id from another workspace
    });
    it('an anonymous caller gets 401', async () => {
      for (const path of ['/api/dashboard/admin', '/api/dashboard/member', '/api/dashboard/viewer', '/api/reports/projects', '/api/security/overview', '/api/tasks/mine', '/api/projects/mine']) {
        expect((await request(app).get(path).set(H).query({ workspaceId: ws })).status, path).toBe(401);
      }
    });
    it('the outsider\'s own dashboard contains only their own workspace', async () => {
      const r = (await dash(E, 'admin', {}, wsE)).body;
      expect(r.kpis).toMatchObject({ projects: 1, tasks: 1, members: 1, completed: 0 });
      expect(JSON.stringify(r)).not.toMatch(/Alpha|Bravo|User A|User C|t2/);
      expect(r.team).toHaveLength(1);
    });
    it('being admin elsewhere grants nothing here (E owns another workspace)', async () => {
      expect((await dash(E, 'admin', {}, wsE)).status).toBe(200);
      expect((await dash(E, 'admin', {}, ws)).status).toBe(404);
    });
  });

  /* ------------------------------------------------------ my tasks / my projects */
  describe('my tasks and my projects', () => {
    const mine = (agent: request.Agent, q: object = {}) => agent.get('/api/tasks/mine').set(H).query({ workspaceId: ws, ...q });
    it('lists only my tasks, soonest due first, with project names', async () => {
      const r = (await mine(C)).body;
      expect(r.total).toBe(3); // default status=open: t2, t3, t7
      expect(r.tasks.map((x: Body) => x.title)).toEqual(['t2', 't3', 't7']);
      expect(r.tasks[0]).toMatchObject({ projectName: 'Alpha', priority: 'urgent' });
      expect((await mine(C, { status: 'done' })).body.tasks.map((x: Body) => x.title)).toEqual(['t1']);
    });
    it('pages and validates', async () => {
      const p1 = (await mine(C, { limit: 2 })).body;
      expect(p1).toMatchObject({ total: 3, pages: 2 });
      expect(p1.tasks).toHaveLength(2);
      expect((await mine(C, { limit: 2, page: 2 })).body.tasks.map((x: Body) => x.title)).toEqual(['t7']);
      expect((await mine(C, { status: 'bogus' })).status).toBe(400);
      expect((await mine(C, { limit: 101 })).status).toBe(400);
    });
    it('never returns somebody else\'s tasks, even if asked', async () => {
      const r = (await mine(F, { assignee: ids.C, userId: ids.C })).body;
      expect(r.tasks.map((x: Body) => x.title).sort()).toEqual(['t4', 't8']);
      expect((await mine(D)).body.total).toBe(0);
    });
    it('my projects: where I work or that I own', async () => {
      const get = async (agent: request.Agent) => (await agent.get('/api/projects/mine').set(H).query({ workspaceId: ws, today: TODAY })).body.projects as Body[];
      expect((await get(C)).map((p) => p.key).sort()).toEqual(['AAA', 'BBB', 'CCM']); // CCM: the project C created above
      expect((await get(F)).map((p) => p.key).sort()).toEqual(['AAA', 'BBB']);
      expect((await get(A)).map((p) => p.key).sort()).toEqual(['AAA', 'BBB', 'CCC']);
      expect((await get(A)).every((p) => p.isOwner)).toBe(true);
      expect(await get(D)).toEqual([]);
    });
  });

  /* ------------------------------------------------------------- reports */
  describe('reports', () => {
    const report = (agent: request.Agent) => agent.get('/api/reports/projects').set(H).query({ workspaceId: ws, today: TODAY });
    it('every role may read project performance, but only roles that may see time data get logged hours', async () => {
      for (const [n, agent] of [['A', A], ['B', B], ['C', C], ['D', D]] as const) expect((await report(agent)).status, n).toBe(200);
      expect((await report(A)).body.projects.find((p: Body) => p.key === 'AAA').loggedMinutes).toBe(180);
      expect((await report(B)).body.projects.find((p: Body) => p.key === 'AAA').loggedMinutes).toBe(180);
      for (const agent of [C, D]) expect((await report(agent)).body.projects.every((p: Body) => p.loggedMinutes === null)).toBe(true);
    });
    it('exports CSV with the same rule', async () => {
      const csv = async (agent: request.Agent) => agent.get('/api/reports/projects/export.csv').set(H).query({ workspaceId: ws, today: TODAY });
      const admin = await csv(A);
      expect(admin.status).toBe(200);
      expect(admin.headers['content-type']).toMatch(/text\/csv/);
      expect(admin.text.split('\n')[0]).toContain('Logged (h)');
      expect(admin.text).toContain('at_risk');
      expect(admin.text).toContain('2 of 4 open tasks are overdue (50%)');
      const viewer = await csv(D);
      expect(viewer.status).toBe(200);
      expect(viewer.text.split('\n')[0]).not.toContain('Logged');
    });
  });

  /* ---------------------------------------------------------------- roles page */
  describe('roles and permissions page', () => {
    it('admins and owners get the real matrix and member counts', async () => {
      for (const agent of [A, B]) {
        const r = await agent.get(`/api/workspaces/${ws}/roles`).set(H);
        expect(r.status).toBe(200);
        expect(r.body.roles).toEqual(['owner', 'admin', 'member', 'viewer']);
        expect(r.body.permissions.find((p: Body) => p.key === 'audit.view').roles).toEqual(['admin', 'owner']);
        expect(r.body.memberCounts).toEqual({ owner: 1, admin: 1, member: 2, viewer: 1 });
      }
      expect((await C.get(`/api/workspaces/${ws}/roles`).set(H)).status).toBe(403);
    });
  });

  /* ---------------------------------------------------------------- security */
  describe('security overview', () => {
    const overview = (agent: request.Agent, days = '7', workspaceId = ws) => agent.get('/api/security/overview').set(H).query({ workspaceId, days });
    beforeAll(async () => {
      const guest = () => request(app);
      for (let i = 0; i < 3; i++) expect((await guest().post('/api/auth/login').set(H).send({ email: email('C'), password: 'wrong-password' })).status).toBe(401);
      expect((await guest().post('/api/auth/login').set(H).send({ email: 'nobody@nowhere.dev', password: 'wrong-password' })).status).toBe(401); // unknown account: not recorded
      expect((await guest().post('/api/auth/login').set(H).send({ email: email('C'), password: 'password123' })).status).toBe(200);
      expect((await F.post('/api/auth/password').set(H).send({ currentPassword: 'password123', newPassword: 'password456' })).status).toBe(200);
      expect((await F.post('/api/auth/logout-all').set(H)).status).toBe(200);
    });
    it('counts sign-ins, failed sign-ins, password changes and revoked sessions for this workspace\'s members', async () => {
      const r = await overview(B);
      expect(r.status).toBe(200);
      expect(r.body.counts).toMatchObject({ signIns: 1, failedSignIns: 3, passwordChanges: 1, sessionsRevoked: 1, accountsCreated: 5, membersAdded: 4 });
      expect(r.body.days).toBe(7);
    });
    it('flags accounts with repeated failed sign-ins', async () => {
      const r = (await overview(A)).body;
      expect(r.flagThreshold).toBe(3);
      expect(r.flaggedAccounts).toHaveLength(1);
      expect(r.flaggedAccounts[0]).toMatchObject({ userId: ids.C, name: 'User C', failedSignIns: 3 });
    });
    it('lists recent events of members only and shows who changed access', async () => {
      const r = (await overview(A, '30')).body;
      const memberEmails = [email('A'), email('B'), email('C'), email('F'), email('D')];
      expect(r.recentEvents.length).toBeGreaterThan(0);
      expect(r.recentEvents.every((e: Body) => memberEmails.includes(e.user.email))).toBe(true);
      expect(r.recentAccessChanges.map((e: Body) => e.action)).toContain('member.added');
      expect(r.recentAccessChanges.find((e: Body) => e.action === 'member.added').target.name).toMatch(/^User /);
      expect(JSON.stringify(r)).not.toMatch(/passwordHash|\$2[aby]\$|password123|password456/);
    });
    it('is admin-only, workspace-scoped, and validates the window', async () => {
      expect((await overview(C)).status).toBe(403);
      expect((await overview(D)).status).toBe(403);
      expect((await overview(E)).status).toBe(404);
      expect((await overview(B, '14')).status).toBe(400);
      const own = (await overview(E, '7', wsE)).body; // E's own workspace sees none of the above
      expect(own.counts).toMatchObject({ signIns: 0, failedSignIns: 0, passwordChanges: 0, accountsCreated: 1 });
      expect(own.flaggedAccounts).toEqual([]);
    });
    it('expires events automatically after 180 days (TTL index) so IP addresses are not kept forever', async () => {
      await SecurityEvent.init();
      const idx = (await SecurityEvent.collection.indexes()).find((i) => i.expireAfterSeconds !== undefined);
      expect(idx?.expireAfterSeconds).toBe(60 * 60 * 24 * 180);
    });
  });
});
