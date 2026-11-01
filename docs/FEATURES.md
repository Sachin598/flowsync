# Feature checklist (honest status)

Legend: DONE = implemented and covered by build/lint/type-check (and unit tests where noted). Integration/UI behaviour has **not been exercised against a live MongoDB or in a browser by the author of this package** - run the steps in docs/TESTING.md to confirm on your machine.

| # | Module | Status | Notes |
|---|---|---|---|
| 1 | Auth and profile | PARTIAL | Register, login, logout, profile name, password change, notification pref, logout-all (session revocation), sign-in/failed-sign-in/password events recorded for the security dashboard. **Missing:** email verification, forgot/reset password, avatar upload, account deletion |
| 2 | Workspaces | PARTIAL | CRUD, roles, add existing user by email, role change, remove, switch workspace. **Missing:** invitations (accept/reject), workspace settings |
| 3 | Projects | PARTIAL | CRUD, archive via status, progress from real tasks, activity feed (API). **Missing:** project members/permissions, templates, milestones |
| 4 | Tasks | PARTIAL | CRUD, filters, search, sort, pagination, duplicate, labels, estimate, checklists (progress shown on cards), comments, mentions, dependencies. **Missing:** attachments, time spent, bulk updates |
| 5 | Kanban | DONE | 5 columns, dnd-kit drag-and-drop (mouse + keyboard), persisted, optimistic update with rollback, add from column, search/priority/assignee filters |
| 6 | List/table | PARTIAL | Sortable, searchable, paginated, CSV export. **Missing:** saved views, inline edit, bulk actions |
| 7 | Calendar/timeline | PARTIAL | Monthly calendar of due dates across all projects (`/calendar`, API `GET /api/calendar`), status colours, overdue highlight, click-to-edit. **Missing:** weekly view, drag-to-reschedule, timeline/Gantt |
| 8 | Dependencies/milestones | PARTIAL | Dependencies: add and remove blockers in the task dialog (saved immediately), blocker status with an "unfinished" warning, and a read-only "blocking" list. The server rejects self-dependencies, other-project tasks, direct and indirect cycles, more than 20 blockers, and stores each blocker once; deleting a task clears it from others. **Missing:** milestones, choosing blockers while *creating* a task in the UI, a dependency graph view, dependency-aware scheduling; the Kanban card's "blocked" badge shows for any blocker, finished or not |
| 9 | Collaboration | PARTIAL | Comments, @mentions, activity log, Socket.IO updates with membership checks. No threads |
| 10 | Notifications | PARTIAL | In-app, unread count, mark read/all, assignment + mention + member-added, real-time push. No due-date/overdue reminders (needs scheduler) |
| 11 | Dashboards and analytics | DONE | **Three role-based dashboards**: admin/owner (8 KPIs, charts, project health & risk with reasons, team workload and performance, deadlines, activity, audit summary), employee/member (personal KPIs, tasks, today, workload, time, progress, notifications, activity), viewer (read-only overview). Plus My Tasks, My Projects, Reports. All numbers come from MongoDB aggregations; rules in docs/DASHBOARDS.md |
| 12 | Workload / time tracking | MOSTLY DONE | Server-side start/stop timer (one per user, survives refresh, global indicator), manual log form (project, task, duration, date, description), edit/delete with audit log, role-scoped reports (summary, by member, by project), estimate vs actual with variance, entry history, timezone-safe inclusive date ranges - see docs/TIME_TRACKING.md. **Missing:** overload warnings, changing an entry's task (delete and re-log instead), CSV export of time, approval/locking of old entries |
| 13 | Sprints | NOT BUILT | |
| 14 | Automation rules | NOT BUILT | |
| 15 | AI assistant | NOT BUILT | |
| 16 | File management | NOT BUILT | |
| 17 | Search / saved filters | PARTIAL | Per-project search and filters, plus workspace-wide search (header box, `/search`). No saved filters |
| 18 | Templates | NOT BUILT | |
| 19 | Goals / OKRs | NOT BUILT | |
| 20 | Audit logs / admin | MOSTLY DONE | Audit log page (filters: date, action, person, project; paging; CSV), Security dashboard, Roles & Permissions page (read-only matrix), centralized RBAC. Audit API is read-only and survives deletes. **Missing:** editing roles at runtime, per-project permissions, tamper-evidence beyond API immutability, retention policy for audit rows, session-revocation UI for admins, a separate user-management page (Team Management covers it). Deleting a whole workspace deletes its audit rows |
| 21 | Import/export | PARTIAL | CSV export only |
| 22 | UX | PARTIAL | Responsive layout, dark mode, collapsible sidebar, skeletons, empty/error states, confirm dialogs, toasts, 404 page |
| 23 | PWA | NOT BUILT | |

Pages built: landing, login, register, dashboard, workspaces, projects, project board/list, team, notifications, settings, 404.
Pages not built: forgot password, timeline, sprint board, templates, goals, global workspace admin.

Known limitations: client bundle is a single ~950 kB chunk (no code splitting yet); the board loads at most 100 tasks per project; real-time refresh re-fetches queries rather than patching them.
