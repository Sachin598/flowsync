import { Children, cloneElement, isValidElement, useEffect, useId, type ReactElement, type ReactNode } from 'react';
import { Loader2, X } from 'lucide-react';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}…
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800 ${className}`} />;
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 p-10 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-sm text-sm text-slate-500">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="card border-red-300 p-6 text-sm text-red-700 dark:text-red-400">
      {message}
      {onRetry && (
        <button className="btn-ghost ml-3" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`card mt-10 w-full ${wide ? 'max-w-3xl' : 'max-w-md'} p-5`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button aria-label="Close dialog" className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Delete', onConfirm, onClose, busy }: {
  title: string; message: string; confirmLabel?: string; onConfirm: () => void; onClose: () => void; busy?: boolean;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-300">{message}</p>
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-danger" disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

const CONTROLS = ['input', 'select', 'textarea'];
type ControlProps = { id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string };

/** Label + control + error. The label is programmatically linked to the first input/select/textarea inside. */
export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  const generated = useId();
  const control = Children.toArray(children).find((c): c is ReactElement<ControlProps> => isValidElement(c) && CONTROLS.includes(c.type as string));
  const controlId = control?.props.id ?? generated;
  const errorId = `${controlId}-error`;
  let linkedOne = false;
  const linked = Children.map(children, (child) => {
    if (!linkedOne && isValidElement(child) && CONTROLS.includes(child.type as string)) {
      linkedOne = true;
      return cloneElement(child as ReactElement<ControlProps>, { id: controlId, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? errorId : undefined });
    }
    return child;
  });
  return (
    <div>
      <label className="label" htmlFor={controlId}>{label}</label>
      {linked}
      {error && <p className="err" id={errorId} role="alert">{error}</p>}
    </div>
  );
}
