import type { ReactNode } from 'react';
import { healthMeta, type HealthLevel } from '../../lib/health';

export function KpiCard({ label, value, tone = 'indigo', hint }: { label: string; value: ReactNode; tone?: 'indigo' | 'emerald' | 'blue' | 'green' | 'amber' | 'red' | 'violet'; hint?: string }) {
  const border = { indigo: 'border-indigo-500', emerald: 'border-emerald-500', blue: 'border-blue-500', green: 'border-green-500', amber: 'border-amber-500', red: 'border-red-500', violet: 'border-violet-500' }[tone];
  const text = { indigo: 'text-indigo-600', emerald: 'text-emerald-600', blue: 'text-blue-600', green: 'text-green-600', amber: 'text-amber-600', red: 'text-red-600', violet: 'text-violet-600' }[tone];
  return (
    <div className={`card border-t-4 p-4 ${border}`}>
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`text-2xl font-bold ${text}`}>{value}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Section({ title, children, action, className = '' }: { title: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={`card p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-medium">{title}</h2>{action}</div>
      {children}
    </section>
  );
}

export const HealthBadge = ({ level }: { level: HealthLevel }) => <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${healthMeta[level].className}`}>{healthMeta[level].label}</span>;

export function Progress({ value, label, tone = 'bg-emerald-500' }: { value: number; label: string; tone?: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
      <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-slate-500">{children}</p>;
