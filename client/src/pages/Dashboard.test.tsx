import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Dashboard from './Dashboard';

const ws = vi.hoisted(() => ({ current: null as null | { _id: string; name: string; myRole: string; permissions: string[] } }));
vi.mock('../hooks/useWorkspace', () => ({ useWorkspace: () => ({ loading: false, current: ws.current, workspaces: [], select: () => {} }) }));
vi.mock('../lib/api', () => ({ api: { get: vi.fn() }, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
vi.mock('recharts', async () => (await import('../test/recharts-mock')).rechartsMock);
import { api } from '../lib/api';

const get = vi.mocked(api.get);
const VIEWER = ['workspace.view', 'dashboard.viewer', 'reports.view', 'project.view', 'task.view'];
const MEMBER = [...VIEWER, 'dashboard.member', 'task.write', 'time.log'];
const ADMIN = [...MEMBER, 'dashboard.admin', 'audit.view'];
const as = (role: string, permissions: string[]) => { ws.current = { _id: 'w1', name: 'Demo', myRole: role, permissions }; };

const project = (o = {}) => ({ id: 'p1', name: 'Website', key: 'WEB', status: 'active', priority: 'high', tasks: 6, done: 2, overdue: 2, progress: 33, openEstimateHours: 12, loggedMinutes: 180, health: { level: 'at_risk', reasons: ['2 of 4 open tasks are overdue (50%)'], expectedProgress: null }, ...o });
const task = (o = {}) => ({ _id: 't1', key: 'WEB-2', title: 'Design nav', status: 'in_progress', priority: 'high', dueDate: '2026-10-29T00:00:00.000Z', project: 'p1', estimateHours: 3, ...o });
const adminData = { kind: 'admin', kpis: { projects: 3, activeProjects: 2, members: 5, tasks: 40, completed: 10, pending: 30, overdue: 4, completionPct: 25 }, tasksByStatus: [{ status: 'done', count: 10 }], tasksByPriority: [{ priority: 'high', count: 5 }], completionTrend: [{ date: '2026-10-29', completed: 2 }], projects: [project(), project({ id: 'p2', name: 'Mobile', key: 'APP', progress: 80, overdue: 0, health: { level: 'healthy', reasons: [], expectedProgress: null } })], team: [{ userId: 'u1', name: 'Asha', role: 'member', openTasks: 16, overdue: 2, openEstimateHours: 20, completed30d: 4, onTimePct: 75, loggedMinutes7d: 300, overloaded: true }], upcomingDeadlines: [{ _id: 'd1', key: 'WEB-9', title: 'Launch', dueDate: '2026-10-30T00:00:00.000Z', project: 'p1', assignee: { name: 'Asha' } }], recentActivity: [{ _id: 'a1', action: 'task.moved', createdAt: '2026-10-29T10:00:00Z', meta: { key: 'WEB-2', from: 'todo', to: 'done' }, actor: { _id: 'u1', name: 'Asha' }, project: null, task: null, target: null }], audit: { events7d: 42, destructive7d: 1, byCategory: [{ category: 'task', count: 30 }], topActors: [{ userId: 'u1', name: 'Asha', count: 20 }] } };
const memberData = { kind: 'member', kpis: { assigned: 7, completed: 3, pending: 4, overdue: 1, loggedMinutes7d: 150, loggedMinutesToday: 60, activeProjects: 2 }, myTasks: [task()], todaysTasks: [task({ _id: 't2', key: 'WEB-3', title: 'Write copy' })], upcomingDeadlines: [task({ _id: 't3', key: 'WEB-4', title: 'Review PR' })], workload: { openTasks: 4, overdue: 1, openEstimateHours: 9, byStatus: [{ status: 'todo', count: 4 }], byPriority: [{ priority: 'high', count: 2 }], overloaded: false }, time: { daily: [{ date: '2026-10-29', minutes: 60 }] }, projects: [{ id: 'p1', name: 'Website', key: 'WEB', status: 'active', myTasks: 5, myDone: 2, myOverdue: 1, myProgress: 40, projectProgress: 33 }], notifications: { unread: 2, items: [{ _id: 'n1', message: 'Ana assigned you WEB-2', read: false, createdAt: '2026-10-29T09:00:00Z' }] }, activity: [{ _id: 'x1', action: 'comment.created', createdAt: '2026-10-29T08:00:00Z', meta: { key: 'WEB-2' }, actor: { _id: 'u2', name: 'Me' }, project: null, task: null, target: null }] };
const viewerData = { kind: 'viewer', kpis: { projects: 3, activeProjects: 2, tasks: 40, completed: 10, pending: 30, overdue: 4, completionPct: 25 }, tasksByStatus: [{ status: 'done', count: 10 }], projects: [project()], upcomingDeadlines: [{ _id: 'd1', key: 'WEB-9', title: 'Launch', dueDate: '2026-10-30T00:00:00.000Z', project: 'p1' }] };

const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><Dashboard /></MemoryRouter></QueryClientProvider>);
const endpoints = () => get.mock.calls.map(([u]) => u);

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation((async (url: string) => {
    if (url === '/dashboard/admin') return { data: adminData };
    if (url === '/dashboard/member') return { data: memberData };
    if (url === '/dashboard/viewer') return { data: viewerData };
    throw new Error(`unexpected GET ${url}`);
  }) as never);
});

