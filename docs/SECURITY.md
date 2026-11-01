# Security design

Implemented
- **Centralized RBAC** (`server/src/permissions.ts`): every protected endpoint checks authentication, workspace membership and a named permission; the client only mirrors the server's permission list for display. Tests cover each role, a viewer's inability to change anything, and cross-workspace access (404). See [PERMISSIONS.md](PERMISSIONS.md).
- Personal endpoints never accept a user id; spoofed ids are ignored (tested).
- Client-supplied `today`/`timezone` are validated and cannot widen access.
- **Security events** (sign-ins, failed sign-ins, password changes, sessions revoked) are recorded per account, shown to workspace admins for their own members only, and expire after 180 days.
- Passwords hashed with bcrypt (cost 12); hashes never selected by default or logged. Login timing is equalised for unknown emails.
- Sessions: signed JWT in an `httpOnly`, `Secure` (prod) cookie. Each token embeds `tokenVersion`; changing the password or "sign out everywhere" increments it, revoking all tokens. Deactivated users are rejected.
- CSRF: state-changing requests must carry `X-Requested-With: FlowSync`; CORS only allows `CLIENT_URL` with credentials.
- Authorization on every route through `services/access.ts`. Resources the caller cannot access return **404** (no id probing). Roles: viewer < member < admin < owner; only the owner can grant/modify admins; the owner cannot be removed or demoted.
- Socket.IO: connections authenticated by cookie; joining a project room re-checks membership.
- Input validation with Zod on all bodies/queries; ObjectIds validated; user text escaped before use in regex search; Mongoose strict schemas; bounded arrays; 100 kB body limit.
- Helmet headers, global and stricter auth rate limits, central error handler that hides internals, pino log redaction of cookies/passwords.
- CSV export neutralises spreadsheet formula injection.
- Env validated at startup; `.env` files are git-ignored; no secrets in the client.

Known gaps (do before real production use)
- No email verification or password reset; no account lockout beyond rate limiting (the security dashboard flags repeated failed sign-ins, it does not block them).
- No per-project permissions: access is per workspace.
- No file uploads (so no upload validation yet).
- Audit log: admin-only page and read-only API exist, and rows are append-only through the API and survive project/task deletion. Not yet done: account security events (login, password change), tamper-evidence against someone with direct database access, retention policy.
- JWT cookies last 7 days with no refresh rotation.
- Dependency audit (`npm audit`) has not been triaged.
