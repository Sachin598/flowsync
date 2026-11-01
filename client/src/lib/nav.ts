import { Bell, Briefcase, CalendarDays, CheckSquare, Clock, FileBarChart, FolderKanban, KeyRound, LayoutDashboard, Settings, ShieldAlert, ShieldCheck, Users, type LucideIcon } from 'lucide-react';

export interface NavItem { to: string; label: string; icon: LucideIcon; needs?: string }
export interface NavGroup { heading?: string; items: NavItem[] }
export type DashboardKind = 'admin' | 'member' | 'viewer' | 'none';

const dashboard: NavItem = { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard };
const calendar: NavItem = { to: '/calendar', label: 'Calendar', icon: CalendarDays };
const time: NavItem = { to: '/time', label: 'Time Tracking', icon: Clock, needs: 'time.log' };
const notifications: NavItem = { to: '/notifications', label: 'Notifications', icon: Bell };
const settings: NavItem = { to: '/settings', label: 'Settings', icon: Settings };

/** Which dashboard a user gets is decided by permissions, never by comparing role names. */
export function dashboardKind(can: (p: string) => boolean, hasWorkspace: boolean): DashboardKind {
  if (!hasWorkspace) return 'none';
  if (can('dashboard.admin')) return 'admin';
  if (can('dashboard.member')) return 'member';
  return can('dashboard.viewer') ? 'viewer' : 'none';
}

/** The sidebar for each kind of user. Items needing a permission the user lacks are dropped as a second safety net. */
export function buildNav(can: (p: string) => boolean, hasWorkspace: boolean): NavGroup[] {
  const kind = dashboardKind(can, hasWorkspace);
  const groups: NavGroup[] =
    kind === 'admin'
      ? [
          { items: [dashboard, { to: '/projects', label: 'Projects', icon: FolderKanban }, calendar, time, { to: '/team', label: 'Team Management', icon: Users }, notifications, { to: '/workspaces', label: 'Workspaces', icon: Briefcase }] },
          { heading: 'Administration', items: [
            { to: '/roles', label: 'Roles & Permissions', icon: KeyRound, needs: 'roles.view' },
            { to: '/audit', label: 'Audit Logs', icon: ShieldCheck, needs: 'audit.view' },
            { to: '/security', label: 'Security Dashboard', icon: ShieldAlert, needs: 'security.view' },
            { to: '/reports', label: 'Reports', icon: FileBarChart, needs: 'reports.view' },
            settings,
          ] },
        ]
      : kind === 'member'
        ? [{ items: [dashboard, { to: '/my-projects', label: 'My Projects', icon: FolderKanban }, { to: '/my-tasks', label: 'My Tasks', icon: CheckSquare }, calendar, time, { to: '/team', label: 'Team', icon: Users }, notifications, settings] }]
        : kind === 'viewer'
          ? [{ items: [dashboard, { to: '/projects', label: 'Projects', icon: FolderKanban }, calendar, { to: '/team', label: 'Team', icon: Users }, { to: '/reports', label: 'Reports', icon: FileBarChart, needs: 'reports.view' }, notifications, settings] }]
          : [{ items: [dashboard, { to: '/workspaces', label: 'Workspaces', icon: Briefcase }, settings] }];
  return groups.map((g) => ({ ...g, items: g.items.filter((i) => !i.needs || can(i.needs)) }));
}
