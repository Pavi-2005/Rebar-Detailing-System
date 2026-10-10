import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { fetchHistory, deleteHistoryEntry } from '../services/historyService.js';

export default function HistoryPage() {
  const { user } = useAuth();
  const [designs, setDesigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;

    const loadHistory = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetchHistory();
        setDesigns(response);
      } catch (err) {
        setError('Unable to load history.');
      } finally {
        setLoading(false);
      }
    };

    loadHistory();
  }, [user]);

  const handleDelete = async (id) => {
    try {
      await deleteHistoryEntry(id);
      setDesigns((current) => current.filter((item) => item._id !== id));
    } catch (err) {
      setError('Unable to delete history entry.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100 lg:p-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Design History</p>
              <h2 className="text-3xl font-semibold">Your saved calculations</h2>
              <p className="mt-2 text-slate-400">See beam and slab records with timestamp, design type, and output summary.</p>
            </div>
            <div className="rounded-3xl bg-slate-950/90 border border-slate-700 p-4 text-sm text-slate-300">
              <p className="font-semibold text-slate-100">Logged in as</p>
              <p>{user?.name || 'Guest'}</p>
              <p className="text-slate-500">{user?.email || 'No user'}</p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {!user ? (
            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-8 text-slate-400">Login to view your saved design history.</div>
          ) : designs.length === 0 ? (
            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-8 text-slate-400">No designs saved yet.</div>
          ) : (
            designs.map((design, index) => {
              const result = design.result || {};
              const dateValue = design.createdAt || design.timestamp;
              const type = result.designType || design.designType || 'Slab';
              return (
                <div key={index} className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-lg">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-sm text-slate-400">{new Date(dateValue).toLocaleString()}</p>
                      <h3 className="text-xl font-semibold text-slate-100">{design.projectName || 'Untitled Project'}</h3>
                      <p className="mt-1 text-sm text-slate-400">{type} design · {result.designStatus || 'Pending'}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-950/80 px-4 py-2 text-sm text-cyan-300">{type}</div>
                  </div>
                  <div className="mt-5 grid gap-4 md:grid-cols-3">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                      <p className="text-sm text-slate-400">Main Reinforcement</p>
                      <p className="mt-2 text-sm font-semibold text-slate-100">{result.mainReinforcement || 'N/A'}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                      <p className="text-sm text-slate-400">Compression Reinforcement</p>
                      <p className="mt-2 text-sm font-semibold text-slate-100">{result.compressionReinforcement || 'N/A'}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                      <p className="text-sm text-slate-400">Status</p>
                      <p className="mt-2 text-sm font-semibold text-emerald-400">{result.designStatus || 'Pending'}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
