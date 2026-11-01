import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api, errorMessage } from '../lib/api';
import { EmptyState, ErrorState, Skeleton } from '../components/ui';
import type { Notification } from '../types';

export default function Notifications() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: async () => (await api.get<{ notifications: Notification[]; unread: number }>('/notifications')).data });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readOne = useMutation({ mutationFn: async (id: string) => api.patch(`/notifications/${id}/read`), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: async () => api.post('/notifications/read-all'), onSuccess: refresh });
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <button className="btn-ghost" disabled={!q.data?.unread || readAll.isPending} onClick={() => readAll.mutate()}>Mark all as read</button>
      </div>
      {q.isLoading ? <Skeleton className="h-32" /> : q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : q.data!.notifications.length === 0 ? (
        <EmptyState title="You're all caught up" hint="Assignments and @mentions will show up here." />
      ) : (
        <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
          {q.data!.notifications.map((n) => (
            <li key={n._id} className={`flex items-center justify-between gap-3 p-4 ${n.read ? 'opacity-60' : ''}`}>
              <div><p className="text-sm">{n.message}</p><p className="text-xs text-slate-500">{format(new Date(n.createdAt), 'MMM d, HH:mm')}</p></div>
              {!n.read && <button className="btn-ghost" onClick={() => readOne.mutate(n._id)}>Mark read</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
