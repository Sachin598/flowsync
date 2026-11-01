import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '../lib/api';
import { timerElapsedMs } from '../lib/timeForm';
import { formatMinutes } from '../lib/utils';

export interface ActiveTimer {
  _id: string;
  startedAt: string;
  note: string;
  task: { _id: string; key: string; title: string };
  project: { _id: string; name: string; key: string };
}

/**
 * The running timer lives on the server (one per user), so it survives refreshes, other tabs and other devices.
 * The browser only displays it: elapsed time is derived from the server's start timestamp, corrected for clock skew,
 * and the server alone decides the final duration when the timer is stopped.
 */
export function useTimer() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['timer'],
    queryFn: async () => {
      const { data } = await api.get<{ timer: ActiveTimer | null; serverNow: string }>('/time-entries/timer');
      return { timer: data.timer, skew: new Date(data.serverNow).getTime() - Date.now() };
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
  const timer = q.data?.timer ?? null;
  const skew = q.data?.skew ?? 0;

  const [, setTick] = useState(0);
  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [timer]);

  const refresh = () => {
    for (const key of ['timer', 'time', 'timeReport', 'timeHistory']) qc.invalidateQueries({ queryKey: [key] });
  };
  const start = useMutation({
    mutationFn: async (v: { taskId: string; note?: string }) =>
      api.post('/time-entries/timer/start', { ...v, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    onSuccess: refresh,
    onError: (e) => { toast.error(errorMessage(e)); refresh(); },
  });
  const stop = useMutation({
    mutationFn: async (note?: string) => (await api.post<{ minutes: number; capped: boolean }>('/time-entries/timer/stop', note ? { note } : {})).data,
    onSuccess: (d) => {
      toast.success(d.capped ? `Logged ${formatMinutes(d.minutes)} (capped at 24h - please check the entry)` : `Logged ${formatMinutes(d.minutes)}`);
      refresh();
    },
    onError: (e) => { toast.error(errorMessage(e)); refresh(); },
  });
  const discard = useMutation({
    mutationFn: async () => api.delete('/time-entries/timer'),
    onSuccess: () => { toast.success('Timer discarded - nothing was logged'); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return {
    timer,
    loading: q.isLoading,
    error: q.isError ? errorMessage(q.error) : null,
    elapsedMs: timer ? timerElapsedMs(timer.startedAt, skew, Date.now()) : 0,
    start, stop, discard,
  };
}
