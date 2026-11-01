import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, errorMessage } from '../../lib/api';
import { dashParams } from '../../lib/dashParams';
import { describeAudit, type AuditEntry } from '../../lib/auditText';
import { healthOrder, type HealthLevel } from '../../lib/health';
import { PRIORITY_COLORS, STATUSES, STATUS_COLORS, formatMinutes, statusLabel } from '../../lib/utils';
import { useWorkspace } from '../../hooks/useWorkspace';
import { ErrorState, Skeleton } from '../../components/ui';
import { Empty, HealthBadge, KpiCard, Progress, Section } from './shared';
import MemberDashboard from './MemberDashboard';

export interface ProjectRow {
  id: string; name: string; key: string; status: string; priority: string; tasks: number; done: number; overdue: number; progress: number;
  openEstimateHours: number; loggedMinutes: number | null; health: { level: HealthLevel; reasons: string[]; expectedProgress: number | null };
}
interface Admin {
  kpis: { projects: number; activeProjects: number; members: number; tasks: number; completed: number; pending: number; overdue: number; completionPct: number };
  tasksByStatus: { status: string; count: number }[]; tasksByPriority: { priority: string; count: number }[]; completionTrend: { date: string; completed: number }[];
  projects: ProjectRow[];
  team: { userId: string; name: string; role: string; openTasks: number; overdue: number; openEstimateHours: number; completed30d: number; onTimePct: number | null; loggedMinutes7d: number; overloaded: boolean }[];
  upcomingDeadlines: { _id: string; key: string; title: string; dueDate: string; project: string; assignee?: { name: string } | null }[];
  recentActivity: AuditEntry[];
  audit: { events7d: number; destructive7d: number; byCategory: { category: string; count: number }[]; topActors: { userId: string; name: string; count: number }[] };
}

