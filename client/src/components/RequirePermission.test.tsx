import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RequirePermission } from './RequirePermission';

const state = vi.hoisted(() => ({ perms: [] as string[], loading: false }));
vi.mock('../hooks/useWorkspace', () => ({ useWorkspace: () => ({ loading: state.loading, current: { _id: 'w', name: 'W', myRole: 'member', permissions: state.perms } }) }));

const show = () => render(<MemberRouter />);
const MemberRouter = () => <MemoryRouter><RequirePermission permission="audit.view"><p>secret admin page</p></RequirePermission></MemoryRouter>;

describe('RequirePermission', () => {
  it('shows the page to someone who has the permission', () => {
    state.perms = ['audit.view'];
    show();
    expect(screen.getByText('secret admin page')).toBeInTheDocument();
  });
  it('shows a clear message, and not the page, to someone who does not', () => {
    state.perms = ['workspace.view', 'task.write'];
    show();
    expect(screen.queryByText('secret admin page')).not.toBeInTheDocument();
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/dashboard');
  });
  it('does not flash the "no access" message while permissions are still loading', () => {
    state.perms = [];
    state.loading = true;
    show();
    expect(screen.queryByText("You don't have access to this page")).not.toBeInTheDocument();
    state.loading = false;
  });
});
