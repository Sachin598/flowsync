import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { Activity } from '../src/models/Misc.js';

/**
 * Audit log against a real MongoDB. Skipped unless MONGODB_URI_TEST is set (use a throwaway database).
 * Roles: A = owner, B = admin, C = member, D = viewer, E = outsider (owns a different workspace).
 */
const enabled = Boolean(process.env.MONGODB_URI_TEST);
const H = { 'X-Requested-With': 'FlowSync' };
const win = (extra: object = {}) => ({ from: new Date(Date.now() - 3600e3).toISOString(), to: new Date(Date.now() + 3600e3).toISOString(), ...extra });

interface Entry {
  _id: string; action: string; createdAt: string; meta: Record<string, unknown>;
  actor: { _id: string; name: string } | null; project: { _id: string; key: string } | null; task: { key: string } | null;
  target: { _id: string; name: string } | null;
}

describe.skipIf(!enabled)('audit log', () => {
  const app = createApp();
  const stamp = Date.now();
  const A = request.agent(app), B = request.agent(app), C = request.agent(app), D = request.agent(app), E = request.agent(app);
  const ids: Record<string, string> = {};
  let ws = '', wsE = '', p1 = '', t1 = '', t2 = '';

  const list = (agent: request.Agent, extra: object = {}, workspaceId = ws) => agent.get('/api/audit-logs').set(H).query({ workspaceId, ...win(extra) });
  const all = async (extra: object = {}) => (await list(A, { limit: 100, ...extra })).body.entries as Entry[];

  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI_TEST!);
    for (const [n, agent] of [['A', A], ['B', B], ['C', C], ['D', D], ['E', E]] as const) {
      expect((await agent.post('/api/auth/register').set(H).send({ name: `User ${n}`, email: `au${n}${stamp}@t.dev`, password: 'password123' })).status).toBe(201);
      ids[n] = (await agent.get('/api/auth/me').set(H)).body.user.id;
    }
    ws = (await A.post('/api/workspaces').set(H).send({ name: 'Audit WS' })).body.workspace._id;
    wsE = (await E.post('/api/workspaces').set(H).send({ name: 'Other WS' })).body.workspace._id;
    for (const [n, role] of [['B', 'admin'], ['C', 'member'], ['D', 'viewer']] as const) {
      expect((await A.post(`/api/workspaces/${ws}/members`).set(H).send({ email: `au${n}${stamp}@t.dev`, role })).status).toBe(201);
    }
    expect((await A.patch(`/api/workspaces/${ws}/members/${ids.C}`).set(H).send({ role: 'viewer' })).status).toBe(200);
    expect((await A.patch(`/api/workspaces/${ws}/members/${ids.C}`).set(H).send({ role: 'member' })).status).toBe(200);
    p1 = (await A.post('/api/projects').set(H).send({ workspaceId: ws, name: 'Audited project', key: 'AUD' })).body.project._id;
    t1 = (await A.post('/api/tasks').set(H).send({ projectId: p1, title: 'First' })).body.task._id;
    t2 = (await A.post('/api/tasks').set(H).send({ projectId: p1, title: 'Second' })).body.task._id;
    expect((await B.post(`/api/tasks/${t1}/move`).set(H).send({ status: 'done', index: 0 })).status).toBe(200);
    expect((await C.post(`/api/tasks/${t1}/comments`).set(H).send({ body: 'looks good' })).status).toBe(201);
    expect((await C.post('/api/time-entries').set(H).send({ taskId: t1, minutes: 30 })).status).toBe(201);
    expect((await B.patch(`/api/workspaces/${ws}`).set(H).send({ description: 'updated by admin' })).status).toBe(200);
  });
  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('is readable by admins and owners only', async () => {
    expect((await list(A)).status).toBe(200);
    expect((await list(B)).status).toBe(200);
    expect((await list(C)).status).toBe(403); // member
    expect((await list(D)).status).toBe(403); // viewer
    expect((await list(E)).status).toBe(404); // outsider: the workspace is invisible to them
    expect((await request(app).get('/api/audit-logs').set(H).query({ workspaceId: ws, ...win() })).status).toBe(401);
    for (const path of ['/api/audit-logs/actions', '/api/audit-logs/export.csv']) {
      const q = path.endsWith('actions') ? { workspaceId: ws } : { workspaceId: ws, ...win() };
      expect((await A.get(path).set(H).query(q)).status, `owner ${path}`).toBe(200);
      expect((await C.get(path).set(H).query(q)).status, `member ${path}`).toBe(403);
      expect((await D.get(path).set(H).query(q)).status, `viewer ${path}`).toBe(403);
      expect((await E.get(path).set(H).query(q)).status, `outsider ${path}`).toBe(404);
    }
  });

  it('records who did what, newest first', async () => {
    const entries = await all();
    const actions = entries.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining([
      'workspace.created', 'member.added', 'member.role_changed', 'project.created', 'task.created', 'task.moved', 'comment.created', 'time.created', 'workspace.updated',
    ]));
    const times = entries.map((e) => new Date(e.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a)); // newest first
    const moved = entries.find((e) => e.action === 'task.moved')!;
    expect(moved.actor).toMatchObject({ _id: ids.B, name: 'User B' });
    expect(moved.task).toMatchObject({ key: 'AUD-1' });
    expect(moved.project).toMatchObject({ key: 'AUD' });
    expect(moved.meta).toMatchObject({ from: 'todo', to: 'done' });
    const updated = entries.find((e) => e.action === 'workspace.updated')!;
    expect(updated.actor?._id).toBe(ids.B);
    expect(updated.meta).toMatchObject({ fields: ['description'] });
  });

  it('names the person an action was done to', async () => {
    const entries = await all({ action: 'member.role_changed' });
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.actor?._id).toBe(ids.A);
      expect(e.target).toMatchObject({ _id: ids.C, name: 'User C' });
    }
    expect(entries.map((e) => e.meta.role).sort()).toEqual(['member', 'viewer']);
  });

  it('filters by action, actor and project and combines them', async () => {
    const created = await all({ action: 'task.created' });
    expect(created).toHaveLength(2);
    expect(created.every((e) => e.action === 'task.created')).toBe(true);
    const byC = await all({ actorId: ids.C });
    expect(byC.length).toBeGreaterThanOrEqual(2);
    expect(byC.every((e) => e.actor?._id === ids.C)).toBe(true);
    expect((await all({ projectId: p1 })).every((e) => e.project?._id === p1)).toBe(true);
    expect(await all({ actorId: ids.C, action: 'task.created' })).toEqual([]);
    expect(await all({ action: 'no.such.action' })).toEqual([]);
  });

  it('pages results and bounds the page size', async () => {
    const total = (await list(A)).body.total as number;
    const p1r = await list(A, { limit: 3, page: 1 });
    expect(p1r.body).toMatchObject({ total, limit: 3, pages: Math.ceil(total / 3) });
    expect(p1r.body.entries).toHaveLength(3);
    const p2r = await list(A, { limit: 3, page: 2 });
    const firstIds = p1r.body.entries.map((e: Entry) => e._id);
    expect(p2r.body.entries.some((e: Entry) => firstIds.includes(e._id))).toBe(false); // no overlap between pages
    expect((await list(A, { limit: 101 })).status).toBe(400);
    expect((await list(A, { page: 0 })).status).toBe(400);
  });

  it('applies time windows exactly: start inclusive, end exclusive, bad windows rejected', async () => {
    const [first] = await all();
    const T = new Date(first.createdAt).getTime();
    const ms = (n: number) => new Date(n).toISOString();
    const q = (from: number, to: number) => list(A, { from: ms(from), to: ms(to), limit: 100 });
    expect((await q(T, T + 1)).body.entries.some((e: Entry) => e._id === first._id)).toBe(true); // start is inclusive
    expect((await q(T + 1, T + 5000)).body.entries.some((e: Entry) => e._id === first._id)).toBe(false);
    expect((await q(T - 5000, T)).body.entries.some((e: Entry) => e._id === first._id)).toBe(false); // end is exclusive
    expect((await q(T + 3600e3, T + 7200e3)).body.total).toBe(0);
    expect((await list(A, { from: ms(T), to: ms(T) })).status).toBe(400); // empty
    expect((await list(A, { from: ms(T + 1), to: ms(T) })).status).toBe(400); // reversed
    expect((await list(A, { from: ms(T - 400 * 86400e3), to: ms(T) })).status).toBe(400); // over 366 days
    expect((await list(A, { from: 'garbage' })).status).toBe(400);
  });

  it('lists only the actions that exist in this workspace', async () => {
    const mine = (await A.get('/api/audit-logs/actions').set(H).query({ workspaceId: ws })).body.actions as string[];
    expect(mine).toEqual([...mine].sort());
    expect(mine).toEqual(expect.arrayContaining(['project.created', 'task.moved', 'workspace.updated']));
    const theirs = (await E.get('/api/audit-logs/actions').set(H).query({ workspaceId: wsE })).body.actions as string[];
    expect(theirs).toEqual(['workspace.created']);
  });

  it('cannot be written, edited or deleted through the API', async () => {
    const [row] = await all();
    for (const [method, path] of [['post', '/api/audit-logs'], ['put', `/api/audit-logs/${row._id}`], ['patch', `/api/audit-logs/${row._id}`], ['delete', `/api/audit-logs/${row._id}`], ['delete', '/api/audit-logs']] as const) {
      const r = await A[method](path).set(H).send({ action: 'forged', workspace: ws });
      expect(r.status, `${method} ${path}`).toBe(404); // no such route, even for the owner
    }
    expect(await Activity.countDocuments({ action: 'forged' })).toBe(0);
    expect(await Activity.exists({ _id: row._id })).toBeTruthy();
  });

  it('never rewrites earlier rows when the data changes; it only appends', async () => {
    const stored = async () => Activity.findOne({ action: 'task.created', task: t2 }).lean(); // the raw row as stored in MongoDB
    const before = await stored();
    const beforeApi = (await all({ action: 'task.created' })).find((e) => e.task?.key === 'AUD-2')!;
    expect(before?.meta).toMatchObject({ key: 'AUD-2', title: 'Second' });
    expect((await A.patch(`/api/tasks/${t2}`).set(H).send({ title: 'Renamed second task', priority: 'urgent' })).status).toBe(200);
    expect(await stored()).toEqual(before); // the stored row is byte-for-byte the same
    const afterApi = (await all({ action: 'task.created' })).find((e) => e.task?.key === 'AUD-2')!;
    expect(afterApi.meta).toEqual(beforeApi.meta); // the title *at that time* is kept in the row, so the UI can show history accurately
    expect(afterApi.meta.title).toBe('Second');
    const updates = await all({ action: 'task.updated' });
    expect(updates[0].meta).toMatchObject({ key: 'AUD-2', fields: expect.arrayContaining(['title', 'priority']) }); // a NEW row was appended
  });

  it('keeps the history of a project after the project is deleted', async () => {
    const p2 = (await A.post('/api/projects').set(H).send({ workspaceId: ws, name: 'Doomed', key: 'DOM' })).body.project._id;
    const tx = (await A.post('/api/tasks').set(H).send({ projectId: p2, title: 'Short lived' })).body.task._id;
    expect((await A.delete(`/api/projects/${p2}`).set(H)).status).toBe(200);
    expect(await mongoose.connection.collection('tasks').countDocuments({ _id: new mongoose.Types.ObjectId(tx) })).toBe(0); // the data is gone
    const rows = await all({ projectId: p2 });
    expect(rows.map((e) => e.action)).toEqual(expect.arrayContaining(['project.created', 'task.created'])); // the audit rows are not
    expect(rows.every((e) => !e.project && !e.task)).toBe(true); // the project and task no longer exist, so nothing can be populated
    const deleted = (await all({ action: 'project.deleted' }))[0];
    expect(deleted.meta).toMatchObject({ name: 'Doomed' });
    expect(deleted.actor?._id).toBe(ids.A);
  });

  it('isolates workspaces', async () => {
    expect((await list(E, {}, ws)).status).toBe(404); // E is admin elsewhere but an outsider here
    const own = await list(E, {}, wsE);
    expect(own.status).toBe(200);
    expect(own.body.total).toBe(1);
    expect(own.body.entries[0]).toMatchObject({ action: 'workspace.created' });
    expect((await list(E, { projectId: p1 }, wsE)).body.total).toBe(0); // another workspace's project id reveals nothing
  });

  it('exports CSV for admins with formula-safe cells', async () => {
    expect((await B.patch('/api/auth/me').set(H).send({ name: '=SUM(1)' })).status).toBe(200);
    expect((await B.patch(`/api/workspaces/${ws}`).set(H).send({ description: 'again' })).status).toBe(200);
    const res = await A.get('/api/audit-logs/export.csv').set(H).query({ workspaceId: ws, ...win() });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/audit-log\.csv/);
    const lines = res.text.split('\n');
    expect(lines[0]).toBe('Time (UTC),Actor,Action,Project,Task,Details');
    expect(res.text).toContain("'=SUM(1)"); // never starts with a raw "="
    expect(res.text).not.toMatch(/(^|,)=SUM/m);
    const total = (await list(A)).body.total as number;
    expect(lines.length).toBe(total + 1);
    expect((await A.get('/api/audit-logs/export.csv').set(H).query({ workspaceId: ws, from: 'x', to: 'y' })).status).toBe(400);
  });
});
