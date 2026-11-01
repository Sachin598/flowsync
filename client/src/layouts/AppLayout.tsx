import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, Menu, Moon, PanelLeftClose, Search, Sun } from 'lucide-react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { buildNav } from '../lib/nav';
import { usePermissions } from '../hooks/usePermissions';
import { TimerPill } from '../components/TimerPill';
import { useWorkspace } from '../hooks/useWorkspace';
import type { Notification } from '../types';
import { toast } from 'sonner';

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { workspaces, current, select } = useWorkspace();
  const { dark, toggle } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can, hasWorkspace } = usePermissions();
  const groups = buildNav(can, hasWorkspace);

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get<{ notifications: Notification[]; unread: number }>('/notifications')).data,
  });

  // Real-time notifications over the authenticated socket.
  useEffect(() => {
    const socket = getSocket();
    const onNew = (n: Notification) => {
      toast.info(n.message);
      qc.invalidateQueries({ queryKey: ['notifications'] });
    };
    socket.on('notification:new', onNew);
    return () => {
      socket.off('notification:new', onNew);
    };
  }, [qc]);

  return (
    <div className="flex min-h-screen">
      <aside
        className={`${mobileOpen ? 'fixed inset-y-0 left-0 z-40 flex' : 'hidden'} md:sticky md:top-0 md:flex md:h-screen ${collapsed ? 'md:w-16' : 'md:w-60'} w-60 flex-col border-r border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900`}
      >
        <div className="mb-4 flex items-center justify-between px-2">
          {!collapsed && <span className="text-lg font-bold text-brand-600">FlowSync</span>}
          <button aria-label="Toggle sidebar" className="hidden rounded p-1 hover:bg-slate-100 md:block dark:hover:bg-slate-800" onClick={() => setCollapsed(!collapsed)}>
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
        {!collapsed && workspaces.length > 0 && (
          <select aria-label="Switch workspace" className="input mb-3" value={current?._id} onChange={(e) => { select(e.target.value); qc.invalidateQueries(); }}>
            {workspaces.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
          </select>
        )}
        <nav className="flex flex-1 flex-col gap-1" aria-label="Main">
          {groups.map((g, gi) => (
            <div key={g.heading ?? gi} className={gi > 0 ? 'mt-3 flex flex-col gap-1' : 'flex flex-col gap-1'}>
              {g.heading && !collapsed && <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{g.heading}</p>}
              {g.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  title={collapsed ? label : undefined}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-600/20 dark:text-brand-100' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {!collapsed && <span>{label}</span>}
                  {!collapsed && to === '/notifications' && !!data?.unread && (
                    <span className="ml-auto rounded-full bg-brand-600 px-1.5 text-xs text-white">{data.unread}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <button className="btn-ghost justify-start" onClick={async () => { await logout(); navigate('/'); }}>
          <LogOut className="h-4 w-4" /> {!collapsed && 'Sign out'}
        </button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <button aria-label="Open menu" className="md:hidden" onClick={() => setMobileOpen(!mobileOpen)}><Menu className="h-5 w-5" /></button>
          <span className="hidden text-sm text-slate-500 md:block">{current?.name ?? 'No workspace yet'}</span>
          <form className="relative mx-3 max-w-md flex-1" role="search" onSubmit={(e) => { e.preventDefault(); const t = searchText.trim(); if (t.length >= 2) navigate(`/search?q=${encodeURIComponent(t)}`); }}>
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input aria-label="Search projects and tasks" className="input pl-9" placeholder="Search tasks and projects…" maxLength={100} value={searchText} onChange={(e) => setSearchText(e.target.value)} />
          </form>
          <div className="flex items-center gap-3">
            {can('time.log') && <TimerPill />}
            <button aria-label="Toggle dark mode" className="rounded p-2 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={toggle}>
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <span className="text-sm font-medium">{user?.name}</span>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
