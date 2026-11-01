import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { ActiveTimer } from '../src/models/ActiveTimer.js';
import { Activity } from '../src/models/Misc.js';

/**
 * Time & workload integration tests against a real MongoDB. Skipped unless MONGODB_URI_TEST is set.
 * Use a throwaway database: the tests create users, workspaces, tasks and time entries.
 *
 * Roles used: A = owner, B = admin, C = member, D = viewer, E = outsider (not in the workspace).
 */
const enabled = Boolean(process.env.MONGODB_URI_TEST);
const H = { 'X-Requested-With': 'FlowSync' };
const DAY = 86400000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => ymd(new Date(Date.now() - n * DAY));
const daysAhead = (n: number) => ymd(new Date(Date.now() + n * DAY));

describe.skipIf(!enabled)('time & workload: timers, entries, reports, history, authorization', () => {
  const app = createApp();
  const stamp = Date.now();
  const emails = { A: `ta${stamp}@t.dev`, B: `tb${stamp}@t.dev`, C: `tc${stamp}@t.dev`, D: `td${stamp}@t.dev`, E: `te${stamp}@t.dev` };
  const A = request.agent(app);
  const B = request.agent(app);
  const C = request.agent(app);
  const C2 = request.agent(app); // a second browser/device for the same member
  const D = request.agent(app);
  const E = request.agent(app);
  const ids: Record<string, string> = {};
  let ws = '', project = '', t1 = '', t2 = '', t3 = '';
  const entry: Record<string, string> = {};

  const log = (agent: request.Agent, body: object) => agent.post('/api/time-entries').set(H).send(body);
  const report = (agent: request.Agent, from: string, to: string) => agent.get(`/api/time-entries/report?workspaceId=${ws}&from=${from}&to=${to}`).set(H);
  const history = (agent: request.Agent, from: string, to: string, extra = '') => agent.get(`/api/time-entries/history?workspaceId=${ws}&from=${from}&to=${to}${extra}`).set(H);
  const ageTimer = (userId: string, startedAt: Date) => ActiveTimer.updateOne({ user: userId }, { startedAt });

  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI_TEST!);
    for (const [k, agent] of [['A', A], ['B', B], ['C', C], ['D', D], ['E', E]] as const) {
      const r = await agent.post('/api/auth/register').set(H).send({ name: `User ${k}`, email: emails[k], password: 'password123' });
      expect(r.status).toBe(201);
      ids[k] = (await agent.get('/api/auth/me').set(H)).body.user.id;
    }
    await C2.post('/api/auth/login').set(H).send({ email: emails.C, password: 'password123' });
    ws = (await A.post('/api/workspaces').set(H).send({ name: 'Time WS' })).body.workspace._id;
    for (const [k, role] of [['B', 'admin'], ['C', 'member'], ['D', 'viewer']] as const) {
      expect((await A.post(`/api/workspaces/${ws}/members`).set(H).send({ email: emails[k], role })).status).toBe(201);
    }
    project = (await A.post('/api/projects').set(H).send({ workspaceId: ws, name: 'Time Project', key: 'TMR' })).body.project._id;
    t1 = (await A.post('/api/tasks').set(H).send({ projectId: project, title: 'Estimated task', estimateHours: 2 })).body.task._id;
    t2 = (await A.post('/api/tasks').set(H).send({ projectId: project, title: 'Scratch task' })).body.task._id;
    t3 = (await A.post('/api/tasks').set(H).send({ projectId: project, title: 'Unestimated task' })).body.task._id;
  });
  afterAll(async () => {
    await mongoose.disconnect();
  });

  /* ------------------------------------------------------------------ timer */
  describe('server-side timer', () => {
    it('requires authentication, write access and workspace membership', async () => {
      expect((await request(app).post('/api/time-entries/timer/start').set(H).send({ taskId: t1 })).status).toBe(401);
      expect((await D.post('/api/time-entries/timer/start').set(H).send({ taskId: t1 })).status).toBe(403); // viewer
      expect((await E.post('/api/time-entries/timer/start').set(H).send({ taskId: t1 })).status).toBe(404); // outsider
      expect((await C.post('/api/time-entries/timer/start').set(H).send({ taskId: t1, timezone: 'Mars/Olympus' })).status).toBe(400);
    });

    it('starts a timer, persists it, and shows it on another device (survives refresh)', async () => {
      expect((await C.get('/api/time-entries/timer').set(H)).body.timer).toBeNull();
      const start = await C.post('/api/time-entries/timer/start').set(H).send({ taskId: t2 });
      expect(start.status).toBe(201);
      const startedAt = start.body.timer.startedAt;
      expect(Math.abs(new Date(startedAt).getTime() - Date.now())).toBeLessThan(5000); // server timestamp
      for (const agent of [C, C2]) {
        const got = await agent.get('/api/time-entries/timer').set(H);
        expect(got.body.timer.startedAt).toBe(startedAt);
        expect(got.body.timer.task.key).toBe('TMR-2');
        expect(got.body.serverNow).toBeTruthy();
      }
      expect((await D.get('/api/time-entries/timer').set(H)).body.timer).toBeNull(); // timers are private
    });

    it('rejects a second active timer', async () => {
      const dup = await C.post('/api/time-entries/timer/start').set(H).send({ taskId: t1 });
      expect(dup.status).toBe(409);
      expect(dup.body.error.message).toMatch(/already running on TMR-2/);
    });

    it('computes the duration on the server and ignores any duration sent by the client', async () => {
      const startedAt = new Date(Date.now() - 89.5 * 60000);
      await ageTimer(ids.C, startedAt);
      const stop = await C.post('/api/time-entries/timer/stop').set(H).send({ minutes: 5, durationMs: 1, note: 'done' });
      expect(stop.status).toBe(201);
      expect(stop.body.minutes).toBe(90);
      expect(stop.body.capped).toBe(false);
      expect(stop.body.entry).toMatchObject({ minutes: 90, source: 'timer', note: 'done', user: ids.C, task: t2, project, workspace: ws });
      expect(stop.body.entry.date.slice(0, 10)).toBe(ymd(startedAt));
      expect(new Date(stop.body.entry.endedAt).getTime()).toBeGreaterThan(new Date(stop.body.entry.startedAt).getTime());
      expect((await C.get('/api/time-entries/timer').set(H)).body.timer).toBeNull();
      expect((await C.post('/api/time-entries/timer/stop').set(H).send({})).status).toBe(404); // nothing left to stop
    });

    it('logs at least 1 minute for an immediate stop', async () => {
      await C.post('/api/time-entries/timer/start').set(H).send({ taskId: t2 });
      const stop = await C.post('/api/time-entries/timer/stop').set(H).send({});
      expect(stop.body.minutes).toBe(1);
    });

    it('caps a forgotten timer at 24h and decides the work day in the start-time zone', async () => {
      // 20:00 UTC is already the next day in India
      await C.post('/api/time-entries/timer/start').set(H).send({ taskId: t2, timezone: 'Asia/Kolkata' });
      await ageTimer(ids.C, new Date(`${daysAgo(9)}T20:00:00Z`));
      const ist = await C.post('/api/time-entries/timer/stop').set(H).send({});
      expect(ist.body).toMatchObject({ minutes: 1440, capped: true });
      expect(ist.body.entry.date.slice(0, 10)).toBe(daysAgo(8));
      // ...but still the same day in Los Angeles
      await C.post('/api/time-entries/timer/start').set(H).send({ taskId: t2, timezone: 'America/Los_Angeles' });
      await ageTimer(ids.C, new Date(`${daysAgo(12)}T20:00:00Z`));
      const la = await C.post('/api/time-entries/timer/stop').set(H).send({});
      expect(la.body.entry.date.slice(0, 10)).toBe(daysAgo(12));
    });

    it('only one of several simultaneous starts succeeds, and only one stop does', async () => {
      const starts = await Promise.all([1, 2, 3, 4].map(() => C.post('/api/time-entries/timer/start').set(H).send({ taskId: t2 })));
      expect(starts.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
      expect(await ActiveTimer.countDocuments({ user: ids.C })).toBe(1);
      await ageTimer(ids.C, new Date(Date.now() - 10 * 60000));
      const stops = await Promise.all([1, 2, 3].map(() => C.post('/api/time-entries/timer/stop').set(H).send({})));
      expect(stops.map((r) => r.status).sort()).toEqual([201, 404, 404]);
    });

    it('can discard a timer without logging time, and audits timer events', async () => {
      await C.post('/api/time-entries/timer/start').set(H).send({ taskId: t2 });
      const del = await C.delete('/api/time-entries/timer').set(H);
      expect(del.body).toMatchObject({ ok: true, discarded: true });
      expect((await C.get('/api/time-entries/timer').set(H)).body.timer).toBeNull();
      const actions = (await Activity.find({ actor: ids.C, workspace: ws }).lean()).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['timer.started', 'timer.stopped', 'timer.discarded']));
    });

    it('drops a timer whose owner lost write access instead of leaving it stuck', async () => {
      await A.post(`/api/workspaces/${ws}/members`).set(H).send({ email: `te${stamp}@t.dev`, role: 'member' }); // E joins
      const ok = await E.post('/api/time-entries/timer/start').set(H).send({ taskId: t2 });
      expect(ok.status).toBe(201);
      await A.patch(`/api/workspaces/${ws}/members/${ids.E}`).set(H).send({ role: 'viewer' });
      expect((await E.get('/api/time-entries/timer').set(H)).body.timer).toBeNull();
      await A.delete(`/api/workspaces/${ws}/members/${ids.E}`).set(H); // E is an outsider again
    });
  });

  /* ------------------------------------------------------------- manual log */
  describe('manual time entry', () => {
    const day = daysAgo(2);
    it('rejects invalid durations, dates and mismatched projects', async () => {
      for (const minutes of [0, -1, 1441, 1.5, '90']) expect((await log(C, { taskId: t2, minutes, date: day })).status, String(minutes)).toBe(400);
      expect((await log(C, { taskId: t2, minutes: 10, date: '2026-02-30' })).status).toBe(400);
      expect((await log(C, { taskId: t2, minutes: 10, date: daysAhead(3) })).status).toBe(400);
      expect((await log(C, { taskId: t2, minutes: 10, date: daysAgo(500) })).status).toBe(400);
      expect((await log(C, { taskId: t2, minutes: 10, note: 'x'.repeat(201) })).status).toBe(400);
      expect((await log(C, { taskId: t2, minutes: 10, projectId: 'a'.repeat(24) })).status).toBe(400);
    });
    it('enforces workspace authorization', async () => {
      expect((await log(D, { taskId: t2, minutes: 10, date: day })).status).toBe(403); // viewer
      expect((await log(E, { taskId: t2, minutes: 10, date: day })).status).toBe(404); // outsider
      expect((await request(app).post('/api/time-entries').set(H).send({ taskId: t2, minutes: 10 })).status).toBe(401);
    });
    it('saves a valid entry with user, task, project and workspace references', async () => {
      const r = await log(C, { taskId: t2, projectId: project, minutes: 45, note: 'Pairing', date: day });
      expect(r.status).toBe(201);
      expect(r.body.entry).toMatchObject({ minutes: 45, note: 'Pairing', source: 'manual', user: ids.C, task: t2, project, workspace: ws });
      expect(r.body.entry.date.slice(0, 10)).toBe(day);
    });
    it('does not allow more than 24h on a single day', async () => {
      const capDay = daysAgo(3);
      expect((await log(C, { taskId: t2, minutes: 1000, date: capDay })).status).toBe(201);
      const over = await log(C, { taskId: t2, minutes: 500, date: capDay });
      expect(over.status).toBe(400);
      expect(over.body.error.message).toMatch(/24 hours/);
      expect((await log(C, { taskId: t2, minutes: 440, date: capDay })).status).toBe(201); // exactly 24h
      expect((await log(C, { taskId: t2, minutes: 1, date: capDay })).status).toBe(400);
    });
  });

  /* ------------------------------------------------------------ aggregation */
  describe('aggregation, date filters and estimate vs actual', () => {
    const dayX = daysAgo(5), dayY = daysAgo(6), dayZ = daysAgo(4);
    beforeAll(async () => {
      entry.c90 = (await log(C, { taskId: t1, minutes: 90, date: dayX })).body.entry._id;
      entry.b30 = (await log(B, { taskId: t1, minutes: 30, date: dayX })).body.entry._id;
      entry.c60 = (await log(C, { taskId: t1, minutes: 60, date: dayY })).body.entry._id;
      entry.c20 = (await log(C, { taskId: t3, minutes: 20, date: dayZ })).body.entry._id;
    });

    it('admin summary counts unique members and projects from real records', async () => {
      const r = await report(B, dayX, dayX);
      expect(r.status).toBe(200);
      expect(r.body.scope).toBe('all');
      expect(r.body.summary).toEqual({ totalMinutes: 120, entryCount: 2, memberCount: 2, projectCount: 1 });
      expect(r.body.byUser.map((u: { name: string; minutes: number }) => [u.name, u.minutes])).toEqual([['User C', 90], ['User B', 30]]);
      const row = r.body.byProject.find((p: { key: string }) => p.key === 'TMR');
      expect(row.minutes).toBe(120);
    });

    it('computes estimate vs actual and the variance', async () => {
      const r = await report(B, dayX, dayX);
      const row = r.body.byProject.find((p: { key: string }) => p.key === 'TMR');
      // t1 estimate = 2h = 120m; ALL-TIME actual on t1 = 90 + 30 + 60 = 180m (dayY entry counts too)
      expect(row).toMatchObject({ tasksWorked: 1, estimateMinutes: 120, actualMinutes: 180, varianceMinutes: 60, variancePct: 50, unestimatedTasks: 0 });
      expect(r.body.overall).toMatchObject({ estimateMinutes: 120, actualMinutes: 180, varianceMinutes: 60, variancePct: 50 });
    });

    it('flags tasks without estimates and never divides by zero', async () => {
      const r = await report(B, dayZ, dayZ);
      expect(r.body.summary).toMatchObject({ totalMinutes: 20, memberCount: 1, projectCount: 1 });
      const row = r.body.byProject.find((p: { key: string }) => p.key === 'TMR');
      expect(row).toMatchObject({ estimateMinutes: 0, actualMinutes: 20, varianceMinutes: 20, variancePct: null, unestimatedTasks: 1 });
    });

    it('applies date ranges inclusively and consistently', async () => {
      expect((await report(B, dayY, dayX)).body.summary).toMatchObject({ totalMinutes: 180, memberCount: 2 });
      expect((await report(B, dayY, dayY)).body.summary.totalMinutes).toBe(60);
      expect((await report(B, dayX, dayX)).body.summary.totalMinutes).toBe(120); // first and last day both included
      expect((await report(B, daysAgo(7), daysAgo(7))).body.summary.totalMinutes).toBe(0); // adjacent day excluded
      // the same boundaries hold for the history list
      expect((await history(B, dayX, dayX)).body.total).toBe(2);
      expect((await history(B, dayY, dayY)).body.total).toBe(1);
      // a timer started at 20:00 UTC in India belongs to the next IST day, so day-8 includes it and day-9 does not
      expect((await report(C, daysAgo(8), daysAgo(8))).body.summary.totalMinutes).toBe(1440);
      expect((await report(C, daysAgo(9), daysAgo(9))).body.summary.totalMinutes).toBe(0);
    });

    it('rejects invalid ranges', async () => {
      expect((await report(B, dayX, dayY)).status).toBe(400); // reversed
      expect((await report(B, '2026-02-30', dayX)).status).toBe(400);
      expect((await report(B, 'nope', dayX)).status).toBe(400);
      expect((await report(B, daysAgo(900), dayX)).status).toBe(400); // too large
      expect((await history(B, dayX, dayY)).status).toBe(400);
    });

    it('non-admins only ever see their own time (no estimate/variance)', async () => {
      const r = await report(C, dayX, dayX);
      expect(r.body.scope).toBe('self');
      expect(r.body.summary).toEqual({ totalMinutes: 90, entryCount: 1, memberCount: 1, projectCount: 1 });
      expect(r.body.byUser).toHaveLength(1);
      const row = r.body.byProject.find((p: { key: string }) => p.key === 'TMR');
      expect(row).toMatchObject({ minutes: 90, estimateMinutes: null, actualMinutes: null, varianceMinutes: null, variancePct: null });
      expect(r.body.overall).toBeNull();
      const viewer = await report(D, dayX, dayX);
      expect(viewer.body.scope).toBe('self');
      expect(viewer.body.summary.totalMinutes).toBe(0);
    });

    it('blocks outsiders and anonymous users from every read', async () => {
      expect((await report(E, dayX, dayX)).status).toBe(404);
      expect((await history(E, dayX, dayX)).status).toBe(404);
      expect((await E.get(`/api/time-entries?taskId=${t1}`).set(H)).status).toBe(404);
      expect((await request(app).get(`/api/time-entries/report?workspaceId=${ws}&from=${dayX}&to=${dayX}`).set(H)).status).toBe(401);
    });

    it('history is scoped by role, paged, and flags what the caller may edit', async () => {
      const admin = await history(B, dayY, dayX);
      expect(admin.body).toMatchObject({ scope: 'all', total: 3, pages: 1 });
      expect(admin.body.entries.every((e: { canEdit: boolean }) => e.canEdit)).toBe(true);
      expect(admin.body.entries[0]).toMatchObject({ user: { name: expect.any(String) }, task: { key: expect.any(String) }, project: { key: 'TMR' } });
      const paged = await history(B, dayY, dayX, '&limit=2');
      expect(paged.body).toMatchObject({ total: 3, pages: 2 });
      expect(paged.body.entries).toHaveLength(2);
      expect((await history(B, dayY, dayX, `&userId=${ids.C}`)).body.total).toBe(2);
      const member = await history(C, dayY, dayX, `&userId=${ids.B}`); // userId filter is ignored for non-admins
      expect(member.body.scope).toBe('self');
      expect(member.body.total).toBe(2);
      expect((await history(D, dayY, dayX)).body.total).toBe(0);
      expect((await history(B, dayY, dayX, '&limit=101')).status).toBe(400);
    });

    it('task-level list shows only your own rows but the task total is real', async () => {
      const viewer = await D.get(`/api/time-entries?taskId=${t1}`).set(H);
      expect(viewer.body).toMatchObject({ entries: [], totalMinutes: 180, scope: 'self' });
      expect((await C.get(`/api/time-entries?taskId=${t1}`).set(H)).body.entries).toHaveLength(2);
      expect((await B.get(`/api/time-entries?taskId=${t1}`).set(H)).body.entries).toHaveLength(3);
    });
  });

  /* ------------------------------------------------ edit / delete + audit log */
  describe('edit and delete permissions with audit logging', () => {
    const day = daysAgo(7);
    let own = '', other = '';
    beforeAll(async () => {
      own = (await log(C, { taskId: t2, minutes: 15, date: day, note: 'orig' })).body.entry._id;
      other = (await log(B, { taskId: t2, minutes: 10, date: day })).body.entry._id;
    });
    const patch = (agent: request.Agent, id: string, body: object) => agent.patch(`/api/time-entries/${id}`).set(H).send(body);

    it('validates edits', async () => {
      expect((await patch(C, own, {})).status).toBe(400);
      expect((await patch(C, own, { minutes: 2000 })).status).toBe(400);
      expect((await patch(C, own, { minutes: 0 })).status).toBe(400);
      expect((await patch(C, own, { date: daysAhead(5) })).status).toBe(400);
      expect((await patch(C, 'not-an-id', { minutes: 5 })).status).toBe(400);
      expect((await patch(C, 'a'.repeat(24), { minutes: 5 })).status).toBe(404);
    });
    it('denies viewers, outsiders and other members; allows own edits and admin edits', async () => {
      expect((await patch(D, own, { minutes: 5 })).status).toBe(403);
      expect((await patch(E, own, { minutes: 5 })).status).toBe(404);
      expect((await patch(C, other, { minutes: 5 })).status).toBe(403); // member editing an admin's row
      expect((await patch(C, own, { minutes: 25, note: 'edited' })).status).toBe(200);
      expect((await patch(B, own, { minutes: 30 })).status).toBe(200); // admin may edit a member's row
    });
    it('writes an audit record with who, what and the before/after values', async () => {
      const rows = await Activity.find({ action: 'time.updated', 'meta.entryId': own }).sort({ createdAt: 1 }).lean();
      expect(rows).toHaveLength(2);
      expect(String(rows[0].actor)).toBe(ids.C);
      expect(rows[0].meta).toMatchObject({ owner: ids.C, before: { minutes: 15, note: 'orig', date: day }, after: { minutes: 25, note: 'edited', date: day } });
      expect(String(rows[1].actor)).toBe(ids.B); // the admin's edit is attributed to the admin
      expect(rows[1].meta).toMatchObject({ before: { minutes: 25 }, after: { minutes: 30 } });
    });
    it('keeps the 24h daily cap when editing', async () => {
      const capEntry = (await log(C, { taskId: t2, minutes: 5, date: daysAgo(10) })).body.entry._id;
      await log(C, { taskId: t2, minutes: 1400, date: daysAgo(10) });
      expect((await patch(C, capEntry, { minutes: 100 })).status).toBe(400);
      expect((await patch(C, capEntry, { minutes: 40 })).status).toBe(200); // exactly 1440
    });
    it('deletes with the right permissions and audits it', async () => {
      expect((await A.delete(`/api/time-entries/${other}`).set(H).send()).status).toBe(200); // owner can delete anyone's
      expect((await C.delete(`/api/time-entries/${other}`).set(H)).status).toBe(404); // already gone
      const mine = (await log(C, { taskId: t2, minutes: 12, date: day })).body.entry._id;
      const bs = (await log(B, { taskId: t2, minutes: 8, date: day })).body.entry._id;
      expect((await D.delete(`/api/time-entries/${mine}`).set(H)).status).toBe(403);
      expect((await E.delete(`/api/time-entries/${mine}`).set(H)).status).toBe(404);
      expect((await C.delete(`/api/time-entries/${bs}`).set(H)).status).toBe(403);
      expect((await C.delete(`/api/time-entries/${mine}`).set(H)).status).toBe(200);
      const audit = await Activity.findOne({ action: 'time.deleted', 'meta.entryId': mine }).lean();
      expect(audit).toBeTruthy();
      expect(String(audit!.actor)).toBe(ids.C);
      expect(audit!.meta).toMatchObject({ minutes: 12, date: day, source: 'manual', owner: ids.C });
      expect((await history(C, day, day)).body.entries.some((e: { _id: string }) => e._id === mine)).toBe(false);
    });
    it('reports reflect edits and deletes immediately', async () => {
      const r = await report(B, day, day);
      expect(r.body.summary.totalMinutes).toBe(30 + 8); // edited 30m (C) + B's 8m; the 12m and other deleted
    });
  });
});
