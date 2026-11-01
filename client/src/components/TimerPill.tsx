import { Link } from 'react-router-dom';
import { Square } from 'lucide-react';
import { useTimer } from '../hooks/useTimer';
import { clock } from '../lib/timeForm';

/** Shows the running timer on every page so it can never be forgotten. */
export function TimerPill() {
  const { timer, elapsedMs, stop } = useTimer();
  if (!timer) return null;
  return (
    <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm dark:bg-emerald-950" role="status" aria-label="Timer running">
      <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
      <Link to={`/projects/${timer.project._id}`} className="hidden font-medium hover:underline sm:inline">{timer.task.key}</Link>
      <span className="font-mono">{clock(elapsedMs)}</span>
      <button className="rounded p-1 hover:bg-emerald-100 dark:hover:bg-emerald-900" aria-label="Stop timer and log time" disabled={stop.isPending} onClick={() => stop.mutate(undefined)}>
        <Square className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
