# Database (MongoDB / Mongoose)

```
User 1--* Membership *--1 Workspace 1--* Project 1--* Task 1--* Comment
User 1--* Notification        Task *--* Task (blockedBy, max 20 ids, same project)
Workspace/Project/Task 1--* Activity (also serves as audit trail)
```

| Model | Key fields | Indexes |
|---|---|---|
| User | name, email (unique), passwordHash (select:false), tokenVersion, isActive, notificationPrefs | email unique |
| Workspace | name, description, owner | - |
| Membership | workspace, user, role (viewer/member/admin/owner) | (workspace,user) unique; user |
| Project | workspace, name, key (2-5 letters), status, priority, owner, dates, taskCounter | (workspace,key) unique; (workspace,status) |
| Task | workspace, project, key (e.g. WEB-12), number, title, description, status, priority, assignee, creator, dueDate, estimateHours, labels (<=10), position, blockedBy (<=20), completedAt | (project,number) unique; (project,status,position); (workspace,assignee,status); (workspace,dueDate); text(title,description) |
| Comment | workspace, project, task, author, body, mentions | (task,createdAt) |
| Notification | user, type, message, link, read | (user,read,createdAt) |
| TimeEntry | workspace, project, task, user, minutes (1-1440 integer), note, date (work day, UTC midnight), source (timer/manual), startedAt/endedAt (timer), timezone | (task,date); (workspace,date); (user,date) |
| ActiveTimer | workspace, project, task, user, startedAt (server clock), timezone, note | **user unique** (one running timer per person) |
| Activity (audit trail) | workspace, project?, task?, actor, action, meta | (workspace,createdAt); (project,createdAt) |

Design notes: task keys use an atomic `$inc` on `Project.taskCounter`. Arrays are bounded. There are no foreign keys in MongoDB, so deleting a workspace/project/task cascades manually in the route handlers. Activity records are never edited or deleted through the API (a dedicated admin audit-log UI is not built yet).

Not modelled yet: Invitation, Attachment, Sprint, Milestone, AutomationRule, ProjectTemplate, SavedFilter, Goal/KeyResult, password-reset tokens.

## Activity = audit trail
`Activity` rows are append-only by design: no route edits or deletes them. They are **kept** when a project or task is deleted (references simply no longer resolve) and are removed only when the entire workspace is deleted. Extra indexes: `(workspace, actor, createdAt)` and `(workspace, action, createdAt)` for the audit filters. Details needed to read an old row (task key/title, project name, before/after values) are stored in `meta` at write time rather than looked up live.

## SecurityEvent
`user`, `type` (`register`, `login_success`, `login_failed`, `password_changed`, `sessions_revoked`), `ip`, `userAgent`, `createdAt`. Only events attributable to a real account are stored. Indexes: `(user, createdAt)` and a **TTL index on `createdAt` that deletes rows after 180 days**.
