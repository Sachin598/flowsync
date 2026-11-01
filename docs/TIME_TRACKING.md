# Time tracking & workload - rules and behaviour

## Data model (reused, one new collection)
- **TimeEntry** (existing, extended): `workspace`, `project`, `task`, `user` references; `minutes`; `note` (shown as "Description"); `date` (work day); new: `source` (`timer` | `manual`), `startedAt`/`endedAt` (timer entries), `timezone`.
- **ActiveTimer** (new): one row per running timer - `user`, `workspace`, `project`, `task`, `startedAt`, `timezone`, `note`. A separate collection is used because a running timer has no duration yet and must not be counted by any total. A **unique index on `user`** guarantees one active timer per person, even when requests race.
- **Activity** (existing) is the audit log: `timer.started`, `timer.stopped`, `timer.discarded`, `time.created`, `time.updated` (with `before`/`after`), `time.deleted` (with the removed values).

## Duration rules
| Case | Rule |
|---|---|
| Timer | `elapsed = server stop time - server start time` (both taken from the **server clock**, never from the browser). `minutes = elapsed rounded UP to a whole minute`, minimum 1, maximum 1440. If the real elapsed time exceeded 24 h the entry is capped at 1440 and the response has `capped: true`. The stop endpoint has **no duration field**; anything the client sends is ignored. |
| Manual | whole minutes, 1 to 1440 per entry. The UI accepts `45m`, `1h30m`, `1.5h`, `1:30`, `90` and converts to minutes; the server validates the number again. |
| Daily cap | One user cannot hold more than 1440 minutes on one work day (across all workspaces). Applies to timer stops, manual entries and edits. |
| Dates | A manual date must be a real calendar day (`YYYY-MM-DD`), not more than 1 day in the future (slack for time zones) and not older than 400 days. |

## Work day and time zones
- An entry's `date` is a **calendar day** stored as UTC midnight of that day, so day-based filtering is identical on every server and browser.
- **Manual entries:** the day the user picked.
- **Timer entries:** the calendar day of `startedAt` in the IANA time zone the browser reported when the timer was started (invalid zones are rejected; default UTC). A timer that runs past midnight belongs to the day it started.
- **Range filters** use plain `YYYY-MM-DD` strings end to end and are **inclusive of both days**: the server converts them to the half-open UTC interval `[from, to + 1 day)`. Max range 366 days; reversed or impossible dates return 400. Report and history use the same function.

## Timer behaviour
- State lives in MongoDB. After a refresh, in another tab or on another device the same timer is shown; elapsed time is derived from the server's `startedAt` and corrected for clock skew using the server's `serverNow`.
- Starting a second timer returns **409** (naming the task already running). Parallel starts: exactly one succeeds.
- Stopping takes the timer atomically (`findOneAndDelete`), so double clicks / two tabs can log it only once. Authorization is re-checked at stop time. If saving fails for a transient reason the timer is put back; if the task was deleted or access was lost the timer is dropped.
- A timer whose task disappeared or whose owner lost write access is removed the next time it is read.
- `DELETE /time-entries/timer` discards a timer without logging.

## Who can see and change what
| Role | Reports & history | Create | Edit / delete |
|---|---|---|---|
| owner / admin | everyone's time; estimate vs actual and variance | yes | any entry |
| member | **own time only**; variance hidden | yes | own entries |
| viewer | own time only (normally none) | no | no |
| not a member | 404 on everything | no | no |

A task's all-time total (shown in the task dialog) includes everyone's time; individual rows of other people are not shown to non-admins.

## Aggregations (all computed in MongoDB, scoped before grouping)
- **Total logged** = sum of `minutes` in range. **Members with time** / **Projects with time** = number of distinct `user` / `project` values among those entries (`$addToSet`).
- **By member** = group by user. **By project** = group by project (all non-archived projects listed, including zero rows).
- **Estimate vs actual (admins):** for the tasks that had at least one entry in the range: `Estimate` = sum of their `estimateHours`; `Actual` = **all-time** minutes logged on those same tasks; `Variance = Actual - Estimate` (positive = over); `Variance % = Variance / Estimate` (null when the estimate is 0). Tasks without an estimate are counted and flagged as "unestimated" so the number is not silently misleading. `Logged in range` is a different scope (only entries dated inside the range) and is shown separately.

## Known limitations
See the end of this file's section in docs/FEATURES.md (module 12).
