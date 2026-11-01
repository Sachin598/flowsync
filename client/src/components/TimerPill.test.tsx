import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TimerPill } from './TimerPill';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  errorMessage: (e: unknown) => String(e),
}));
import { api } from '../lib/api';

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const wrap = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><TimerPill /></MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => vi.clearAllMocks());

describe('TimerPill (timer state comes from the server)', () => {
  it('renders nothing when no timer is running', async () => {
    get.mockResolvedValue({ data: { timer: null, serverNow: new Date().toISOString() } });
    const { container } = wrap();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('after a page refresh, shows the running timer with elapsed time measured from the SERVER start timestamp', async () => {
    const startedAt = '2026-10-29T10:00:00.000Z';
    // the server says "now" is 90 minutes after the start, regardless of this device's clock
    get.mockResolvedValue({ data: { timer: { _id: 'x', startedAt, note: '', task: { _id: 't', key: 'WEB-3', title: 'Nav' }, project: { _id: 'p', name: 'Web', key: 'WEB' } }, serverNow: '2026-10-29T11:30:00.000Z' } });
    wrap();
    expect(await screen.findByText('01:30:00')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Timer running' })).toBeInTheDocument();
  });

  it('Stop sends no duration - the server decides it', async () => {
    get.mockResolvedValue({ data: { timer: { _id: 'x', startedAt: '2026-10-29T10:00:00.000Z', note: '', task: { _id: 't', key: 'WEB-3', title: 'Nav' }, project: { _id: 'p', name: 'Web', key: 'WEB' } }, serverNow: '2026-10-29T10:05:00.000Z' } });
    post.mockResolvedValue({ data: { minutes: 5, capped: false } });
    wrap();
    await userEvent.click(await screen.findByRole('button', { name: /stop timer/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/time-entries/timer/stop', {}));
  });
});
