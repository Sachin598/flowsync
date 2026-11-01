import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { ConfirmDialog, EmptyState, ErrorState, Skeleton } from '../components/ui';
import { usePermissions } from '../hooks/usePermissions';
import type { Member } from '../types';

export default function Team() {
  const { current } = useWorkspace();
  const { can } = usePermissions();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [removing, setRemoving] = useState<Member | null>(null);
  const id = current?._id;
  const q = useQuery({ queryKey: ['members', id], enabled: !!id, queryFn: async () => (await api.get<{ members: Member[] }>(`/workspaces/${id}/members`)).data.members });
  const refresh = () => qc.invalidateQueries({ queryKey: ['members', id] });
  const add = useMutation({
    mutationFn: async () => api.post(`/workspaces/${id}/members`, { email, role }),
    onSuccess: () => { setEmail(''); refresh(); toast.success('Member added'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const changeRole = useMutation({
    mutationFn: async (v: { userId: string; role: string }) => api.patch(`/workspaces/${id}/members/${v.userId}`, { role: v.role }),
    onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: async (userId: string) => api.delete(`/workspaces/${id}/members/${userId}`),
    onSuccess: () => { setRemoving(null); refresh(); toast.success('Member removed'); }, onError: (e) => toast.error(errorMessage(e)),
  });

  if (!current) return <EmptyState title="Create a workspace first" />;
  const admin = can('members.manage');
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">{admin ? 'Team management' : 'Team'}</h1>
      {admin && (
        <form className="card flex flex-wrap items-end gap-2 p-4" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <div className="min-w-56 flex-1"><label className="label" htmlFor="invite-email">Add by email (must already have an account)</label><input id="invite-email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><label className="label" htmlFor="invite-role">Role</label><select id="invite-role" className="input" value={role} onChange={(e) => setRole(e.target.value)}><option>viewer</option><option>member</option>{can('admins.manage') && <option>admin</option>}</select></div>
          <button className="btn-primary" disabled={add.isPending}>Add member</button>
        </form>
      )}
      {q.isLoading ? <Skeleton className="h-32" /> : q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : (
        <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
          {q.data!.map((m) => (
            <li key={m.user._id} className="flex flex-wrap items-center justify-between gap-2 p-4">
              <div><p className="font-medium">{m.user.name}{m.user._id === user?.id && ' (you)'}</p><p className="text-sm text-slate-500">{m.user.email}</p></div>
              <div className="flex items-center gap-2">
                {admin && m.role !== 'owner' && m.user._id !== user?.id ? (
                  <>
                    <select aria-label={`Role for ${m.user.name}`} className="input w-auto" value={m.role} onChange={(e) => changeRole.mutate({ userId: m.user._id, role: e.target.value })}>
                      <option>viewer</option><option>member</option>{can('admins.manage') && <option>admin</option>}
                    </select>
                    <button className="btn-ghost" onClick={() => setRemoving(m)}>Remove</button>
                  </>
                ) : <span className="rounded bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">{m.role}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {removing && <ConfirmDialog title="Remove member?" message={`${removing.user.name} will lose access. Their tasks become unassigned.`} confirmLabel="Remove" busy={remove.isPending} onConfirm={() => remove.mutate(removing.user._id)} onClose={() => setRemoving(null)} />}
    </div>
  );
}
