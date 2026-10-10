import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { getReturnTo } from '../utils/authRedirect.js';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (event) => {
    event.preventDefault();
    if (!email || !password) {
      setError('Please enter your email and password.');
      return;
    }

    try {
      await login(email, password);
      navigate(getReturnTo(location.state?.from), { replace: true });
    } catch (err) {
      setError(err?.response?.data?.error || 'Invalid email or password.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-6 py-10 lg:px-10">
      <div className="mx-auto max-w-3xl rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Welcome back</p>
          <h1 className="mt-3 text-4xl font-semibold">Login to Rebar Detailing</h1>
          <p className="mt-3 text-slate-400">Access your saved designs, step-by-step calculations, and reports.</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <label className="block text-sm text-slate-300">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none focus:border-cyan-500"
              placeholder="you@example.com"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none focus:border-cyan-500"
              placeholder="Enter your password"
            />
          </label>
          {error ? <p className="text-sm text-rose-400">{error}</p> : null}
          <button type="submit" className="w-full rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400">
            Login
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          New to the app?{' '}
          <Link to="/signup" state={location.state} className="text-cyan-300 hover:text-cyan-200">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
