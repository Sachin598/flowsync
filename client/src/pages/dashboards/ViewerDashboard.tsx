import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Eye } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, errorMessage } from '../../lib/api';
import { dashParams } from '../../lib/dashParams';
import { healthOrder } from '../../lib/health';
import { STATUSES, STATUS_COLORS } from '../../lib/utils';
import { useWorkspace } from '../../hooks/useWorkspace';
import { usePermissions } from '../../hooks/usePermissions';
import { ErrorState, Skeleton } from '../../components/ui';
import { Empty, HealthBadge, KpiCard, Progress, Section } from './shared';
import type { ProjectRow } from './AdminDashboard';

interface Viewer {
  kpis: { projects: number; activeProjects: number; tasks: number; completed: number; pending: number; overdue: number; completionPct: number };
  tasksByStatus: { status: string; count: number }[]; projects: ProjectRow[];
  upcomingDeadlines: { _id: string; key: string; title: string; dueDate: string; project: string }[];
}

/** Read-only overview: progress and health of what the viewer is permitted to see. No people-level data, no editing controls. */
export default function ViewerDashboard() {
  const { current } = useWorkspace();
  const { can } = usePermissions();
  const q = useQuery({
    queryKey: ['dashboard', 'viewer', current?._id], enabled: !!current,
    queryFn: async () => (await api.get<Viewer>('/dashboard/viewer', { params: dashParams(current!._id) })).data,
  });
  const banner = <p className="flex items-center gap-2 rounded-lg bg-slate-100 p-2 text-sm dark:bg-slate-800"><Eye className="h-4 w-4" /> You have read-only access to this workspace.</p>;
  if (q.isLoading) return <div className="space-y-6"><h1 className="text-2xl font-semibold">Overview</h1><div className="grid grid-cols-2 gap-4 md:grid-cols-4">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div></div>;
  if (q.isError) return <div className="space-y-6"><h1 className="text-2xl font-semibold">Overview</h1><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></div>;
  const d = q.data!;
  const k = d.kpis;
  const projects = [...d.projects].sort((a, b) => healthOrder[a.health.level] - healthOrder[b.health.level]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Overview</h1>{can('reports.view') && <Link className="btn-ghost" to="/reports">View reports</Link>}</div>
      {banner}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Projects" value={k.projects} tone="indigo" />
        <KpiCard label="Active Projects" value={k.activeProjects} tone="emerald" />
        <KpiCard label="Total Tasks" value={k.tasks} tone="blue" />
        <KpiCard label="Completed Tasks" value={k.completed} tone="green" />
        <KpiCard label="Pending Tasks" value={k.pending} tone="amber" />
        <KpiCard label="Overdue Tasks" value={k.overdue} tone="red" />
        <KpiCard label="Overall Completion" value={`${k.completionPct}%`} tone="emerald" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Tasks by status">
          {k.tasks === 0 ? <Empty>No tasks yet.</Empty> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={STATUSES.map((s) => ({ id: s.id, name: s.label, count: d.tasksByStatus.find((x) => x.status === s.id)?.count ?? 0 }))}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} /><XAxis dataKey="name" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>{STATUSES.map((s) => <Cell key={s.id} fill={STATUS_COLORS[s.id]} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Section>
        <Section title="Upcoming deadlines (7 days)">
          {d.upcomingDeadlines.length === 0 ? <Empty>Nothing due soon.</Empty> : (
            <ul className="space-y-2 text-sm">{d.upcomingDeadlines.map((t) => <li key={t._id} className="flex justify-between gap-2"><Link className="truncate hover:underline" to={`/projects/${t.project}`}>{t.key} {t.title}</Link><span className="shrink-0 text-slate-500">{format(new Date(t.dueDate.slice(0, 10) + 'T00:00:00'), 'MMM d')}</span></li>)}</ul>
          )}
        </Section>
      </div>
      <Section title="Project progress and health">
        {projects.length === 0 ? <Empty>No projects yet.</Empty> : (
          <ul className="space-y-4">{projects.map((p) => (
            <li key={p.id}>
              <div className="mb-1 flex items-center justify-between gap-2 text-sm"><Link className="hover:underline" to={`/projects/${p.id}`}>{p.name} <span className="text-slate-500">({p.key})</span></Link><span className="flex items-center gap-2"><span className="text-slate-500">{p.progress}% · {p.done}/{p.tasks}</span><HealthBadge level={p.health.level} /></span></div>
              <Progress value={p.progress} label={`${p.name} progress`} />
              {p.health.reasons.length > 0 && <p className="mt-1 text-xs text-slate-500">{p.health.reasons.join(' · ')}</p>}
            </li>
          ))}</ul>
        )}
      </Section>
    </div>
  );
}
