# Testing

```bash
npm test                 # server + client
npm run test -w server   # Vitest + Supertest
npm run test -w client   # Vitest + React Testing Library
npm run lint && npm run typecheck && npm run build
```

## What exists
| Suite | Needs DB? | Covers |
|---|---|---|
| `server/tests/unit.test.ts` | no | dependency-cycle detection, CSV escaping/formula safety, Kanban position maths, role hierarchy |
| `server/tests/api.test.ts` | no | health, CSRF header guard, 401 on protected routes, forged cookie rejected, input validation, JSON 404 |
| `server/tests/integration.test.ts` | **yes** | register/login, workspace/project/task CRUD, move persistence, **cross-workspace isolation (404s)**, viewer read-only (403), dependency cycle rejection, dashboard counts |
| `server/tests/timeMath.test.ts` | no | timer duration rule (round up, min 1, 24 h cap), variance maths, time-zone work day, inclusive date-range boundaries, report scope, edit permissions, request validation |
| `server/tests/time.integration.test.ts` | **yes** | server-side timer (start/duplicate/stop/refresh/other device/races/24 h cap/time zones), manual logging validation, daily cap, aggregation numbers (summary, unique members/projects, by member/project), estimate vs actual variance, date-filter boundaries, role-scoped reports and history, edit/delete permissions, audit records, outsider/anonymous access |
| `server/tests/permissions.test.ts` | no | permission-matrix invariants (viewer read-only, admin = owner minus two powers, roles only gain permissions), a source scan that no route uses raw role names, a scan that the client only uses permission names that exist on the server, project-health rules and exact thresholds, overload rule, "today" sanity check |
| `server/tests/rbac.integration.test.ts` | **yes** | admin, employee and viewer dashboards with known data (every KPI, health, team, deadlines, audit summary, personal numbers, notifications, activity), viewer cannot change anything (15 write endpoints), member/admin boundaries, ownership rules, IDOR (spoofed user ids ignored), workspace isolation and 401s, My Tasks / My Projects, reports (time data withheld), roles page, security overview (flagged accounts, member-only events, no unknown-email events, TTL index) |
| `server/tests/auditUnit.test.ts` | no | audit time-window rules, query validation, CSV formula safety |
| `server/tests/audit.integration.test.ts` | **yes** | admin-only access (owner/admin 200, member/viewer 403, outsider 404, anonymous 401), who/what/when content and ordering, target names, filters, paging, exact window boundaries, immutability (no write routes; earlier rows unchanged), history kept after a project is deleted, workspace isolation, CSV export |
| `server/tests/dependencies.integration.test.ts` | **yes** | blocker validation (self, other project, unknown/malformed id, >20), chains, cycles (direct and indirect), diamond without false cycles, replace/dedupe/clear, blocker status, validation on create, role permissions, cleanup when a task is deleted |
| `client/src/pages/Dashboard.test.tsx`, `AdminPages.test.tsx`, `lib/nav.test.ts`, `components/RequirePermission.test.tsx` | no | the right dashboard and endpoint per role (admin / employee / viewer), every KPI label from the brief, viewer has no controls and no people data, exact sidebar per role, route guard, Security / Roles / My Tasks / Reports pages |
| `client/src/lib/*.test.ts`, `components/*.test.tsx` | no | permission helpers, ordering, overdue logic, dialogs and states, `parseDuration`/`formatMinutes`, form validation, timer clock with skew, variance labels, LogTimeModal (validation, submit, server error, edit), TimerPill (server-derived elapsed time, stop sends no duration), AuditLog page (rows, request window, filters, paging, empty/error/invalid-range states, CSV, admin-only), `describeAudit` and local-day windows (checked under 3 time zones), DependencyEditor (display, warning, valid choices only, add/remove, server error, read-only, 20 limit, load error) |

## Running the integration tests
Any MongoDB works: a local `mongod`, Docker (`docker run -p 27017:27017 mongo:7`), or a separate Atlas database.
They are skipped unless `MONGODB_URI_TEST` is set. **Use a throwaway database** - the tests create users, workspaces and tasks.
```bash
MONGODB_URI_TEST='mongodb://127.0.0.1:27017/flowsync-test' npm run test -w server
```

## Not set up
Playwright end-to-end tests, coverage thresholds, accessibility audits.
