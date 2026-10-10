import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

const cards = [
  { title: 'Beam Design', description: 'Open the beam design workspace for RCC member design and checks.', link: '/beam' },
  { title: 'Column Design', description: 'Design RCC rectangular columns for axial load and biaxial bending.', link: '/column' },
  { title: 'Footing Design', description: 'Design an isolated RCC footing for one rectangular column on soil.', link: '/footing' },
  { title: 'Slab Design', description: 'Open the slab design workspace for panel calculations and detailing.', link: '/slab' },
  { title: 'Design History', description: 'Review saved beam and slab calculations with timestamps.', link: '/history' },
  { title: 'Calculation Steps', description: 'Follow clear engineering steps for every design stage.', link: '/steps' }
];

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100 lg:p-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 grid gap-6 lg:grid-cols-[0.7fr_0.3fr]">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Dashboard</p>
                <h2 className="mt-3 text-4xl font-semibold text-slate-100">Smart Rebar Detailing Hub</h2>
                <p className="mt-4 max-w-2xl text-slate-400">Design beams and slabs, store results, and follow step-by-step calculations in a polished workspace.</p>
              </div>
              <button onClick={handleLogout} className="rounded-2xl border border-rose-500 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/20">
                Logout
              </button>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5">
                <p className="text-sm text-slate-400">Current user</p>
                <p className="mt-2 text-lg font-semibold text-slate-100">{user?.name || 'Guest User'}</p>
                <p className="text-sm text-slate-500">{user?.email || 'Not signed in'}</p>
              </div>
              <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5">
                <p className="text-sm text-slate-400">Design status</p>
                <p className="mt-2 text-lg font-semibold text-emerald-400">Bring your idea to detailed drawings</p>
                  <button onClick={() => navigate('/column')} className="mt-4 rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400">
                    Start a new column design
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900/80 via-slate-950 to-slate-900/60 p-8 shadow-2xl">
            <p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Quick actions</p>
            <h3 className="mt-3 text-3xl font-semibold text-slate-100">Navigate faster</h3>
            <div className="mt-8 space-y-3">
              {cards.slice(0, 4).map((card) => (
                <Link key={card.title} to={card.link} className="block rounded-2xl border border-slate-700 bg-slate-950/80 px-5 py-4 text-sm text-slate-200 transition hover:border-cyan-500 hover:bg-slate-900/90">
                  <p className="font-semibold text-slate-100">{card.title}</p>
                  <p className="mt-1 text-slate-400">{card.description}</p>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
            <h3 className="text-2xl font-semibold text-slate-100">Recent activity</h3>
            <p className="mt-3 text-slate-400">Your latest saved designs and the next recommended step.</p>
            <div className="mt-8 grid gap-4">
              <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5">
                <p className="text-sm text-slate-400">Next recommended action</p>
                <p className="mt-2 text-lg font-semibold text-slate-100">Open calculation steps and review the history of your projects.</p>
              </div>
              <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5">
                <p className="text-sm text-slate-400">Design tip</p>
                <p className="mt-2 text-lg font-semibold text-slate-100">Use the step-by-step guide to verify load, depth and reinforcement before report generation.</p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
            <h3 className="text-2xl font-semibold text-slate-100">Overview</h3>
            <ul className="mt-6 space-y-4 text-slate-300">
              <li className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                <p className="font-semibold text-slate-100">Beam + slab + column modules</p>
                <p className="mt-2 text-sm text-slate-400">Design members with automatic reinforcement selection and code checks.</p>
              </li>
              <li className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                <p className="font-semibold text-slate-100">Saved history</p>
                <p className="mt-2 text-sm text-slate-400">Saved designs appear in history for easy retrieval and project review.</p>
              </li>
              <li className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                <p className="font-semibold text-slate-100">Guided calculations</p>
                <p className="mt-2 text-sm text-slate-400">Step-by-step calculation guidance helps validate the beam/slab design process.</p>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
