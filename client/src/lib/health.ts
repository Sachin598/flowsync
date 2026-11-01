export type HealthLevel = 'healthy' | 'watch' | 'at_risk' | 'complete' | 'no_data';
export const healthMeta: Record<HealthLevel, { label: string; className: string }> = {
  healthy: { label: 'Healthy', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  watch: { label: 'Watch', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  at_risk: { label: 'At risk', className: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  complete: { label: 'Complete', className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' },
  no_data: { label: 'No tasks', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
};
export const healthOrder: Record<HealthLevel, number> = { at_risk: 0, watch: 1, healthy: 2, no_data: 3, complete: 4 };
