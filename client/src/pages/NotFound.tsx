import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-5xl font-bold text-brand-600">404</h1>
      <p className="text-slate-500">That page doesn&apos;t exist.</p>
      <Link className="btn-primary" to="/">Go home</Link>
    </div>
  );
}
