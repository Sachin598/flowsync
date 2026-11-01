import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { dashParams } from '../lib/dashParams';
import { useWorkspace } from '../hooks/useWorkspace';
import { usePermissions } from '../hooks/usePermissions';
import { EmptyState, ErrorState, Skeleton } from '../components/ui';
import { Progress } from './dashboards/shared';

interface Row { id: string; name: string; key: string; status: string; isOwner: boolean; myTasks: number; myDone: number; myOverdue: number; myProgress: number; projectProgress: number }

/** Projects the user owns or has tasks in. (Project access itself is workspace-wide; see docs/PERMISSIONS.md.) */
export default function MyProjects() {
  const { current } = useWorkspace();
  const { can } = usePermissions();
  const q = useQuery({
    queryKey: ['myProjects', current?._id], enabled: !!current,
    queryFn: async () => { const { workspaceId, today, timezone } = dashParams(current!._id); return (await api.get<{ projects: Row[] }>('/projects/mine', { params: { workspaceId, today, timezone } })).data.projects; },
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">My projects</h1>
        {can('project.view') && <Link className="btn-ghost" to="/projects">Browse all workspace projects</Link>}
      </div>
      {q.isLoading ? <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}</div> : q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : q.data!.length === 0 ? (
        <EmptyState title="You are not working on any project yet" hint="Projects you own or have tasks in will appear here." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {q.data!.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="card p-4 transition hover:border-brand-500">
              <div className="flex items-center justify-between"><h3 className="font-medium">{p.name}</h3><span className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">{p.key}</span></div>
              <p className="mt-1 text-xs text-slate-500">{p.status}{p.isOwner ? ' · you own this project' : ''}</p>
              <p className="mt-3 text-sm">Your tasks: {p.myDone}/{p.myTasks} done{p.myOverdue > 0 && <span className="text-red-600"> · {p.myOverdue} overdue</span>}</p>
              <div className="mt-1"><Progress value={p.myProgress} label={`Your progress in ${p.name}`} /></div>
              <p className="mt-2 text-xs text-slate-500">Whole project: {p.projectProgress}%</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
