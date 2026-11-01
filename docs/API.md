# REST API

Base URL: `http://localhost:5000/api`. JSON in/out. Auth = httpOnly cookie `flowsync_session`. **Every non-GET request must send `X-Requested-With: FlowSync`** (CSRF guard). Errors: `{ "error": { "message": "...", "details": [...] } }`.
Status codes: 400 validation, 401 not signed in, 403 role too low, 404 missing **or not accessible**, 409 conflict, 429 rate limited.
Roles: viewer < member < admin < owner (per workspace). Access is decided by **permissions** (see [PERMISSIONS.md](PERMISSIONS.md)), not by comparing role names. A caller who is not a member of the workspace always gets 404.

## Auth
| Method & path | Purpose | Notes |
|---|---|---|
| GET `/health` | liveness + DB state | public |
| POST `/auth/register` | `{name,email,password(8-128)}` -> 201, sets cookie | rate limited |
| POST `/auth/login` | `{email,password}` -> sets cookie | rate limited; same error for unknown email/wrong password |
| POST `/auth/logout` | clears cookie | |
| GET `/auth/me` | current user | auth |
| PATCH `/auth/me` | `{name?, notificationPrefs?}` | auth |
| POST `/auth/password` | `{currentPassword,newPassword}`; revokes other sessions | auth |
| POST `/auth/logout-all` | revokes all sessions (tokenVersion++) | auth |

## Workspaces
| Method & path | Min role |
|---|---|
| GET `/workspaces` | any member (lists yours) |
| POST `/workspaces` `{name,description?}` | any user (becomes owner) |
| GET `/workspaces/:id` | viewer |
| PATCH `/workspaces/:id` | admin |
| DELETE `/workspaces/:id` (cascades) | owner |
| GET `/workspaces/:id/members` | viewer |
| POST `/workspaces/:id/members` `{email,role}` (existing users only) | admin |
| PATCH `/workspaces/:id/members/:userId` `{role}` | admin (only owner grants/changes admin) |
| DELETE `/workspaces/:id/members/:userId` | admin, or yourself |

## Projects
| Method & path | Min role |
|---|---|
| GET `/projects?workspaceId=&includeArchived=` (with real progress) | viewer |
| POST `/projects` `{workspaceId,name,key,description?,priority?,startDate?,endDate?}` | member |
| GET `/projects/:id` | viewer |
| PATCH `/projects/:id` (status incl. `archived`) | project owner or admin |
| DELETE `/projects/:id` (cascades) | admin |
| GET `/projects/:id/activity` | viewer |

## Tasks
| Method & path | Min role |
|---|---|
| GET `/tasks?projectId=&status=&priority=&assignee=me\|none\|<id>&label=&q=&overdue=true&sort=&order=&page=&limit<=100` -> `{tasks,page,limit,total,pages}` | viewer |
| GET `/tasks/export?projectId=` -> CSV (formula-injection safe) | viewer |
| POST `/tasks` `{projectId,title,...,blockedBy?,checklist?: [{text,done}] (max 30)}` | member |
| GET `/tasks/:id` (with blocked-by / blocking) | viewer |
| PATCH `/tasks/:id` - `blockedBy: [taskId]` **replaces** the blocker list (deduplicated). 400 for itself, a task from another project, an unknown id, more than 20, or any direct/indirect cycle | member |
| POST `/tasks/:id/move` `{status,index}` | member |
| POST `/tasks/:id/duplicate` | member |
| DELETE `/tasks/:id` | creator or admin |
| GET / POST `/tasks/:id/comments` (`{body}`; `@email` mentions notify workspace members) | viewer / member |

## Notifications
- GET `/notifications` -> `{notifications, unread}`; PATCH `/notifications/:id/read`; POST `/notifications/read-all`.

## Dashboards, personal lists, reports, security, roles
Definitions and rules: [DASHBOARDS.md](DASHBOARDS.md). The old `/analytics/dashboard` route was replaced by `/dashboard/*`.

