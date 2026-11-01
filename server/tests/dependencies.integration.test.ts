import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';

/** Task dependency rules against a real MongoDB. Skipped unless MONGODB_URI_TEST is set (use a throwaway database). */
const enabled = Boolean(process.env.MONGODB_URI_TEST);
const H = { 'X-Requested-With': 'FlowSync' };

describe.skipIf(!enabled)('task dependencies (blockedBy)', () => {
  const app = createApp();
  const stamp = Date.now();
  const A = request.agent(app); // owner
  const V = request.agent(app); // viewer
  const E = request.agent(app); // outsider
  let ws = '', p1 = '', p2 = '';
  const t: Record<string, string> = {};

  const mk = async (project: string, title: string, extra: object = {}) => {
    const r = await A.post('/api/tasks').set(H).send({ projectId: project, title, ...extra });
    expect(r.status, title).toBe(201);
    return r.body.task._id as string;
  };
  const setBlockers = (agent: request.Agent, id: string, blockedBy: string[]) => agent.patch(`/api/tasks/${id}`).set(H).send({ blockedBy });
  const detail = async (id: string) => (await A.get(`/api/tasks/${id}`).set(H)).body as {
    task: { blockedBy: { _id: string; key: string; title: string; status: string }[] };
    blocking: { _id: string; key: string }[];
  };
  const ids = (list: { _id: string }[]) => list.map((x) => x._id).sort();

  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI_TEST!);
    for (const [name, agent] of [['A', A], ['V', V], ['E', E]] as const) {
      expect((await agent.post('/api/auth/register').set(H).send({ name, email: `dep${name}${stamp}@t.dev`, password: 'password123' })).status).toBe(201);
    }
    ws = (await A.post('/api/workspaces').set(H).send({ name: 'Dep WS' })).body.workspace._id;
    expect((await A.post(`/api/workspaces/${ws}/members`).set(H).send({ email: `depV${stamp}@t.dev`, role: 'viewer' })).status).toBe(201);
    p1 = (await A.post('/api/projects').set(H).send({ workspaceId: ws, name: 'Project one', key: 'ONE' })).body.project._id;
    p2 = (await A.post('/api/projects').set(H).send({ workspaceId: ws, name: 'Project two', key: 'TWO' })).body.project._id;
    for (const n of ['a', 'b', 'c', 'p', 'q', 'r', 's']) t[n] = await mk(p1, `Task ${n}`);
    t.x = await mk(p2, 'Task in another project');
  });
  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('rejects invalid blockers', async () => {
    expect((await setBlockers(A, t.a, [t.a])).status).toBe(400); // itself
    expect((await setBlockers(A, t.a, [t.x])).status).toBe(400); // other project
    expect((await setBlockers(A, t.a, ['a'.repeat(24)])).status).toBe(400); // valid id, no such task
    expect((await setBlockers(A, t.a, ['nope'])).status).toBe(400); // malformed id
    expect((await setBlockers(A, t.a, Array.from({ length: 21 }, (_, i) => String(i).padStart(24, '0')))).status).toBe(400); // over 20
    expect((await detail(t.a)).task.blockedBy).toEqual([]); // nothing was saved by any of the failed attempts
  });

  it('adds a chain of dependencies and shows both directions', async () => {
    expect((await setBlockers(A, t.b, [t.a])).status).toBe(200); // b is blocked by a
    expect((await setBlockers(A, t.c, [t.b])).status).toBe(200); // c is blocked by b
    const c = await detail(t.c);
    expect(c.task.blockedBy).toHaveLength(1);
    expect(c.task.blockedBy[0]).toMatchObject({ _id: t.b, title: 'Task b', status: 'todo', key: expect.stringMatching(/^ONE-/) });
    expect(ids((await detail(t.a)).blocking)).toEqual([t.b]); // a blocks b
    expect(ids((await detail(t.b)).blocking)).toEqual([t.c]);
  });

  it('rejects direct and indirect cycles and leaves existing links untouched', async () => {
    const direct = await setBlockers(A, t.a, [t.b]); // a <- b <- a
    expect(direct.status).toBe(400);
    expect(direct.body.error.message).toMatch(/cycle/);
    expect((await setBlockers(A, t.a, [t.c])).status).toBe(400); // a <- c <- b <- a
    expect((await detail(t.a)).task.blockedBy).toEqual([]);
    expect(ids((await detail(t.c)).task.blockedBy)).toEqual([t.b]);
  });

  it('allows a diamond (no false cycle) and a task with several blockers', async () => {
    expect((await setBlockers(A, t.q, [t.p])).status).toBe(200);
    expect((await setBlockers(A, t.r, [t.p])).status).toBe(200);
    expect((await setBlockers(A, t.s, [t.q, t.r])).status).toBe(200); // s <- q <- p and s <- r <- p
    expect(ids((await detail(t.s)).task.blockedBy)).toEqual([t.q, t.r].sort());
    expect(ids((await detail(t.p)).blocking)).toEqual([t.q, t.r].sort());
  });

  it('replaces the whole list, stores each blocker once, and can clear it', async () => {
    expect((await setBlockers(A, t.c, [t.a, t.a, t.a])).status).toBe(200);
    expect(ids((await detail(t.c)).task.blockedBy)).toEqual([t.a]); // replaced [b] and deduplicated
    expect((await setBlockers(A, t.c, [])).status).toBe(200);
    expect((await detail(t.c)).task.blockedBy).toEqual([]);
    expect((await detail(t.b)).blocking).toEqual([]);
  });

  it('reports the blocker status so the UI can warn about unfinished work', async () => {
    expect((await A.patch(`/api/tasks/${t.a}`).set(H).send({ status: 'done' })).status).toBe(200);
    expect((await detail(t.b)).task.blockedBy[0]).toMatchObject({ _id: t.a, status: 'done' });
  });

  it('validates blockers when a task is created', async () => {
    const ok = await A.post('/api/tasks').set(H).send({ projectId: p1, title: 'Has a blocker', blockedBy: [t.a, t.a] });
    expect(ok.status).toBe(201);
    expect(ok.body.task.blockedBy).toEqual([t.a]);
    expect((await A.post('/api/tasks').set(H).send({ projectId: p1, title: 'Bad blocker', blockedBy: [t.x] })).status).toBe(400);
  });

  it('enforces permissions', async () => {
    expect((await setBlockers(V, t.q, [t.a])).status).toBe(403); // viewer is read-only
    expect((await setBlockers(E, t.q, [t.a])).status).toBe(404); // outsider cannot even see it
    expect((await request(app).patch(`/api/tasks/${t.q}`).set(H).send({ blockedBy: [] })).status).toBe(401);
    expect(ids((await detail(t.q)).task.blockedBy)).toEqual([t.p]); // unchanged
    expect((await V.get(`/api/tasks/${t.s}`).set(H)).status).toBe(200); // viewers can still read dependencies
    expect((await E.get(`/api/tasks/${t.s}`).set(H)).status).toBe(404);
  });

  it('removes a deleted task from everyone it was blocking', async () => {
    expect(ids((await detail(t.b)).task.blockedBy)).toEqual([t.a]);
    expect((await A.delete(`/api/tasks/${t.a}`).set(H)).status).toBe(200);
    expect((await detail(t.b)).task.blockedBy).toEqual([]);
  });
});
