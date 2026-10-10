import { Fragment, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import api from '../services/api';
import SlabReinforcementDiagram, { StatusChip } from '../components/SlabReinforcementDiagram.jsx';
import { slabDetailingPresentation, slabShearStatusPresentation } from '../utils/reinforcementDetailingPresentation.js';

const NOT_PROVIDED = 'NOT PROVIDED';
const NOT_ESTABLISHED = 'NOT ESTABLISHED';

const defaultValues = {
  projectName: 'Residential Slab Design',
  designerName: 'Engineer',
  date: new Date().toISOString().slice(0, 10),
  remarks: 'Design generated from the slab module',
  length: 5.0,
  width: 3.0,
  slabThickness: 150,
  wallThickness: 0.15,
  supportType: 'Simply Supported',
  cornerRestraint: 'FREE_TO_LIFT',
  clearCover: 25,
  concreteGrade: 'M35',
  steelGrade: 'Fe500',
  liveLoad: 3,
  floorFinishLoad: 1.5,
  unitWeightConcrete: 25,
  preferredBarDiameter: 12
};

// Every displayed value is read from the authoritative result and formatted here only.
// Nothing is recalculated in this file: no engineering value is derived in JSX.
const finite = (value) => (Number.isFinite(Number(value)) && value !== null && value !== undefined ? Number(value) : null);

const shown = (value, fallback = NOT_PROVIDED) => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number' && !Number.isFinite(value)) return fallback;
  if (typeof value === 'string' && /undefined|null|NaN|Infinity/i.test(value)) return fallback;
  return String(value);
};

