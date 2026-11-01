import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Minus } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useWorkspace } from '../hooks/useWorkspace';
import { ErrorState, Skeleton } from '../components/ui';

interface Matrix { roles: string[]; permissions: { key: string; group: string; label: string; roles: string[] }[]; memberCounts: Record<string, number> }

/** Read-only view of the real permission matrix the server enforces, plus how many people hold each role. */
export default function RolesPermissions() {
  const { current } = useWorkspace();
  const q = useQuery({ queryKey: ['roles', current?._id], enabled: !!current, queryFn: async () => (await api.get<Matrix>(`/workspaces/${current!._id}/roles`)).data });
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const m = q.data!;
  const groups = [...new Set(m.permissions.map((p) => p.group))];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Roles &amp; permissions</h1>
        <p className="text-sm text-slate-500">This is exactly what the server enforces on every request. To change someone&apos;s role, use Team management.</p>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="p-3">Permission</th>
              {m.roles.map((r) => <th key={r} className="p-3 text-center capitalize">{r}<span className="block text-xs font-normal text-slate-500">{m.memberCounts[r] ?? 0} {(m.memberCounts[r] ?? 0) === 1 ? 'person' : 'people'}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g}>
                <tr className="bg-slate-50 dark:bg-slate-800/50"><th colSpan={m.roles.length + 1} className="p-2 px-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</th></tr>
                {m.permissions.filter((p) => p.group === g).map((p) => (
                  <tr key={p.key} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="p-3">{p.label}<span className="block font-mono text-xs text-slate-400">{p.key}</span></td>
                    {m.roles.map((r) => (
                      <td key={r} className="p-3 text-center">
                        {p.roles.includes(r) ? <Check className="mx-auto h-4 w-4 text-emerald-600" aria-label={`${r} can`} /> : <Minus className="mx-auto h-4 w-4 text-slate-300" aria-label={`${r} cannot`} />}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Access is granted per workspace. Per-project membership is not part of this version.</p>
    </div>
  );
}
