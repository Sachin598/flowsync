import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { api, errorMessage } from '../lib/api';
import { useWorkspace } from '../hooks/useWorkspace';
import { EmptyState, ErrorState, Skeleton } from '../components/ui';
import { STATUS_COLORS, statusLabel } from '../lib/utils';

interface Result {
  projects: { _id: string; name: string; key: string; status: string }[];
  tasks: { _id: string; key: string; title: string; status: string; priority: string; project: string; dueDate?: string }[];
}

export default function Search() {
  const [params] = useSearchParams();
  const term = (params.get('q') ?? '').trim();
  const { current } = useWorkspace();
  const q = useQuery({
    queryKey: ['search', current?._id, term],
    enabled: !!current && term.length >= 2,
    queryFn: async () => (await api.get<Result>('/search', { params: { workspaceId: current!._id, q: term } })).data,
  });

  if (!current) return <EmptyState title="Create a workspace first" />;
  if (term.length < 2) return <EmptyState title="Search" hint="Type at least 2 characters in the search box above." />;
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const { projects, tasks } = q.data!;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Results for &ldquo;{term}&rdquo; <span className="text-base font-normal text-slate-500">in {current.name}</span></h1>
      {projects.length === 0 && tasks.length === 0 && <EmptyState title="No results" hint="Try a different word, a task key like WEB-3, or a label." />}
      {projects.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium">Projects</h2>
          <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
            {projects.map((p) => (
              <li key={p._id}><Link className="flex justify-between p-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800" to={`/projects/${p._id}`}><span>{p.name}</span><span className="text-slate-500">{p.key} &middot; {p.status}</span></Link></li>
            ))}
          </ul>
        </section>
      )}
      {tasks.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium">Tasks {tasks.length === 25 && <span className="text-xs font-normal text-slate-500">(showing first 25)</span>}</h2>
          <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
            {tasks.map((t) => (
              <li key={t._id}>
                <Link className="flex items-center justify-between gap-3 p-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800" to={`/projects/${t.project}`}>
                  <span className="truncate"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[t.status] }} />{t.key} {t.title}</span>
                  <span className="shrink-0 text-slate-500">{statusLabel(t.status)}{t.dueDate ? ` \u00b7 ${format(new Date(t.dueDate), 'MMM d')}` : ''}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
