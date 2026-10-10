import { useState } from 'react';
import { useForm } from 'react-hook-form';
import api from '../services/api';
import BeamReinforcementDiagram from '../components/BeamReinforcementDiagram';

const defaultValues = {
  projectName: 'Residential Beam Design',
  designerName: 'Engineer',
  date: new Date().toISOString().slice(0, 10),
  remarks: 'Design generated from the beam module',
  length: 4.0,
  breadth: 300,
  overallDepth: 500,
  supportType: 'Simply Supported',
  supportCondition: 'Simply Supported',
  clearSpan: undefined,
  supportWidth: undefined,
  terminationSetbackFromSupportFace: undefined,
  availableEmbedmentLength: undefined,
  clearCover: 25,
  concreteGrade: 'M25',
  steelGrade: 'Fe415',
  liveLoad: 10,
  deadLoad: 3,
  unitWeightConcrete: 25,
  preferredBarDiameter: 16
};

const shown = (value, fallback = 'Not determined') => (
  value === undefined || value === null || value === '' || value === 'undefined' || value === 'null' ? fallback : value
);

// Calculation steps arrive fully formatted from the design engine. The engine already numbers the
// description, so the leading number is stripped here and the step index is rendered exactly once.
// Non-finite placeholders (undefined/null/NaN/Infinity) are only presentation states: they mean the
// engine could not determine that value, never that the value is zero.
const stepText = (item) => String(item?.value ?? item?.description ?? '')
  .trim()
  .replace(/^\s*\d+[.)]\s*/, '')
  .replace(/\bundefined\b/g, 'Not determined')
  .replace(/\bnull\b/g, 'Not determined')
  .replace(/\bNaN\b/g, 'Not determined')
  .replace(/\bInfinity\b/g, 'Not determined')
  .replace(/Not determined\s*mm(?:²)?/g, 'Not determined')
  .replace(/\s{2,}/g, ' ')
  .trim();

// Physical face/role metadata from the calculated cage; the fallback reproduces that mapping for
// results produced before the metadata existed. Naming is presentation only, never a calculation.
export const barGroupLabels = (result) => {
  if (!result) return { main: 'Main tension bars', secondary: 'Top detailing/hanger bars' };
  const flexural = result.reinforcement?.bottomBars || {};
  const secondary = result.reinforcement?.topBars || {};
  const flexuralFace = flexural.face === 'top' || flexural.face === 'bottom'
    ? flexural.face
    : (result.beamType === 'Cantilever' ? 'top' : 'bottom');
  const secondaryFace = secondary.face === 'top' || secondary.face === 'bottom'
    ? secondary.face
    : (result.beamType === 'Cantilever' ? 'bottom' : 'top');
  const secondaryRole = secondary.structuralRole || (result.continuousDesign ? 'tension' : 'hanger/detailing');
  const main = flexuralFace === 'top'
    ? `Top flexural tension bars (physical top face at the fixed support)`
    : `${result.continuousDesign ? 'Bottom positive-moment flexural bars' : 'Bottom flexural tension bars'} (physical bottom face)`;
  const secondaryLabel = secondaryRole === 'tension'
    ? `Top negative-moment/support bars (physical ${secondaryFace} face)`
    : `${secondaryFace === 'top' ? 'Top' : 'Bottom'} detailing/hanger bars (physical ${secondaryFace} face; not flexurally designed steel)`;
  return { main, secondary: secondaryLabel };
};

function CalculationStepRow({ step }) {
  return (
    <div className="flex gap-3 border-b border-slate-700 pb-2 last:border-0 last:pb-0">
      <span className="min-w-fit font-semibold text-cyan-400">{shown(step?.step, '—')}.</span>
      <div className="flex-1">
        <p className="text-slate-300">{stepText(step) || 'Not determined'}</p>
      </div>
    </div>
  );
}

