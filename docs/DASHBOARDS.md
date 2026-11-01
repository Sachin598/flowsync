# Role-based dashboards

`/dashboard` shows one of three dashboards. The choice is made from permissions (`dashboard.admin` -> admin, else `dashboard.member` -> employee, else `dashboard.viewer` -> viewer), and each API endpoint checks its **own** permission, so calling another role's endpoint directly returns 403.

| Endpoint | Permission | Who |
|---|---|---|
| `GET /api/dashboard/admin` | `dashboard.admin` | owner, admin |
| `GET /api/dashboard/member` | `dashboard.member` | owner, admin, member |
| `GET /api/dashboard/viewer` | `dashboard.viewer` | everyone in the workspace |

Query parameters (all endpoints): `workspaceId` (required), `today` (`YYYY-MM-DD`, the user's local day), `timezone` (IANA name). `today` must be within 2 days of the server's date and `timezone` must be valid, otherwise 400. They only decide where "today" and day boundaries fall; they never choose whose data is returned. Missing values default to the server's UTC day and `UTC`.

## Definitions (so every number can be checked)
- **Overdue** = not done, has a due date, and the due *day* is before the user's today. A task due today is **not** overdue. (Due dates are stored as the chosen calendar day.)
- **Overall completion %** = completed / total tasks, rounded.
- **Completed tasks per day** = tasks whose `completedAt` falls on that day, cut in the user's time zone, last 14 days.
- **Active projects** (admin/viewer) = projects with status `active`. For an employee = active projects they own or have tasks in.
- **Team members** = memberships in the workspace.

## Admin / owner dashboard
- **KPI cards:** Total Projects, Active Projects, Total Team Members, Total Tasks, Completed Tasks, Pending Tasks, Overdue Tasks, Overall Completion.
- **Charts:** tasks by status, completed per day, tasks by priority, team workload (open vs overdue per member).
- **Project health & risk.** Rule-based, with reasons shown. Thresholds are constants in `server/src/utils/health.ts`:
  - *Complete*: every task done (or project completed/archived). *No tasks*: nothing to rate.
  - *At risk*: at least **30%** of open tasks overdue, **or** progress at least **25 points** behind the date-based expectation, **or** the end date has passed with open tasks.
  - *Watch*: at least **10%** of open tasks overdue, **or** at least **10 points** behind schedule, **or** the project is on hold.
  - Expected progress = share of the start-to-end period that has elapsed (only when both dates are set).
- **Project progress / performance:** per project tasks, done, overdue, open estimate hours, logged time, health.
- **Team workload & performance (per member):** open tasks, overdue, open estimated hours, tasks completed in the last 30 days, **on-time %** (completed on or before the due day, among completed tasks that had a due date), time logged in the last 7 days. A member is flagged **overloaded** at 15+ open tasks or 40+ open estimated hours.
- **Upcoming deadlines:** open tasks due from today through the next 7 days, soonest first.
- **Recent activity** and **Audit activity summary** (last 7 days): number of events, deletions/removals, events by category, three most active people. These come from the audit trail; see below.
- A **My work** tab shows the same personal dashboard an employee sees.

## Employee (member) dashboard
- **KPI cards:** My Assigned Tasks, Completed Tasks, Pending Tasks, Overdue Tasks, Logged Working Hours (last 7 days, with today's total), Active Projects.
- **Sections:** My Tasks (open, soonest due first), Today's Tasks (due today), Upcoming Deadlines (next 7 days), My Workload (open, overdue, estimated hours, by status and priority), My Time Tracking (hours per day for 7 days), My Project Progress (own progress next to the project's), Recent Notifications (5 + unread count), Personal Activity History (their own last 10 audit events).
- Everything is computed for the authenticated user. There is no user-id parameter.
- Related pages: **My Tasks** (`/my-tasks`, paged, filter by status) and **My Projects** (`/my-projects`).

## Viewer dashboard
Read-only overview: KPIs, tasks by status, project progress with health, upcoming deadlines, and a link to Reports. It deliberately contains **no** people-level data: no per-member workload, no time data, no audit data, no notifications. It has no buttons that change data.

## Reports (`/reports`)
`GET /api/reports/projects` and `.../export.csv` (`reports.view`, all roles): one row per project with progress, overdue, open estimate, health and reasons. A "Logged" column is included only for roles with `time.view.all`.

## Security dashboard (`/security`, admin/owner)
`GET /api/security/overview?workspaceId&days=7|30`. Shows sign-ins, failed sign-ins, password changes, sessions revoked, accounts created (from the `SecurityEvent` collection), plus members added / role changes / members removed (from the audit trail). Accounts with **3 or more failed sign-ins** in the window are listed. Only events of this workspace's members are included. A failed sign-in for an email with no account is not recorded. Events (including IP addresses and browser) are deleted automatically after **180 days** by a MongoDB TTL index.

## Audit log (`/audit`, admin/owner)
See [API.md](API.md#audit-log-admin--owner-only). Filters: date range, action, person, project; paging; CSV export. Events are created only by the server, with server timestamps, the actor and the workspace; no endpoint can create, edit or delete one; and they are kept when the project or task they describe is deleted.

## Not built (and not faked)
Risk analysis beyond the rules above, predictions, AI summaries, automated deadline reminders and a dependency graph are not implemented. No AI provider is configured, so nothing AI-based appears anywhere.