const num = (value, digits, unit = '', fallback = NOT_PROVIDED) => {
  const numeric = finite(value);
  return numeric === null ? fallback : `${numeric.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
};

const barText = (direction) => {
  const diameter = finite(direction?.diameter);
  const spacing = finite(direction?.spacing);
  if (diameter === null || spacing === null) return NOT_PROVIDED;
  return `${diameter} mm @ ${spacing} mm c/c`;
};

/** Beam-module summary grid cell. */
function Field({ label, value, tone = '' }) {
  return (
    <div className="min-w-0">
      <p className="text-slate-400">{label}</p>
      <p className={`truncate font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

/** Beam-module section card. */
function Panel({ title, aside = null, children }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="font-semibold text-slate-200">{title}</h4>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * Compact engineering-check table. Every row renders from the authoritative check
 * object; the expandable row only reveals the reason, code reference and verification
 * requirement the engine already produced.
 */
function CheckTable({ checks }) {
  const [open, setOpen] = useState(null);
  if (!checks.length) {
    return <p className="text-slate-400">No engineering checks were returned by the design engine.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3 font-medium">Check</th>
            <th className="py-2 pr-3 font-medium">Actual</th>
            <th className="py-2 pr-3 font-medium">Limit / basis</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((check) => {
            const expanded = open === check.id;
            const actual = check.actualValue ?? check.actual;
            const limit = check.limitValue ?? check.limit;
            return (
              <Fragment key={check.id}>
                <tr
                  className={`cursor-pointer border-b border-slate-800/70 align-top ${expanded ? 'bg-slate-900/60' : 'hover:bg-slate-900/40'}`}
                  onClick={() => setOpen(expanded ? null : check.id)}
                  aria-expanded={expanded}
                >
                  <td className="py-2 pr-3 text-slate-300">{check.title}</td>
                  <td className="py-2 pr-3 tabular-nums text-slate-200">
                    {actual === null || actual === undefined ? '—' : `${actual}${check.unit ? ` ${check.unit}` : ''}`}
                  </td>
                  <td className="py-2 pr-3 text-slate-400">
                    {limit === null || limit === undefined ? (check.codeReference ?? '—') : `${limit}${check.unit ? ` ${check.unit}` : ''}`}
                  </td>
                  <td className="py-2"><StatusChip status={check.status} /></td>
                </tr>
                {expanded ? (
                  <tr className="border-b border-slate-800/70 bg-slate-900/40">
                    <td colSpan={4} className="py-2 text-xs">
                      <p className="text-slate-300">{shown(check.reason)}</p>
                      <p className="mt-1 text-slate-500">
                        {`Code reference: ${shown(check.codeReference, 'N/A')}`
                          + ` · Verification required: ${check.verificationRequired ? 'YES' : 'NO'}`}
                      </p>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The authoritative calculation trace, collapsed by default and grouped into
 * engineering sections. Grouping metadata is supplied by the calculation service;
 * no step is recomputed or removed here.
 */
function CalculationTrace({ steps }) {
  const [open, setOpen] = useState(null);
  const groups = useMemo(() => {
    const collected = [];
    steps.forEach((entry) => {
      const key = entry.group ?? 'other';
      const existing = collected.find((group) => group.key === key);
      if (existing) existing.steps.push(entry);
      else collected.push({ key, label: entry.groupLabel ?? key, steps: [entry] });
    });
    return collected;
  }, [steps]);

  if (!steps.length) {
    return <p className="text-slate-400">No calculation steps were returned by the design engine.</p>;
  }

  return (
    <div className="space-y-1.5">
      {groups.map((group) => {
        const expanded = open === group.key;
        return (
          <div key={group.key} className="overflow-hidden rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : group.key)}
              aria-expanded={expanded}
              className="flex w-full items-center justify-between gap-2 bg-slate-900/60 px-3 py-2 text-left text-sm font-semibold text-slate-200 hover:bg-slate-900"
            >
              <span>{group.label}</span>
              <span className="shrink-0 text-xs font-normal text-slate-500">
                {`${group.steps.length} step${group.steps.length === 1 ? '' : 's'} · ${expanded ? 'hide' : 'show'}`}
              </span>
            </button>
            {expanded ? (
              <div className="space-y-3 p-3 text-sm">
                {group.steps.map((entry) => (
                  <div key={entry.id ?? entry.step} className="border-b border-slate-800/70 pb-3 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium text-slate-200">
                        <span className="mr-2 font-semibold text-cyan-400">{entry.step}.</span>
                        {shown(entry.title)}
                      </p>
                      <p className="tabular-nums text-slate-300">
                        {`${shown(entry.result)}${entry.unit ? ` ${entry.unit}` : ''}`}
                      </p>
                    </div>
                    {entry.formula ? <p className="mt-1 break-words text-xs text-slate-500">{`Formula: ${entry.formula}`}</p> : null}
                    {entry.substitution ? <p className="mt-1 break-words text-xs text-slate-500">{`Substitution: ${entry.substitution}`}</p> : null}
                    {entry.status ? <p className="mt-1"><StatusChip status={entry.status} /></p> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function SlabDesignPage() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { register, handleSubmit, getValues } = useForm({ defaultValues });

  // Read-only aliases over the authoritative result object. Nothing is recalculated here.
  const output = result?.designOutput || {};
  const loads = result?.loadSummary || {};
  const forces = result?.designForces || {};
  const shortDir = result?.shortDirectionReinforcement;
  const longDir = result?.longDirectionReinforcement;
  const detailing = slabDetailingPresentation(result?.detailing);
  const shearStatus = slabShearStatusPresentation(result || {});
  const checks = Array.isArray(result?.checks) ? result.checks : [];
  const steps = Array.isArray(result?.calculationSteps) ? result.calculationSteps : [];
  const cover = result?.coverVerification || {};

  const verificationItems = useMemo(
    () => checks.filter((check) => check.status === 'VERIFICATION REQUIRED'),
    [checks]
  );
  const statusReason = verificationItems.length
    ? verificationItems.map((check) => `${check.title}: ${check.reason}`).join('  ')
    : shown(result?.validationMessage, '');

  const onSubmit = async (values) => {
    setIsLoading(true);
    setError('');
    try {
      const response = await api.post('/slabs/design', values);
      setResult(response.data);
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to calculate slab design.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadReport = async () => {
    if (!result) return;
    try {
      // The report endpoint regenerates slab output from these validated inputs.  Sending
      // the full calculation trace back (including every thickness iteration) made this
      // request exceed Express's JSON body limit, before the report controller ran.
      const payload = { ...getValues(), result: { designType: result.designType } };
      const response = await api.post('/reports/pdf', payload, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'slab-report.pdf');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError('Unable to generate report.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100 lg:p-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Slab Design</p>
            <h2 className="text-3xl font-semibold">Automatic Rebar Detailing</h2>
          </div>
          <a href="/dashboard" className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-cyan-400">Dashboard</a>
        </div>

        <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 self-start rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl">
            <div>
              <h3 className="text-xl font-semibold">Project Details</h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-sm text-slate-300">
                  Project Name
                  <input {...register('projectName')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
                <label className="text-sm text-slate-300">
                  Designer Name
                  <input {...register('designerName')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
                <label className="text-sm text-slate-300">
                  Date
                  <input type="date" {...register('date')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
                <label className="text-sm text-slate-300">
                  Remarks
                  <input {...register('remarks')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
              </div>
            </div>

            <div>
              <h3 className="text-xl font-semibold">Geometry</h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-sm text-slate-300">
                  Length — centre-to-centre (m)
                  <input type="number" step="0.1" {...register('length')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
                <label className="text-sm text-slate-300">
                  Width — centre-to-centre (m)
                  <input type="number" step="0.1" {...register('width')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
                <label className="text-sm text-slate-300">
                  Slab Thickness (mm)
                  <input type="number" step="1" {...register('slabThickness')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
                <label className="text-sm text-slate-300">
                  Wall / Support Thickness (m)
                  <input type="number" step="0.01" {...register('wallThickness')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
                <label className="text-sm text-slate-300">
                  Support Type
                  <select {...register('supportType')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
                    <option>Simply Supported</option>
                    <option>Continuous</option>
                    <option>Cantilever</option>
                  </select>
                </label>
                <label className="text-sm text-slate-300">
                  Corner Restraint
                  <select {...register('cornerRestraint')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
                    <option value="FREE_TO_LIFT">FREE_TO_LIFT (corners free to lift)</option>
                    <option value="RESTRAINED">RESTRAINED (corners held down)</option>
                  </select>
                </label>
                <label className="text-sm text-slate-300 md:col-span-2">
                  Clear Cover (mm)
                  <input type="number" {...register('clearCover')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Length and Width are the <span className="font-semibold text-slate-300">centre-to-centre support spans</span>; the clear span
                is the centre-to-centre span less the support width, and the effective span is
                min(clear span + d, centre-to-centre) per IS&nbsp;456:2000 Clause&nbsp;22.2.
              </p>
              <p className="mt-1 text-xs text-slate-400">
                A simply supported slab with FREE_TO_LIFT corners uses the IS 456:2000 Table 27 coefficients.
                Finite ratios above 2.5 require verification because the published infinity column is not a finite
                interpolation endpoint. Restrained/Table 26 panels with ly/lx &gt; 2 are rejected as one-way.
              </p>
            </div>

            <div>
              <h3 className="text-xl font-semibold">Material &amp; Loading</h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-sm text-slate-300">
                  Concrete Grade
                  <select {...register('concreteGrade')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
                    <option>M20</option>
                    <option>M25</option>
                    <option>M30</option>
                    <option>M35</option>
                  </select>
                </label>
                <label className="text-sm text-slate-300">
                  Steel Grade
                  <select {...register('steelGrade')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
                    <option>Fe250</option>
                    <option>Fe415</option>
                    <option>Fe500</option>
                  </select>
                </label>
                <label className="text-sm text-slate-300">
                  Live Load (kN/m²)
                  <input type="number" step="0.1" {...register('liveLoad')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
                <label className="text-sm text-slate-300">
                  Floor Finish Load (kN/m²)
                  <input type="number" step="0.1" {...register('floorFinishLoad')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
                <label className="text-sm text-slate-300">
                  Unit Weight Concrete (kN/m³)
                  <input type="number" step="0.1" {...register('unitWeightConcrete')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
                <label className="text-sm text-slate-300">
                  Preferred Bar Diameter (mm)
                  <select {...register('preferredBarDiameter')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
                    <option value={8}>8</option>
                    <option value={10}>10</option>
                    <option value={12}>12</option>
                    <option value={16}>16</option>
                    <option value={20}>20</option>
                  </select>
                </label>
              </div>
            </div>

            <button type="submit" className="w-full rounded-xl bg-cyan-500 px-4 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400">
              {isLoading ? 'Calculating…' : 'Calculate Slab Design'}
            </button>
          </form>

          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
              <h3 className="text-xl font-semibold">Design Output</h3>
              {error ? <p className="mt-3 text-sm text-rose-400">{error}</p> : null}
              {isLoading ? (
                <div className="mt-6 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-5 text-center">
                  <p className="font-semibold text-cyan-300">Calculating slab design…</p>
                  <p className="mt-1 text-sm text-slate-400">Running IS 456:2000 checks and preparing both reinforcement directions.</p>
                </div>
              ) : !result ? (
                <p className="mt-3 text-sm text-slate-400">Submit the form to generate the slab design output and reinforcement details.</p>
              ) : result.coefficientStatus === 'VERIFICATION REQUIRED' ? (
                <div className="mt-4 space-y-4">
                  <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
                    <div className="flex items-center gap-3">
                      <span className="text-sm uppercase tracking-wide text-slate-400">Design Status</span>
                      <StatusChip status="VERIFICATION REQUIRED" />
                    </div>
                    <p className="mt-3 text-sm font-semibold text-amber-300">Coefficient not established</p>
                    <p className="mt-1 text-sm text-amber-100/90">{result.coefficientNotEstablishedReason}</p>
                    <p className="mt-3 text-xs text-slate-300">
                      No Table 27 coefficients, design moments, or reinforcement values are reported for this finite aspect ratio.
                    </p>
                  </div>
                  <div className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 sm:grid-cols-2">
                    <Field label="Coefficient Table" value={shown(result.coefficientTableReference)} />
                    <Field label="Finite Aspect Ratio" value={num(result.aspectRatio, 4)} />
                    <Field label="αx" value={NOT_ESTABLISHED} />
                    <Field label="αy" value={NOT_ESTABLISHED} />
                  </div>
                  <button onClick={handleDownloadReport} className="w-full rounded-xl border border-cyan-500 px-4 py-2 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/10">
                    Download Verification Report
                  </button>
                </div>
              ) : (
                <div className="mt-4 space-y-4">

                  {/* ---------- B. DESIGN STATUS BANNER ---------- */}
                  <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="text-sm uppercase tracking-wide text-slate-400">Design Status</span>
                        <StatusChip status={result.finalStatus} />
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-slate-400">Final adopted thickness</p>
                        <p className="text-lg font-semibold text-amber-300">
                          {result.adoptedThickness === null ? NOT_ESTABLISHED : num(result.adoptedThickness, 0, 'mm')}
                        </p>
                      </div>
                    </div>
                    {statusReason ? (
                      <div className="mt-3 border-t border-amber-500/20 pt-3">
                        <p className="text-sm font-semibold text-amber-300">Reason:</p>
                        <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-amber-200/90">
                          {verificationItems.length
                            ? verificationItems.map((check) => <li key={check.id}>{`${check.title}: ${check.reason}`}</li>)
                            : <li>{statusReason}</li>}
                        </ul>
                      </div>
                    ) : null}
                    <p className="mt-3 text-xs text-slate-400">
                      {`Thickness search: ${shown(result.evaluatedThicknessCount)} thicknesses evaluated `
                        + `(${shown(result.incrementCount)} increments) up to ${num(result.lastEvaluatedThickness, 0, 'mm')}; `
                        + `${shown(result.adoptionCount)} satisfied every required check. `
                        + 'The last evaluated thickness is not an adopted thickness.'}
                    </p>
                  </div>

                  {/* ---------- C. DESIGN SUMMARY ---------- */}
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <h4 className="font-semibold text-slate-200">Design Summary</h4>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label="Design Type" value={shown(output.designType)} tone="text-cyan-300" />
                      <Field label="Slab Type" value={shown(output.slabType)} tone="text-emerald-400" />
                      <Field label="Support Type" value={shown(output.supportType)} />
                      <Field label="Concrete / Steel Grade" value={`${shown(output.concreteGrade)} / ${shown(output.steelGrade)}`} />
                      <Field label="Evaluated Thickness" value={num(output.slabThickness, 0, 'mm')} />
                      <Field
                        label="Final Adopted Thickness"
                        value={result.adoptedThickness === null ? NOT_ESTABLISHED : num(result.adoptedThickness, 0, 'mm')}
                        tone="text-amber-300"
                      />
                      <Field label="Short Span Lx" value={num(output.shortSpan, 2, 'm')} />
                      <Field label="Long Span Ly" value={num(output.longSpan, 2, 'm')} />
                      <Field label="Aspect Ratio" value={num(output.aspectRatio, 3)} />
                      <Field label="Effective Depth – Short" value={num(output.effectiveDepthShort, 0, 'mm')} />
                      <Field label="Effective Depth – Long" value={num(output.effectiveDepthLong, 0, 'mm')} />
                      <Field label="Nominal Cover" value={num(output.clearCover, 0, 'mm')} />
                    </div>
                    <p className="mt-3 text-xs text-slate-400">
                      <span className="font-semibold text-slate-300">Span input: </span>
                      Length and Width are centre-to-centre support spans.
                      <span className="ml-2 font-semibold text-slate-300">Effective span: </span>
                      Leff = min(clear span + d, centre-to-centre) — IS 456:2000 Clause 22.2.
                    </p>
                  </div>

                  {/* ---------- D. LOADS ---------- */}
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <h4 className="font-semibold text-slate-200">Loads</h4>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <Field label="Self Weight" value={num(loads.selfWeight, 2, 'kN/m²')} />
                      <Field label="Floor Finish" value={num(loads.floorFinish, 2, 'kN/m²')} />
                      <Field label="Dead Load" value={num(loads.deadLoad, 2, 'kN/m²')} />
                      <Field label="Live Load" value={num(loads.liveLoad, 2, 'kN/m²')} />
                      <Field label="Service Load" value={num(loads.serviceLoad, 2, 'kN/m²')} />
                      <Field label="Ultimate Load wu" value={num(loads.ultimateLoad, 2, 'kN/m²')} tone="text-cyan-300" />
                    </div>
                  </div>

                  {/* ---------- E. DESIGN FORCES ---------- */}
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <h4 className="font-semibold text-slate-200">Design Forces</h4>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label="Aspect Ratio" value={num(forces.aspectRatio, 3)} />
                      <Field label="Coefficient Table" value={shown(forces.coefficientTableReference)} tone="text-cyan-300" />
                      <Field label="αx" value={num(forces.alphaX, 4)} />
                      <Field label="αy" value={num(forces.alphaY, 4)} />
                      <Field label="Mx (short direction)" value={num(forces.MuShort, 2, 'kN·m/m')} />
                      <Field label="My (long direction)" value={num(forces.MuLong, 2, 'kN·m/m')} />
                      <Field label="Effective Short Span Used" value={num(result.shortSpanUsedForBothMoments, 2, 'm')} />
                      <Field label="Moment Equation" value={shown(forces.momentEquation)} />
                    </div>
                    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Coefficient selection</p>
                      <p className="mt-1 text-sm text-slate-300">{shown(forces.coefficientSelectionReason)}</p>
                      <p className="mt-1 text-xs text-slate-400">{shown(forces.coefficientSource)}</p>
                      {forces.coefficientTableRuledOut ? (
                        <p className="mt-1 text-xs text-slate-500">{forces.coefficientTableRuledOut}</p>
                      ) : null}
                    </div>
                  </div>


                  {/* ---------- F. REINFORCEMENT DESIGN ---------- */}
                  <Panel title="Design Reinforcement">
                    <div className="grid gap-3 lg:grid-cols-2">
                      {[
                        {
                          key: 'Short', caption: 'SHORT DIRECTION — MAIN', dir: shortDir, depth: result.effectiveDepthShort,
                          mu: result.MuShort, flexural: result.AstFlexuralRequiredShort, minimum: result.AstMinimumShort,
                          governing: result.AstRequiredShort, provided: result.AstProvidedShort,
                          xu: result.xuShort, xuMax: result.xuMaxShort, capacity: result.momentCapacityShort,
                          byCategory: result.checksByCategory
                        },
                        {
                          key: 'Long', caption: 'LONG DIRECTION — DISTRIBUTION', dir: longDir, depth: result.effectiveDepthLong,
                          mu: result.MuLong, flexural: result.AstFlexuralRequiredLong, minimum: result.AstMinimumLong,
                          governing: result.AstRequiredLong, provided: result.AstProvidedLong,
                          xu: result.xuLong, xuMax: result.xuMaxLong, capacity: result.momentCapacityLong,
                          byCategory: result.checksByCategory
                        }
                      ].map((d) => (
                        <div key={d.key} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">{d.caption}</p>

                          {/* Governing steel — made visually obvious */}
                          <div className="mt-2 rounded-lg border border-cyan-500/25 bg-cyan-500/5 px-3 py-2">
                            <p className="text-xs text-slate-400">Governing Ast required for design</p>
                            <p className="text-xl font-semibold text-cyan-300">{num(d.governing, 2, 'mm²/m')}</p>
                            <p className="text-xs text-slate-500">{`max(flexural ${num(d.flexural, 2, '')}, minimum ${num(d.minimum, 2, '')})`}</p>
                          </div>

                          <div className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2">
                            <Field label="Flexural Ast" value={num(d.flexural, 2, 'mm²/m')} />
                            <Field label="Minimum Ast" value={num(d.minimum, 2, 'mm²/m')} />
                            <Field label="Ast Provided" value={num(d.provided, 2, 'mm²/m')} />
                            <Field label="Bar Diameter" value={num(d.dir?.diameter, 0, 'mm')} />
                            <Field label="Spacing" value={num(d.dir?.spacing, 0, 'mm c/c')} />
                            <Field label="Effective Depth d" value={num(d.depth, 0, 'mm')} />
                            <Field label="Design Moment Mu" value={num(d.mu, 2, 'kN·m/m')} />
                            <Field label="Moment Capacity" value={num(d.capacity, 2, 'kN·m/m')} />
                            <Field label="Neutral Axis xu" value={num(d.xu, 2, 'mm')} />
                            <Field label="Max Neutral Axis xu,max" value={num(d.xuMax, 2, 'mm')} />
                          </div>

                          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-800 pt-2">
                            <StatusChip status={d.key === 'Short' ? d.byCategory?.flexureShort?.status : d.byCategory?.flexureLong?.status} />
                            <StatusChip status={d.key === 'Short' ? d.byCategory?.requiredSteelShort?.status : d.byCategory?.requiredSteelLong?.status} />
                            <StatusChip status={d.key === 'Short' ? d.byCategory?.minimumSteelShort?.status : d.byCategory?.minimumSteelLong?.status} />
                            <StatusChip status={d.key === 'Short' ? d.byCategory?.spacingShort?.status : d.byCategory?.spacingLong?.status} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-xs text-slate-400">
                      <span className="font-semibold text-slate-300">Layer assumption: </span>
                      {shown(result.effectiveDepthLayerAssumption)}
                    </p>
                    {/* IS 456:2000 Annex D-2.1.1 bar extension / curtailment */}
                    {result.barExtension?.reference ? (
                      <div className="mt-3 border-t border-slate-800 pt-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            {`Bar extension / curtailment (${result.barExtension.reference})`}
                          </p>
                          <StatusChip status={result.barExtension.status} />
                        </div>
                        <p className="mt-1 text-sm text-slate-300">{shown(result.barExtension.requirement)}</p>
                        <div className="mt-2 grid gap-3 sm:grid-cols-2">
                          <Field label="Short: 0.1 lx from support" value={`${num(result.barExtension.short?.terminationAllowanceM, 3, 'm')}`} mono />
                          <Field label="Long: 0.1 ly from support" value={`${num(result.barExtension.long?.terminationAllowanceM, 3, 'm')}`} mono />
                        </div>
                        <p className="mt-2 text-xs text-amber-300/90">{shown(result.barExtension.verificationNote)}</p>
                      </div>
                    ) : null}
                  </Panel>

                  {/* ---------- G. REINFORCEMENT LAYOUT ---------- */}
                  <Panel title="Reinforcement Layout">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Short direction</p>
                        <p className="mt-1 text-lg font-semibold text-cyan-300">{barText(shortDir)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Long direction</p>
                        <p className="mt-1 text-lg font-semibold text-violet-300">{barText(longDir)}</p>
                      </div>
                    </div>
                    <h5 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Detailing</h5>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      {[
                        { label: 'Short direction', direction: detailing.shortDirection },
                        { label: 'Long direction', direction: detailing.longDirection }
                      ].map(({ label, direction }) => (
                        <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                          <Field label="Number of bars" value={direction.numberOfBars} />
                          <Field label="Available placement width" value={shown(direction.availablePlacementWidth)} />
                          <Field label="Bar arrangement" value={shown(direction.barArrangement)} />
                          <Field label="Detailing status" value={shown(direction.detailingStatus)} />
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {[
                        { label: 'Short', required: result.shortDirectionAstRequired, provided: result.shortDirectionAstProvided, maxSpacing: result.maxSpacingShort, clearSpacing: result.clearSpacingShort, status: result.checksByCategory?.spacingShort?.status },
                        { label: 'Long', required: result.longDirectionAstRequired, provided: result.longDirectionAstProvided, maxSpacing: result.maxSpacingLong, clearSpacing: result.clearSpacingLong, status: result.checksByCategory?.spacingLong?.status }
                      ].map((row) => (
                        <div key={row.label} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Field label="Governing Ast required" value={num(row.required, 2, 'mm²/m')} />
                            <Field label="Ast Provided" value={num(row.provided, 2, 'mm²/m')} />
                            <Field label="Maximum Spacing" value={num(row.maxSpacing, 0, 'mm')} />
                            <Field label="Clear Spacing" value={num(row.clearSpacing, 0, 'mm')} />
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <span className="text-xs uppercase tracking-wide text-slate-500">Spacing status</span>
                            <StatusChip status={row.status} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </Panel>

                  {/* ---------- H. SCHEMATIC ---------- */}
                  <SlabReinforcementDiagram result={result} />

                  {/* ---------- I. SERVICEABILITY ---------- */}
                  <Panel
                    title="Serviceability"
                    aside={<StatusChip status={result.deflectionStatus} />}
                  >
                    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                      <Field label="Actual L/d" value={num(result.actualLd, 2)} />
                      <Field label="Permissible L/d" value={result.permissibleLd === null ? NOT_ESTABLISHED : num(result.permissibleLd, 2)} />
                      <Field label="Modification Factor" value={result.modificationFactor === null ? NOT_ESTABLISHED : num(result.modificationFactor, 4)} />
                      <Field label="pt" value={num(result.deflectionPt, 4, '%')} />
                      <Field label="fs" value={num(result.deflectionServiceStress, 2, 'N/mm²')} />
                      <Field label="Governing Direction" value={shown(result.governingDirection)} />
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs uppercase tracking-wide text-slate-400">Shear</p>
                          <StatusChip status={shearStatus} />
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <Field label="Vu at critical section" value={num(result.Vu, 3, 'kN/m')} />
                          <Field label="τv" value={num(result.shearStress, 4, 'N/mm²')} />
                          <Field label="τc (Table 19)" value={num(result.concreteShearStrength, 2, 'N/mm²')} />
                          <Field label="τc,max (Table 20)" value={num(result.maxShearStress, 2, 'N/mm²')} />
                        </div>
                        <p className="mt-2 text-xs text-slate-500">{shown(result.criticalSection)}</p>
                        {/* State the shear model explicitly rather than leaving it implied. */}
                        {result.shearBasis?.analysisWidth ? (
                          <p className="mt-2 border-t border-slate-800 pt-2 text-xs text-slate-500">
                            <span className="font-semibold text-slate-400">Basis: </span>
                            {`${result.shearBasis.analysisWidth}, ${result.shearBasis.governingDirection}. `}
                            {`${result.shearBasis.conservatismNote} `}
                            {`${result.shearBasis.longDirectionCheck} `}
                            {result.shearBasis.shearReinforcementNote}
                          </p>
                        ) : null}
                      </div>
                      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs uppercase tracking-wide text-slate-400">Corner torsion</p>
                          <StatusChip status={result.cornerTorsionStatus} />
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <Field label="Corner Restraint" value={shown(result.cornerRestraintLabel)} />
                          <Field label="Basis" value={shown(result.cornerTorsionBasis)} />
                        </div>
                        <p className="mt-2 text-xs text-slate-500">{shown(result.cornerTorsionReason)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs uppercase tracking-wide text-slate-400">Cover</p>
                          <StatusChip status={result.checksByCategory?.cover?.status} />
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <Field label="Clear cover" value={num(result.clearCover, 0, 'mm')} />
                          <Field
                            label="Cover vs bar (geometric)"
                            value={shown(result.checksByCategory?.coverGeometric?.status)}
                            status={result.checksByCategory?.coverGeometric?.status}
                          />
                        </div>
                        <p className="mt-2 text-xs text-slate-500">{shown(cover.reason)}</p>
                      </div>
                    </div>
                    {result.deflectionStatus === 'VERIFICATION REQUIRED' ? (
                      <p className="mt-3 text-sm text-amber-300">{`Reason: ${shown(result.deflectionMessage)}`}</p>
                    ) : null}
                    {Array.isArray(result.deflectionOutOfRangeInputs) && result.deflectionOutOfRangeInputs.length ? (
                      <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-amber-200/80">
                        {result.deflectionOutOfRangeInputs.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    ) : null}
                  </Panel>

                  {/* ---------- J. ENGINEERING CHECKS ---------- */}
                  <Panel title={`Engineering Checks (${checks.length})`}>
                    <CheckTable checks={checks} />
                  </Panel>

                  {/* ---------- K. CALCULATION TRACE ---------- */}
                  <Panel title={`Calculation Trace (${steps.length} steps)`}>
                    <p className="mb-3 text-xs text-slate-400">
                      Every calculation step is reproduced from the design engine. Expand a group to view its
                      formula, substitution, result, unit and status.
                    </p>
                    <CalculationTrace steps={steps} />
                  </Panel>

                  {/* ---------- FINAL VERIFICATION SUMMARY ---------- */}
                  <Panel title="Final Verification Summary">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <p className="text-slate-400">Final design status</p>
                        <p className="mt-1"><StatusChip status={result.finalStatus} /></p>
                      </div>
                      <div>
                        <p className="text-slate-400">Final adopted thickness</p>
                        <p className="font-semibold text-amber-300">
                          {result.adoptedThickness === null ? NOT_ESTABLISHED : num(result.adoptedThickness, 0, 'mm')}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-400">Cover verification</p>
                        <p className="mt-1"><StatusChip status={cover.status} /></p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-slate-400">{shown(cover.reason)}</p>
                    {verificationItems.length ? (
                      <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                        <p className="text-sm font-semibold text-amber-300">
                          Items requiring verification ({verificationItems.length})
                        </p>
                        <ul className="mt-1 list-inside list-disc space-y-1 text-xs text-amber-200/90">
                          {verificationItems.map((check) => <li key={check.id}>{`${check.title}: ${check.reason}`}</li>)}
                        </ul>
                      </div>
                    ) : null}
                    <p className="mt-3 text-xs text-slate-500">{shown(result.validationMessage)}</p>
                  </Panel>

                  <button onClick={handleDownloadReport} className="w-full rounded-xl border border-cyan-500 px-4 py-2 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/10">
                    Download PDF Report
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
