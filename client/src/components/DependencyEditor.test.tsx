import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DependencyEditor } from './DependencyEditor';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), patch: vi.fn() },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
import { api } from '../lib/api';

const get = vi.mocked(api.get);
const patch = vi.mocked(api.patch);
const ref = (n: number, status: string, title = `Task ${n}`) => ({ _id: `id${n}`, key: `WEB-${n}`, title, status });
const wrap = (readOnly = false) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DependencyEditor taskId="id1" projectId="p1" readOnly={readOnly} />
    </QueryClientProvider>,
  );

/** Task id1 is blocked by id2 (in progress) and blocks id9. id3 and id4 are free to choose. */
function mockApi(blockedBy = [ref(2, 'in_progress', 'Design')], blocking = [ref(9, 'todo', 'Launch')]) {
  get.mockImplementation((async (url: string) => {
    if (url === '/tasks') return { data: { tasks: [ref(1, 'todo'), ...blockedBy, ...blocking, ref(3, 'todo', 'Copy'), ref(4, 'done', 'Review')] } };
    return { data: { task: { blockedBy }, blocking } };
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi();
});

describe('DependencyEditor', () => {
  it('shows prerequisites with their status, a warning for unfinished ones, and what the task blocks', async () => {
    wrap();
    expect(await screen.findByText(/WEB-2 Design/)).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText(/Blocked by 1 unfinished task/)).toBeInTheDocument();
    expect(screen.getByText(/WEB-9 Launch/)).toBeInTheDocument();
  });

  it('does not warn when every prerequisite is done', async () => {
    mockApi([ref(2, 'done', 'Design')]);
    wrap();
    await screen.findByText(/WEB-2 Design/);
    expect(screen.queryByText(/unfinished/)).not.toBeInTheDocument();
  });

  it('offers only valid choices: not itself, not current blockers, not tasks it already blocks', async () => {
    wrap();
    const select = await screen.findByLabelText('Add a blocking task');
    await screen.findByRole('option', { name: /WEB-3/ });
    const labels = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual(expect.arrayContaining([expect.stringContaining('WEB-3'), expect.stringContaining('WEB-4')]));
    for (const excluded of ['WEB-1 ', 'WEB-2 ', 'WEB-9 ']) expect(labels.some((l) => l?.includes(excluded))).toBe(false);
  });

  it('adds a blocker by sending the full new list', async () => {
    patch.mockResolvedValue({ data: {} });
    wrap();
    await screen.findByRole('option', { name: /WEB-3/ });
    await userEvent.selectOptions(screen.getByLabelText('Add a blocking task'), 'id3');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/tasks/id1', { blockedBy: ['id2', 'id3'] }));
  });

  it('removes a blocker', async () => {
    patch.mockResolvedValue({ data: {} });
    wrap();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove dependency on WEB-2' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/tasks/id1', { blockedBy: [] }));
  });

  it('shows the server message when a change is rejected (for example a cycle)', async () => {
    patch.mockRejectedValue(new Error('That dependency would create a cycle'));
    wrap();
    await screen.findByRole('option', { name: /WEB-3/ });
    await userEvent.selectOptions(screen.getByLabelText('Add a blocking task'), 'id3');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That dependency would create a cycle');
  });

  it('is read-only for viewers: no controls, and the task list is not even requested', async () => {
    wrap(true);
    await screen.findByText(/WEB-2 Design/);
    expect(screen.queryByLabelText('Add a blocking task')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove dependency/ })).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith('/tasks', expect.anything());
  });

  it('stops offering choices at the 20 blocker limit', async () => {
    mockApi(Array.from({ length: 20 }, (_, i) => ref(100 + i, 'done')));
    wrap();
    const select = await screen.findByLabelText('Add a blocking task');
    expect(select).toBeDisabled();
    expect(screen.getByRole('option', { name: /Limit of 20 reached/ })).toBeInTheDocument();
  });

  it('shows an error with a retry when the dependencies cannot be loaded', async () => {
    get.mockRejectedValue(new Error('Cannot reach the server'));
    wrap();
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
