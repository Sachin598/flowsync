import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { api, errorMessage } from '../lib/api';
import { Field, Modal } from './ui';
import { validateLogForm, type LogErrors, type LogForm } from '../lib/timeForm';
import { formatMinutes } from '../lib/utils';
import type { Project, Task } from '../types';

export interface EditableEntry {
  _id: string; minutes: number; note: string; date: string;
  task?: { key: string; title: string }; project?: { name: string; key: string };
}

/** Manual "Log time" form (project, task, duration, date, description) and the edit form for an existing entry. */
export function LogTimeModal({ workspaceId, entry, onClose, onSaved }: { workspaceId: string; entry?: EditableEntry; onClose: () => void; onSaved: () => void }) {
  const editing = !!entry;
  const today = format(new Date(), 'yyyy-MM-dd');
  const [form, setForm] = useState<LogForm>({
    projectId: '', taskId: '',
    duration: entry ? formatMinutes(entry.minutes).replace(/\s/g, '') : '',
    date: entry ? entry.date.slice(0, 10) : today,
    note: entry?.note ?? '',
  });
  const [errors, setErrors] = useState<LogErrors>({});
  const [serverError, setServerError] = useState('');
  const set = (patch: Partial<LogForm>) => setForm((f) => ({ ...f, ...patch }));

  const projects = useQuery({
    queryKey: ['projects', workspaceId], enabled: !editing,
    queryFn: async () => (await api.get<{ projects: Project[] }>('/projects', { params: { workspaceId } })).data.projects,
  });
  const tasks = useQuery({
    queryKey: ['tasks', form.projectId, 'picker'], enabled: !editing && !!form.projectId,
    queryFn: async () => (await api.get<{ tasks: Task[] }>('/tasks', { params: { projectId: form.projectId, limit: 100, sort: 'title', order: 'asc' } })).data.tasks,
  });

  const save = useMutation({
    mutationFn: async (v: { minutes: number }) =>
      editing
        ? api.patch(`/time-entries/${entry!._id}`, { minutes: v.minutes, date: form.date, note: form.note.trim() })
        : api.post('/time-entries', { taskId: form.taskId, projectId: form.projectId, minutes: v.minutes, date: form.date, note: form.note.trim() }),
    onSuccess: () => { toast.success(editing ? 'Time entry updated' : 'Time logged'); onSaved(); onClose(); },
    onError: (e) => setServerError(errorMessage(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');
    const r = validateLogForm(form, today, { requireTask: !editing });
    setErrors(r.errors);
    if (r.valid && r.minutes) save.mutate({ minutes: r.minutes });
  };

  return (
    <Modal title={editing ? 'Edit time entry' : 'Log time'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        {editing ? (
          <p className="rounded-lg bg-slate-100 p-2 text-sm dark:bg-slate-800">{entry!.project?.name} &middot; {entry!.task?.key} {entry!.task?.title}</p>
        ) : (
          <>
            <Field label="Project" error={errors.projectId}>
              <select className="input" value={form.projectId} onChange={(e) => set({ projectId: e.target.value, taskId: '' })} disabled={projects.isLoading}>
                <option value="">{projects.isLoading ? 'Loading projects…' : 'Select a project'}</option>
                {projects.data?.map((p) => <option key={p._id} value={p._id}>{p.name} ({p.key})</option>)}
              </select>
              {projects.isError && <p className="err">{errorMessage(projects.error)}</p>}
            </Field>
            <Field label="Task" error={errors.taskId}>
              <select className="input" value={form.taskId} onChange={(e) => set({ taskId: e.target.value })} disabled={!form.projectId || tasks.isLoading}>
                <option value="">{!form.projectId ? 'Choose a project first' : tasks.isLoading ? 'Loading tasks…' : tasks.data?.length ? 'Select a task' : 'No tasks in this project'}</option>
                {tasks.data?.map((t) => <option key={t._id} value={t._id}>{t.key} · {t.title}</option>)}
              </select>
              {tasks.isError && <p className="err">{errorMessage(tasks.error)}</p>}
            </Field>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration" error={errors.duration}><input className="input" placeholder="e.g. 1h30m" value={form.duration} onChange={(e) => set({ duration: e.target.value })} /></Field>
          <Field label="Work date" error={errors.date}><input type="date" className="input" max={today} value={form.date} onChange={(e) => set({ date: e.target.value })} /></Field>
        </div>
        <Field label="Description (optional)" error={errors.note}><input className="input" maxLength={220} value={form.note} onChange={(e) => set({ note: e.target.value })} /></Field>
        {serverError && <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{serverError}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Log time'}</button>
        </div>
      </form>
    </Modal>
  );
}