| Method & path | Permission | Purpose |
|---|---|---|
| GET `/dashboard/admin?workspaceId&today&timezone` | `dashboard.admin` | KPIs, charts, project health, team workload/performance, deadlines, recent activity, audit summary |
| GET `/dashboard/member?workspaceId&today&timezone` | `dashboard.member` | the caller's own KPIs, tasks, today, deadlines, workload, 7-day time, projects, notifications, activity |
| GET `/dashboard/viewer?workspaceId&today&timezone` | `dashboard.viewer` | read-only overview (no people, time or audit data) |
| GET `/tasks/mine?workspaceId&status=open\|backlog\|todo\|in_progress\|in_review\|done&page&limit<=100` | `task.view` | the caller's assigned tasks, soonest due first |
| GET `/projects/mine?workspaceId&today&timezone` | `project.view` | projects the caller owns or has tasks in, with own and project progress |
| GET `/reports/projects?workspaceId&today` and `/reports/projects/export.csv` | `reports.view` | project performance; logged time only with `time.view.all` |
| GET `/security/overview?workspaceId&days=7\|30` | `security.view` | sign-in/access counts, flagged accounts, recent events, recent access changes |
| GET `/workspaces/:id/roles` | `roles.view` | the permission matrix and how many members hold each role |

`GET /workspaces`, `GET /workspaces/:id` and `GET /projects/:id` include `permissions: string[]` for the caller. Personal endpoints take no user id; any `userId`/`assignee` parameter is ignored.

## Calendar
- GET `/calendar?workspaceId=&from=YYYY-MM-DD&to=YYYY-MM-DD` (viewer) -> `{tasks, truncated}`; tasks with `dueDate` in [from, to), max 500, range <= 62 days.

## Search
- GET `/search?workspaceId=&q=` (viewer, q 2-100 chars) -> `{projects, tasks}` (max 10 / 25) inside that workspace only.

## Audit log (admin / owner only)
Read-only. There is intentionally no endpoint to create, edit or delete audit rows. Members and viewers get 403, outsiders 404.

| Method & path | Purpose |
|---|---|
| GET `/audit-logs?workspaceId&from&to&action?&actorId?&projectId?&page&limit<=100` | Paged events, newest first. `from` is inclusive and `to` is exclusive, both ISO instants (the browser sends the user's local midnight, so day filters follow the user's own time zone). Range must be > 0 and <= 366 days. Each entry has `actor`, `project`, `task` (null if since deleted), `meta` (details saved when it happened, e.g. old/new values) and `target` (the member an action was done to) |
| GET `/audit-logs/actions?workspaceId` | Distinct action names present in the workspace (for the filter dropdown) |
| GET `/audit-logs/export.csv?workspaceId&from&to&action?&actorId?&projectId?` | Same filters, max 5000 rows, spreadsheet-formula-safe cells |

Recorded actions: `workspace.created|updated`, `member.added|role_changed|removed`, `project.created|updated|deleted`, `task.created|updated|moved|deleted`, `comment.created`, `time.created|updated|deleted`, `timer.started|stopped|discarded`.

## Time tracking
Rules, rounding and time-zone handling: [TIME_TRACKING.md](TIME_TRACKING.md). All paths are under `/time-entries`.

| Method & path | Purpose | Min role |
|---|---|---|
| GET `/timer` | caller's running timer or `null`, plus `serverNow` | any (own only) |
| POST `/timer/start` `{taskId, note?, timezone?}` | start a timer; **409** if one is already running; server sets `startedAt` | member |
| POST `/timer/stop` `{note?}` | stop and log; duration computed on the server -> `{entry, minutes, capped}`; **404** if none | member |
| DELETE `/timer` | discard without logging | any (own only) |
| POST `/` `{taskId, projectId?, minutes (1-1440), note?<=200, date?: YYYY-MM-DD}` | manual entry; `projectId` must match the task's project | member |
| PATCH `/:id` `{minutes?, note?, date?}` | edit (audited with before/after) | own entry: member; any entry: admin |
| DELETE `/:id` | delete (audited) | own entry: member; any entry: admin |
| GET `/?taskId=` | entries on a task (own only unless admin) + all-time `totalMinutes` | viewer |
| GET `/history?workspaceId&from&to&projectId?&userId?&page&limit<=100` | paged entries with `canEdit`; `userId` honoured for admins only | viewer (own) / admin (all) |
| GET `/report?workspaceId&from&to` | `{scope, summary{totalMinutes,entryCount,memberCount,projectCount}, byUser, byProject{minutes, estimateMinutes, actualMinutes, varianceMinutes, variancePct, tasksWorked, unestimatedTasks}, overall}`; estimate/variance are `null` for non-admins | viewer (own) / admin (all) |

Errors: 400 invalid duration/date/range or >24 h on a day, 403 role too low, 404 not found or not your workspace, 409 timer already running.

## Socket.IO
Connect to the API origin with credentials. Emit `project:join` (projectId, ack boolean). Receive `task:created|updated|deleted`, `comment:created`, `notification:new`.
