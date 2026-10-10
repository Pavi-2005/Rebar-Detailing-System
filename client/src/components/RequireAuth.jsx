import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function RequireAuth({ children }) {
  const { user, initialized, authError, retrySession } = useAuth();
  const location = useLocation();

  if (!initialized) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-300" role="status">
        Checking your session…
      </main>
    );
  }

  if (authError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
        <section className="max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-7 text-center">
          <h1 className="text-xl font-semibold">Session check unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">{authError}</p>
          <button
            type="button"
            onClick={retrySession}
            className="mt-6 rounded-lg bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
          >
            Retry
          </button>
          <Link to="/login" state={{ from: location }} className="mt-4 block text-sm text-cyan-300 hover:text-cyan-200">
            Go to login
          </Link>
        </section>
      </main>
    );
  }

  return user ? children : <Navigate to="/login" replace state={{ from: location }} />;
}
