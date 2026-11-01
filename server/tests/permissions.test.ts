import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS, PERMISSION_DEFS, ROLES, can, isRole, permissionMatrix, permissionsFor, roleAtLeast, satisfies, type Permission, type Role } from '../src/permissions.js';
import { HEALTH, OVERLOAD, computeProjectHealth, isOverloaded, isPlausibleToday } from '../src/utils/health.js';

const set = (r: Role) => new Set(permissionsFor(r));

describe('permission matrix invariants', () => {
  it('every permission is held by at least one role, and the owner holds all of them', () => {
    for (const p of PERMISSIONS) expect(PERMISSION_DEFS[p].roles.length, p).toBeGreaterThan(0);
    expect(permissionsFor('owner')).toEqual(PERMISSIONS);
  });
  it('roles only ever gain permissions as they get more senior (viewer ⊆ member ⊆ admin ⊆ owner)', () => {
    const order: Role[] = ['viewer', 'member', 'admin', 'owner'];
    for (let i = 0; i < order.length - 1; i++) for (const p of set(order[i])) expect(set(order[i + 1]).has(p), `${order[i + 1]} must keep ${p}`).toBe(true);
  });
  it('the admin differs from the owner only in the two owner-only powers', () => {
    expect(PERMISSIONS.filter((p) => !can('admin', p)).sort()).toEqual(['admins.manage', 'workspace.delete']);
  });
  it('a viewer is strictly read-only: no write, delete, manage, create or log permission', () => {
    const forbiddenWords = /(\.write|\.create|\.delete|\.update|\.manage|\.log|\.own)/;
    for (const p of set('viewer')) expect(forbiddenWords.test(p), `viewer must not hold ${p}`).toBe(false);
    expect([...set('viewer')].sort()).toEqual(['dashboard.viewer', 'members.view', 'project.view', 'reports.view', 'task.view', 'workspace.view']);
  });
  it('members work but do not administer', () => {
    for (const p of ['task.write', 'comment.create', 'time.log', 'project.create', 'dashboard.member'] as Permission[]) expect(can('member', p), p).toBe(true);
    for (const p of ['audit.view', 'security.view', 'roles.view', 'members.manage', 'dashboard.admin', 'time.view.all', 'project.delete', 'workspace.update'] as Permission[]) expect(can('member', p), p).toBe(false);
  });
  it('dashboards: admin/owner -> admin dashboard, member -> personal dashboard, viewer -> read-only overview', () => {
    expect(ROLES.filter((r) => can(r, 'dashboard.admin')).sort()).toEqual(['admin', 'owner']);
    expect(ROLES.filter((r) => can(r, 'dashboard.member')).sort()).toEqual(['admin', 'member', 'owner']);
    expect(ROLES.filter((r) => can(r, 'dashboard.viewer')).sort()).toEqual(['admin', 'member', 'owner', 'viewer']);
  });
  it('satisfies() accepts permissions and (for people rules) roles; roleAtLeast compares seniority', () => {
    expect(satisfies('member', 'task.write')).toBe(true);
    expect(satisfies('viewer', 'task.write')).toBe(false);
    expect(satisfies('admin', 'admin')).toBe(true);
    expect(satisfies('member', 'admin')).toBe(false);
    expect(isRole('member')).toBe(true);
    expect(isRole('task.write')).toBe(false);
    expect(roleAtLeast('owner', 'admin') && !roleAtLeast('viewer', 'member')).toBe(true);
  });
  it('the matrix sent to the Roles page is the same matrix the server enforces', () => {
    const m = permissionMatrix();
    expect(m.roles).toEqual(['owner', 'admin', 'member', 'viewer']);
    expect(m.permissions).toHaveLength(PERMISSIONS.length);
    for (const row of m.permissions) expect([...row.roles].sort()).toEqual([...PERMISSION_DEFS[row.key].roles].sort());
  });
});

