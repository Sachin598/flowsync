import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { describeAudit, type AuditEntry } from '../lib/auditText';
import { useWorkspace } from '../hooks/useWorkspace';
import { EmptyState, ErrorState, Skeleton } from '../components/ui';
import { Empty, KpiCard, Section } from './dashboards/shared';

interface Overview {
  days: number; flagThreshold: number;
  counts: { signIns: number; failedSignIns: number; passwordChanges: number; sessionsRevoked: number; accountsCreated: number; membersAdded: number; roleChanges: number; membersRemoved: number };
  flaggedAccounts: { userId: string; name: string; email: string; failedSignIns: number; lastAttempt: string }[];
  recentEvents: { _id: string; type: string; createdAt: string; ip: string; userAgent: string; user: { name: string; email: string } }[];
  recentAccessChanges: AuditEntry[];
}
const EVENT_LABEL: Record<string, string> = { login_success: 'Signed in', login_failed: 'Failed sign-in', register: 'Account created', password_changed: 'Password changed', sessions_revoked: 'Signed out everywhere' };
const browser = (ua: string) => (/Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : ua ? 'Other' : '—');

/** Sign-in and access events for the people in this workspace. Real events only; nothing is estimated. */
export default function SecurityDashboard() {
  const { current } = useWorkspace();
  const [days, setDays] = useState<7 | 30>(7);
  const q = useQuery({
    queryKey: ['security', current?._id, days], enabled: !!current,
    queryFn: async () => (await api.get<Overview>('/security/overview', { params: { workspaceId: current!._id, days } })).data,
  });
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">Security dashboard</h1>
      <div role="group" aria-label="Time window" className="flex overflow-hidden rounded-lg border border-slate-300 text-sm dark:border-slate-700">
        {([7, 30] as const).map((d) => <button key={d} aria-pressed={days === d} className={`px-3 py-1.5 ${days === d ? 'bg-brand-600 text-white' : ''}`} onClick={() => setDays(d)}>Last {d} days</button>)}
      </div>
    </div>
  );
  if (q.isLoading) return <div className="space-y-4">{header}<Skeleton className="h-64" /></div>;
  if (q.isError) return <div className="space-y-4">{header}<ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></div>;
  const d = q.data!;
  const c = d.counts;
  return (
    <div className="space-y-6">
      {header}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Sign-ins" value={c.signIns} tone="emerald" />
        <KpiCard label="Failed sign-ins" value={c.failedSignIns} tone={c.failedSignIns ? 'red' : 'green'} />
        <KpiCard label="Password changes" value={c.passwordChanges} tone="blue" />
        <KpiCard label="Sessions revoked" value={c.sessionsRevoked} tone="violet" />
        <KpiCard label="Members added" value={c.membersAdded} tone="indigo" />
        <KpiCard label="Role changes" value={c.roleChanges} tone="amber" />
        <KpiCard label="Members removed" value={c.membersRemoved} tone={c.membersRemoved ? 'red' : 'green'} />
        <KpiCard label="Accounts created" value={c.accountsCreated} tone="indigo" />
      </div>
      <Section title="Accounts needing attention" action={<span className="text-xs text-slate-500">{d.flagThreshold}+ failed sign-ins in the window</span>}>
        {d.flaggedAccounts.length === 0 ? <Empty>No account has repeated failed sign-ins.</Empty> : (
          <ul className="space-y-2 text-sm">{d.flaggedAccounts.map((a) => (
            <li key={a.userId} className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-500" /><span className="font-medium">{a.name}</span><span className="text-slate-500">{a.email}</span></span><span className="text-red-600">{a.failedSignIns} failed · last {format(new Date(a.lastAttempt), 'MMM d, HH:mm')}</span></li>
          ))}</ul>
        )}
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Recent access changes">
          {d.recentAccessChanges.length === 0 ? <Empty>No members were added, removed or re-roled in this window.</Empty> : (
            <ul className="space-y-1.5 text-sm">{d.recentAccessChanges.map((a) => <li key={a._id}><span className="font-medium">{a.actor?.name ?? 'Someone'}</span> {describeAudit(a)} <span className="text-slate-500">· {format(new Date(a.createdAt), 'MMM d, HH:mm')}</span></li>)}</ul>
          )}
        </Section>
        <Section title="Recent sign-in activity">
          {d.recentEvents.length === 0 ? <EmptyState title="No events in this window" hint="Sign-ins and password changes by workspace members appear here." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800"><tr><th className="py-2 pr-3">When</th><th className="pr-3">Who</th><th className="pr-3">Event</th><th className="pr-3">IP</th><th>Browser</th></tr></thead>
                <tbody>{d.recentEvents.map((e) => (
                  <tr key={e._id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="whitespace-nowrap py-2 pr-3 text-slate-500">{format(new Date(e.createdAt), 'MMM d, HH:mm')}</td><td className="pr-3">{e.user.name}</td>
                    <td className={`pr-3 ${e.type === 'login_failed' ? 'font-medium text-red-600' : ''}`}>{EVENT_LABEL[e.type] ?? e.type}</td><td className="pr-3 font-mono text-xs">{e.ip || '—'}</td><td>{browser(e.userAgent)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
      <p className="text-xs text-slate-500">Only events of this workspace&apos;s members are shown. Failed sign-ins for email addresses that have no account are not recorded. IP addresses and browsers are deleted automatically after 180 days.</p>
    </div>
  );
}
