import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { format, subDays } from 'date-fns';
import { Download, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '../lib/api';
import { useWorkspace } from '../hooks/useWorkspace';
import { EmptyState, ErrorState, Skeleton } from '../components/ui';
import { describeAudit, localDayRangeToInstants, type AuditEntry } from '../lib/auditText';
import { usePermissions } from '../hooks/usePermissions';
import type { Member } from '../types';

interface Page { entries: AuditEntry[]; page: number; pages: number; total: number }
const day = (d: Date) => format(d, 'yyyy-MM-dd');
const PAGE_SIZE = 25;

/** Read-only history of who changed what. Admin and owner only (the server enforces this; the page just explains it). */
export default function AuditLog() {
  const { current } = useWorkspace();
  const [from, setFrom] = useState(() => day(subDays(new Date(), 6)));
  const [to, setTo] = useState(() => day(new Date()));
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [page, setPage] = useState(1);
  const wsId = current?._id;
  const { can } = usePermissions();
  const admin = can('audit.view');
  const valid = !!from && !!to && from <= to;
  const range = valid ? localDayRangeToInstants(from, to) : null;
  const filters = { workspaceId: wsId, ...range, ...(action && { action }), ...(actorId && { actorId }), ...(projectId && { projectId }) };

  const entries = useQuery({
    queryKey: ['audit', wsId, range?.from, range?.to, action, actorId, projectId, page],
    enabled: !!wsId && admin && valid,
    queryFn: async () => (await api.get<Page>('/audit-logs', { params: { ...filters, page, limit: PAGE_SIZE } })).data,
  });
  const actions = useQuery({
    queryKey: ['auditActions', wsId], enabled: !!wsId && admin,
    queryFn: async () => (await api.get<{ actions: string[] }>('/audit-logs/actions', { params: { workspaceId: wsId } })).data.actions,
  });
  const projects = useQuery({
    queryKey: ['projects', wsId, 'all'], enabled: !!wsId && admin,
    queryFn: async () => (await api.get<{ projects: { _id: string; name: string; key: string }[] }>('/projects', { params: { workspaceId: wsId, includeArchived: true } })).data.projects,
  });
  const members = useQuery({
    queryKey: ['members', wsId], enabled: !!wsId && admin,
    queryFn: async () => (await api.get<{ members: Member[] }>(`/workspaces/${wsId}/members`)).data.members,
  });

  async function exportCsv() {
    try {
      const res = await api.get('/audit-logs/export.csv', { params: filters, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = 'audit-log.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error(errorMessage(e)); }
  }

  if (!current) return <EmptyState title="Create a workspace first" action={<Link className="btn-primary" to="/workspaces">Create workspace</Link>} />;
  if (!admin) return <EmptyState title="Audit log is for admins" hint="Only workspace admins and owners can see the history of changes." />;
  const change = (fn: () => void) => { fn(); setPage(1); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><ShieldCheck className="h-6 w-6 text-brand-600" /> Audit log</h1>
        <button className="btn-ghost" disabled={!valid} onClick={exportCsv}><Download className="h-4 w-4" /> Export CSV</button>
      </div>
      <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div><label className="label" htmlFor="au-from">From</label><input id="au-from" type="date" className="input" value={from} max={to || undefined} onChange={(e) => change(() => setFrom(e.target.value))} /></div>
        <div><label className="label" htmlFor="au-to">To</label><input id="au-to" type="date" className="input" value={to} min={from || undefined} onChange={(e) => change(() => setTo(e.target.value))} /></div>
        <div>
          <label className="label" htmlFor="au-action">Action</label>
          <select id="au-action" className="input" value={action} onChange={(e) => change(() => setAction(e.target.value))}>
            <option value="">All actions</option>
            {actions.data?.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="au-actor">Person</label>
          <select id="au-actor" className="input" value={actorId} onChange={(e) => change(() => setActorId(e.target.value))}>
            <option value="">Everyone</option>
            {members.data?.map((m) => <option key={m.user._id} value={m.user._id}>{m.user.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="au-project">Project</label>
          <select id="au-project" className="input" value={projectId} onChange={(e) => change(() => setProjectId(e.target.value))}>
            <option value="">All projects</option>
            {projects.data?.map((p) => <option key={p._id} value={p._id}>{p.name} ({p.key})</option>)}
          </select>
        </div>
      </div>
      {!valid && <p role="alert" className="text-sm text-red-600">Choose a valid range: &ldquo;From&rdquo; must be on or before &ldquo;To&rdquo;.</p>}

      {valid && (entries.isLoading ? <Skeleton className="h-64" /> : entries.isError ? <ErrorState message={errorMessage(entries.error)} onRetry={() => entries.refetch()} /> : entries.data!.entries.length === 0 ? (
        <EmptyState title="No activity found" hint="Nothing was recorded for these filters. Try a wider date range or clear the filters." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
              <tr><th className="p-3">When</th><th className="p-3">Who</th><th className="p-3">What happened</th><th className="p-3">Project</th></tr>
            </thead>
            <tbody>
              {entries.data!.entries.map((en) => (
                <tr key={en._id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="whitespace-nowrap p-3 text-slate-500">{format(new Date(en.createdAt), 'MMM d, HH:mm')}</td>
                  <td className="whitespace-nowrap p-3 font-medium">{en.actor?.name ?? 'Deleted user'}</td>
                  <td className="p-3">{describeAudit(en)}</td>
                  <td className="whitespace-nowrap p-3 text-slate-500">{en.project?.key ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between p-3 text-sm text-slate-500">
            <span>{entries.data!.total} events</span>
            <div className="flex items-center gap-2">
              <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
              <span>Page {entries.data!.page} of {Math.max(1, entries.data!.pages)}</span>
              <button className="btn-ghost" disabled={page >= entries.data!.pages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-500">This log is read-only: events are recorded by the server and cannot be edited or deleted here. Times are shown in your local time zone; the date range uses your local days.</p>
    </div>
  );
}
