import { Link } from 'react-router-dom';
import { CheckCircle2, KanbanSquare, BarChart3, Zap } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function Landing() {
  const { user } = useAuth();
  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <header className="flex items-center justify-between">
        <span className="text-xl font-bold text-brand-600">FlowSync</span>
        <nav className="flex gap-3">
          {user ? (
            <Link className="btn-primary" to="/dashboard">Open app</Link>
          ) : (
            <>
              <Link className="btn-ghost" to="/login">Sign in</Link>
              <Link className="btn-primary" to="/register">Get started</Link>
            </>
          )}
        </nav>
      </header>
      <section className="py-20 text-center">
        <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Plan, track and ship work together</h1>
        <p className="mx-auto mt-4 max-w-xl text-slate-600 dark:text-slate-300">
          Workspaces, projects, Kanban boards, comments and live dashboards in one place.
        </p>
        <Link className="btn-primary mt-8 px-6 py-3" to="/register">Create a free account</Link>
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        {[
          { icon: KanbanSquare, t: 'Kanban boards', d: 'Drag tasks between columns. Changes are saved and shared live.' },
          { icon: BarChart3, t: 'Live dashboard', d: 'Every number is computed from your real tasks and projects.' },
          { icon: Zap, t: 'Real-time collaboration', d: 'Comments, @mentions and instant notifications.' },
        ].map(({ icon: Icon, t, d }) => (
          <div key={t} className="card p-5">
            <Icon className="mb-3 h-6 w-6 text-brand-600" />
            <h3 className="font-semibold">{t}</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{d}</p>
          </div>
        ))}
      </section>
      <p className="mt-10 flex items-center justify-center gap-2 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4" /> Role-based access on every request</p>
    </div>
  );
}
