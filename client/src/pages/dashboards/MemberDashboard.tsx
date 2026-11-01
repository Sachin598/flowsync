import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, errorMessage } from '../../lib/api';
import { dashParams } from '../../lib/dashParams';
import { describeAudit, type AuditEntry } from '../../lib/auditText';
import { STATUS_COLORS, formatMinutes, isOverdue, priorityClass, statusLabel } from '../../lib/utils';
import { useWorkspace } from '../../hooks/useWorkspace';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui';
import type { Priority } from '../../types';
import { Empty, KpiCard, Progress, Section } from './shared';

interface TaskRow { _id: string; key: string; title: string; status: string; priority: Priority; dueDate?: string; project: string; estimateHours: number }
interface Member {
  kpis: { assigned: number; completed: number; pending: number; overdue: number; loggedMinutes7d: number; loggedMinutesToday: number; activeProjects: number };
  myTasks: TaskRow[]; todaysTasks: TaskRow[]; upcomingDeadlines: TaskRow[];
  workload: { openTasks: number; overdue: number; openEstimateHours: number; byStatus: { status: string; count: number }[]; byPriority: { priority: string; count: number }[]; overloaded: boolean };
  time: { daily: { date: string; minutes: number }[] };
  projects: { id: string; name: string; key: string; status: string; myTasks: number; myDone: number; myOverdue: number; myProgress: number; projectProgress: number }[];
  notifications: { unread: number; items: { _id: string; message: string; read: boolean; createdAt: string }[] };
  activity: AuditEntry[];
}

const dueText = (d?: string) => (d ? format(new Date(d.slice(0, 10) + 'T00:00:00'), 'MMM d') : 'No due date');

