# FlowSync

Full-stack project management and team collaboration platform: workspaces, projects, Kanban boards, tasks with checklists and dependencies, calendar, time tracking, notifications, **role-based dashboards**, reports, an **audit log**, a **security dashboard** and a centralized **RBAC** system. Built with React, TypeScript, Node/Express and MongoDB.

> **Status:** a working, tested portfolio-grade application, not a finished commercial product. What is and is not built is listed honestly in [docs/FEATURES.md](docs/FEATURES.md) and under *Known limitations* below.

## Features
- **Accounts and workspaces:** register/login (httpOnly cookie sessions), profile, change password, sign out everywhere, multiple workspaces, add members, change/remove roles.
- **Projects and tasks:** CRUD, Kanban board with drag and drop (saved, optimistic with rollback), list view with filters/sort/paging/CSV export, checklists, dependencies (cycle-safe), comments with @mentions, labels, estimates, real-time updates (Socket.IO).
- **Calendar, search, notifications:** monthly due-date calendar, global search, real-time in-app notifications.
- **Time tracking:** server-side start/stop timer (survives refresh, one per user), manual entries, estimated vs actual with variance, reports by member and project, edit/delete with audit.
- **Role-based dashboards** (new): an admin/owner dashboard (KPIs, charts, project health and risk, team workload and performance, deadlines, audit summary), an employee dashboard (my tasks, today, workload, time, progress, notifications, activity) and a read-only viewer dashboard. Plus *My Tasks*, *My Projects* and *Reports*. See [docs/DASHBOARDS.md](docs/DASHBOARDS.md).
- **Centralized RBAC** (new): one permission matrix, enforced on every API request, mirrored read-only in the UI; a *Roles & Permissions* page. See [docs/PERMISSIONS.md](docs/PERMISSIONS.md).
- **Audit log:** who did what and when, with date/action/person/project filters, paging and CSV export; read-only API; admin/owner only.
- **Security dashboard** (new): sign-ins, failed sign-ins (repeat offenders flagged), password changes, revoked sessions, access changes.
- **Interface:** responsive layout, dark mode, collapsible sidebar, loading/empty/error states, confirmation dialogs, toasts.

## Roles
| Role | Dashboard | Can |
|---|---|---|
| **Owner** | admin | everything, including deleting the workspace and managing admins |
| **Admin** | admin | manage projects, tasks, members (not admins), see all time data, audit log, security, reports |
| **Member** (employee) | personal | work on tasks, comment, track time, create and edit their own projects; sees only their own time |
| **Viewer** | read-only overview | read permitted projects, tasks, progress and reports; cannot change anything |

The full matrix is in [docs/PERMISSIONS.md](docs/PERMISSIONS.md).

## Technology stack
- **Client:** React 18, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, React Hook Form + Zod, Recharts, dnd-kit, date-fns, Socket.IO client, Lucide icons.
- **Server:** Node.js 20+, Express, TypeScript, Mongoose, Zod, Socket.IO, Helmet, CORS, express-rate-limit, pino.
- **Database:** MongoDB (Atlas recommended).
- **Tests:** Vitest, Supertest, React Testing Library.

## Architecture
```
Browser (React SPA) --HTTPS/JSON + httpOnly cookie--> Express API --Mongoose--> MongoDB
        \------------ Socket.IO (cookie-authenticated) -----------/
```
Request flow: authenticate -> validate input (Zod) -> find the caller's membership in the resource's workspace (none = 404) -> check a named permission (missing = 403) -> apply data rules (own project, admin-only) -> query MongoDB -> write an audit event -> respond. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Folder structure
```
FlowSync/
├── client/src/
│   ├── pages/            Dashboard, AuditLog, SecurityDashboard, RolesPermissions, Reports, MyTasks, MyProjects, ProjectBoard, TimeReport, ...
│   │   └── dashboards/   AdminDashboard, MemberDashboard, ViewerDashboard, shared
│   ├── components/       KanbanBoard, TaskModal, TimeTracker, DependencyEditor, RequirePermission, ui, ...
│   ├── hooks/            useAuth, useWorkspace, usePermissions, useTimer, useTheme
│   ├── lib/              api client, nav (role-based sidebar), auditText, health, timeForm, utils
│   └── layouts/          AppLayout
├── server/src/
│   ├── permissions.ts    the role/permission matrix (single source of truth)
│   ├── routes/           auth, workspaces, projects, tasks, time, dashboard, reports, security, audit, misc
│   ├── services/         access (RBAC checks), dashboardData (aggregations), activity (audit + notifications), security, auditFeed
│   ├── models/           User, Workspace/Membership, Project, Task, TimeEntry, ActiveTimer, SecurityEvent, Comment/Notification/Activity
│   ├── middleware/ validators/ utils/ sockets/ config/ seed.ts server.ts app.ts
├── server/tests/         unit and integration tests
├── docs/                 API, ARCHITECTURE, DATABASE, DASHBOARDS, PERMISSIONS, SECURITY, TESTING, TIME_TRACKING, FEATURES, DEPLOYMENT
├── .env.example  package.json (npm workspaces)  README.md
```

