import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { format, startOfMonth, subDays } from 'date-fns';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, errorMessage } from '../lib/api';
import { useWorkspace } from '../hooks/useWorkspace';
import { ConfirmDialog, EmptyState, ErrorState, Skeleton } from '../components/ui';
import { LogTimeModal, type EditableEntry } from '../components/LogTimeModal';
import { toneClass, varianceLabel } from '../lib/timeForm';
import { formatMinutes } from '../lib/utils';
import { usePermissions } from '../hooks/usePermissions';

interface Variance { estimateMinutes: number | null; actualMinutes: number | null; varianceMinutes: number | null; variancePct: number | null }
interface Report {
  scope: 'all' | 'self';
  summary: { totalMinutes: number; entryCount: number; memberCount: number; projectCount: number };
  byUser: { userId: string; name: string; minutes: number; entries: number }[];
  byProject: (Variance & { projectId: string; name: string; key: string; minutes: number; tasksWorked: number | null; unestimatedTasks: number | null })[];
  overall: (Variance & { unestimatedTasks: number }) | null;
}
interface HistoryRow {
  _id: string; minutes: number; note: string; date: string; source: 'timer' | 'manual'; canEdit: boolean;
  user: { _id: string; name: string }; task: { key: string; title: string }; project: { name: string; key: string };
}
interface History { scope: 'all' | 'self'; total: number; pages: number; page: number; entries: HistoryRow[] }

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6', '#ec4899'];
// Dates are plain YYYY-MM-DD strings end to end: they are never converted through Date/UTC, so ranges cannot shift by timezone.
const day = (d: Date) => format(d, 'yyyy-MM-dd');

