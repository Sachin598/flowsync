import { describe, expect, it } from 'vitest';
import { buildNav, dashboardKind } from './nav';

// Minimal permission sets per kind of user (the server owns the real matrix; the permission *names* are checked against it
// by a server-side test, and the server integration tests check what each role really receives).
const viewer = ['workspace.view', 'dashboard.viewer', 'reports.view'];
const member = [...viewer, 'dashboard.member', 'time.log', 'task.write'];
const admin = [...member, 'dashboard.admin', 'roles.view', 'audit.view', 'security.view', 'members.manage'];
const labels = (perms: string[], hasWorkspace = true) => buildNav((p) => perms.includes(p), hasWorkspace).map((g) => ({ heading: g.heading ?? null, items: g.items.map((i) => i.label) }));

describe('dashboardKind', () => {
  it('chooses the dashboard from permissions', () => {
    const kind = (perms: string[], ws = true) => dashboardKind((p) => perms.includes(p), ws);
    expect(kind(admin)).toBe('admin');
    expect(kind(member)).toBe('member');
    expect(kind(viewer)).toBe('viewer');
    expect(kind(admin, false)).toBe('none');
    expect(kind([])).toBe('none');
  });
});

describe('sidebar per role (exactly the navigation in the spec)', () => {
  it('admin / owner: main menu plus an Administration group', () => {
    expect(labels(admin)).toEqual([
      { heading: null, items: ['Dashboard', 'Projects', 'Calendar', 'Time Tracking', 'Team Management', 'Notifications', 'Workspaces'] },
      { heading: 'Administration', items: ['Roles & Permissions', 'Audit Logs', 'Security Dashboard', 'Reports', 'Settings'] },
    ]);
  });
  it('employee (member): personal navigation, no administration', () => {
    expect(labels(member)).toEqual([{ heading: null, items: ['Dashboard', 'My Projects', 'My Tasks', 'Calendar', 'Time Tracking', 'Team', 'Notifications', 'Settings'] }]);
  });
  it('viewer: read-only navigation, no time tracking, no administration', () => {
    expect(labels(viewer)).toEqual([{ heading: null, items: ['Dashboard', 'Projects', 'Calendar', 'Team', 'Reports', 'Notifications', 'Settings'] }]);
  });
  it('a user without a workspace can only create one', () => {
    expect(labels(admin, false)).toEqual([{ heading: null, items: ['Dashboard', 'Workspaces', 'Settings'] }]);
  });
  it('drops items whose permission is missing even if the role layout lists them', () => {
    const noAudit = admin.filter((p) => p !== 'audit.view');
    expect(labels(noAudit)[1].items).not.toContain('Audit Logs');
  });
  it('links point at real routes', () => {
    const tos = buildNav((p) => admin.includes(p), true).flatMap((g) => g.items.map((i) => i.to));
    expect(tos).toEqual(['/dashboard', '/projects', '/calendar', '/time', '/team', '/notifications', '/workspaces', '/roles', '/audit', '/security', '/reports', '/settings']);
  });
});