## Getting started
Requirements: Node.js 20 or newer, and a MongoDB database (a free Atlas cluster is fine).

```bash
npm install                     # installs client and server (npm workspaces)
cp .env.example server/.env     # then edit server/.env (see below)
npm run dev:server              # API on http://localhost:5000
npm run dev:client              # app on http://localhost:5173  (second terminal)
```
Open http://localhost:5173, register, create a workspace, then a project.

### MongoDB Atlas setup
1. Create a free cluster at https://www.mongodb.com/atlas.
2. **Database Access:** add a user with a strong password.
3. **Network Access:** add your IP address (use `0.0.0.0/0` only for short tests).
4. **Connect, Drivers:** copy the `mongodb+srv://...` string into `MONGODB_URI`, replace `<password>`, and add the database name (e.g. `/flowsync`) before the `?`. URL-encode special characters in the password (`@` becomes `%40`).

### Environment variables
| Variable | Required | Meaning |
|---|---|---|
| `MONGODB_URI` | yes | MongoDB connection string |
| `JWT_SECRET` | yes | at least 32 random characters (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) |
| `CLIENT_URL` | no | the app's origin for CORS (default `http://localhost:5173`) |
| `PORT`, `NODE_ENV`, `JWT_EXPIRES_IN`, `LOG_LEVEL` | no | defaults: 5000, development, 7d, info |
| `MONGODB_URI_TEST` | no | a throwaway database for the integration tests |
| `VITE_API_URL` | no | client setting if the API is not at `http://localhost:5000` |
| `SEED_PASSWORD`, `SEED_OWNER_EMAIL`, `SEED_RESET` | seed only | see below |

Never commit a real `.env`; `.gitignore` excludes it. No secret ever goes in client code.

### Demo data
```bash
SEED_PASSWORD='choose-a-demo-password' npm run seed
```
(PowerShell: `$env:SEED_PASSWORD="..."; npm run seed`.) Creates the workspace "Demo Studio" with 6 users, 6 projects, about 180 tasks, comments, notifications, activity and time entries. Log in as `demo.owner@flowsync.dev` (owner), `ana@flowsync.dev` (admin), `ben@flowsync.dev`, `chitra@flowsync.dev`, `dev@flowsync.dev` (members) or `esha@flowsync.dev` (viewer) with your seed password to see each role's dashboard. Set `SEED_OWNER_EMAIL` to also make your own registered account an owner of the demo workspace, and `SEED_RESET=true` to rebuild the demo data. The seed refuses to run in production and only ever touches `@flowsync.dev` demo accounts.

## API
Summary by area; full reference with permissions and errors in [docs/API.md](docs/API.md).
`/api/auth`, `/api/workspaces` (+ members, roles), `/api/projects` (+ `/mine`), `/api/tasks` (+ `/mine`, comments, export), `/api/time-entries` (timer, history, report), `/api/dashboard/{admin,member,viewer}`, `/api/reports/projects`, `/api/audit-logs`, `/api/security/overview`, `/api/notifications`, `/api/calendar`, `/api/search`, `/api/health`.

## Testing
```bash
npm run lint && npm run typecheck && npm run build
npm test                                   # server + client
```
The integration tests need a real MongoDB. Point `MONGODB_URI_TEST` at a **throwaway** database (they create data in it): a local `mongod`, Docker (`docker run -p 27017:27017 mongo:7`), or a separate Atlas database.
```bash
MONGODB_URI_TEST='mongodb://127.0.0.1:27017/flowsync-test' npm test
```
Without it the database tests are skipped and the rest still run. At the time of writing: 175 server tests (112 of them need MongoDB; the other 63 run without it) and 91 client tests, all passing; see [docs/TESTING.md](docs/TESTING.md) for what each file covers.

## Known limitations
- Access is **per workspace**; there is no per-project membership (see docs/PERMISSIONS.md).
- Roles and permissions are fixed in code (viewable, not editable in the app).
- No email verification, forgot/reset password, invitations (members must already have an account), file attachments, sprints, milestones, automated reminders or AI features. Nothing AI-related is faked.
- The audit trail is append-only through the API, but someone with direct database access could still alter it; it is not tamper-evident.
- Time-zone handling relies on the browser reporting its zone; a user's "today" is validated to be within 2 days of the server's date.
- The UI has been exercised through component tests and by hand, not by automated browser (Playwright) tests.
- The client is one ~1 MB bundle (no code splitting yet).

## Documentation
[Features and status](docs/FEATURES.md) · [Dashboards](docs/DASHBOARDS.md) · [Permissions](docs/PERMISSIONS.md) · [API](docs/API.md) · [Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [Security](docs/SECURITY.md) · [Time tracking](docs/TIME_TRACKING.md) · [Testing](docs/TESTING.md) · [Deployment](docs/DEPLOYMENT.md) · [Roadmap](docs/DEVELOPMENT_PLAN.md)

## Screenshots
_Add screenshots after running the app locally: admin dashboard, employee dashboard, Kanban board, audit log._
