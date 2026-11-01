import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, X } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { STATUS_COLORS, statusLabel } from '../lib/utils';
import { Spinner } from './ui';
import type { Task } from '../types';

interface Ref { _id: string; key: string; title: string; status: string }
interface Detail { task: { blockedBy: Ref[] }; blocking: Ref[] }
const MAX_BLOCKERS = 20; // same limit the server enforces

function Chip({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[status] }} />
      {statusLabel(status)}
    </span>
  );
}

/**
 * Edit which tasks block this one ("blocked by") and see which tasks it blocks.
 * Every change is saved immediately with PATCH /tasks/:id { blockedBy }. The server is the authority: it rejects
 * tasks from other projects, self-dependencies and any cycle (direct or indirect), and its message is shown here.
 */
export function DependencyEditor({ taskId, projectId, readOnly }: { taskId: string; projectId: string; readOnly: boolean }) {
  const qc = useQueryClient();
  const [choice, setChoice] = useState('');
  const [error, setError] = useState('');

  const detail = useQuery({ queryKey: ['task', taskId], queryFn: async () => (await api.get<Detail>(`/tasks/${taskId}`)).data });
  const candidates = useQuery({
    queryKey: ['tasks', projectId, 'picker'], enabled: !readOnly,
    queryFn: async () => (await api.get<{ tasks: Task[] }>('/tasks', { params: { projectId, limit: 100, sort: 'title', order: 'asc' } })).data.tasks,
  });

  const save = useMutation({
    mutationFn: async (ids: string[]) => api.patch(`/tasks/${taskId}`, { blockedBy: ids }),
    onSuccess: () => {
      setError('');
      setChoice('');
      for (const k of ['task', 'tasks', 'calendar']) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  if (detail.isLoading) return <Spinner />;
  if (detail.isError) return <p role="alert" className="text-sm text-red-600">{errorMessage(detail.error)} <button className="underline" onClick={() => detail.refetch()}>Retry</button></p>;

  const blockers = detail.data!.task.blockedBy;
  const blocking = detail.data!.blocking;
  const unfinished = blockers.filter((b) => b.status !== 'done');
  // Hide tasks that can never be valid choices: itself, tasks already chosen, and tasks it already blocks (a direct cycle).
  // Longer cycles are still caught by the server.
  const taken = new Set([taskId, ...blockers.map((b) => b._id), ...blocking.map((b) => b._id)]);
  const options = (candidates.data ?? []).filter((t) => !taken.has(t._id));
  const atLimit = blockers.length >= MAX_BLOCKERS;

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Dependencies</h3>
      {unfinished.length > 0 && (
        <p className="mb-2 flex items-center gap-1 rounded bg-amber-50 p-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Blocked by {unfinished.length} unfinished {unfinished.length === 1 ? 'task' : 'tasks'}
        </p>
      )}

      <p className="mb-1 text-xs font-medium text-slate-500">Blocked by</p>
      <ul className="mb-2 space-y-1 text-sm">
        {blockers.length === 0 && <li className="text-slate-500">No prerequisites.</li>}
        {blockers.map((b) => (
          <li key={b._id} className="flex items-center gap-2">
            <span className="flex-1 truncate">{b.key} {b.title}</span>
            <Chip status={b.status} />
            {!readOnly && (
              <button type="button" aria-label={`Remove dependency on ${b.key}`} className="text-slate-400 hover:text-red-600 disabled:opacity-40" disabled={save.isPending}
                onClick={() => save.mutate(blockers.filter((x) => x._id !== b._id).map((x) => x._id))}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {!readOnly && (
        <form className="mb-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (choice) save.mutate([...blockers.map((b) => b._id), choice]); }}>
          <select aria-label="Add a blocking task" className="input" value={choice} onChange={(e) => setChoice(e.target.value)} disabled={candidates.isLoading || save.isPending || atLimit}>
            <option value="">
              {atLimit ? `Limit of ${MAX_BLOCKERS} reached` : candidates.isLoading ? 'Loading tasks…' : options.length ? 'Add a task that blocks this one…' : 'No other tasks available'}
            </option>
            {options.map((t) => <option key={t._id} value={t._id}>{t.key} · {t.title}</option>)}
          </select>
          <button className="btn-ghost" disabled={!choice || save.isPending}>{save.isPending ? 'Saving…' : 'Add'}</button>
        </form>
      )}
      {candidates.isError && <p role="alert" className="mb-1 text-xs text-red-600">Could not load tasks: {errorMessage(candidates.error)}</p>}
      {error && <p role="alert" className="mb-2 rounded bg-red-50 p-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

      <p className="mb-1 text-xs font-medium text-slate-500">Blocking</p>
      <ul className="space-y-1 text-sm">
        {blocking.length === 0 && <li className="text-slate-500">Nothing depends on this task.</li>}
        {blocking.map((b) => (
          <li key={b._id} className="flex items-center gap-2"><span className="flex-1 truncate">{b.key} {b.title}</span><Chip status={b.status} /></li>
        ))}
      </ul>
    </div>
  );
}
