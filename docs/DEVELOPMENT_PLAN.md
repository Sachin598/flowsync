# Development plan

| Phase | Scope | Status |
|---|---|---|
| 1 Foundation | monorepo, Express + Vite, config, logging, health | done |
| 2 Auth | register/login/logout, sessions, RBAC middleware, tests | mostly done (no email verification/reset) |
| 3 Core | workspaces, members, projects, tasks, Kanban, filters | done (invitations pending) |
| 4 Collaboration | comments, mentions, activity, notifications, sockets | done (attachments pending) |
| 5 Planning | calendar, timeline, milestones, sprints, time tracking | not started |
| 6 Analytics/automation | dashboard done; reports, saved filters, automation, AI | partly |
| 7 Advanced | templates, goals, audit UI, import, PWA | not started |
| 8 QA | unit + guard tests done; DB integration run by you; Playwright pending | partial |
| 9 Docs/packaging | docs and ZIP | done for MVP |

Suggested next steps: password reset + email verification, invitations, calendar view, time entries, Playwright smoke tests, code-splitting the client.
