import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';

/**
 * Full-stack tests against a real MongoDB. Skipped unless MONGODB_URI_TEST is set.
 * WARNING: they create data in that database. Use a throwaway database.
 */
const enabled = Boolean(process.env.MONGODB_URI_TEST);
const H = { 'X-Requested-With': 'FlowSync' };

describe.skipIf(!enabled)('integration: auth, workspaces, tasks, isolation', () => {
  const app = createApp();
  const agentA = request.agent(app);
  const agentB = request.agent(app);
  const stamp = Date.now();
  let workspaceId = '';
  let projectId = '';
  let taskId = '';

  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI_TEST!);
  });
  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('registers two users and logs in', async () => {
    const a = await agentA.post('/api/auth/register').set(H).send({ name: 'A', email: `a${stamp}@t.dev`, password: 'password123' });
    expect(a.status).toBe(201);
    const b = await agentB.post('/api/auth/register').set(H).send({ name: 'B', email: `b${stamp}@t.dev`, password: 'password123' });
    expect(b.status).toBe(201);
    expect((await agentA.get('/api/auth/me').set(H)).body.user.email).toBe(`a${stamp}@t.dev`);
    const bad = await request(app).post('/api/auth/login').set(H).send({ email: `a${stamp}@t.dev`, password: 'wrong-password' });
    expect(bad.status).toBe(401);
  });

  it('creates workspace, project and task', async () => {
    const ws = await agentA.post('/api/workspaces').set(H).send({ name: 'WS' });
    workspaceId = ws.body.workspace._id;
    const p = await agentA.post('/api/projects').set(H).send({ workspaceId, name: 'Proj', key: 'TST' });
    expect(p.status).toBe(201);
    projectId = p.body.project._id;
    const t = await agentA.post('/api/tasks').set(H).send({ projectId, title: 'First task' });
    expect(t.status).toBe(201);
    expect(t.body.task.key).toBe('TST-1');
    taskId = t.body.task._id;
  });

  it('moves a task and persists the status', async () => {
    const m = await agentA.post(`/api/tasks/${taskId}/move`).set(H).send({ status: 'done', index: 0 });
    expect(m.body.task.status).toBe('done');
    const list = await agentA.get(`/api/tasks?projectId=${projectId}&status=done`).set(H);
    expect(list.body.total).toBe(1);
  });

  it('blocks cross-workspace access (user B)', async () => {
    expect((await agentB.get(`/api/workspaces/${workspaceId}`).set(H)).status).toBe(404);
    expect((await agentB.get(`/api/projects/${projectId}`).set(H)).status).toBe(404);
    expect((await agentB.get(`/api/tasks/${taskId}`).set(H)).status).toBe(404);
    expect((await agentB.patch(`/api/tasks/${taskId}`).set(H).send({ title: 'hacked' })).status).toBe(404);
    expect((await agentB.get(`/api/dashboard/admin?workspaceId=${workspaceId}`).set(H)).status).toBe(404);
  });

  it('enforces viewer role as read-only', async () => {
    const add = await agentA.post(`/api/workspaces/${workspaceId}/members`).set(H).send({ email: `b${stamp}@t.dev`, role: 'viewer' });
    expect(add.status).toBe(201);
    expect((await agentB.get(`/api/tasks?projectId=${projectId}`).set(H)).status).toBe(200);
    expect((await agentB.post('/api/tasks').set(H).send({ projectId, title: 'nope' })).status).toBe(403);
  });

  it('rejects dependency cycles', async () => {
    const t2 = await agentA.post('/api/tasks').set(H).send({ projectId, title: 'Second', blockedBy: [taskId] });
    expect(t2.status).toBe(201);
    const cyc = await agentA.patch(`/api/tasks/${taskId}`).set(H).send({ blockedBy: [t2.body.task._id] });
    expect(cyc.status).toBe(400);
  });

  it('dashboard returns real counts', async () => {
    const d = await agentA.get(`/api/dashboard/admin?workspaceId=${workspaceId}`).set(H);
    expect(d.body.kpis.tasks).toBe(2);
    expect(d.body.kpis.completed).toBe(1);
  });

});