export default function BeamDesignPage() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { register, handleSubmit, getValues } = useForm({ defaultValues });

  const onSubmit = async (values) => {
    setIsLoading(true);
    setError('');

    try {
      const response = await api.post('/beams/design', values);
      setResult(response.data);
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to calculate beam design.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadReport = async () => {
    if (!result) return;
    try {
      const payload = { ...getValues(), result };
      const response = await api.post('/reports/pdf', payload, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'beam-report.pdf');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError('Unable to generate report.');
    }
  };


  // Physical face/role naming for the calculated bar groups (presentation only).
  const barLabels = barGroupLabels(result);


  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100 lg:p-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Beam Design</p>
            <h2 className="text-3xl font-semibold">Singly Reinforced Beam Design</h2>
          </div>
          <a href="/dashboard" className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-cyan-400">Dashboard</a>
        </div>

        <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl">
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
                  Effective/Design Span (m)
                  <input type="number" step="0.1" {...register('length')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
                <label className="text-sm text-slate-300">
                  Breadth (mm)
                  <input type="number" step="10" {...register('breadth')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
                <label className="text-sm text-slate-300">
                  Overall Depth (mm)
                  <input type="number" step="10" {...register('overallDepth')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
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
                  Clear Cover (mm)
                  <input type="number" {...register('clearCover')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
                <label className="text-sm text-slate-300">
                  Clear Span (m, optional)
                  <input type="number" step="0.1" {...register('clearSpan', { valueAsNumber: true })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
                <label className="text-sm text-slate-300">
                  Support Width (mm, optional)
                  <input type="number" step="10" {...register('supportWidth', { valueAsNumber: true })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
                <label className="text-sm text-slate-300">
                  Support Condition
                  <select {...register('supportCondition')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
                    <option>Simply Supported</option>
                    <option>Continuous</option>
                    <option>Cantilever</option>
                  </select>
                </label>
                <label className="text-sm text-slate-300">
                  Bar Termination Setback (mm, optional)
                  <input type="number" step="1" {...register('terminationSetbackFromSupportFace', { valueAsNumber: true })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
                <label className="text-sm text-slate-300">
                  Bar Embedment (mm, optional)
                  <input type="number" step="1" {...register('availableEmbedmentLength', { valueAsNumber: true })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
              </div>
            </div>

            <div>
              <h3 className="text-xl font-semibold">Material & Loading</h3>
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
                  Live Load (kN/m)
                  <input type="number" step="0.1" {...register('liveLoad')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
                <label className="text-sm text-slate-300">
                  Superimposed Dead Load (kN/m)
                  <input type="number" step="0.1" {...register('deadLoad')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
                </label>
                <p className="text-xs text-slate-400 md:col-span-2">Beam self-weight is calculated automatically and added separately.</p>
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
              {isLoading ? 'Calculating…' : 'Calculate Beam Design'}
            </button>
          </form>

          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
              <h3 className="text-xl font-semibold">Design Output</h3>
              {error ? <p className="mt-3 text-sm text-rose-400">{error}</p> : null}
              {!result ? (
                <p className="mt-3 text-sm text-slate-400">Submit the form to generate beam design output and reinforcement details.</p>
              ) : (
                <div className="mt-4 space-y-4">
                  <div className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 md:grid-cols-2">
                    <div><p className="text-slate-400">Design Type</p><p className="font-semibold text-cyan-300">{shown(result.reinforcementCategory)}</p></div>
                    <div><p className="text-slate-400">Support Type</p><p className="font-semibold text-emerald-400">{result.beamType}</p></div>
                    <div><p className="text-slate-400">Effective Depth</p><p className="font-semibold">{shown(result.effectiveDepth)} mm</p></div>
                    <div><p className="text-slate-400">Ultimate Moment</p><p className="font-semibold">{shown(result.ultimateMoment)} kN·m</p></div>
                  </div>

                  {result.continuousDesign ? <div className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 md:grid-cols-2"><div><p className="text-slate-400">Positive/span moment Mu+</p><p className="font-semibold">{shown(result.continuousDesign.positive.mu)} kN·m</p></div><div><p className="text-slate-400">Negative/support moment Mu-</p><p className="font-semibold">{shown(result.continuousDesign.negative.mu)} kN·m</p></div><div><p className="text-slate-400">Required Ast+</p><p className="font-semibold">{shown(result.continuousDesign.positive.requiredAst)} mm²</p></div><div><p className="text-slate-400">Required Ast-</p><p className="font-semibold">{shown(result.continuousDesign.negative.requiredAst)} mm²</p></div></div> : null}

                  <div className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 md:grid-cols-2">
                    <div><p className="text-slate-400">Self Weight</p><p className="font-semibold">{shown(result.loads?.selfWeight ?? result.selfWeight)} kN/m</p></div>
                    <div><p className="text-slate-400">Total Dead Load</p><p className="font-semibold">{shown(result.loads?.totalDeadLoad ?? result.totalDeadLoad ?? result.deadLoad)} kN/m</p></div>
                    <div><p className="text-slate-400">Service Load</p><p className="font-semibold">{shown(result.loads?.serviceLoad ?? result.serviceLoad)} kN/m</p></div>
                    <div><p className="text-slate-400">Factored Load</p><p className="font-semibold">{shown(result.loads?.factoredLoad ?? result.factoredLoad ?? result.ultimateLoad)} kN/m</p></div>
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <h4 className="font-semibold text-slate-200">Reinforcement</h4>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div><p className="text-slate-400">{barLabels.main}</p><p className="font-semibold">{shown(result.mainReinforcement)}</p></div>
                      <div><p className="text-slate-400">{barLabels.secondary}</p><p className="font-semibold">{shown(result.topReinforcement)}</p></div>
                      <div><p className="text-slate-400">Bar Diameter</p><p className="font-semibold">{shown(result.barDiameter)} mm</p></div>
                      <div><p className="text-slate-400">Stirrups</p><p className="font-semibold">{shown(result.reinforcement?.stirrups?.label ?? result.shearReinforcement)}</p></div>
                      <div><p className="text-slate-400">Stirrup Spacing</p><p className="font-semibold">{shown(result.reinforcement?.stirrups?.spacing ?? result.maximumStirrupSpacing?.provided)} mm c/c</p></div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <h4 className="font-semibold text-slate-200">Checks</h4>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div><p className="text-slate-400">Overall Shear Status</p><p className="font-semibold">{shown(result.shearStatus)}</p></div>
                      <div><p className="text-slate-400">Concrete Shear Capacity</p><p className="font-semibold">{shown(result.shearCalculation?.concreteShearStatus)}</p></div>
                      <div><p className="text-slate-400">Maximum Shear Stress</p><p className="font-semibold">{shown(result.shearCalculation?.maximumShearStressStatus, 'NOT PROVIDED')}</p></div>
                      <div><p className="text-slate-400">Deflection Status</p><p className="font-semibold">{shown(result.deflectionStatus)}</p></div>
                      <div className="md:col-span-2">
                        <p className="text-slate-400">Minimum shear reinforcement (Asv/(b×Sv) ≥ 0.4/(0.87 fy))</p>
                        <p className="font-semibold">Asv/(b×Sv) = {shown(result.minimumShearReinforcement?.providedRatio)} · Required = {shown(result.minimumShearReinforcement?.requiredRatio)} · Status = {shown(result.shearCalculation?.minShearPass === true ? 'PASS' : result.minimumShearReinforcement?.checkPass ? 'PASS' : 'FAIL')}</p>
                        <p className="text-xs text-slate-400">Provided = {shown(result.minimumShearReinforcement?.providedRatioPercent)}% · Required = {shown(result.minimumShearReinforcement?.requiredRatioPercent)}%</p>
                      </div>
                      <div><p className="text-slate-400">Final Status</p><p className="font-semibold">{shown(result.finalStatus)}</p></div>
                    </div>
                    {result.finalStatus === 'VERIFICATION REQUIRED' ? <p className="mt-3 text-sm text-amber-300">Verification required: {shown(result.anchorageReason, 'A mandatory design check requires further verification.')}</p> : null}
                  </div>

                  <BeamReinforcementDiagram result={result} input={getValues()} />
                  <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4">
                    <h4 className="font-semibold text-slate-200">Calculation Steps</h4>
                    <div className="mt-3 space-y-3 text-sm">
                      {(result.calculationSteps || []).map((step) => (
                        <CalculationStepRow key={step.step} step={step} />
                      ))}
                      {!result.calculationSteps?.length ? <p className="text-slate-400">No calculation steps were returned by the design engine.</p> : null}
                    </div>
                  </div>
                  <button onClick={handleDownloadReport} className="rounded-xl border border-cyan-500 px-4 py-2 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/10">
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
