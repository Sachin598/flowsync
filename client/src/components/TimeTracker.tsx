import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Play, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '../lib/api';
import { useTimer } from '../hooks/useTimer';
import { clock, toneClass, validateLogForm, varianceLabel, type LogErrors } from '../lib/timeForm';
import { formatMinutes } from '../lib/utils';
import { ConfirmDialog, Field, Skeleton } from './ui';
import { LogTimeModal, type EditableEntry } from './LogTimeModal';

interface Entry { _id: string; minutes: number; note: string; date: string; source: string; canEdit: boolean; user: { _id: string; name: string } }
const today = () => format(new Date(), 'yyyy-MM-dd');

/** Time section of the task details dialog: server-side timer, manual log form, and this task's entry history. */
export function TimeTracker({ taskId, workspaceId, estimateHours, readOnly }: { taskId: string; workspaceId: string; estimateHours: number; readOnly: boolean }) {
  const qc = useQueryClient();
  const { timer, elapsedMs, start, stop, discard } = useTimer();
  const [form, setForm] = useState({ duration: '', date: today(), note: '' });
  const [errors, setErrors] = useState<LogErrors>({});
  const [serverError, setServerError] = useState('');
  const [editing, setEditing] = useState<EditableEntry | null>(null);
  const [deleting, setDeleting] = useState<Entry | null>(null);

  const q = useQuery({
    queryKey: ['time', taskId],
    queryFn: async () => (await api.get<{ entries: Entry[]; totalMinutes: number; scope: 'all' | 'self' }>('/time-entries', { params: { taskId } })).data,
  });
  const refresh = () => { for (const k of ['time', 'timeReport', 'timeHistory']) qc.invalidateQueries({ queryKey: [k] }); };

  const log = useMutation({
    mutationFn: async (minutes: number) => api.post('/time-entries', { taskId, minutes, date: form.date, note: form.note.trim() }),
    onSuccess: () => { setForm({ duration: '', date: today(), note: '' }); setServerError(''); toast.success('Time logged'); refresh(); },
    onError: (e) => setServerError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/time-entries/${id}`),
    onSuccess: () => { setDeleting(null); toast.success('Time entry deleted'); refresh(); },
    onError: (e) => { setDeleting(null); toast.error(errorMessage(e)); },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');
    const r = validateLogForm({ ...form, projectId: '', taskId }, today(), { requireTask: false });
    setErrors(r.errors);
    if (r.valid && r.minutes) log.mutate(r.minutes);
  };

  const total = q.data?.totalMinutes ?? 0;
  const estimateMinutes = Math.round(estimateHours * 60);
  const variance = varianceLabel({ estimateMinutes, varianceMinutes: total - estimateMinutes, variancePct: estimateMinutes ? Math.round(((total - estimateMinutes) / estimateMinutes) * 100) : null });
  const pct = estimateMinutes > 0 ? Math.min(100, Math.round((total / estimateMinutes) * 100)) : 0;
  const timerHere = timer?.task._id === taskId;
  const busy = start.isPending || stop.isPending;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Time tracking</h3>
        {q.isLoading ? <Skeleton className="h-4 w-40" /> : (
          <span className="text-xs text-slate-500">
            Actual {formatMinutes(total)} / estimate {estimateMinutes ? formatMinutes(estimateMinutes) : 'none'} &middot; <span className={toneClass[variance.tone]}>variance {variance.text}</span>
          </span>
        )}
      </div>
      {estimateMinutes > 0 && <div className="mb-2 h-1.5 overflow-hidden rounded bg-slate-200 dark:bg-slate-800"><div className={`h-full ${total > estimateMinutes ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} /></div>}

      {!readOnly && (
        <div className="mb-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {timerHere ? (
              <>
                <button type="button" className="btn-danger" disabled={busy} onClick={() => stop.mutate(undefined)}><Square className="h-4 w-4" /> Stop timer</button>
                <span className="font-mono text-sm" role="timer">{clock(elapsedMs)}</span>
                <button type="button" className="text-xs text-slate-500 underline" disabled={discard.isPending} onClick={() => discard.mutate()}>Discard</button>
              </>
            ) : (
              <button type="button" className="btn-ghost" disabled={busy || !!timer} onClick={() => start.mutate({ taskId })}><Play className="h-4 w-4" /> Start timer</button>
            )}
            {timer && !timerHere && <span className="text-xs text-amber-600">A timer is running on {timer.task.key}. Stop it before starting another.</span>}
          </div>
          <form className="grid gap-2 sm:grid-cols-[8rem_10rem_1fr_auto]" onSubmit={submit} noValidate>
            <Field label="Duration" error={errors.duration}><input className="input" placeholder="e.g. 1h30m" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} /></Field>
            <Field label="Work date" error={errors.date}><input type="date" className="input" max={today()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="Description" error={errors.note}><input className="input" maxLength={220} placeholder="Optional" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
            <div className="flex items-end"><button className="btn-ghost w-full" disabled={log.isPending}>{log.isPending ? 'Logging…' : 'Log time'}</button></div>
          </form>
          {serverError && <p role="alert" className="text-sm text-red-600">{serverError}</p>}
        </div>
      )}

      {q.isLoading ? <Skeleton className="h-16" /> : q.isError ? (
        <p role="alert" className="text-sm text-red-600">{errorMessage(q.error)} <button className="underline" onClick={() => q.refetch()}>Retry</button></p>
      ) : (
        <>
          {q.data!.scope === 'self' && <p className="mb-1 text-xs text-slate-500">Showing your own entries. The total above includes everyone.</p>}
          <ul className="max-h-44 space-y-1 overflow-y-auto text-sm">
            {q.data!.entries.length === 0 && <li className="text-slate-500">No time logged{q.data!.scope === 'self' ? ' by you' : ''} yet.</li>}
            {q.data!.entries.map((en) => (
              <li key={en._id} className="flex items-center gap-2">
                <span className="w-16 shrink-0 font-medium">{formatMinutes(en.minutes)}</span>
                <span className="flex-1 truncate text-slate-500">{en.user.name} &middot; {format(new Date(`${en.date.slice(0, 10)}T00:00:00`), 'MMM d')} &middot; {en.source}{en.note ? ` · ${en.note}` : ''}</span>
                {en.canEdit && !readOnly && (
                  <>
                    <button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => setEditing({ _id: en._id, minutes: en.minutes, note: en.note, date: en.date })}>Edit</button>
                    <button type="button" aria-label="Delete time entry" className="text-slate-400 hover:text-red-600" onClick={() => setDeleting(en)}><Trash2 className="h-3.5 w-3.5" /></button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {editing && <LogTimeModal workspaceId={workspaceId} entry={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {deleting && <ConfirmDialog title="Delete time entry?" message={`${formatMinutes(deleting.minutes)} on ${deleting.date.slice(0, 10)} will be removed. This is recorded in the audit log.`} busy={remove.isPending} onConfirm={() => remove.mutate(deleting._id)} onClose={() => setDeleting(null)} />}
    </div>
  );
}
