import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { WorkspaceProvider } from './hooks/useWorkspace';
import { AppLayout } from './layouts/AppLayout';
import { Spinner } from './components/ui';
import Landing from './pages/Landing';
import { Login, Register } from './pages/AuthPages';
import Dashboard from './pages/Dashboard';
import Workspaces from './pages/Workspaces';
import Projects from './pages/Projects';
import ProjectBoard from './pages/ProjectBoard';
import Team from './pages/Team';
import Calendar from './pages/Calendar';
import Search from './pages/Search';
import TimeReport from './pages/TimeReport';
import AuditLog from './pages/AuditLog';
import MyTasks from './pages/MyTasks';
import MyProjects from './pages/MyProjects';
import RolesPermissions from './pages/RolesPermissions';
import SecurityDashboard from './pages/SecurityDashboard';
import Reports from './pages/Reports';
import { RequirePermission } from './components/RequirePermission';
import Notifications from './pages/Notifications';
import Settings from './pages/Settings';
import NotFound from './pages/NotFound';

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <WorkspaceProvider>
      <AppLayout>
        <Outlet />
      </AppLayout>
    </WorkspaceProvider>
  );
}

function GuestOnly() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return user ? <Navigate to="/dashboard" replace /> : <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>
      <Route element={<Protected />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/workspaces" element={<Workspaces />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:projectId" element={<ProjectBoard />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/search" element={<Search />} />
        <Route path="/time" element={<RequirePermission permission="time.log"><TimeReport /></RequirePermission>} />
        <Route path="/my-tasks" element={<RequirePermission permission="dashboard.member"><MyTasks /></RequirePermission>} />
        <Route path="/my-projects" element={<RequirePermission permission="dashboard.member"><MyProjects /></RequirePermission>} />
        <Route path="/roles" element={<RequirePermission permission="roles.view"><RolesPermissions /></RequirePermission>} />
        <Route path="/security" element={<RequirePermission permission="security.view"><SecurityDashboard /></RequirePermission>} />
        <Route path="/reports" element={<RequirePermission permission="reports.view"><Reports /></RequirePermission>} />
        <Route path="/audit" element={<RequirePermission permission="audit.view"><AuditLog /></RequirePermission>} />
        <Route path="/team" element={<Team />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
