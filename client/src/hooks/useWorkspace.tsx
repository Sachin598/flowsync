import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Workspace } from '../types';

interface Ctx {
  workspaces: Workspace[];
  current: Workspace | null;
  loading: boolean;
  select: (id: string) => void;
}
const WorkspaceCtx = createContext<Ctx | null>(null);
const KEY = 'flowsync-workspace'; // only a UI preference; access is always checked on the server

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: async () => (await api.get<{ workspaces: Workspace[] }>('/workspaces')).data.workspaces,
  });
  const [id, setId] = useState<string | null>(() => localStorage.getItem(KEY));
  const workspaces = data ?? [];
  const current = workspaces.find((w) => w._id === id) ?? workspaces[0] ?? null;
  useEffect(() => {
    if (current) localStorage.setItem(KEY, current._id);
  }, [current]);
  return (
    <WorkspaceCtx.Provider value={{ workspaces, current, loading: isLoading, select: setId }}>
      {children}
    </WorkspaceCtx.Provider>
  );
}

export function useWorkspace() {
  const c = useContext(WorkspaceCtx);
  if (!c) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return c;
}
