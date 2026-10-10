import { Link } from 'react-router-dom';

const modules = [
  {
    number: '01',
    title: 'Beam',
    description: 'RCC beam design, engineering checks, and reinforcement detailing.',
    href: '/beam'
  },
  {
    number: '02',
    title: 'Slab',
    description: 'One-way and two-way slab analysis with reinforcement detailing.',
    href: '/slab'
  },
  {
    number: '03',
    title: 'Column',
    description: 'Rectangular column design for axial load and biaxial bending.',
    href: '/column'
  },
  {
    number: '04',
    title: 'Footing',
    description: 'Isolated footing design for a column supported on soil.',
    href: '/footing'
  }
];

const workflow = [
  ['01', 'Set up the design', 'Enter member geometry, materials, supports, and loads.'],
  ['02', 'Review the results', 'Follow design checks and calculation steps.'],
  ['03', 'Detail and report', 'Inspect reinforcement views and generate design reports.']
];

function StructuralIllustration() {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Structural system</p>
          <h2 className="mt-1 text-lg font-medium text-slate-200">Connected design modules</h2>
        </div>
        <span className="rounded-md border border-slate-800 px-2.5 py-1 text-xs text-slate-400">RCC</span>
      </div>
      <svg
        className="mt-5 h-auto w-full"
        viewBox="0 0 560 300"
        role="img"
        aria-label="Conceptual illustration of a multi-storey structural frame"
      >
        <defs>
          <pattern id="frame-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M28 0H0V28" fill="none" stroke="#1e293b" strokeWidth="1" />
          </pattern>
          <linearGradient id="frame-glow" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#22d3ee" stopOpacity=".16" />
            <stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="560" height="300" rx="12" fill="url(#frame-grid)" />
        <rect width="560" height="300" rx="12" fill="url(#frame-glow)" />
        <g fill="none" stroke="#64748b" strokeWidth="2">
          <path d="M92 245V92M216 245V66M344 245V82M468 245V104" />
          <path d="M92 92H468M92 143H468M92 194H468M92 245H468" />
        </g>
        <g fill="none" stroke="#22d3ee" strokeWidth="2.5">
          <path d="M92 143H468M216 66V245M344 82V245" opacity=".9" />
          <path d="M92 92V245M468 104V245" opacity=".5" />
        </g>
        <g fill="#22d3ee" stroke="#020617" strokeWidth="3">
          <circle cx="92" cy="143" r="6" /><circle cx="216" cy="143" r="6" />
          <circle cx="344" cy="143" r="6" /><circle cx="468" cy="143" r="6" />
          <circle cx="216" cy="194" r="5" /><circle cx="344" cy="194" r="5" />
        </g>
        <path d="M70 258H490" stroke="#475569" strokeWidth="1" />
      </svg>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        Conceptual illustration only—not a calculated model or construction detail.
      </p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5 lg:px-8">
        <Link to="/" className="flex min-w-0 items-center gap-3" aria-label="Automatic Rebar Detailing System home">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-400 text-lg font-bold text-slate-950">R</span>
          <span className="min-w-0">
            <span className="block truncate text-base font-semibold tracking-tight sm:text-lg">Automatic Rebar Detailing System</span>
            <span className="block text-xs text-slate-400 sm:text-sm">Structural design and detailing</span>
          </span>
        </Link>
        <nav aria-label="Main navigation" className="flex shrink-0 items-center gap-1 sm:gap-3">
          <a href="#modules" className="hidden rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:text-cyan-300 sm:block">Modules</a>
          <Link to="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-900 hover:text-white sm:px-4">Log in</Link>
          <Link to="/signup" className="rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 sm:px-4">Create account</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-6 pb-8 lg:px-8">
        <section className="grid items-center gap-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 sm:p-9 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:p-10">
          <div className="py-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Structural design workspace</p>
            <h1 className="mt-4 max-w-xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Design with precision. Detail with confidence.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-300">
              An integrated workspace for RCC beam, slab, column, and footing design, reinforcement detailing, design checks, and reports.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to="/dashboard" className="rounded-lg bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">
                Start Designing <span aria-hidden="true">→</span>
              </Link>
              <a href="#modules" className="rounded-lg border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-slate-800/60">
                Explore Modules
              </a>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-400">
              <span>Calculation steps</span>
              <span>Reinforcement views</span>
              <span>Saved design history</span>
            </div>
          </div>
          <StructuralIllustration />
        </section>

        <section id="modules" className="scroll-mt-6 pt-12">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">Design modules</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Choose your starting point</h2>
            </div>
            <p className="max-w-lg text-sm leading-6 text-slate-400">
              Focused tools for the structural elements in your project.
            </p>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {modules.map((module) => (
              <Link
                key={module.title}
                to={module.href}
                className="group flex min-h-44 flex-col rounded-xl border border-slate-800 bg-slate-900/50 p-5 transition-colors hover:border-cyan-400/50 hover:bg-slate-900"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-cyan-400">{module.number}</span>
                  <span aria-hidden="true" className="text-slate-500 transition group-hover:text-cyan-300">↗</span>
                </div>
                <h3 className="mt-4 text-lg font-semibold">{module.title} design</h3>
                <p className="mt-1 flex-1 text-sm leading-6 text-slate-400">{module.description}</p>
                <span className="mt-4 text-sm font-medium text-slate-300 group-hover:text-cyan-300">Open module <span aria-hidden="true">→</span></span>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-12 rounded-2xl border border-slate-800 bg-slate-900/40 p-6 sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">A considered workflow</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">From inputs to reviewed details</h2>
            </div>
            <Link to="/dashboard" className="text-sm font-medium text-cyan-300 transition hover:text-cyan-200">Open workspace <span aria-hidden="true">→</span></Link>
          </div>
          <div className="mt-6 grid gap-5 md:grid-cols-3 md:gap-7">
            {workflow.map(([number, title, description]) => (
              <article key={number} className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-700 text-xs font-semibold text-cyan-300">{number}</span>
                <div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-400">{description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 py-5 text-sm text-slate-500">
          <p>Automatic Rebar Detailing System</p>
          <p>Structural design and reinforcement detailing</p>
        </footer>
      </main>
    </div>
  );
}
