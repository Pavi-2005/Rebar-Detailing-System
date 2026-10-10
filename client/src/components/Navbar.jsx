import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function Navbar() {
  const { user, logout } = useAuth();

  return (
    <header className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold">Automatic Rebar Detailing System</h1>
        <p className="text-sm text-slate-400">RCC beam and slab design with detailing</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {user ? (
          <>
            <span className="text-sm text-slate-300">{user.name}</span>
            <button onClick={logout} className="rounded-lg border border-rose-500 px-4 py-2 text-sm text-rose-300 transition hover:bg-rose-500/10">Logout</button>
          </>
        ) : (
          <> 
            <Link to="/login" className="rounded-lg border border-cyan-500 px-4 py-2 text-sm text-cyan-300 transition hover:bg-cyan-500/10">Login</Link>
            <Link to="/signup" className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400">Sign Up</Link>
          </>
        )}
      </div>
    </header>
  );
}