describe('Dashboard picks the dashboard from the user\'s permissions', () => {
  it('admin / owner: the workspace dashboard, with every KPI from the spec', async () => {
    as('admin', ADMIN);
    wrap();
    for (const label of ['Total Projects', 'Active Projects', 'Total Team Members', 'Total Tasks', 'Completed Tasks', 'Pending Tasks', 'Overdue Tasks', 'Overall Completion']) expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(endpoints()).toEqual(['/dashboard/admin']); // never asks for the other two
  });
  it('admin sections: health & risk with reasons, team workload and performance, deadlines, audit summary, activity', async () => {
    as('owner', ADMIN);
    wrap();
    expect(await screen.findByText('Project health & risk')).toBeInTheDocument();
    expect(screen.getByText('2 of 4 open tasks are overdue (50%)')).toBeInTheDocument();
    expect(screen.getAllByText('At risk').length).toBeGreaterThan(0);
    expect(screen.getByText('overloaded')).toBeInTheDocument();
    expect(screen.getByText('Team performance')).toBeInTheDocument();
    expect(screen.getByText('Upcoming deadlines (7 days)')).toBeInTheDocument();
    expect(screen.getByText(/WEB-9 Launch/)).toBeInTheDocument();
    const audit = screen.getByRole('heading', { name: 'Audit activity (7 days)' }).closest('section')!;
    expect(within(audit).getByText('42')).toBeInTheDocument();
    expect(within(audit).getByRole('link', { name: 'Open audit log' })).toHaveAttribute('href', '/audit');
    expect(screen.getByText('moved WEB-2 from To Do to Done')).toBeInTheDocument();
  });
  it('admin can switch to "My work", which loads the personal dashboard', async () => {
    as('admin', ADMIN);
    wrap();
    await screen.findByText('Total Projects');
    await userEvent.click(screen.getByRole('tab', { name: 'My work' }));
    expect(await screen.findByText('My Assigned Tasks')).toBeInTheDocument();
    expect(endpoints()).toContain('/dashboard/member');
  });
  it('employee (member): personal KPIs and sections, and only the personal endpoint is called', async () => {
    as('member', MEMBER);
    wrap();
    for (const label of ['My Assigned Tasks', 'Completed Tasks', 'Pending Tasks', 'Overdue Tasks', 'Logged Working Hours', 'Active Projects']) expect(await screen.findByText(label)).toBeInTheDocument();
    for (const title of ['My tasks', "Today's tasks", 'Upcoming deadlines (7 days)', 'My workload', 'My time tracking', 'My project progress', 'Recent notifications', 'My activity history']) expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText('2h 30m')).toBeInTheDocument(); // 150 minutes logged
    expect(screen.getByText(/last 7 days · 1h today/)).toBeInTheDocument();
    expect(screen.getByText('Ana assigned you WEB-2')).toBeInTheDocument();
    expect(screen.getByText(/You commented on WEB-2/)).toBeInTheDocument();
    expect(endpoints()).toEqual(['/dashboard/member']);
    expect(screen.queryByText('Project health & risk')).not.toBeInTheDocument(); // nothing from the admin dashboard
    expect(screen.queryByText('Team performance')).not.toBeInTheDocument();
  });
  it('viewer: a read-only overview with no editing controls and no personal or people data', async () => {
    as('viewer', VIEWER);
    wrap();
    expect(await screen.findByText('You have read-only access to this workspace.')).toBeInTheDocument();
    expect(screen.getByText('Overall Completion')).toBeInTheDocument();
    expect(screen.getByText('Project progress and health')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View reports' })).toHaveAttribute('href', '/reports');
    expect(screen.queryByRole('button')).not.toBeInTheDocument(); // nothing to click that could change data
    for (const hidden of ['My Assigned Tasks', 'Team performance', 'Audit activity (7 days)', 'Logged Working Hours']) expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    expect(endpoints()).toEqual(['/dashboard/viewer']);
  });
  it('a user with no workspace is invited to create one and nothing is requested', async () => {
    ws.current = null;
    wrap();
    expect(await screen.findByText('Create a workspace to get started')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
  it('shows an error with a retry when the server fails', async () => {
    as('admin', ADMIN);
    get.mockRejectedValue(new Error('Cannot reach the server'));
    wrap();
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server');
    get.mockImplementation((async () => ({ data: adminData })) as never);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('Total Projects')).toBeInTheDocument());
  });
  it('sends the user\'s local day and time zone, which the server validates', async () => {
    as('member', MEMBER);
    wrap();
    await screen.findByText('My Assigned Tasks');
    const params = get.mock.calls[0][1]!.params as Record<string, string>;
    expect(params).toMatchObject({ workspaceId: 'w1' });
    expect(params.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.timezone.length).toBeGreaterThan(0);
    expect(params).not.toHaveProperty('userId'); // the server decides whose dashboard it is
  });
});
