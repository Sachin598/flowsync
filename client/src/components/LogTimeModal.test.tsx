import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LogTimeModal } from './LogTimeModal';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
import { api } from '../lib/api';

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const patch = vi.mocked(api.patch);
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);


/** Waits for the async option lists to load (the selects are disabled while loading), then picks a project and a task. */
async function pickProjectAndTask() {
  await screen.findByRole('option', { name: 'Website (WEB)' });
  await userEvent.selectOptions(screen.getByLabelText('Project'), 'p1');
  await screen.findByRole('option', { name: /WEB-1/ });
  await userEvent.selectOptions(screen.getByLabelText('Task'), 't1');
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: { projects: [{ _id: 'p1', name: 'Website', key: 'WEB' }], tasks: [{ _id: 't1', key: 'WEB-1', title: 'Header' }] } });
});

describe('LogTimeModal - manual entry', () => {
  it('shows validation errors and sends nothing when the form is empty', async () => {
    wrap(<LogTimeModal workspaceId="w1" onClose={() => {}} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Log time' }));
    expect(await screen.findByText('Choose a project')).toBeInTheDocument();
    expect(screen.getByText('Choose a task')).toBeInTheDocument();
    expect(screen.getByText(/Enter a duration/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('posts task, project, parsed minutes, date and description once valid', async () => {
    const onSaved = vi.fn();
    post.mockResolvedValue({ data: {} });
    wrap(<LogTimeModal workspaceId="w1" onClose={() => {}} onSaved={onSaved} />);
    await pickProjectAndTask();
    await userEvent.type(screen.getByLabelText('Duration'), '1h30m');
    await userEvent.type(screen.getByLabelText(/Description/), 'Pairing');
    await userEvent.click(screen.getByRole('button', { name: 'Log time' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/time-entries', expect.objectContaining({ taskId: 't1', projectId: 'p1', minutes: 90, note: 'Pairing' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('shows the server error inside the dialog when saving fails', async () => {
    post.mockRejectedValue(new Error('That would put more than 24 hours on 2026-10-20'));
    wrap(<LogTimeModal workspaceId="w1" onClose={() => {}} onSaved={() => {}} />);
    await pickProjectAndTask();
    await userEvent.type(screen.getByLabelText('Duration'), '5h');
    await userEvent.click(screen.getByRole('button', { name: 'Log time' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/more than 24 hours/);
  });
});

describe('LogTimeModal - edit entry', () => {
  const entry = { _id: 'e1', minutes: 90, note: 'old', date: '2026-10-20T00:00:00.000Z', task: { key: 'WEB-1', title: 'Header' }, project: { name: 'Website', key: 'WEB' } };

  it('prefills the entry, rejects a bad duration, then PATCHes the new minutes', async () => {
    patch.mockResolvedValue({ data: {} });
    wrap(<LogTimeModal workspaceId="w1" entry={entry} onClose={() => {}} onSaved={() => {}} />);
    const duration = screen.getByLabelText('Duration');
    expect(duration).toHaveValue('1h30m');
    await userEvent.clear(duration);
    await userEvent.type(duration, 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Use a format like/)).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
    await userEvent.clear(duration);
    await userEvent.type(duration, '2h');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/time-entries/e1', { minutes: 120, date: '2026-10-20', note: 'old' }));
  });
});
