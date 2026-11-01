/**
 * Central RBAC definition - the ONLY place that says what each role may do.
 * Server routes ask `can(role, permission)` (or pass a permission name to requireMembership/loadProject/loadTask);
 * the client receives the caller's permission list from the API and never maintains its own copy of this matrix.
 */
export const ROLES = ['viewer', 'member', 'admin', 'owner'] as const;
export type Role = (typeof ROLES)[number];

const ALL: readonly Role[] = ['viewer', 'member', 'admin', 'owner'];
const MEMBER_UP: readonly Role[] = ['member', 'admin', 'owner'];
const ADMIN_UP: readonly Role[] = ['admin', 'owner'];
const OWNER_ONLY: readonly Role[] = ['owner'];

export const PERMISSION_DEFS = {
  // Workspace
  'workspace.view': { group: 'Workspace', label: 'See the workspace and switch to it', roles: ALL },
  'workspace.update': { group: 'Workspace', label: 'Change workspace name and settings', roles: ADMIN_UP },
  'workspace.delete': { group: 'Workspace', label: 'Delete the workspace and all its data', roles: OWNER_ONLY },
  // People
  'members.view': { group: 'People', label: 'See the member list', roles: ALL },
  'members.manage': { group: 'People', label: 'Add members, change roles, remove members', roles: ADMIN_UP },
  'admins.manage': { group: 'People', label: 'Promote, demote or remove admins', roles: OWNER_ONLY },
  // Projects
  'project.view': { group: 'Projects', label: 'See projects and their progress', roles: ALL },
  'project.create': { group: 'Projects', label: 'Create projects', roles: MEMBER_UP },
  'project.update.own': { group: 'Projects', label: 'Edit projects they own', roles: MEMBER_UP },
  'project.update': { group: 'Projects', label: 'Edit any project', roles: ADMIN_UP },
  'project.delete': { group: 'Projects', label: 'Delete projects', roles: ADMIN_UP },
  // Tasks
  'task.view': { group: 'Tasks', label: 'See tasks, comments and dependencies', roles: ALL },
  'task.write': { group: 'Tasks', label: 'Create, edit, move and duplicate tasks', roles: MEMBER_UP },
  'task.delete.own': { group: 'Tasks', label: 'Delete tasks they created', roles: MEMBER_UP },
  'task.delete': { group: 'Tasks', label: 'Delete any task', roles: ADMIN_UP },
  'comment.create': { group: 'Tasks', label: 'Write comments', roles: MEMBER_UP },
  // Time
  'time.log': { group: 'Time tracking', label: 'Run timers and log their own time', roles: MEMBER_UP },
  'time.view.all': { group: 'Time tracking', label: "See everyone's time and estimate variance", roles: ADMIN_UP },
  'time.manage.all': { group: 'Time tracking', label: "Edit or delete other people's time entries", roles: ADMIN_UP },
  // Dashboards & reports
  'dashboard.admin': { group: 'Dashboards', label: 'Workspace-wide admin dashboard', roles: ADMIN_UP },
  'dashboard.member': { group: 'Dashboards', label: 'Personal work dashboard', roles: MEMBER_UP },
  'dashboard.viewer': { group: 'Dashboards', label: 'Read-only workspace overview', roles: ALL },
  'reports.view': { group: 'Dashboards', label: 'Project performance reports (no per-person data)', roles: ALL },
  // Administration
  'audit.view': { group: 'Administration', label: 'Read and export the audit log', roles: ADMIN_UP },
  'security.view': { group: 'Administration', label: 'Security dashboard (sign-in and access events)', roles: ADMIN_UP },
  'roles.view': { group: 'Administration', label: 'See the roles and permissions matrix', roles: ADMIN_UP },
} as const satisfies Record<string, { group: string; label: string; roles: readonly Role[] }>;

export type Permission = keyof typeof PERMISSION_DEFS;
export const PERMISSIONS = Object.keys(PERMISSION_DEFS) as Permission[];

/** A role string ("member") or a permission name ("task.write"). */
export type Need = Role | Permission;

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
export const isRole = (v: string): v is Role => v in RANK;
/** Seniority comparison, used only for rules about people (who may change whose role). Not for feature access. */
export const roleAtLeast = (role: Role, min: Role) => RANK[role] >= RANK[min];

export const can = (role: Role, permission: Permission): boolean => (PERMISSION_DEFS[permission].roles as readonly Role[]).includes(role);
export const satisfies = (role: Role, need: Need): boolean => (isRole(need) ? roleAtLeast(role, need) : can(role, need));
export const permissionsFor = (role: Role): Permission[] => PERMISSIONS.filter((p) => can(role, p));

/** Matrix for the Roles & Permissions page. */
export function permissionMatrix() {
  return {
    roles: [...ROLES].reverse(),
    permissions: PERMISSIONS.map((key) => ({ key, group: PERMISSION_DEFS[key].group, label: PERMISSION_DEFS[key].label, roles: [...PERMISSION_DEFS[key].roles] })),
  };
}
