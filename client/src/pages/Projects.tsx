import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useWorkspace } from '../hooks/useWorkspace';
import { EmptyState, ErrorState, Field, Modal, Skeleton } from '../components/ui';
import { usePermissions } from '../hooks/usePermissions';
import type { Project } from '../types';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  key: z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/, 'Key must be 2-5 letters'),
  description: z.string().max(2000).optional(),
});

export default function Projects() {
  const { current } = useWorkspace();
  const { can } = usePermissions();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['projects', current?._id],
    enabled: !!current,
    queryFn: async () => (await api.get<{ projects: Project[] }>('/projects', { params: { workspaceId: current!._id } })).data.projects,
  });
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const create = useMutation({
    mutationFn: async (v: z.infer<typeof schema>) => api.post('/projects', { ...v, workspaceId: current!._id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); setOpen(false); reset(); toast.success('Project created'); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!current) return <EmptyState title="Create a workspace first" action={<Link className="btn-primary" to="/workspaces">Create workspace</Link>} />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        {can('project.create') && <button className="btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New project</button>}
      </div>
      {q.isLoading ? <div className="grid gap-4 md:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}</div>
        : q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        : q.data!.length === 0 ? <EmptyState title="No projects yet" hint="Projects hold your tasks and Kanban board." />
        : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {q.data!.map((p) => (
              <Link key={p._id} to={`/projects/${p._id}`} className="card p-4 transition hover:border-brand-500">
                <div className="flex items-center justify-between"><h3 className="font-medium">{p.name}</h3><span className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">{p.key}</span></div>
                <p className="mt-1 line-clamp-2 text-sm text-slate-500">{p.description || 'No description'}</p>
                <div className="mt-4 h-1.5 overflow-hidden rounded bg-slate-200 dark:bg-slate-800"><div className="h-full bg-brand-600" style={{ width: `${p.progress ?? 0}%` }} /></div>
                <p className="mt-1 text-xs text-slate-500">{p.taskDone}/{p.taskTotal} tasks done · {p.status}</p>
              </Link>
            ))}
          </div>
        )}
      {open && (
        <Modal title="New project" onClose={() => setOpen(false)}>
          <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-3" noValidate>
            <Field label="Name" error={errors.name?.message}><input className="input" {...register('name')} /></Field>
            <Field label="Key (2-5 letters, used in task ids like WEB-1)" error={errors.key?.message}><input className="input uppercase" maxLength={5} {...register('key')} /></Field>
            <Field label="Description" error={errors.description?.message}><textarea className="input" rows={3} {...register('description')} /></Field>
            <button className="btn-primary w-full" disabled={create.isPending}>Create project</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
