import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, isToday, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useWorkspace } from '../hooks/useWorkspace';
import { EmptyState, ErrorState, Modal, Skeleton } from '../components/ui';
import { TaskModal } from '../components/TaskModal';
import { STATUSES, STATUS_COLORS, isOverdue, statusLabel } from '../lib/utils';
import { usePermissions } from '../hooks/usePermissions';
import type { Task } from '../types';

const MAX_PER_DAY = 3;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Due dates are stored as UTC midnight of the chosen day, so group by the UTC date part.
const dayKey = (iso: string) => iso.slice(0, 10);
const isoDay = (d: Date) => format(d, 'yyyy-MM-dd');

export default function Calendar() {
  const { current } = useWorkspace();
  const { can } = usePermissions();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [dayList, setDayList] = useState<string | null>(null);
  const [selected, setSelected] = useState<Task | null>(null);

  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const from = isoDay(gridStart);
  const to = isoDay(new Date(gridEnd.getFullYear(), gridEnd.getMonth(), gridEnd.getDate() + 1));

  const q = useQuery({
    queryKey: ['calendar', current?._id, from, to],
    enabled: !!current,
    queryFn: async () => (await api.get<{ tasks: Task[]; truncated: boolean }>('/calendar', { params: { workspaceId: current!._id, from, to } })).data,
  });

  if (!current) return <EmptyState title="Create a workspace first" action={<Link className="btn-primary" to="/workspaces">Create workspace</Link>} />;

  const byDay = new Map<string, Task[]>();
  for (const t of q.data?.tasks ?? []) {
    if (!t.dueDate) continue;
    const k = dayKey(t.dueDate);
    byDay.set(k, [...(byDay.get(k) ?? []), t]);
  }
  const total = q.data?.tasks.length ?? 0;
  const readOnly = !can('task.write');

  const chip = (t: Task) => (
    <button
      key={t._id}
      onClick={() => setSelected(t)}
      title={`${t.key} · ${t.title} · ${statusLabel(t.status)}`}
      className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-xs text-white ${isOverdue(t.dueDate, t.status) ? 'ring-2 ring-red-500' : ''}`}
      style={{ backgroundColor: STATUS_COLORS[t.status] }}
    >
      {t.key} {t.title}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Calendar</h1>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" aria-label="Previous month" onClick={() => setMonth(subMonths(month, 1))}><ChevronLeft className="h-4 w-4" /></button>
          <span className="w-40 text-center font-medium" aria-live="polite">{format(month, 'MMMM yyyy')}</span>
          <button className="btn-ghost" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight className="h-4 w-4" /></button>
          <button className="btn-ghost" onClick={() => setMonth(startOfMonth(new Date()))}>Today</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-300">
        {STATUSES.map((s) => (
          <span key={s.id} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: STATUS_COLORS[s.id] }} /> {s.label}</span>
        ))}
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded ring-2 ring-red-500" /> Overdue</span>
      </div>

      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-96" /> : (
        <>
          {q.data?.truncated && <p className="text-sm text-amber-600">Showing the first 500 tasks for this range.</p>}
          {total === 0 && <p className="text-sm text-slate-500">No tasks have a due date in this view.</p>}
          <div className="card overflow-x-auto">
            <div className="grid min-w-[700px] grid-cols-7 border-b border-slate-200 text-center text-xs font-medium text-slate-500 dark:border-slate-800">
              {WEEKDAYS.map((d) => <div key={d} className="p-2">{d}</div>)}
            </div>
            <div className="grid min-w-[700px] grid-cols-7">
              {days.map((d) => {
                const key = isoDay(d);
                const list = byDay.get(key) ?? [];
                return (
                  <div key={key} className={`min-h-28 border-b border-r border-slate-100 p-1.5 dark:border-slate-800 ${isSameMonth(d, month) ? '' : 'bg-slate-50 opacity-60 dark:bg-slate-900/40'}`}>
                    <div className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs ${isToday(d) ? 'bg-brand-600 font-semibold text-white' : 'text-slate-500'}`}>{format(d, 'd')}</div>
                    <div className="space-y-1">
                      {list.slice(0, MAX_PER_DAY).map(chip)}
                      {list.length > MAX_PER_DAY && (
                        <button className="text-xs text-brand-600 hover:underline" onClick={() => setDayList(key)}>+{list.length - MAX_PER_DAY} more</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {dayList && (
        <Modal title={`Tasks due ${format(new Date(`${dayList}T00:00:00`), 'MMM d, yyyy')}`} onClose={() => setDayList(null)}>
          <ul className="space-y-2">
            {(byDay.get(dayList) ?? []).map((t) => (
              <li key={t._id}>
                <button className="w-full rounded-lg border border-slate-200 p-2 text-left text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onClick={() => { setDayList(null); setSelected(t); }}>
                  <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[t.status] }} />
                  {t.key} {t.title} <span className="text-slate-500">· {statusLabel(t.status)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
      {selected && <TaskModal projectId={selected.project} workspaceId={current._id} task={selected} readOnly={readOnly} onClose={() => setSelected(null)} />}
    </div>
  );
}
