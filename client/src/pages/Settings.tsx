import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import type { User } from '../types';

export default function Settings() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const save = useMutation({
    mutationFn: async (body: object) => (await api.patch<{ user: User }>('/auth/me', body)).data.user,
    onSuccess: (u) => { setUser(u); toast.success('Saved'); }, onError: (e) => toast.error(errorMessage(e)),
  });
  const pw = useMutation({
    mutationFn: async () => api.post('/auth/password', { currentPassword: current, newPassword: next }),
    onSuccess: () => { setCurrent(''); setNext(''); toast.success('Password changed; other sessions were signed out'); }, onError: (e) => toast.error(errorMessage(e)),
  });
  const logoutAll = useMutation({
    mutationFn: async () => api.post('/auth/logout-all'),
    onSuccess: async () => { await logout().catch(() => undefined); navigate('/login'); }, onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <form className="card space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); save.mutate({ name }); }}>
        <h2 className="font-medium">Profile</h2>
        <div><label className="label" htmlFor="s-email">Email</label><input id="s-email" className="input" value={user?.email} disabled /></div>
        <div><label className="label" htmlFor="s-name">Name</label><input id="s-name" className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <button className="btn-primary" disabled={save.isPending}>Save profile</button>
      </form>
      <div className="card p-4">
        <h2 className="mb-2 font-medium">Notifications</h2>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={user?.notificationPrefs?.inApp !== false} onChange={(e) => save.mutate({ notificationPrefs: { inApp: e.target.checked } })} /> In-app notifications</label>
      </div>
      <form className="card space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); pw.mutate(); }}>
        <h2 className="font-medium">Change password</h2>
        <div><label className="label" htmlFor="s-cur">Current password</label><input id="s-cur" type="password" autoComplete="current-password" required className="input" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
        <div><label className="label" htmlFor="s-new">New password (min 8 characters)</label><input id="s-new" type="password" autoComplete="new-password" minLength={8} required className="input" value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <button className="btn-primary" disabled={pw.isPending}>Change password</button>
      </form>
      <div className="card p-4">
        <h2 className="mb-1 font-medium">Sessions</h2>
        <p className="mb-3 text-sm text-slate-500">Sign out of every device, including this one.</p>
        <button className="btn-ghost" disabled={logoutAll.isPending} onClick={() => logoutAll.mutate()}>Sign out everywhere</button>
      </div>
    </div>
  );
}
