# Architecture

```
Browser (React SPA)  --HTTPS/JSON + httpOnly cookie-->  Express API  --Mongoose-->  MongoDB
        \------------- Socket.IO (cookie-authenticated) ------------/
```

## Server layout (`server/src`)
- `config/` env validation (Zod, fails fast), logger (pino with redaction), DB connection
- `models/` Mongoose schemas and indexes
- `routes/` Express routers (`auth`, `workspaces`, `projects`, `tasks`, `dashboard`, `reports`, `security`, `audit`, `time`, `misc` = notifications, calendar, search). Handlers are thin; shared rules live in `services/`
- `permissions.ts` the role/permission matrix (the only place that says what a role may do); `services/access.ts` turns it into membership + permission checks; `services/dashboardData.ts` the shared aggregations behind the dashboards
- `services/activity.ts` activity/audit log + notifications; `services/realtime.ts` Socket.IO emit helpers
- `middleware/` auth, CSRF header guard, central error handler
- `validators/` Zod request schemas
- `sockets/` authenticated Socket.IO with per-project room membership checks
- `utils/` pure, unit-tested helpers (dependency cycles, CSV, Kanban ordering)

Note: routes contain the controller logic directly (no separate `controllers/` folder) to keep the MVP small.

## Request flow
1. Browser sends request with the `flowsync_session` cookie and `X-Requested-With: FlowSync`.
2. `requireCustomHeader` (CSRF) -> `requireAuth` (verifies JWT, checks user active + `tokenVersion`).
3. Route validates input with Zod, loads the resource, calls `requireMembership(user, workspace, minRole)`.
4. Mutation writes to MongoDB, records activity, creates notifications, emits Socket.IO events.
5. Errors flow to the central handler and return `{ error: { message, details? } }`.

## Real-time
Sockets authenticate with the same cookie. A client joins `project:<id>` only if `loadProject` succeeds (workspace membership). Events: `task:created|updated|deleted`, `comment:created`, `notification:new` (to `user:<id>`). Event payloads contain only data the room members may already read.

## Kanban ordering
Tasks have a float `position`. A move sends `{status, index}`; the server computes the position between neighbours (`utils/position.ts`). The client applies the same function for optimistic updates and rolls back on error.

## Client layout (`client/src`)
`pages/`, `components/` (Kanban, TaskModal, ui primitives), `layouts/AppLayout`, `hooks/` (auth, workspace, theme), `lib/` (axios client, socket, helpers), `types/`.

## Authorization flow
1. `requireAuth` identifies the user (cookie + token version).
2. The route loads the resource and calls `requireMembership` / `loadProject` / `loadTask` with a **permission name**.
3. `access.ts` finds the caller's membership in the resource's workspace: none -> 404; permission missing -> 403.
4. Handlers add rules that depend on data (own project, own task, only the owner may touch admins).
5. The client receives the permission list and uses it only for display.
