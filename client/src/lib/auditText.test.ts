import { describe, expect, it } from 'vitest';
import { format } from 'date-fns';
import { describeAudit, localDayRangeToInstants, type AuditEntry } from './auditText';

const base: AuditEntry = { _id: '1', action: '', createdAt: '2026-10-29T10:00:00Z', meta: {}, actor: { _id: 'a', name: 'Asha' }, project: null, task: null, target: null };
const e = (action: string, meta: Record<string, unknown> = {}, extra: Partial<AuditEntry> = {}): AuditEntry => ({ ...base, action, meta, ...extra });
const ben = { _id: 'b', name: 'Ben' };

describe('describeAudit', () => {
  it('describes workspace and member changes using the person involved', () => {
    expect(describeAudit(e('workspace.created'))).toBe('created the workspace');
    expect(describeAudit(e('workspace.updated', { fields: ['name', 'description'] }))).toBe('updated workspace settings (name, description)');
    expect(describeAudit(e('member.added', { role: 'viewer' }, { target: ben }))).toBe('added Ben as viewer');
    expect(describeAudit(e('member.role_changed', { role: 'admin' }, { target: ben }))).toBe("changed Ben's role to admin");
    expect(describeAudit(e('member.removed', {}, { target: ben }))).toBe('removed Ben from the workspace');
  });

  it('describes tasks from the saved details, even after the live task changed or vanished', () => {
    const live = { key: 'WEB-9', title: 'RENAMED LATER' };
    expect(describeAudit(e('task.created', { key: 'WEB-1', title: 'Original title' }, { task: live }))).toBe('created task WEB-1: Original title');
    expect(describeAudit(e('task.deleted', { key: 'WEB-1', title: 'Gone' }))).toBe('deleted task WEB-1: Gone');
    expect(describeAudit(e('task.moved', { key: 'WEB-2', from: 'todo', to: 'in_progress' }))).toBe('moved WEB-2 from To Do to In Progress');
    expect(describeAudit(e('task.updated', { key: 'WEB-2', fields: ['title', 'priority'] }))).toBe('updated task WEB-2 (title, priority)');
    expect(describeAudit(e('comment.created', { key: 'WEB-2' }))).toBe('commented on WEB-2');
  });

  it('describes projects, including ones that no longer exist', () => {
    expect(describeAudit(e('project.created', { name: 'Website' }))).toBe('created project “Website”');
    expect(describeAudit(e('project.deleted', { name: 'Website' }))).toBe('deleted project “Website”');
    expect(describeAudit(e('project.updated', { fields: ['status'] }, { project: { _id: 'p', name: 'Website', key: 'WEB' } }))).toBe('updated project WEB (status)');
    expect(describeAudit(e('project.updated', { fields: ['status'] }))).toBe('updated project (status)');
  });

  it('describes time entries with before/after values and whose entry it was', () => {
    expect(describeAudit(e('time.created', { key: 'WEB-1', minutes: 90, date: '2026-10-29' }))).toBe('logged 1h 30m on WEB-1 for 2026-10-29');
    const changed = { before: { minutes: 60, note: 'a', date: '2026-10-28' }, after: { minutes: 120, note: 'a', date: '2026-10-29' } };
    expect(describeAudit(e('time.updated', changed, { target: ben }))).toBe("edited Ben's time entry: 1h → 2h, date 2026-10-28 → 2026-10-29");
    expect(describeAudit(e('time.updated', { before: { minutes: 60, note: 'x', date: 'd' }, after: { minutes: 60, note: 'y', date: 'd' } }, { target: { _id: 'a', name: 'Asha' } }))).toBe('edited their own time entry: description');
    expect(describeAudit(e('time.deleted', { minutes: 45, date: '2026-10-20' }, { target: ben }))).toBe("deleted Ben's 45m time entry from 2026-10-20");
    expect(describeAudit(e('timer.started', { key: 'WEB-1' }))).toBe('started a timer on WEB-1');
    expect(describeAudit(e('timer.stopped', { key: 'WEB-1', minutes: 1440, capped: true }))).toBe('stopped a timer on WEB-1 and logged 24h (capped at 24h)');
    expect(describeAudit(e('timer.discarded'))).toBe('discarded a running timer');
  });

  it('never throws on missing or unexpected data', () => {
    expect(describeAudit(e('something.new'))).toBe('something.new');
    expect(describeAudit({ ...base, action: 'task.moved', meta: undefined as never })).toContain('moved');
    expect(() => describeAudit(e('time.updated', { before: null, after: 5 } as never))).not.toThrow();
  });
});

describe('localDayRangeToInstants', () => {
  it('uses the user\'s own local midnight for both ends, in any time zone', () => {
    const r = localDayRangeToInstants('2026-10-23', '2026-10-29');
    expect(format(new Date(r.from), 'yyyy-MM-dd HH:mm')).toBe('2026-10-23 00:00');
    expect(format(new Date(r.to), 'yyyy-MM-dd HH:mm')).toBe('2026-10-30 00:00'); // exclusive: start of the day after the last day
  });
  it('a single day spans exactly one local day', () => {
    const r = localDayRangeToInstants('2026-10-29', '2026-10-29');
    expect(format(new Date(r.from), 'yyyy-MM-dd HH:mm')).toBe('2026-10-29 00:00');
    expect(format(new Date(r.to), 'yyyy-MM-dd HH:mm')).toBe('2026-10-30 00:00');
  });
  it('crosses month and year ends', () => {
    const r = localDayRangeToInstants('2026-12-31', '2026-12-31');
    expect(format(new Date(r.to), 'yyyy-MM-dd HH:mm')).toBe('2027-01-01 00:00');
  });
});
