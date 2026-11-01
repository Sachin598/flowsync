import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '../lib/api';
import { dashParams } from '../lib/dashParams';
import { healthOrder } from '../lib/health';
import { formatMinutes } from '../lib/utils';
import { useWorkspace } from '../hooks/useWorkspace';
import { usePermissions } from '../hooks/usePermissions';
import { EmptyState, ErrorState, Skeleton } from '../components/ui';
import { HealthBadge, Progress } from './dashboards/shared';
import type { ProjectRow } from './dashboards/AdminDashboard';

/** Project performance report. Project-level numbers only; logged hours appear only for people allowed to see time data. */
export default function Reports() {
  const { current } = useWorkspace();
  const { can } = usePermissions();
  const q = useQuery({
    queryKey: ['reports', current?._id], enabled: !!current,
    queryFn: async () => { const { workspaceId, today } = dashParams(current!._id); return (await api.get<{ projects: ProjectRow[] }>('/reports/projects', { params: { workspaceId, today } })).data.projects; },
  });
  async function exportCsv() {
    try {
      const { workspaceId, today } = dashParams(current!._id);
      const res = await api.get('/reports/projects/export.csv', { params: { workspaceId, today }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = 'project-report.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error(errorMessage(e)); }
  }
  const rows = [...(q.data ?? [])].sort((a, b) => healthOrder[a.health.level] - healthOrder[b.health.level]);
  const showTime = rows.some((r) => r.loggedMinutes !== null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <div className="flex gap-2">
          {can('time.log') && <Link className="btn-ghost" to="/time">Time &amp; workload report</Link>}
          {can('audit.view') && <Link className="btn-ghost" to="/audit">Audit log</Link>}
          <button className="btn-ghost" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" /> Export CSV</button>
        </div>
      </div>
      {q.isLoading ? <Skeleton className="h-64" /> : q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : rows.length === 0 ? <EmptyState title="No projects to report on" hint="Create a project and add tasks." /> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="p-3 text-left font-medium">Project performance</caption>
            <thead className="border-y border-slate-200 text-slate-500 dark:border-slate-800">
              <tr><th className="p-3">Project</th><th className="p-3">Progress</th><th className="p-3">Tasks</th><th className="p-3">Overdue</th><th className="p-3">Open estimate</th>{showTime && <th className="p-3">Logged</th>}<th className="p-3">Health</th></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="p-3"><Link className="hover:underline" to={`/projects/${p.id}`}>{p.name}</Link> <span className="text-slate-500">({p.key})</span>{p.health.reasons.length > 0 && <span className="block text-xs text-slate-500">{p.health.reasons.join(' · ')}</span>}</td>
                  <td className="w-40 p-3"><Progress value={p.progress} label={`${p.name} progress`} /><span className="text-xs text-slate-500">{p.progress}% ({p.done}/{p.tasks})</span></td>
                  <td className="p-3">{p.tasks}</td><td className={`p-3 ${p.overdue ? 'font-medium text-red-600' : ''}`}>{p.overdue}</td><td className="p-3">{p.openEstimateHours}h</td>
                  {showTime && <td className="p-3">{formatMinutes(p.loggedMinutes ?? 0)}</td>}<td className="p-3"><HealthBadge level={p.health.level} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">Health is rule-based (overdue share of open tasks, schedule slip, end date) and each flag lists its reasons.</p>
    </div>
  );
}
