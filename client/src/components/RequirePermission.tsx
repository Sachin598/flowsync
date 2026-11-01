import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions';
import { useWorkspace } from '../hooks/useWorkspace';
import { EmptyState, Skeleton } from './ui';

/** Guards a page. The API enforces the same rule; this just shows a clear message instead of a broken page. */
export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = usePermissions();
  const { loading } = useWorkspace();
  if (loading) return <Skeleton className="h-40" />;
  if (!can(permission)) {
    return <EmptyState title="You don't have access to this page" hint="Your role in this workspace doesn't include it. Ask a workspace admin if you need access." action={<Link className="btn-primary" to="/dashboard">Back to dashboard</Link>} />;
  }
  return <>{children}</>;
}
