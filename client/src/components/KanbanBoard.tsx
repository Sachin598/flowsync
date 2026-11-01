import { useState } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { format } from 'date-fns';
import { CalendarDays, Link2, ListChecks } from 'lucide-react';
import { STATUSES, checklistProgress, isOverdue, priorityClass } from '../lib/utils';
import type { Task, TaskStatus } from '../types';

function Card({ task, onOpen, dragging }: { task: Task; onOpen?: () => void; dragging?: boolean }) {
  const overdue = isOverdue(task.dueDate, task.status);
  const cl = checklistProgress(task.checklist);
  return (
    <div className={`card cursor-grab p-3 text-left ${dragging ? 'shadow-lg ring-2 ring-brand-500' : ''}`}>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{task.key}</span>
        <span className={`rounded px-1.5 py-0.5 ${priorityClass[task.priority]}`}>{task.priority}</span>
      </div>
      <button className="mt-1 block w-full text-left text-sm font-medium hover:underline" onClick={onOpen} onPointerDown={(e) => e.stopPropagation()}>
        {task.title}
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        {task.dueDate && (
          <span className={`flex items-center gap-1 ${overdue ? 'font-medium text-red-600' : ''}`}>
            <CalendarDays className="h-3 w-3" /> {format(new Date(task.dueDate), 'MMM d')}{overdue && ' (overdue)'}
          </span>
        )}
        {cl.total > 0 && <span className={`flex items-center gap-1 ${cl.done === cl.total ? 'text-emerald-600' : ''}`}><ListChecks className="h-3 w-3" /> {cl.done}/{cl.total}</span>}
        {task.blockedBy.length > 0 && <span className="flex items-center gap-1"><Link2 className="h-3 w-3" /> blocked</span>}
        {task.labels.map((l) => <span key={l} className="rounded bg-slate-100 px-1.5 dark:bg-slate-800">{l}</span>)}
      </div>
    </div>
  );
}

function SortableCard({ task, onOpen, disabled }: { task: Task; onOpen: () => void; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task._id, disabled });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }} {...attributes} {...listeners}>
      <Card task={task} onOpen={onOpen} />
    </div>
  );
}

function Column({ id, label, tasks, onOpen, onAdd, readOnly }: { id: TaskStatus; label: string; tasks: Task[]; onOpen: (t: Task) => void; onAdd?: (status: TaskStatus) => void; readOnly: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section aria-label={label} className={`flex w-72 shrink-0 flex-col rounded-xl bg-slate-100 p-2 dark:bg-slate-900/60 ${isOver ? 'ring-2 ring-brand-500' : ''}`}>
      <div className="flex items-center justify-between px-2 py-1">
        <h3 className="text-sm font-semibold">{label} <span className="font-normal text-slate-500">{tasks.length}</span></h3>
        {!readOnly && <button className="rounded px-2 text-lg leading-none hover:bg-slate-200 dark:hover:bg-slate-800" aria-label={`Add task to ${label}`} onClick={() => onAdd?.(id)}>+</button>}
      </div>
      <div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 p-1">
        <SortableContext items={tasks.map((t) => t._id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => <SortableCard key={t._id} task={t} disabled={readOnly} onOpen={() => onOpen(t)} />)}
        </SortableContext>
        {tasks.length === 0 && <p className="p-3 text-center text-xs text-slate-500">No tasks</p>}
      </div>
    </section>
  );
}

export function KanbanBoard({ tasks, readOnly, onMove, onOpen, onAdd }: {
  tasks: Task[]; readOnly: boolean; onMove: (taskId: string, status: TaskStatus, index: number) => void; onOpen: (t: Task) => void; onAdd: (s: TaskStatus) => void;
}) {
  const [active, setActive] = useState<Task | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const column = (s: TaskStatus) => tasks.filter((t) => t.status === s).sort((a, b) => a.position - b.position);

  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const { active: a, over } = e;
    if (!over || readOnly) return;
    const moving = tasks.find((t) => t._id === a.id);
    if (!moving) return;
    const overId = String(over.id);
    const isColumn = STATUSES.some((s) => s.id === overId);
    const overTask = isColumn ? null : tasks.find((t) => t._id === overId);
    const target = (isColumn ? overId : overTask?.status) as TaskStatus | undefined;
    if (!target) return;
    const others = column(target).filter((t) => t._id !== moving._id);
    let index = others.length;
    if (overTask) {
      const overIndex = others.findIndex((t) => t._id === overTask._id);
      const original = column(target).findIndex((t) => t._id === moving._id);
      const overOriginal = column(target).findIndex((t) => t._id === overTask._id);
      index = moving.status === target && original !== -1 && original < overOriginal ? overIndex + 1 : overIndex;
    }
    if (moving.status === target && column(target).findIndex((t) => t._id === moving._id) === index) return;
    onMove(moving._id, target, index);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={(e: DragStartEvent) => setActive(tasks.find((t) => t._id === e.active.id) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {STATUSES.map((s) => <Column key={s.id} id={s.id} label={s.label} tasks={column(s.id)} onOpen={onOpen} onAdd={onAdd} readOnly={readOnly} />)}
      </div>
      <DragOverlay>{active ? <Card task={active} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}
