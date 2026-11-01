import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { api, errorMessage } from '../lib/api';
import { useWorkspace } from '../hooks/useWorkspace';
import { ConfirmDialog, EmptyState, Field, Skeleton } from '../components/ui';
import { usePermissions } from '../hooks/usePermissions';

const schema = z.object({ name: z.string().trim().min(1, 'Name is required').max(80), description: z.string().max(500).optional() });

export default function Workspaces() {
  const { workspaces, current, select, loading } = useWorkspace();
  const { can } = usePermissions();
  const qc = useQueryClient();
  const [toDelete, setToDelete] = useState<string | null>(null);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const create = useMutation({
    mutationFn: async (v: z.infer<typeof schema>) => (await api.post('/workspaces', v)).data.workspace,
    onSuccess: (ws) => { qc.invalidateQueries({ queryKey: ['workspaces'] }); select(ws._id); reset(); toast.success('Workspace created'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/workspaces/${id}`),
    onSuccess: () => { qc.invalidateQueries(); setToDelete(null); toast.success('Workspace deleted'); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Workspaces</h1>
      <form onSubmit={handleSubmit((v) => create.mutate(v))} className="card space-y-3 p-4" noValidate>
        <h2 className="font-medium">Create a workspace</h2>
        <Field label="Name" error={errors.name?.message}><input className="input" {...register('name')} /></Field>
        <Field label="Description (optional)" error={errors.description?.message}><input className="input" {...register('description')} /></Field>
        <button className="btn-primary" disabled={create.isPending}>Create workspace</button>
      </form>
      {loading ? <Skeleton className="h-24" /> : workspaces.length === 0 ? (
        <EmptyState title="No workspaces yet" hint="Create your first workspace above." />
      ) : (
        <ul className="space-y-3">
          {workspaces.map((w) => (
            <li key={w._id} className="card flex items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{w.name} {current?._id === w._id && <span className="ml-2 rounded bg-brand-50 px-2 py-0.5 text-xs text-brand-700 dark:bg-brand-600/20">current</span>}</p>
                <p className="text-sm text-slate-500">Your role: {w.myRole}{w.description ? ` · ${w.description}` : ''}</p>
              </div>
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={() => select(w._id)}>Switch</button>
                {w.permissions.includes('workspace.delete') && <button className="btn-danger" onClick={() => setToDelete(w._id)}>Delete</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {toDelete && (
        <ConfirmDialog title="Delete workspace?" message="This permanently deletes the workspace with all its projects, tasks and comments." busy={remove.isPending} onConfirm={() => remove.mutate(toDelete)} onClose={() => setToDelete(null)} />
      )}
      <p className="text-xs text-slate-500">{can('members.manage') ? 'You can manage members on the Team page.' : ''}</p>
    </div>
  );
}
