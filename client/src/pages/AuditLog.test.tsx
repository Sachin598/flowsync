import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AuditLog from './AuditLog';

const ws = vi.hoisted(() => ({ permissions: ['workspace.view', 'audit.view'] as string[] }));
vi.mock('../hooks/useWorkspace', () => ({ useWorkspace: () => ({ current: { _id: 'w1', name: 'Demo', myRole: 'admin', permissions: ws.permissions } }) }));
vi.mock('../lib/api', () => ({ api: { get: vi.fn() }, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
import { api } from '../lib/api';

const get = vi.mocked(api.get);
const actor = { _id: 'u1', name: 'Asha' };
const row = (n: number, action: string, meta: object, extra: object = {}) => ({
  _id: `e${n}`, action, createdAt: '2026-10-29T10:00:00.000Z', meta, actor, project: { _id: 'p', name: 'Website', key: 'WEB' }, task: null, target: null, ...extra,
});
function mockApi(entries = [row(1, 'task.moved', { key: 'WEB-2', from: 'todo', to: 'done' }), row(2, 'project.deleted', { name: 'Old site' }, { project: null })], pages = 1) {
  get.mockImplementation((async (url: string) => {
    if (url === '/projects') return { data: { projects: [{ _id: 'p1', name: 'Website', key: 'WEB' }] } };
    if (url === '/audit-logs/actions') return { data: { actions: ['project.deleted', 'task.moved'] } };
    if (url === '/workspaces/w1/members') return { data: { members: [{ role: 'admin', user: { _id: 'u1', name: 'Asha', email: 'a@x.dev' } }, { role: 'member', user: { _id: 'u2', name: 'Ben', email: 'b@x.dev' } }] } };
    if (url === '/audit-logs') return { data: { entries, page: 1, pages, total: entries.length } };
    throw new Error(`unexpected GET ${url}`);
  }) as never);
}
const wrap = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><AuditLog /></MemoryRouter>
  </QueryClientProvider>,
);
const auditCalls = () => get.mock.calls.filter(([u]) => u === '/audit-logs');

beforeEach(() => { vi.clearAllMocks(); ws.permissions = ['workspace.view', 'audit.view']; mockApi(); });

describe('AuditLog page', () => {
  it('shows readable events with who did them and the project, deleted projects as a dash', async () => {
    wrap();
    expect(await screen.findByText('moved WEB-2 from To Do to Done')).toBeInTheDocument();
    expect(screen.getByText('deleted project “Old site”')).toBeInTheDocument();
    expect(screen.getAllByText('Asha').length).toBeGreaterThan(0);
    expect(screen.getByText('WEB')).toBeInTheDocument();
    expect(screen.getByText('2 events')).toBeInTheDocument();
  });

  it('asks the server for the user\'s local-day window as exact instants, 25 per page', async () => {
    wrap();
    await screen.findByText('2 events');
    const params = auditCalls()[0][1]!.params as Record<string, unknown>;
    expect(params).toMatchObject({ workspaceId: 'w1', page: 1, limit: 25 });
    expect(new Date(params.from as string).toISOString()).toBe(params.from); // a real ISO instant
    expect(new Date(params.to as string).getTime()).toBeGreaterThan(new Date(params.from as string).getTime());
    expect(params).not.toHaveProperty('action');
  });

  it('filters by action and person, returning to page 1', async () => {
    wrap();
    await screen.findByText('2 events');
    await screen.findByRole('option', { name: 'task.moved' });
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'task.moved');
    await userEvent.selectOptions(screen.getByLabelText('Person'), 'u2');
    await waitFor(() => expect(auditCalls().at(-1)![1]!.params).toMatchObject({ action: 'task.moved', actorId: 'u2', page: 1 }));
  });

  it('filters by project', async () => {
    wrap();
    await screen.findByText('2 events');
    await screen.findByRole('option', { name: 'Website (WEB)' });
    await userEvent.selectOptions(screen.getByLabelText('Project'), 'p1');
    await waitFor(() => expect(auditCalls().at(-1)![1]!.params).toMatchObject({ projectId: 'p1', page: 1 }));
  });

  it('pages forward', async () => {
    mockApi([row(1, 'task.moved', { key: 'WEB-2', from: 'todo', to: 'done' })], 3);
    wrap();
    await screen.findByText('Page 1 of 3');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(auditCalls().at(-1)![1]!.params).toMatchObject({ page: 2 }));
  });

  it('shows an empty state', async () => {
    mockApi([]);
    wrap();
    expect(await screen.findByText('No activity found')).toBeInTheDocument();
  });

  it('shows the server error with a retry', async () => {
    get.mockImplementation((async (url: string) => {
      if (url === '/audit-logs') throw new Error('Cannot reach the server');
      return { data: { actions: [], members: [] } };
    }) as never);
    wrap();
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('rejects a reversed date range without asking the server', async () => {
    wrap();
    await screen.findByText('2 events');
    const before = auditCalls().length;
    const from = screen.getByLabelText('From');
    // setting "From" after "To": the inputs cap each other, so type an out-of-order value directly
    await userEvent.clear(from);
    await userEvent.type(from, '2999-01-01');
    expect(await screen.findByRole('alert')).toHaveTextContent(/From.*must be on or before.*To/);
    expect(auditCalls().length).toBe(before);
  });

  it('exports the filtered log as CSV', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    wrap();
    await screen.findByText('2 events');
    // From here on, only the temporary download link is faked; everything else uses the real DOM.
    const click = vi.fn();
    const real = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'a' ? ({ click, set href(_v: string) {}, set download(_v: string) {} } as unknown as HTMLAnchorElement) : real(tag)) as never);
    get.mockResolvedValueOnce({ data: new Blob(['a']) } as never);
    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    spy.mockRestore();
    expect(get).toHaveBeenLastCalledWith('/audit-logs/export.csv', expect.objectContaining({ responseType: 'blob', params: expect.objectContaining({ workspaceId: 'w1' }) }));
  });

  it.each([['member', ['workspace.view', 'task.write']], ['viewer', ['workspace.view']]])('tells a %s it is admin-only and never requests the log', async (_role, permissions) => {
    ws.permissions = permissions as string[];
    wrap();
    expect(await screen.findByText('Audit log is for admins')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});
