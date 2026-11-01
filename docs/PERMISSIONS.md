# Roles and permissions (RBAC)

FlowSync has four workspace roles: **Owner**, **Admin**, **Member** (the "employee" role) and **Viewer**.
There is no separate Employee role: the Member role gets the employee dashboard and navigation.

## One source of truth
`server/src/permissions.ts` is the only place that defines what a role may do.

- **Server:** routes never compare role names. They pass a permission name (for example `task.write`) to `requireMembership`, `loadProject` or `loadTask`, or call `can(role, permission)`.
- **Client:** it never keeps its own role table. `GET /workspaces` and `GET /projects/:id` return the caller's permission list, and the UI (`usePermissions`, `buildNav`, `RequirePermission`) only decides what to **show** from that list.
- **The API enforces everything again.** Hiding a menu item is cosmetic; every protected endpoint checks authentication, workspace membership and the permission.
- Two tests keep this honest: one scans `server/src/routes` and fails if a raw role name is passed to an access check; another scans the client source and fails if it uses a permission name that does not exist on the server, or compares role names.

## The matrix (generated from the code)
| Permission | What it allows | Owner | Admin | Member | Viewer |
|---|---|:-:|:-:|:-:|:-:|
| **Workspace** | |  |  |  |  |
| `workspace.view` | See the workspace and switch to it | ✔ | ✔ | ✔ | ✔ |
| `workspace.update` | Change workspace name and settings | ✔ | ✔ |  |  |
| `workspace.delete` | Delete the workspace and all its data | ✔ |  |  |  |
| **People** | |  |  |  |  |
| `members.view` | See the member list | ✔ | ✔ | ✔ | ✔ |
| `members.manage` | Add members, change roles, remove members | ✔ | ✔ |  |  |
| `admins.manage` | Promote, demote or remove admins | ✔ |  |  |  |
| **Projects** | |  |  |  |  |
| `project.view` | See projects and their progress | ✔ | ✔ | ✔ | ✔ |
| `project.create` | Create projects | ✔ | ✔ | ✔ |  |
| `project.update.own` | Edit projects they own | ✔ | ✔ | ✔ |  |
| `project.update` | Edit any project | ✔ | ✔ |  |  |
| `project.delete` | Delete projects | ✔ | ✔ |  |  |
| **Tasks** | |  |  |  |  |
| `task.view` | See tasks, comments and dependencies | ✔ | ✔ | ✔ | ✔ |
| `task.write` | Create, edit, move and duplicate tasks | ✔ | ✔ | ✔ |  |
| `task.delete.own` | Delete tasks they created | ✔ | ✔ | ✔ |  |
| `task.delete` | Delete any task | ✔ | ✔ |  |  |
| `comment.create` | Write comments | ✔ | ✔ | ✔ |  |
| **Time tracking** | |  |  |  |  |
| `time.log` | Run timers and log their own time | ✔ | ✔ | ✔ |  |
| `time.view.all` | See everyone's time and estimate variance | ✔ | ✔ |  |  |
| `time.manage.all` | Edit or delete other people's time entries | ✔ | ✔ |  |  |
| **Dashboards** | |  |  |  |  |
| `dashboard.admin` | Workspace-wide admin dashboard | ✔ | ✔ |  |  |
| `dashboard.member` | Personal work dashboard | ✔ | ✔ | ✔ |  |
| `dashboard.viewer` | Read-only workspace overview | ✔ | ✔ | ✔ | ✔ |
| `reports.view` | Project performance reports (no per-person data) | ✔ | ✔ | ✔ | ✔ |
| **Administration** | |  |  |  |  |
| `audit.view` | Read and export the audit log | ✔ | ✔ |  |  |
| `security.view` | Security dashboard (sign-in and access events) | ✔ | ✔ |  |  |
| `roles.view` | See the roles and permissions matrix | ✔ | ✔ |  |  |


Notes on the rules that are not simple table lookups:

- **Ownership rules.** A member may edit a project they own (`project.update.own`) and delete a task they created (`task.delete.own`); anyone else's needs the admin permission.
- **People rules.** Only the owner may grant, change or remove an **admin** (`admins.manage`); the owner role itself can never be changed or removed. Anyone may leave a workspace.
- **Time data.** Members see only their own time. Admins and owners see everyone's (`time.view.all`) and may edit or delete other people's entries (`time.manage.all`).
- **Reports.** `reports.view` returns project-level numbers only. Logged hours are included only for roles with `time.view.all`.

## What each role gets
| | Owner | Admin | Member (employee) | Viewer |
|---|---|---|---|---|
| Dashboard | Admin dashboard (+ "My work") | Admin dashboard (+ "My work") | Personal dashboard | Read-only overview |
| Sidebar | Dashboard, Projects, Calendar, Time Tracking, Team Management, Notifications, Workspaces; Administration: Roles & Permissions, Audit Logs, Security Dashboard, Reports, Settings | same as owner | Dashboard, My Projects, My Tasks, Calendar, Time Tracking, Team, Notifications, Settings | Dashboard, Projects, Calendar, Team, Reports, Notifications, Settings |
| Can change data | everything | everything except owner-only actions | tasks, comments, own time, own projects | nothing |

"User Management" in your brief is the **Team Management** page (add members, change roles, remove members); there is a single page rather than two copies of it.

## Workspace isolation
- Every query is scoped by a workspace id that is checked against the caller's membership; a non-member always gets **404** (never 403), so ids cannot be probed.
- Resource ids (task, project, time entry) are resolved to their workspace on the server, and the caller's membership of *that* workspace is checked.
- Personal endpoints (`/dashboard/member`, `/tasks/mine`, `/projects/mine`) have no user-id parameter: they always use the authenticated user. Tests send spoofed `userId`/`assignee` parameters and confirm they are ignored.
- Being an admin in one workspace grants nothing in another.

## Known limitation: no per-project membership
Access is granted **per workspace**. Every member can open every project in their workspace. "My Projects" and "My Tasks" show the projects a person owns or has tasks in, but that is a convenience filter, not an access boundary. True per-project access (a ProjectMembership model, project roles, and filtering every list and aggregate by it) was not built; it touches nearly every query and should be a deliberate next step.

Permissions are fixed in code; the Roles & Permissions page shows them read-only. Editing roles at runtime is not implemented.
