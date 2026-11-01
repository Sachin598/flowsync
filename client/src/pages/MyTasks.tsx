import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { api, errorMessage } from '../lib/api';
import { useWorkspace } from '../hooks/useWorkspace';
import { EmptyState, ErrorState, Skeleton } from '../components/ui';
import { STATUSES, STATUS_COLORS, isOverdue, priorityClass, statusLabel } from '../lib/utils';
import type { Priority } from '../types';

interface Row { _id: string; key: string; title: string; status: string; priority: Priority; dueDate?: string; project: string; projectName?: string; estimateHours: number }
interface Page { tasks: Row[]; page: number; pages: number; total: number }

/** Tasks assigned to the signed-in user across the workspace. The server always filters by the authenticated user. */
export default function MyTasks() {
  const { current } = useWorkspace();
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['myTasks', current?._id, status, page], enabled: !!current,
    queryFn: async () => (await api.get<Page>('/tasks/mine', { params: { workspaceId: current!._id, status, page, limit: 20 } })).data,
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">My tasks</h1>
        <div><label className="sr-only" htmlFor="mt-status">Show</label>
          <select id="mt-status" className="input w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="open">All open tasks</option>
            {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
      </div>
      {q.isLoading ? <Skeleton className="h-64" /> : q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : q.data!.tasks.length === 0 ? (
        <EmptyState title={status === 'open' ? 'No open tasks assigned to you' : 'No tasks with this status'} hint="Tasks assigned to you appear here, soonest due first." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800"><tr><th className="p-3">Task</th><th className="p-3">Project</th><th className="p-3">Status</th><th className="p-3">Priority</th><th className="p-3">Due</th></tr></thead>
            <tbody>
              {q.data!.tasks.map((t) => (
                <tr key={t._id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="p-3"><Link className="hover:underline" to={`/projects/${t.project}`}>{t.key} {t.title}</Link></td>
                  <td className="p-3 text-slate-500">{t.projectName ?? '—'}</td>
                  <td className="p-3"><span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[t.status] }} />{statusLabel(t.status)}</span></td>
                  <td className="p-3"><span className={`rounded px-1.5 py-0.5 text-xs ${priorityClass[t.priority]}`}>{t.priority}</span></td>
                  <td className={`p-3 ${isOverdue(t.dueDate, t.status) ? 'font-medium text-red-600' : 'text-slate-500'}`}>{t.dueDate ? format(new Date(t.dueDate.slice(0, 10) + 'T00:00:00'), 'MMM d, yyyy') : '—'}{isOverdue(t.dueDate, t.status) ? ' (overdue)' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between p-3 text-sm text-slate-500">
            <span>{q.data!.total} tasks</span>
            <div className="flex items-center gap-2">
              <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
              <span>Page {q.data!.page} of {Math.max(1, q.data!.pages)}</span>
              <button className="btn-ghost" disabled={page >= q.data!.pages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