export default function AdminDashboard() {
  const { current } = useWorkspace();
  const [view, setView] = useState<'workspace' | 'mine'>('workspace');
  const q = useQuery({
    queryKey: ['dashboard', 'admin', current?._id], enabled: !!current && view === 'workspace',
    queryFn: async () => (await api.get<Admin>('/dashboard/admin', { params: dashParams(current!._id) })).data,
  });
  const tabs = (
    <div role="tablist" aria-label="Dashboard view" className="flex overflow-hidden rounded-lg border border-slate-300 text-sm dark:border-slate-700">
      {([['workspace', 'Workspace overview'], ['mine', 'My work']] as const).map(([id, label]) => (
        <button key={id} role="tab" aria-selected={view === id} className={`px-3 py-1.5 ${view === id ? 'bg-brand-600 text-white' : ''}`} onClick={() => setView(id)}>{label}</button>
      ))}
    </div>
  );
  const header = <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Dashboard</h1>{tabs}</div>;

  if (view === 'mine') return <div className="space-y-6">{header}<MemberDashboard embedded /></div>;
  if (q.isLoading) return <div className="space-y-6">{header}<div className="grid grid-cols-2 gap-4 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-64" /></div>;
  if (q.isError) return <div className="space-y-6">{header}<ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></div>;
  const d = q.data!;
  const k = d.kpis;
  const projects = [...d.projects].sort((a, b) => healthOrder[a.health.level] - healthOrder[b.health.level] || b.overdue - a.overdue);
  const risky = projects.filter((p) => p.health.level === 'at_risk' || p.health.level === 'watch');

  return (
    <div className="space-y-6">
      {header}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Total Projects" value={k.projects} tone="indigo" />
        <KpiCard label="Active Projects" value={k.activeProjects} tone="emerald" />
        <KpiCard label="Total Team Members" value={k.members} tone="violet" />
        <KpiCard label="Total Tasks" value={k.tasks} tone="blue" />
        <KpiCard label="Completed Tasks" value={k.completed} tone="green" />
        <KpiCard label="Pending Tasks" value={k.pending} tone="amber" />
        <KpiCard label="Overdue Tasks" value={k.overdue} tone="red" />
        <KpiCard label="Overall Completion" value={`${k.completionPct}%`} tone="emerald" />
      </div>

      {k.tasks === 0 ? <Section title="Analytics"><Empty>No tasks yet. Create a project and add tasks to see analytics here.</Empty></Section> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Tasks by status">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={STATUSES.map((s) => ({ id: s.id, name: s.label, count: d.tasksByStatus.find((x) => x.status === s.id)?.count ?? 0 }))}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} /><XAxis dataKey="name" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>{STATUSES.map((s) => <Cell key={s.id} fill={STATUS_COLORS[s.id]} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </Section>
          <Section title="Completed tasks per day (14 days)">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={d.completionTrend.map((t) => ({ ...t, label: t.date.slice(5) }))}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} /><XAxis dataKey="label" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip />
                <Line type="monotone" dataKey="completed" stroke="#10b981" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </Section>
          <Section title="Tasks by priority">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={d.tasksByPriority.map((p) => ({ name: p.priority, value: p.count }))} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={3} label>
                  {d.tasksByPriority.map((p) => <Cell key={p.priority} fill={PRIORITY_COLORS[p.priority] ?? '#94a3b8'} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          </Section>
          <Section title="Team workload (open tasks)">
            {d.team.every((m) => m.openTasks === 0) ? <Empty>Nobody has open assigned tasks.</Empty> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={d.team.filter((m) => m.openTasks > 0).map((m) => ({ name: m.name, open: m.openTasks, overdue: m.overdue }))}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} /><XAxis dataKey="name" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip /><Legend />
                  <Bar dataKey="open" name="Open" fill="#6366f1" radius={[4, 4, 0, 0]} /><Bar dataKey="overdue" name="Overdue" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Section>
        </div>
      )}

      <Section title="Project health & risk" action={<span className="text-xs text-slate-500">Rule-based: overdue share of open tasks, schedule slip, end date</span>}>
        {projects.length === 0 ? <Empty>No projects yet.</Empty> : risky.length === 0 ? <Empty>No project needs attention right now.</Empty> : (
          <ul className="space-y-3">
            {risky.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link className="font-medium hover:underline" to={`/projects/${p.id}`}>{p.name} <span className="text-slate-500">({p.key})</span></Link>
                  <ul className="mt-1 space-y-0.5 text-xs text-slate-500">{p.health.reasons.map((r) => <li key={r} className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-500" />{r}</li>)}</ul>
                </div>
                <HealthBadge level={p.health.level} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Project progress">
          {projects.length === 0 ? <Empty>No projects yet.</Empty> : (
            <ul className="space-y-3">{projects.map((p) => (
              <li key={p.id}>
                <div className="mb-1 flex justify-between text-sm"><Link className="hover:underline" to={`/projects/${p.id}`}>{p.name}</Link><span className="text-slate-500">{p.progress}% · {p.done}/{p.tasks}</span></div>
                <Progress value={p.progress} label={`${p.name} progress`} />
              </li>
            ))}</ul>
          )}
        </Section>
        <Section title="Upcoming deadlines (7 days)">
          {d.upcomingDeadlines.length === 0 ? <Empty>Nothing due soon.</Empty> : (
            <ul className="space-y-2 text-sm">{d.upcomingDeadlines.map((t) => (
              <li key={t._id} className="flex justify-between gap-2"><Link className="truncate hover:underline" to={`/projects/${t.project}`}>{t.key} {t.title}{t.assignee ? <span className="text-slate-500"> · {t.assignee.name}</span> : ''}</Link><span className="shrink-0 text-slate-500">{format(new Date(t.dueDate.slice(0, 10) + 'T00:00:00'), 'MMM d')}</span></li>
            ))}</ul>
          )}
        </Section>
      </div>

      <Section title="Project performance">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800"><tr><th className="py-2 pr-3">Project</th><th className="pr-3">Tasks</th><th className="pr-3">Done</th><th className="pr-3">Overdue</th><th className="pr-3">Open estimate</th><th className="pr-3">Logged</th><th>Health</th></tr></thead>
            <tbody>{projects.map((p) => (
              <tr key={p.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                <td className="py-2 pr-3">{p.name} <span className="text-slate-500">({p.key})</span></td><td className="pr-3">{p.tasks}</td><td className="pr-3">{p.done}</td>
                <td className={`pr-3 ${p.overdue ? 'font-medium text-red-600' : ''}`}>{p.overdue}</td><td className="pr-3">{p.openEstimateHours}h</td><td className="pr-3">{formatMinutes(p.loggedMinutes ?? 0)}</td><td><HealthBadge level={p.health.level} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Team performance" action={<Link className="text-sm text-brand-600 hover:underline" to="/team">Manage team</Link>}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800"><tr><th className="py-2 pr-3">Member</th><th className="pr-3">Open</th><th className="pr-3">Done (30d)</th><th className="pr-3" title="Finished on or before the due date">On time</th><th>Logged (7d)</th></tr></thead>
              <tbody>{d.team.map((m) => (
                <tr key={m.userId} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="py-2 pr-3">{m.name} <span className="text-xs text-slate-500">{m.role}</span>{m.overloaded && <span className="ml-1 rounded bg-red-100 px-1 text-xs text-red-700 dark:bg-red-950 dark:text-red-300" title="15+ open tasks or 40+ open estimated hours">overloaded</span>}</td>
                  <td className="pr-3">{m.openTasks}{m.overdue > 0 && <span className="text-red-600"> ({m.overdue} late)</span>}</td><td className="pr-3">{m.completed30d}</td><td className="pr-3">{m.onTimePct === null ? '—' : `${m.onTimePct}%`}</td><td>{formatMinutes(m.loggedMinutes7d)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Section>
        <Section title="Audit activity (7 days)" action={<Link className="text-sm text-brand-600 hover:underline" to="/audit">Open audit log</Link>}>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div><p className="text-xs text-slate-500">Events</p><p className="text-xl font-bold">{d.audit.events7d}</p></div>
            <div><p className="text-xs text-slate-500">Deletions / removals</p><p className={`text-xl font-bold ${d.audit.destructive7d ? 'text-red-600' : ''}`}>{d.audit.destructive7d}</p></div>
          </div>
          {d.audit.byCategory.length === 0 ? <Empty>No activity this week.</Empty> : (
            <>
              <div className="mb-2 flex flex-wrap gap-1.5">{d.audit.byCategory.map((c) => <span key={c.category} className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">{c.category} · {c.count}</span>)}</div>
              <p className="text-xs text-slate-500">Most active: {d.audit.topActors.map((a) => `${a.name} (${a.count})`).join(', ')}</p>
            </>
          )}
        </Section>
      </div>

      <Section title="Recent activity">
        {d.recentActivity.length === 0 ? <Empty>No activity yet.</Empty> : (
          <ul className="space-y-1.5 text-sm">{d.recentActivity.map((a) => (
            <li key={a._id}><span className="font-medium">{a.actor?.name ?? 'Someone'}</span> {describeAudit(a)} <span className="text-slate-500">· {format(new Date(a.createdAt), 'MMM d, HH:mm')}</span></li>
          ))}</ul>
        )}
      </Section>
      <p className="text-xs text-slate-500">{statusLabel('done')} tasks and completion % count every task in the workspace. Overdue means open and due before today.</p>
    </div>
  );
}
