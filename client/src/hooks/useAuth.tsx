import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { closeSocket } from '../lib/socket';
import type { User } from '../types';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    retry: false,
    queryFn: async () => {
      try {
        return (await api.get<{ user: User }>('/auth/me')).data.user;
      } catch {
        return null; // 401 simply means "not signed in"
      }
    },
  });
  const setUser = (u: User | null) => qc.setQueryData(['me'], u);
  const logout = async () => {
    await api.post('/auth/logout');
    closeSocket();
    qc.clear();
    qc.setQueryData(['me'], null);
  };
  return <Ctx.Provider value={{ user: data ?? null, loading: isLoading, setUser, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used inside AuthProvider');
  return c;
}