export default function TimeReport() {
  const { current } = useWorkspace();
  const { can } = usePermissions();
  const qc = useQueryClient();
  const [from, setFrom] = useState(() => day(subDays(new Date(), 6)));
  const [to, setTo] = useState(() => day(new Date()));
  const [page, setPage] = useState(1);
  const [logOpen, setLogOpen] = useState(false);
  const [editing, setEditing] = useState<EditableEntry | null>(null);
  const [deleting, setDeleting] = useState<HistoryRow | null>(null);
  const valid = !!from && !!to && from <= to;
  const wsId = current?._id;

  const report = useQuery({
    queryKey: ['timeReport', wsId, from, to], enabled: !!wsId && valid,
    queryFn: async () => (await api.get<Report>('/time-entries/report', { params: { workspaceId: wsId, from, to } })).data,
  });
  const history = useQuery({
    queryKey: ['timeHistory', wsId, from, to, page], enabled: !!wsId && valid,
    queryFn: async () => (await api.get<History>('/time-entries/history', { params: { workspaceId: wsId, from, to, page, limit: 15 } })).data,
  });
  const refresh = () => { for (const k of ['timeReport', 'timeHistory', 'time']) qc.invalidateQueries({ queryKey: [k] }); };
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/time-entries/${id}`),
    onSuccess: () => { setDeleting(null); toast.success('Time entry deleted'); refresh(); },
    onError: (e) => { setDeleting(null); toast.error(errorMessage(e)); },
  });

  if (!current) return <EmptyState title="Create a workspace first" action={<Link className="btn-primary" to="/workspaces">Create workspace</Link>} />;
  const setRange = (f: string, t: string) => { setFrom(f); setTo(t); setPage(1); };
  const data = report.data;
  const self = data?.scope === 'self';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Time &amp; workload</h1>
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="label" htmlFor="tr-from">From</label><input id="tr-from" type="date" className="input" value={from} max={to || undefined} onChange={(e) => setRange(e.target.value, to)} /></div>
          <div><label className="label" htmlFor="tr-to">To</label><input id="tr-to" type="date" className="input" value={to} min={from || undefined} onChange={(e) => setRange(from, e.target.value)} /></div>
          <button className="btn-ghost" onClick={() => setRange(day(subDays(new Date(), 6)), day(new Date()))}>Last 7 days</button>
          <button className="btn-ghost" onClick={() => setRange(day(startOfMonth(new Date())), day(new Date()))}>This month</button>
          {can('time.log') && <button className="btn-primary" onClick={() => setLogOpen(true)}><Plus className="h-4 w-4" /> Log time</button>}
        </div>
      </div>
      {!valid && <p role="alert" className="text-sm text-red-600">Choose a valid range: &ldquo;From&rdquo; must be on or before &ldquo;To&rdquo;.</p>}
      {self && <p className="rounded-lg bg-slate-100 p-2 text-sm dark:bg-slate-800">You are seeing your own time only. Workspace admins see everyone&apos;s time and estimate variance.</p>}

      {valid && (report.isLoading ? <Skeleton className="h-64" /> : report.isError ? <ErrorState message={errorMessage(report.error)} onRetry={() => report.refetch()} /> : data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="card border-t-4 border-indigo-500 p-4"><p className="text-sm text-slate-500">Total logged</p><p className="text-2xl font-bold text-indigo-600">{formatMinutes(data.summary.totalMinutes)}</p><p className="text-xs text-slate-500">{data.summary.entryCount} entries</p></div>
            <div className="card border-t-4 border-emerald-500 p-4"><p className="text-sm text-slate-500">Members with time</p><p className="text-2xl font-bold text-emerald-600">{data.summary.memberCount}</p></div>
            <div className="card border-t-4 border-amber-500 p-4"><p className="text-sm text-slate-500">Projects with time</p><p className="text-2xl font-bold text-amber-600">{data.summary.projectCount}</p></div>
          </div>

          {data.summary.totalMinutes === 0 ? (
            <EmptyState title="No time logged in this range" hint="Use Log time here, or open a task and press Start timer." />
          ) : (
            <div className="card p-4">
              <h2 className="mb-3 font-medium">Hours by member</h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.byUser.map((u) => ({ name: u.name, hours: Math.round((u.minutes / 60) * 10) / 10 }))}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} /><XAxis dataKey="name" fontSize={12} /><YAxis fontSize={12} /><Tooltip />
                  <Bar dataKey="hours" radius={[4, 4, 0, 0]}>{data.byUser.map((u, i) => <Cell key={u.userId} fill={COLORS[i % COLORS.length]} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-5">
            <div className="card overflow-x-auto xl:col-span-2">
              <table className="w-full text-left text-sm">
                <caption className="p-3 text-left font-medium">By member</caption>
                <thead className="border-y border-slate-200 text-slate-500 dark:border-slate-800"><tr><th className="p-3">Member</th><th className="p-3">Logged</th><th className="p-3">Entries</th></tr></thead>
                <tbody>{data.byUser.length === 0 ? <tr><td className="p-3 text-slate-500" colSpan={3}>Nothing logged in this range.</td></tr> : data.byUser.map((u) => (
                  <tr key={u.userId} className="border-b border-slate-100 last:border-0 dark:border-slate-800"><td className="p-3">{u.name}</td><td className="p-3">{formatMinutes(u.minutes)}</td><td className="p-3">{u.entries}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className="card overflow-x-auto xl:col-span-3">
              <table className="w-full text-left text-sm">
                <caption className="p-3 text-left font-medium">By project &mdash; estimated vs actual</caption>
                <thead className="border-y border-slate-200 text-slate-500 dark:border-slate-800">
                  <tr><th className="p-3">Project</th><th className="p-3">Logged in range</th><th className="p-3" title="Sum of estimates of tasks worked on in this range">Estimate</th><th className="p-3" title="All-time time logged on those same tasks">Actual</th><th className="p-3" title="Actual minus estimate">Variance</th></tr>
                </thead>
                <tbody>
                  {data.byProject.length === 0 && <tr><td className="p-3 text-slate-500" colSpan={5}>No projects yet.</td></tr>}
                  {data.byProject.map((p) => {
                    const v = varianceLabel(p);
                    return (
                      <tr key={p.projectId} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="p-3">{p.name} <span className="text-slate-500">({p.key})</span></td>
                        <td className="p-3">{formatMinutes(p.minutes)}</td>
                        <td className="p-3">{p.tasksWorked ? formatMinutes(p.estimateMinutes ?? 0) : '—'}</td>
                        <td className="p-3">{p.tasksWorked ? formatMinutes(p.actualMinutes ?? 0) : '—'}</td>
                        <td className={`p-3 ${toneClass[p.tasksWorked ? v.tone : 'none']}`}>{p.tasksWorked ? v.text : '—'}{!!p.unestimatedTasks && <span className="ml-1 text-xs text-amber-600" title="Tasks with no estimate"> {p.unestimatedTasks} unestimated</span>}</td>
                      </tr>
                    );
                  })}
                  {data.overall && data.overall.actualMinutes! > 0 && (
                    <tr className="font-medium"><td className="p-3">Total</td><td className="p-3">{formatMinutes(data.summary.totalMinutes)}</td><td className="p-3">{formatMinutes(data.overall.estimateMinutes!)}</td><td className="p-3">{formatMinutes(data.overall.actualMinutes!)}</td><td className={`p-3 ${toneClass[varianceLabel(data.overall).tone]}`}>{varianceLabel(data.overall).text}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Estimate and Actual cover the tasks that had time logged in the selected range: Estimate is those tasks&apos; planned hours, Actual is all time ever logged on them, and Variance is Actual minus Estimate (positive = over). &ldquo;Logged in range&rdquo; counts only entries dated inside the range.
            {self && ' Estimate and variance are shown to workspace admins only.'}
          </p>
        </>
      ))}

      {valid && (
        <div className="card overflow-x-auto">
          <h2 className="p-3 font-medium">Time entry history</h2>
          {history.isLoading ? <div className="p-3"><Skeleton className="h-24" /></div> : history.isError ? <div className="p-3"><ErrorState message={errorMessage(history.error)} onRetry={() => history.refetch()} /></div> : history.data!.entries.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No entries in this range.</p>
          ) : (
            <>
              <table className="w-full text-left text-sm">
                <thead className="border-y border-slate-200 text-slate-500 dark:border-slate-800"><tr><th className="p-3">Date</th>{history.data!.scope === 'all' && <th className="p-3">Member</th>}<th className="p-3">Task</th><th className="p-3">Duration</th><th className="p-3">Description</th><th className="p-3">Source</th><th className="p-3"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {history.data!.entries.map((en) => (
                    <tr key={en._id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                      <td className="whitespace-nowrap p-3">{format(new Date(`${en.date.slice(0, 10)}T00:00:00`), 'MMM d, yyyy')}</td>
                      {history.data!.scope === 'all' && <td className="p-3">{en.user.name}</td>}
                      <td className="p-3"><span className="text-slate-500">{en.project.key}</span> {en.task.key} {en.task.title}</td>
                      <td className="p-3 font-medium">{formatMinutes(en.minutes)}</td>
                      <td className="max-w-48 truncate p-3 text-slate-500">{en.note || '—'}</td>
                      <td className="p-3"><span className={`rounded px-1.5 py-0.5 text-xs ${en.source === 'timer' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 dark:bg-slate-800'}`}>{en.source}</span></td>
                      <td className="whitespace-nowrap p-3 text-right">
                        {en.canEdit && can('time.log') ? (
                          <>
                            <button className="mr-3 text-brand-600 hover:underline" onClick={() => setEditing({ _id: en._id, minutes: en.minutes, note: en.note, date: en.date, task: en.task, project: en.project })}>Edit</button>
                            <button className="text-red-600 hover:underline" onClick={() => setDeleting(en)}>Delete</button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between p-3 text-sm text-slate-500">
                <span>{history.data!.total} entries</span>
                <div className="flex items-center gap-2">
                  <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
                  <span>Page {history.data!.page} of {Math.max(1, history.data!.pages)}</span>
                  <button className="btn-ghost" disabled={page >= history.data!.pages} onClick={() => setPage(page + 1)}>Next</button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {logOpen && <LogTimeModal workspaceId={current._id} onClose={() => setLogOpen(false)} onSaved={refresh} />}
      {editing && <LogTimeModal workspaceId={current._id} entry={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {deleting && <ConfirmDialog title="Delete time entry?" message={`${formatMinutes(deleting.minutes)} on ${deleting.date.slice(0, 10)} (${deleting.task.key}) will be removed. This is recorded in the audit log.`} busy={remove.isPending} onConfirm={() => remove.mutate(deleting._id)} onClose={() => setDeleting(null)} />}
    </div>
  );
}