describe('policy: access checks go through the central permission module', () => {
  const dir = join(__dirname, '../src/routes');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  it('no route file passes a raw role name to requireMembership / loadProject / loadTask', () => {
    const bad: string[] = [];
    for (const f of files) {
      readFileSync(join(dir, f), 'utf8').split('\n').forEach((line, i) => {
        if (/(requireMembership|loadProject|loadTask)\(/.test(line) && /'(viewer|member|admin|owner)'/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });
  it('no route file compares seniority with roleAtLeast to decide FEATURE access', () => {
    const bad = files.filter((f) => /roleAtLeast\(/.test(readFileSync(join(dir, f), 'utf8')));
    expect(bad).toEqual([]);
  });
});

describe('client and server agree on permission names', () => {
  const clientSrc = join(__dirname, '../../client/src');
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [join(dir, e.name)] : []));
  it('every permission name used in the client source exists in the server matrix', () => {
    const used = new Map<string, string>();
    for (const file of walk(clientSrc)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/(?:can\(|needs: |permission="|includes\(|dashboardKind\([^)]*\)|hasPermission\()'?"?([a-z]+(?:\.[a-z]+){1,2})['"]/g)) used.set(m[1], file.replace(clientSrc, ''));
    }
    expect(used.size).toBeGreaterThan(8); // the scan really found usages
    const unknown = [...used].filter(([name]) => !(PERMISSIONS as string[]).includes(name));
    expect(unknown).toEqual([]);
  });
  it('the client never decides access by comparing role names', () => {
    const bad: string[] = [];
    for (const file of walk(clientSrc)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/myRole\s*(===|!==|==)\s*'/.test(line) || /\b(canWrite|canAdmin)\(/.test(line)) bad.push(`${file.replace(clientSrc, '')}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });
});

describe('project health rules', () => {
  const today = new Date('2026-10-29T00:00:00Z');
  const base = { status: 'active', total: 10, done: 5, overdue: 0, today };
  const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
  it('no tasks -> no_data; everything done -> complete', () => {
    expect(computeProjectHealth({ ...base, total: 0, done: 0 }).level).toBe('no_data');
    expect(computeProjectHealth({ ...base, done: 10 }).level).toBe('complete');
    expect(computeProjectHealth({ ...base, status: 'completed' }).level).toBe('complete');
  });
  it('overdue ratio sets watch from 10% and at_risk from 30% of OPEN tasks (exact boundaries)', () => {
    const open10 = { ...base, total: 20, done: 10 }; // 10 open tasks
    expect(computeProjectHealth({ ...open10, overdue: 0 }).level).toBe('healthy');
    expect(computeProjectHealth({ ...open10, overdue: 1 }).level).toBe('watch'); // 10% -> threshold is inclusive
    expect(computeProjectHealth({ ...open10, overdue: 2 }).level).toBe('watch'); // 20%
    expect(computeProjectHealth({ ...open10, overdue: 3 }).level).toBe('at_risk'); // 30% -> inclusive
    expect(computeProjectHealth({ ...open10, overdue: 10 }).level).toBe('at_risk');
  });
  it('thresholds are exactly the documented constants', () => {
    expect(HEALTH).toEqual({ OVERDUE_AT_RISK: 0.3, OVERDUE_WATCH: 0.1, SLIP_AT_RISK: 25, SLIP_WATCH: 10 });
    expect(OVERLOAD).toEqual({ OPEN_TASKS: 15, OPEN_ESTIMATE_HOURS: 40 });
  });
  it('explains itself', () => {
    const h = computeProjectHealth({ ...base, total: 10, done: 4, overdue: 3 }); // 3 of 6 open overdue = 50%
    expect(h.level).toBe('at_risk');
    expect(h.reasons[0]).toBe('3 of 6 open tasks are overdue (50%)');
  });
  it('compares progress with the schedule', () => {
    const dates = { startDate: d('2026-10-01'), endDate: d('2026-11-30') }; // today is 28 of 60 days (47%) through
    expect(computeProjectHealth({ ...base, ...dates, done: 5 }).expectedProgress).toBe(47); // 28 of 60 days elapsed
    expect(computeProjectHealth({ ...base, ...dates, done: 5 }).level).toBe('healthy'); // 50% done vs 47% expected
    expect(computeProjectHealth({ ...base, ...dates, done: 3 }).level).toBe('watch'); // 30% done vs 47% expected: 17 points behind
    const risky = computeProjectHealth({ ...base, ...dates, done: 1 }); // 10% done vs 47% expected: 37 points behind
    expect(risky.level).toBe('at_risk');
    expect(risky.reasons.join(' ')).toMatch(/Behind schedule/);
  });
  it('a project past its end date with open work is at risk; on hold is at least watch', () => {
    const late = computeProjectHealth({ ...base, startDate: d('2026-08-01'), endDate: d('2026-10-01') });
    expect(late.level).toBe('at_risk');
    expect(late.reasons.join(' ')).toMatch(/Past its end date/);
    expect(computeProjectHealth({ ...base, status: 'on_hold' }).level).toBe('watch');
  });
  it('workload flag and the "today" sanity check', () => {
    expect(isOverloaded(14, 39)).toBe(false);
    expect(isOverloaded(15, 0)).toBe(true);
    expect(isOverloaded(2, 40)).toBe(true);
    const now = new Date('2026-10-29T12:00:00Z');
    expect(isPlausibleToday(new Date('2026-10-29T00:00:00Z'), now)).toBe(true);
    expect(isPlausibleToday(new Date('2026-10-30T00:00:00Z'), now)).toBe(true); // user ahead of UTC
    expect(isPlausibleToday(new Date('2026-10-27T00:00:00Z'), now)).toBe(true);
    expect(isPlausibleToday(new Date('2026-11-10T00:00:00Z'), now)).toBe(false);
    expect(isPlausibleToday(new Date('2020-01-01T00:00:00Z'), now)).toBe(false);
  });
});
