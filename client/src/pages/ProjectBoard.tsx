import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { ArrowLeft, Download, KanbanSquare, List, Plus } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { getSocket } from '../lib/socket';
import { KanbanBoard } from '../components/KanbanBoard';
import { TaskModal } from '../components/TaskModal';
import { EmptyState, ErrorState, Skeleton } from '../components/ui';
import { PRIORITIES, isOverdue, positionAt, priorityClass, statusLabel } from '../lib/utils';
import type { Project, Task, TaskStatus } from '../types';

interface TaskPage { tasks: Task[]; page: number; pages: number; total: number }

export default function ProjectBoard() {
  const { projectId = '' } = useParams();
  const qc = useQueryClient();
  const [view, setView] = useState<'board' | 'list'>('board');
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState('');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<'createdAt' | 'dueDate' | 'priority' | 'title'>('createdAt');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [modal, setModal] = useState<{ task: Task | null; status?: TaskStatus } | null>(null);

  const project = useQuery({ queryKey: ['project', projectId], queryFn: async () => (await api.get<{ project: Project; myRole: string; permissions: string[] }>(`/projects/${projectId}`)).data });
  // permissions of the PROJECT's workspace, as reported by the server (may differ from the currently selected workspace)
  const readOnly = !project.data?.permissions.includes('task.write');

  const params = {
    projectId, ...(search && { q: search }), ...(priority && { priority }), ...(mine && { assignee: 'me' }),
    ...(view === 'board' ? { limit: 100, sort: 'position', order: 'asc' } : { limit: 25, page, sort, order }),
  };
  const key = ['tasks', projectId, view, params];
  const tasks = useQuery({ queryKey: key, queryFn: async () => (await api.get<TaskPage>('/tasks', { params })).data });

  // Real-time: join the project room (server verifies membership) and refresh on events.
  useEffect(() => {
    const socket = getSocket();
    const join = () => socket.emit('project:join', projectId);
    if (socket.connected) join();
    socket.on('connect', join);
    const refresh = () => { qc.invalidateQueries({ queryKey: ['tasks', projectId] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); };
    ['task:created', 'task:updated', 'task:deleted'].forEach((e) => socket.on(e, refresh));
    return () => {
      socket.emit('project:leave', projectId);
      socket.off('connect', join);
      ['task:created', 'task:updated', 'task:deleted'].forEach((e) => socket.off(e, refresh));
    };
  }, [projectId, qc]);

  const move = useMutation({
    mutationFn: async (v: { id: string; status: TaskStatus; index: number }) => api.post(`/tasks/${v.id}/move`, { status: v.status, index: v.index }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['tasks', projectId] });
      const previous = qc.getQueryData<TaskPage>(key);
      if (previous) {
        const others = previous.tasks.filter((t) => t.status === v.status && t._id !== v.id).sort((a, b) => a.position - b.position);
        const position = positionAt(others.map((t) => t.position), v.index);
        qc.setQueryData<TaskPage>(key, { ...previous, tasks: previous.tasks.map((t) => (t._id === v.id ? { ...t, status: v.status, position } : t)) });
      }
      return { previous };
    },
    onError: (e, _v, ctx) => { if (ctx?.previous) qc.setQueryData(key, ctx.previous); toast.error(`Move failed: ${errorMessage(e)}`); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['tasks', projectId] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
  });

  async function exportCsv() {
    try {
      const res = await api.get('/tasks/export', { params: { projectId }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = `${project.data?.project.key ?? 'tasks'}-tasks.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error(errorMessage(e)); }
  }

  if (project.isLoading) return <Skeleton className="h-40" />;
  if (project.isError) return <ErrorState message={errorMessage(project.error)} />;
  const p = project.data!.project;
  const toggleSort = (s: typeof sort) => { if (s === sort) setOrder(order === 'asc' ? 'desc' : 'asc'); else { setSort(s); setOrder('asc'); } setPage(1); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/projects" className="mb-1 flex items-center gap-1 text-sm text-slate-500 hover:underline"><ArrowLeft className="h-3 w-3" /> Projects</Link>
          <h1 className="text-2xl font-semibold">{p.name} <span className="text-base font-normal text-slate-500">({p.key})</span></h1>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={exportCsv}><Download className="h-4 w-4" /> CSV</button>
          {!readOnly && <button className="btn-primary" onClick={() => setModal({ task: null })}><Plus className="h-4 w-4" /> New task</button>}
        </div>
      </div>
      {readOnly && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">You have view-only access to this workspace.</p>}

      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Search tasks" className="input max-w-xs" placeholder="Search tasks…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select aria-label="Filter by priority" className="input w-auto" value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }}>
          <option value="">All priorities</option>{PRIORITIES.map((x) => <option key={x}>{x}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(1); }} /> Assigned to me</label>
        <div className="ml-auto flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
          <button aria-pressed={view === 'board'} className={`flex items-center gap-1 px-3 py-1.5 text-sm ${view === 'board' ? 'bg-brand-600 text-white' : ''}`} onClick={() => setView('board')}><KanbanSquare className="h-4 w-4" /> Board</button>
          <button aria-pressed={view === 'list'} className={`flex items-center gap-1 px-3 py-1.5 text-sm ${view === 'list' ? 'bg-brand-600 text-white' : ''}`} onClick={() => setView('list')}><List className="h-4 w-4" /> List</button>
        </div>
      </div>

      {tasks.isLoading ? <Skeleton className="h-64" /> : tasks.isError ? <ErrorState message={errorMessage(tasks.error)} onRetry={() => tasks.refetch()} /> : view === 'board' ? (
        <KanbanBoard tasks={tasks.data!.tasks} readOnly={readOnly} onMove={(id, status, index) => move.mutate({ id, status, index })} onOpen={(t) => setModal({ task: t })} onAdd={(status) => setModal({ task: null, status })} />
      ) : tasks.data!.tasks.length === 0 ? (
        <EmptyState title="No tasks match" hint="Try clearing the filters or create a new task." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
              <tr>
                <th className="p-3">Key</th>
                <th className="p-3"><button onClick={() => toggleSort('title')}>Title {sort === 'title' && (order === 'asc' ? '↑' : '↓')}</button></th>
                <th className="p-3">Status</th>
                <th className="p-3"><button onClick={() => toggleSort('priority')}>Priority {sort === 'priority' && (order === 'asc' ? '↑' : '↓')}</button></th>
                <th className="p-3"><button onClick={() => toggleSort('dueDate')}>Due {sort === 'dueDate' && (order === 'asc' ? '↑' : '↓')}</button></th>
              </tr>
            </thead>
            <tbody>
              {tasks.data!.tasks.map((t) => (
                <tr key={t._id} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50" onClick={() => setModal({ task: t })}>
                  <td className="p-3 text-slate-500">{t.key}</td><td className="p-3 font-medium">{t.title}</td><td className="p-3">{statusLabel(t.status)}</td>
                  <td className="p-3"><span className={`rounded px-1.5 py-0.5 text-xs ${priorityClass[t.priority]}`}>{t.priority}</span></td>
                  <td className={`p-3 ${isOverdue(t.dueDate, t.status) ? 'font-medium text-red-600' : ''}`}>{t.dueDate ? format(new Date(t.dueDate), 'MMM d, yyyy') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between p-3 text-sm text-slate-500">
            <span>{tasks.data!.total} tasks</span>
            <div className="flex items-center gap-2">
              <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
              <span>Page {tasks.data!.page} of {Math.max(1, tasks.data!.pages)}</span>
              <button className="btn-ghost" disabled={page >= tasks.data!.pages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        </div>
      )}
      {view === 'board' && tasks.data && tasks.data.total > 100 && <p className="text-xs text-amber-600">Showing the first 100 of {tasks.data.total} tasks. Use filters or the list view.</p>}
      {modal && <TaskModal projectId={projectId} workspaceId={p.workspace} task={modal.task} defaultStatus={modal.status} readOnly={readOnly} onClose={() => setModal(null)} />}
    </div>
  );
}
