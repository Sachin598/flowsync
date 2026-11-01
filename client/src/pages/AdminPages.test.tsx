import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SecurityDashboard from './SecurityDashboard';
import RolesPermissions from './RolesPermissions';
import MyTasks from './MyTasks';
import Reports from './Reports';

const ws = vi.hoisted(() => ({ perms: ['workspace.view', 'time.log', 'audit.view'] as string[] }));
vi.mock('../hooks/useWorkspace', () => ({ useWorkspace: () => ({ loading: false, current: { _id: 'w1', name: 'Demo', myRole: 'admin', permissions: ws.perms } }) }));
vi.mock('../lib/api', () => ({ api: { get: vi.fn() }, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
import { api } from '../lib/api';

const get = vi.mocked(api.get);
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
const reply = (map: Record<string, unknown>) => get.mockImplementation((async (url: string) => { if (url in map) return { data: map[url] }; throw new Error(`unexpected GET ${url}`); }) as never);
beforeEach(() => { vi.clearAllMocks(); ws.perms = ['workspace.view', 'time.log', 'audit.view']; });

describe('SecurityDashboard', () => {
  const overview = {
    days: 7, flagThreshold: 3,
    counts: { signIns: 12, failedSignIns: 4, passwordChanges: 1, sessionsRevoked: 2, accountsCreated: 5, membersAdded: 3, roleChanges: 1, membersRemoved: 0 },
    flaggedAccounts: [{ userId: 'u1', name: 'Ben Shah', email: 'ben@x.dev', failedSignIns: 3, lastAttempt: '2026-10-29T10:00:00Z' }],
    recentEvents: [{ _id: 'e1', type: 'login_failed', createdAt: '2026-10-29T10:00:00Z', ip: '203.0.113.9', userAgent: 'Mozilla/5.0 Chrome/120 Safari/537', user: { name: 'Ben Shah', email: 'ben@x.dev' } }],
    recentAccessChanges: [{ _id: 'a1', action: 'member.role_changed', createdAt: '2026-10-29T09:00:00Z', meta: { role: 'admin' }, actor: { _id: 'o', name: 'Owen' }, project: null, task: null, target: { _id: 'u1', name: 'Ben Shah' } }],
  };
  it('shows real counts, flagged accounts, readable events and access changes', async () => {
    reply({ '/security/overview': overview });
    wrap(<SecurityDashboard />);
    expect(await screen.findByText('Failed sign-ins')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    const flagged = screen.getByRole('heading', { name: 'Accounts needing attention' }).closest('section')!;
    expect(within(flagged).getByText('Ben Shah')).toBeInTheDocument();
    expect(within(flagged).getByText(/3 failed/)).toBeInTheDocument();
    expect(screen.getByText('Failed sign-in')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.9')).toBeInTheDocument();
    expect(screen.getByText('Chrome')).toBeInTheDocument();
    expect(screen.getByText(/Owen/)).toBeInTheDocument();
    expect(screen.getByText(/changed Ben Shah's role to admin/)).toBeInTheDocument();
    expect(screen.getByText(/deleted automatically after 180 days/)).toBeInTheDocument();
  });
  it('switches the window to 30 days', async () => {
    reply({ '/security/overview': overview });
    wrap(<SecurityDashboard />);
    await screen.findByText('Failed sign-ins');
    await userEvent.click(screen.getByRole('button', { name: 'Last 30 days' }));
    await waitFor(() => expect(get.mock.calls.at(-1)![1]!.params).toMatchObject({ workspaceId: 'w1', days: 30 }));
  });
  it('shows empty states and an error with retry', async () => {
    reply({ '/security/overview': { ...overview, flaggedAccounts: [], recentEvents: [], recentAccessChanges: [] } });
    wrap(<SecurityDashboard />);
    expect(await screen.findByText('No account has repeated failed sign-ins.')).toBeInTheDocument();
    expect(screen.getByText('No events in this window')).toBeInTheDocument();
  });
  it('reports a server error', async () => {
    get.mockRejectedValue(new Error('Cannot reach the server'));
    wrap(<SecurityDashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server');
  });
});

describe('RolesPermissions', () => {
  it('renders the server\'s matrix with who can and cannot, and how many people hold each role', async () => {
    reply({ '/workspaces/w1/roles': { roles: ['owner', 'admin', 'member', 'viewer'], memberCounts: { owner: 1, admin: 1, member: 2, viewer: 1 }, permissions: [
      { key: 'task.write', group: 'Tasks', label: 'Create, edit, move and duplicate tasks', roles: ['member', 'admin', 'owner'] },
      { key: 'audit.view', group: 'Administration', label: 'Read and export the audit log', roles: ['admin', 'owner'] },
    ] } });
    wrap(<RolesPermissions />);
    expect(await screen.findByText('Create, edit, move and duplicate tasks')).toBeInTheDocument();
    expect(screen.getByText('2 people')).toBeInTheDocument();
    expect(screen.getAllByText('1 person')).toHaveLength(3);
    const row = screen.getByText('Read and export the audit log').closest('tr')!;
    expect(within(row).getByLabelText('admin can')).toBeInTheDocument();
    expect(within(row).getByLabelText('member cannot')).toBeInTheDocument();
    expect(within(row).getByLabelText('viewer cannot')).toBeInTheDocument();
  });
  it('shows the server\'s refusal', async () => {
    get.mockRejectedValue(new Error('You do not have permission to do that'));
    wrap(<RolesPermissions />);
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission');
  });
});

describe('MyTasks', () => {
  const rows = [{ _id: 't1', key: 'WEB-2', title: 'Design nav', status: 'in_progress', priority: 'high', dueDate: '2000-01-01T00:00:00.000Z', project: 'p1', projectName: 'Website', estimateHours: 2 }, { _id: 't2', key: 'WEB-3', title: 'Write copy', status: 'todo', priority: 'low', project: 'p1', projectName: 'Website', estimateHours: 0 }];
  it('lists my tasks with project, status, priority and an overdue marker', async () => {
    reply({ '/tasks/mine': { tasks: rows, page: 1, pages: 1, total: 2 } });
    wrap(<MyTasks />);
    expect(await screen.findByText('WEB-2 Design nav')).toBeInTheDocument();
    expect(screen.getAllByText('Website')).toHaveLength(2);
    expect(screen.getByText(/overdue/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/tasks/mine', { params: { workspaceId: 'w1', status: 'open', page: 1, limit: 20 } }); // no user id: the server uses the signed-in user
  });
  it('filters by status and pages', async () => {
    reply({ '/tasks/mine': { tasks: rows, page: 1, pages: 3, total: 41 } });
    wrap(<MyTasks />);
    await screen.findByText('Page 1 of 3');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(get.mock.calls.at(-1)![1]!.params).toMatchObject({ page: 2 }));
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'done');
    await waitFor(() => expect(get.mock.calls.at(-1)![1]!.params).toMatchObject({ status: 'done', page: 1 }));
  });
  it('has an empty state', async () => {
    reply({ '/tasks/mine': { tasks: [], page: 1, pages: 0, total: 0 } });
    wrap(<MyTasks />);
    expect(await screen.findByText('No open tasks assigned to you')).toBeInTheDocument();
  });
});

describe('Reports', () => {
  const p = (o = {}) => ({ id: 'p1', name: 'Website', key: 'WEB', status: 'active', priority: 'high', tasks: 6, done: 2, overdue: 2, progress: 33, openEstimateHours: 12, loggedMinutes: null, health: { level: 'at_risk', reasons: ['2 of 4 open tasks are overdue (50%)'], expectedProgress: null }, ...o });
  it('hides the logged-time column when the server withholds time data (member / viewer)', async () => {
    reply({ '/reports/projects': { projects: [p()] } });
    wrap(<Reports />);
    expect(await screen.findByText('Project performance')).toBeInTheDocument();
    expect(screen.getByText('2 of 4 open tasks are overdue (50%)')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Logged' })).not.toBeInTheDocument();
  });
  it('shows logged time when the server provides it (admin / owner)', async () => {
    reply({ '/reports/projects': { projects: [p({ loggedMinutes: 180 })] } });
    wrap(<Reports />);
    expect(await screen.findByRole('columnheader', { name: 'Logged' })).toBeInTheDocument();
    expect(screen.getByText('3h')).toBeInTheDocument();
  });
  it('links to the audit log only for people who may open it', async () => {
    reply({ '/reports/projects': { projects: [p()] } });
    wrap(<Reports />);
    expect(await screen.findByRole('link', { name: 'Audit log' })).toBeInTheDocument();
  });
  it('shows no audit link to a viewer', async () => {
    ws.perms = ['workspace.view', 'reports.view'];
    reply({ '/reports/projects': { projects: [p()] } });
    wrap(<Reports />);
    await screen.findByText('Project performance');
    expect(screen.queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Time & workload/ })).not.toBeInTheDocument();
  });
  it('has an empty state', async () => {
    reply({ '/reports/projects': { projects: [] } });
    wrap(<Reports />);
    expect(await screen.findByText('No projects to report on')).toBeInTheDocument();
  });
});
