import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

// These tests never touch the database: they cover guards that run before any query.
const app = createApp();
const H = { 'X-Requested-With': 'FlowSync' };

describe('API guards (no database needed)', () => {
  it('health endpoint responds', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('rejects state-changing requests without the CSRF header', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'x' });
    expect(res.status).toBe(403);
  });

  it('requires authentication for protected routes', async () => {
    for (const path of ['/api/workspaces', '/api/tasks?projectId=abc', '/api/notifications', '/api/auth/me', '/api/calendar?workspaceId=x&from=2026-10-01&to=2026-11-01', '/api/search?workspaceId=x&q=ab', '/api/time-entries?taskId=x', '/api/time-entries/timer', '/api/audit-logs?workspaceId=x&from=2026-10-01&to=2026-10-02', '/api/audit-logs/actions?workspaceId=x', '/api/audit-logs/export.csv?workspaceId=x&from=2026-10-01&to=2026-10-02', '/api/time-entries/history?workspaceId=x&from=2026-10-01&to=2026-10-07', '/api/time-entries/report?workspaceId=x&from=2026-10-01&to=2026-10-07']) {
      const res = await request(app).get(path).set(H);
      expect(res.status, path).toBe(401);
    }
  });

  it('validates registration input', async () => {
    const res = await request(app).post('/api/auth/register').set(H).send({ name: '', email: 'nope', password: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects a forged session cookie', async () => {
    const res = await request(app).get('/api/auth/me').set(H).set('Cookie', 'flowsync_session=forged.token.value');
    expect(res.status).toBe(401);
  });

  it('returns JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/api/nope').set(H);
    expect(res.status).toBe(404);
  });
});
