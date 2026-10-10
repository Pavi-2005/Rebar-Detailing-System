import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { getReturnTo } from '../utils/authRedirect.js';

export default function SignupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signup } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const handleSignup = async (event) => {
    event.preventDefault();
    if (!name || !email || !password || !confirmPassword) {
      setError('All fields are required.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    try {
      await signup(name, email, password);
      navigate(getReturnTo(location.state?.from), { replace: true });
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to create account.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-6 py-10 lg:px-10">
      <div className="mx-auto max-w-3xl rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Join the system</p>
          <h1 className="mt-3 text-4xl font-semibold">Create your account</h1>
          <p className="mt-3 text-slate-400">Start saving beam and slab designs with guided calculation steps.</p>
        </div>

        <form onSubmit={handleSignup} className="space-y-6">
          <label className="block text-sm text-slate-300">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none focus:border-cyan-500"
              placeholder="Your full name"
            />
          </label>
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
              placeholder="Create a password"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Confirm Password
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none focus:border-cyan-500"
              placeholder="Repeat your password"
            />
          </label>
          {error ? <p className="text-sm text-rose-400">{error}</p> : null}
          <button type="submit" className="w-full rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400">
            Sign Up
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          Already have an account?{' '}
          <Link to="/login" state={location.state} className="text-cyan-300 hover:text-cyan-200">
            Login here
          </Link>
        </p>
      </div>
    </div>
  );
}
