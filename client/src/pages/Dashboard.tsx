import { Link } from 'react-router-dom';
import { dashboardKind } from '../lib/nav';
import { usePermissions } from '../hooks/usePermissions';
import { useWorkspace } from '../hooks/useWorkspace';
import { EmptyState, Skeleton } from '../components/ui';
import AdminDashboard from './dashboards/AdminDashboard';
import MemberDashboard from './dashboards/MemberDashboard';
import ViewerDashboard from './dashboards/ViewerDashboard';

/** One entry point, three dashboards. The role decides which one (through permissions); the API enforces it again. */
export default function Dashboard() {
  const { loading } = useWorkspace();
  const { can, hasWorkspace } = usePermissions();
  if (loading) return <Skeleton className="h-40" />;
  const kind = dashboardKind(can, hasWorkspace);
  if (kind === 'admin') return <AdminDashboard />;
  if (kind === 'member') return <MemberDashboard />;
  if (kind === 'viewer') return <ViewerDashboard />;
  return <EmptyState title="Create a workspace to get started" action={<Link to="/workspaces" className="btn-primary">Create workspace</Link>} />;
}