function Tasks({ rows, empty }: { rows: TaskRow[]; empty: string }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((t) => (
        <li key={t._id} className="flex items-center justify-between gap-2">
          <Link className="flex min-w-0 items-center gap-2 hover:underline" to={`/projects/${t.project}`}>
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: STATUS_COLORS[t.status] }} title={statusLabel(t.status)} />
            <span className="truncate">{t.key} {t.title}</span>
          </Link>
          <span className="flex shrink-0 items-center gap-2">
            <span className={`rounded px-1.5 text-xs ${priorityClass[t.priority]}`}>{t.priority}</span>
            <span className={isOverdue(t.dueDate, t.status) ? 'font-medium text-red-600' : 'text-slate-500'}>{dueText(t.dueDate)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The signed-in person's own work. The server always computes it for the authenticated user; nothing here accepts a user id. */
export default function MemberDashboard({ embedded = false }: { embedded?: boolean }) {
  const { current } = useWorkspace();
  const q = useQuery({
    queryKey: ['dashboard', 'member', current?._id], enabled: !!current,
    queryFn: async () => (await api.get<Member>('/dashboard/member', { params: dashParams(current!._id) })).data,
  });
  const title = embedded ? null : <h1 className="text-2xl font-semibold">My dashboard</h1>;
  if (q.isLoading) return <div className="space-y-6">{title}<div className="grid grid-cols-2 gap-4 md:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-64" /></div>;
  if (q.isError) return <div className="space-y-6">{title}<ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></div>;
  const d = q.data!;
  const k = d.kpis;

  return (
    <div className="space-y-6">
      {title}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <KpiCard label="My Assigned Tasks" value={k.assigned} tone="indigo" />
        <KpiCard label="Completed Tasks" value={k.completed} tone="green" />
        <KpiCard label="Pending Tasks" value={k.pending} tone="amber" />
        <KpiCard label="Overdue Tasks" value={k.overdue} tone="red" />
        <KpiCard label="Logged Working Hours" value={formatMinutes(k.loggedMinutes7d)} tone="blue" hint={`last 7 days · ${formatMinutes(k.loggedMinutesToday)} today`} />
        <KpiCard label="Active Projects" value={k.activeProjects} tone="emerald" />
      </div>

      {k.assigned === 0 && <EmptyState title="Nothing is assigned to you yet" hint="When someone assigns you a task it will show up here." action={<Link className="btn-ghost" to="/projects">Browse projects</Link>} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="My tasks" action={<Link className="text-sm text-brand-600 hover:underline" to="/my-tasks">See all</Link>}><Tasks rows={d.myTasks} empty="No open tasks. Nice work." /></Section>
        <Section title="Today's tasks"><Tasks rows={d.todaysTasks} empty="Nothing is due today." /></Section>
        <Section title="Upcoming deadlines (7 days)"><Tasks rows={d.upcomingDeadlines} empty="No deadlines in the next 7 days." /></Section>
        <Section title="My workload">
          <p className="mb-2 text-sm">{d.workload.openTasks} open · <span className={d.workload.overdue ? 'font-medium text-red-600' : ''}>{d.workload.overdue} overdue</span> · {d.workload.openEstimateHours}h estimated</p>
          {d.workload.overloaded && <p className="mb-2 rounded bg-amber-50 p-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">You have a heavy load (15+ open tasks or 40+ estimated hours). Talk to your team lead about priorities.</p>}
          {d.workload.openTasks === 0 ? <Empty>No open work.</Empty> : (
            <div className="space-y-2 text-xs">
              <div className="flex flex-wrap gap-1.5">{d.workload.byStatus.map((s) => <span key={s.status} className="rounded bg-slate-100 px-2 py-0.5 dark:bg-slate-800">{statusLabel(s.status)} · {s.count}</span>)}</div>
              <div className="flex flex-wrap gap-1.5">{d.workload.byPriority.map((p) => <span key={p.priority} className={`rounded px-2 py-0.5 ${priorityClass[p.priority as Priority]}`}>{p.priority} · {p.count}</span>)}</div>
            </div>
          )}
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="My time tracking" action={<Link className="text-sm text-brand-600 hover:underline" to="/time">Open time tracking</Link>}>
          {k.loggedMinutes7d === 0 ? <Empty>No time logged in the last 7 days. Start a timer on any task.</Empty> : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={d.time.daily.map((x) => ({ label: format(new Date(x.date + 'T00:00:00'), 'EEE'), hours: Math.round((x.minutes / 60) * 10) / 10 }))}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} /><XAxis dataKey="label" fontSize={12} /><YAxis fontSize={12} /><Tooltip />
                <Bar dataKey="hours" name="Hours" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Section>
        <Section title="My project progress" action={<Link className="text-sm text-brand-600 hover:underline" to="/my-projects">My projects</Link>}>
          {d.projects.length === 0 ? <Empty>You are not working on any project yet.</Empty> : (
            <ul className="space-y-3">{d.projects.map((p) => (
              <li key={p.id}>
                <div className="mb-1 flex justify-between text-sm"><Link className="hover:underline" to={`/projects/${p.id}`}>{p.name}</Link><span className="text-slate-500">mine {p.myDone}/{p.myTasks} · project {p.projectProgress}%</span></div>
                <Progress value={p.myProgress} label={`My progress in ${p.name}`} />
              </li>
            ))}</ul>
          )}
        </Section>
        <Section title="Recent notifications" action={<Link className="text-sm text-brand-600 hover:underline" to="/notifications">{d.notifications.unread} unread</Link>}>
          {d.notifications.items.length === 0 ? <Empty>No notifications.</Empty> : (
            <ul className="space-y-1.5 text-sm">{d.notifications.items.map((n) => <li key={n._id} className={n.read ? 'text-slate-500' : 'font-medium'}>{n.message} <span className="text-xs font-normal text-slate-500">· {format(new Date(n.createdAt), 'MMM d, HH:mm')}</span></li>)}</ul>
          )}
        </Section>
        <Section title="My activity history">
          {d.activity.length === 0 ? <Empty>No activity yet.</Empty> : (
            <ul className="space-y-1.5 text-sm">{d.activity.map((a) => <li key={a._id}>You {describeAudit(a)} <span className="text-slate-500">· {format(new Date(a.createdAt), 'MMM d, HH:mm')}</span></li>)}</ul>
          )}
        </Section>
      </div>
    </div>
  );
}
