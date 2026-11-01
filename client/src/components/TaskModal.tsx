import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { api, errorMessage } from '../lib/api';
import { ConfirmDialog, Field, Modal, Spinner } from './ui';
import { TimeTracker } from './TimeTracker';
import { DependencyEditor } from './DependencyEditor';
import { PRIORITIES, STATUSES, checklistProgress } from '../lib/utils';
import type { Member, Task } from '../types';

const schema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().max(5000).optional(),
  status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  assignee: z.string().optional(),
  dueDate: z.string().optional(),
  estimateHours: z.coerce.number().min(0).max(1000),
  labels: z.string().optional(),
});
type Values = z.infer<typeof schema>;

interface CommentRow { _id: string; body: string; createdAt: string; author: { name: string } }

/** Create (task == null) or edit a task. `defaults` pre-fills status when adding from a column. */
export function TaskModal({ projectId, workspaceId, task, defaultStatus, readOnly, onClose }: {
  projectId: string; workspaceId: string; task: Task | null; defaultStatus?: Task['status']; readOnly: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [comment, setComment] = useState('');
  const [items, setItems] = useState<{ text: string; done: boolean }[]>(task?.checklist ?? []);
  const [newItem, setNewItem] = useState('');
  const members = useQuery({ queryKey: ['members', workspaceId], queryFn: async () => (await api.get<{ members: Member[] }>(`/workspaces/${workspaceId}/members`)).data.members });
  const comments = useQuery({ queryKey: ['comments', task?._id], enabled: !!task, queryFn: async () => (await api.get<{ comments: CommentRow[] }>(`/tasks/${task!._id}/comments`)).data.comments });

  const { register, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      title: task?.title ?? '', description: task?.description ?? '', status: task?.status ?? defaultStatus ?? 'todo', priority: task?.priority ?? 'medium',
      assignee: task?.assignee ?? '', dueDate: task?.dueDate ? task.dueDate.slice(0, 10) : '', estimateHours: task?.estimateHours ?? 0, labels: task?.labels.join(', ') ?? '',
    },
  });
  const done = () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['calendar'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['projects'] }); };

  const save = useMutation({
    mutationFn: async (v: Values) => {
      const payload = {
        title: v.title, description: v.description ?? '', status: v.status, priority: v.priority, estimateHours: v.estimateHours,
        assignee: v.assignee || null, dueDate: v.dueDate ? new Date(v.dueDate).toISOString() : null,
        labels: (v.labels ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10),
      };
      return task ? api.patch(`/tasks/${task._id}`, payload) : api.post('/tasks', { ...payload, projectId });
    },
    onSuccess: () => { done(); toast.success(task ? 'Task updated' : 'Task created'); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: async () => api.delete(`/tasks/${task!._id}`),
    onSuccess: () => { done(); toast.success('Task deleted'); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveChecklist = useMutation({
    mutationFn: async (next: { text: string; done: boolean }[]) => api.patch(`/tasks/${task!._id}`, { checklist: next }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['calendar'] }); },
    onError: (e, _next, prev) => { toast.error(errorMessage(e)); if (prev) setItems(prev as never); },
    onMutate: () => items,
  });
  const persist = (next: { text: string; done: boolean }[]) => { setItems(next); saveChecklist.mutate(next); };
  const progress = checklistProgress(items);
  const addComment = useMutation({
    mutationFn: async () => api.post(`/tasks/${task!._id}/comments`, { body: comment }),
    onSuccess: () => { setComment(''); qc.invalidateQueries({ queryKey: ['comments', task!._id] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Modal title={task ? `${task.key} · Edit task` : 'New task'} onClose={onClose} wide>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="grid gap-3 md:grid-cols-2" noValidate>
        <fieldset disabled={readOnly} className="contents">
          <div className="md:col-span-2"><Field label="Title" error={errors.title?.message}><input className="input" {...register('title')} /></Field></div>
          <div className="md:col-span-2"><Field label="Description"><textarea className="input" rows={3} {...register('description')} /></Field></div>
          <Field label="Status"><select className="input" {...register('status')}>{STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
          <Field label="Priority"><select className="input" {...register('priority')}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></Field>
          <Field label="Assignee">
            <select className="input" {...register('assignee')}>
              <option value="">Unassigned</option>
              {members.data?.map((m) => <option key={m.user._id} value={m.user._id}>{m.user.name}</option>)}
            </select>
          </Field>
          <Field label="Due date"><input type="date" className="input" {...register('dueDate')} /></Field>
          <Field label="Estimate (hours)" error={errors.estimateHours?.message}><input type="number" step="0.5" min="0" className="input" {...register('estimateHours')} /></Field>
          <Field label="Labels (comma separated)"><input className="input" {...register('labels')} /></Field>
        </fieldset>
        <div className="flex items-center justify-between gap-2 md:col-span-2">
          <div>{task && !readOnly && <button type="button" className="btn-danger" onClick={() => setConfirmDelete(true)}>Delete</button>}</div>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
            {!readOnly && <button className="btn-primary" disabled={save.isPending}>{task ? 'Save changes' : 'Create task'}</button>}
          </div>
        </div>
      </form>

      {task && (
        <div className="mt-6 grid gap-6 border-t border-slate-200 pt-4 md:grid-cols-2 dark:border-slate-800">
          <div className="md:col-span-2">
            <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Checklist</h3>{progress.total > 0 && <span className="text-xs text-slate-500">{progress.done}/{progress.total} done ({progress.pct}%)</span>}</div>
            {progress.total > 0 && <div className="mb-2 h-1.5 overflow-hidden rounded bg-slate-200 dark:bg-slate-800"><div className="h-full bg-emerald-500" style={{ width: `${progress.pct}%` }} /></div>}
            <ul className="space-y-1 text-sm">
              {items.map((it, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input type="checkbox" aria-label={`Mark "${it.text}" done`} checked={it.done} disabled={readOnly} onChange={() => persist(items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} />
                  <span className={`flex-1 ${it.done ? 'text-slate-400 line-through' : ''}`}>{it.text}</span>
                  {!readOnly && <button type="button" aria-label={`Remove "${it.text}"`} className="text-slate-400 hover:text-red-600" onClick={() => persist(items.filter((_, j) => j !== i))}>&times;</button>}
                </li>
              ))}
              {items.length === 0 && <li className="text-slate-500">No checklist items.</li>}
            </ul>
            {!readOnly && items.length < 30 && (
              <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = newItem.trim(); if (!t) return; persist([...items, { text: t.slice(0, 200), done: false }]); setNewItem(''); }}>
                <input className="input" placeholder="Add a checklist item" maxLength={200} value={newItem} onChange={(e) => setNewItem(e.target.value)} />
                <button className="btn-ghost" disabled={!newItem.trim()}>Add</button>
              </form>
            )}
          </div>
          <div className="md:col-span-2"><TimeTracker taskId={task._id} workspaceId={workspaceId} estimateHours={task.estimateHours} readOnly={readOnly} /></div>
          <div>
            <DependencyEditor taskId={task._id} projectId={task.project} readOnly={readOnly} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Comments</h3>
            {comments.isLoading ? <Spinner /> : (
              <ul className="mb-3 max-h-48 space-y-2 overflow-y-auto text-sm">
                {comments.data?.length === 0 && <li className="text-slate-500">No comments yet.</li>}
                {comments.data?.map((c) => (
                  <li key={c._id} className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800"><span className="font-medium">{c.author.name}</span> <span className="text-xs text-slate-500">{format(new Date(c.createdAt), 'MMM d, HH:mm')}</span><p className="whitespace-pre-wrap">{c.body}</p></li>
                ))}
              </ul>
            )}
            {!readOnly && (
              <div className="flex gap-2">
                <input className="input" placeholder="Add a comment (@email to mention)" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={4000} />
                <button className="btn-primary" disabled={!comment.trim() || addComment.isPending} onClick={() => addComment.mutate()}>Post</button>
              </div>
            )}
          </div>
        </div>
      )}
      {confirmDelete && <ConfirmDialog title="Delete task?" message="This also removes its comments." busy={remove.isPending} onConfirm={() => remove.mutate()} onClose={() => setConfirmDelete(false)} />}
    </Modal>
  );
}
