import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import api from '../services/api';
import ColumnReinforcementDiagram from '../components/ColumnReinforcementDiagram.jsx';
import { StatusChip } from '../components/SlabReinforcementDiagram.jsx';
import {
  columnResultState,
  formatColumnInteger,
  formatColumnLength,
  formatColumnNumber,
  isColumnDesignInput
} from '../utils/columnPresentation.js';

const SUPPORTED_FRAME_CONDITION = 'BRACED_NON_SWAY';
const SWAY_EXTERNAL_MESSAGE = 'Sway-frame analysis is not performed here. Supply effective lengths and final factored design moments from an independently validated frame analysis.';
const INPUTS_CHANGED_MESSAGE = 'Design inputs changed. Recalculate to update the authoritative result.';

const defaultValues = {
  projectName: 'RCC Column Design',
  designerName: 'Engineer',
  date: new Date().toISOString().slice(0, 10),
  remarks: 'Design generated from the RCC column module',
  width: 300,
  depth: 300,
  unsupportedLength: 3000,
  clearCover: 40,
  frameCondition: SUPPORTED_FRAME_CONDITION,
  concreteGrade: 'M25',
  steelGrade: 'Fe415',
  factoredAxialLoad: 500,
  momentX: 20,
  momentY: 10,
  allowZeroMomentDesignCase: false,
  effectiveLength: {
    x: { supportCondition: 'BOTH_ENDS_HELD_RESTRAINED' },
    y: { supportCondition: 'BOTH_ENDS_HELD_RESTRAINED' }
  }
};

const conditions = [
  ['BOTH_ENDS_HELD_RESTRAINED', 'Both ends held and restrained'],
  ['ONE_END_RESTRAINED_OTHER_NOT', 'One end restrained, other not'],
  ['BOTH_ENDS_HELD_NO_ROTATION_RESTRAINT', 'Both ends held, no rotation restraint'],
  ['ONE_END_FREE', 'One end free']
];

function shown(value, fallback = 'Not determined') {
  if (typeof value === 'number') return formatColumnNumber(value, 3, fallback);
  return value === undefined || value === null || value === '' || /undefined|null|NaN|Infinity/i.test(String(value))
    ? fallback
    : value;
}

function Cell({ label, value, detail, tone = '' }) {
  return <div>
    <p className="text-slate-400">{label}</p>
    <p className={`font-semibold ${tone}`}>{shown(value)}</p>
    {detail ? <p className="mt-1 text-xs text-slate-400">{shown(detail)}</p> : null}
  </div>;
}

function Checks({ checks = [] }) {
  return <div className="space-y-2">{checks.map((check, index) =>
    <div key={`${check.name}-${index}`} className="grid gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3 md:grid-cols-[1fr_auto]">
      <div>
        <p className="font-medium text-slate-200">{shown(check.name)}</p>
        <p className="mt-1 text-xs text-slate-400">{shown(check.formula)} · {shown(check.clause)}</p>
        <p className="mt-1 text-xs text-slate-300">Actual: {shown(check.actual)} {shown(check.unit, '')} · Limit: {shown(check.limit)}</p>
      </div>
      <StatusChip status={check.status} />
    </div>
  )}</div>;
}

function Trace({ steps = [] }) {
  return <div className="space-y-3 text-sm">
    {steps.map((step) =>
      <div key={step.step} className="border-b border-slate-800 pb-3 last:border-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-medium text-slate-200"><span className="mr-2 text-cyan-400">{formatColumnInteger(step.step)}.</span>{shown(step.description)}</p>
          <StatusChip status={step.status} />
        </div>
        <p className="mt-1 text-slate-300">{shown(step.value)} {shown(step.unit, '')}</p>
        <p className="mt-1 text-xs text-slate-500">{shown(step.formula)} · {shown(step.clause)}</p>
      </div>
    )}
    {!steps.length ? <p className="text-slate-400">No calculation steps were returned by the design engine.</p> : null}
  </div>;
}

export default function ColumnDesignPage() {
  const [result, setResult] = useState(null);
  const [calculationError, setCalculationError] = useState('');
  const [calculationNotice, setCalculationNotice] = useState('');
  const [reportStatus, setReportStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRevision = useRef(0);
  const { register, handleSubmit, getValues, watch } = useForm({ defaultValues });
  const watchedValues = watch();
  const resultState = columnResultState(result, watchedValues);
  const isSway = watchedValues.frameCondition === 'UNBRACED_SWAY';

  useEffect(() => {
    const subscription = watch((values, { name } = {}) => {
      if (!isColumnDesignInput(name)) return;
      inputRevision.current += 1;
      if (result) {
        setResult(null);
        setCalculationNotice(INPUTS_CHANGED_MESSAGE);
        setReportStatus('');
      }
    });
    return () => subscription.unsubscribe();
  }, [result, watch]);

  const onSubmit = async (values) => {
    setCalculationError('');
    setCalculationNotice('');
    setReportStatus('');
    setResult(null);
    const requestedRevision = inputRevision.current;
    setIsLoading(true);
    try {
      const calculatedResult = (await api.post('/columns/design', values)).data;
      if (requestedRevision !== inputRevision.current || columnResultState(calculatedResult, getValues()) !== 'current') {
        setCalculationNotice(getValues('frameCondition') === SUPPORTED_FRAME_CONDITION
          ? INPUTS_CHANGED_MESSAGE
          : SWAY_EXTERNAL_MESSAGE);
        return;
      }
      setResult(calculatedResult);
    } catch (error) {
      setCalculationError(error?.response?.data?.error || 'Unable to calculate column design.');
    } finally {
      setIsLoading(false);
    }
  };

  const download = async () => {
    if (!result || columnResultState(result, getValues()) !== 'current') return;
    setReportStatus('generating');
    try {
      const response = await api.post('/reports/pdf', { ...getValues(), result }, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'column-report.pdf';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setReportStatus('success');
    } catch {
      setReportStatus('failed');
    }
  };

  const input = (name, label, props = {}) =>
    <label className="text-sm text-slate-300">{label}<input {...props} {...register(name)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" /></label>;

  return <div className="min-h-screen bg-slate-950 p-6 text-slate-100 lg:p-10">
    <div className="mx-auto max-w-7xl">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div><p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Column Design</p><h2 className="text-3xl font-semibold">RCC Rectangular Column Design</h2></div>
        <a href="/dashboard" className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-cyan-400">Dashboard</a>
      </div>
      <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 self-start rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl">
          <section>
            <h3 className="text-xl font-semibold">Project Details</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">{input('projectName', 'Project Name')}{input('designerName', 'Designer Name')}{input('date', 'Date', { type: 'date' })}{input('remarks', 'Remarks')}</div>
          </section>
          <section>
            <h3 className="text-xl font-semibold">Geometry & Effective Length</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {input('width', 'Width (mm)', { type: 'number' })}
              {input('depth', 'Depth (mm)', { type: 'number' })}
              {input('unsupportedLength', 'Unsupported Length (mm)', { type: 'number' })}
              {input('clearCover', 'Clear Cover to Tie (mm)', { type: 'number' })}
              {!isSway ? ['x', 'y'].map((axis) =>
                <label key={axis} className="text-sm text-slate-300">Effective Length {axis.toUpperCase()} Support Condition
                  <select {...register(`effectiveLength.${axis}.supportCondition`)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
                    {conditions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              ) : null}
              <label className="text-sm text-slate-300">Frame Condition
                <select {...register('frameCondition')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
                  <option value={SUPPORTED_FRAME_CONDITION}>Braced / non-sway</option>
                  <option value="UNBRACED_SWAY">Unbraced / sway (external frame results)</option>
                </select>
              </label>
              {isSway ? <div className="md:col-span-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
                {SWAY_EXTERNAL_MESSAGE} This application does not solve or independently verify the frame model.
              </div> : null}
              {isSway ? <>
                {input('swayAnalysis.effectiveLengthX', 'External frame-analysis effective length X (mm)', { type: 'number', step: '0.1' })}
                {input('swayAnalysis.effectiveLengthY', 'External frame-analysis effective length Y (mm)', { type: 'number', step: '0.1' })}
                {input('swayAnalysis.analysisReference', 'Frame analysis reference (software/version, model and load combination)')}
              </> : null}
            </div>
          </section>
          <section>
            <h3 className="text-xl font-semibold">Materials & Factored Actions</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="text-sm text-slate-300">Concrete Grade
                <select {...register('concreteGrade')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">{['M20', 'M25', 'M30', 'M35'].map((grade) => <option key={grade}>{grade}</option>)}</select>
              </label>
              <label className="text-sm text-slate-300">Reinforcement Grade
                <select {...register('steelGrade')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">{['Fe250', 'Fe415', 'Fe500'].map((grade) => <option key={grade}>{grade}</option>)}</select>
              </label>
              {input('factoredAxialLoad', 'Factored Axial Load Pu (kN)', { type: 'number', step: '0.1' })}
              {input('momentX', isSway ? 'Final Factored Design Moment Mux (kN·m)' : 'Factored Moment Mux (kN·m)', { type: 'number', step: '0.1' })}
              {input('momentY', isSway ? 'Final Factored Design Moment Muy (kN·m)' : 'Factored Moment Muy (kN·m)', { type: 'number', step: '0.1' })}
              {isSway ? <p className="md:col-span-2 text-xs text-amber-200">For sway, these must be final factored column design moments including sway, second-order effects, and minimum eccentricity. No additional magnification is applied here.</p> : null}
              <label className="flex items-center gap-3 self-end text-sm text-slate-300"><input type="checkbox" {...register('allowZeroMomentDesignCase')} className="h-4 w-4" />Explicit zero-moment design case</label>
            </div>
          </section>
          <button type="submit" disabled={isLoading} className="w-full rounded-xl bg-cyan-500 px-4 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-wait disabled:opacity-60">{isLoading ? 'Calculating...' : 'Calculate Column Design'}</button>
        </form>
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
            <h3 className="text-xl font-semibold">Design Output</h3>
            {calculationError ? <p className="mt-3 text-sm text-rose-400">{calculationError}</p> : null}
            {isLoading ? <p className="mt-4 text-cyan-300">Calculating column design...</p> : null}
            {!isLoading && resultState === 'unsupported'
              ? <VerificationNotice message={SWAY_EXTERNAL_MESSAGE} />
              : null}
            {!isLoading && resultState === 'stale'
              ? <VerificationNotice message={INPUTS_CHANGED_MESSAGE} />
              : null}
            {!isLoading && resultState === 'current'
              ? <Output result={result} reportStatus={reportStatus} download={download} />
              : null}
            {!isLoading && resultState === 'empty' && calculationNotice
              ? <VerificationNotice message={calculationNotice} />
              : null}
            {!isLoading && resultState === 'empty' && !calculationNotice && !calculationError
              ? <p className="mt-3 text-sm text-slate-400">Submit the form to calculate axial capacity, slenderness, flexure, biaxial interaction, and detailing.</p>
              : null}
          </div>
        </div>
      </div>
    </div>
  </div>;
}

function VerificationNotice({ message }) {
  return <div role="alert" className="mt-4 rounded-2xl border border-amber-500/50 bg-amber-500/10 p-4">
    <p className="font-semibold text-amber-200">VERIFICATION REQUIRED</p>
    <p className="mt-1 text-sm text-amber-100">{message}</p>
  </div>;
}

function Output({ result, reportStatus, download }) {
  const approved = result.finalStatus === 'APPROVED';
  const sway = result.frameCondition === 'UNBRACED_SWAY';
  return <div className="mt-4 space-y-4">
    <div className="rounded-2xl border border-cyan-500/40 bg-cyan-500/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-sm text-slate-400">Calculation Status</p><p className="text-2xl font-semibold">{approved && sway ? 'COLUMN CHECK — APPROVED' : approved ? 'SUCCESS — APPROVED' : result.finalStatus}</p></div>
        <StatusChip status={result.finalStatus} />
      </div>
    </div>
    {sway ? <div role="note" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
      Sway-frame effective lengths and final design moments were supplied externally. This application checks the column section and detailing only; it does not analyze or independently verify the frame. Reference: {result.inputs.swayAnalysis.analysisReference}
    </div> : null}
    <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <h4 className="font-semibold">Design Summary</h4>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <Cell label="Column Size" value={`${formatColumnLength(result.geometry.width)} × ${formatColumnLength(result.geometry.depth)} mm`} />
        <Cell label="Unsupported Length" value={`${formatColumnLength(result.geometry.unsupportedLength)} mm`} />
        <Cell label="Effective Length X / Y" value={`${formatColumnLength(result.effectiveLengths.x.effectiveLength)} / ${formatColumnLength(result.effectiveLengths.y.effectiveLength)} mm`} />
        <Cell label="Pu" value={`${formatColumnNumber(result.inputs.factoredAxialLoad)} kN`} />
        <Cell label="Mux / Muy" value={`${formatColumnNumber(result.inputs.momentX)} / ${formatColumnNumber(result.inputs.momentY)} kN·m`} />
        <Cell label="Concrete / Steel" value={`${result.materials.concreteGrade} / ${result.materials.steelGrade}`} />
      </div>
    </section>
    <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <h4 className="font-semibold">Key Design Results</h4>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Cell label="Axial Capacity" value={`${formatColumnNumber(result.axialCapacity.capacity)} kN`} detail={`Utilization: ${formatColumnNumber(result.axialCapacity.utilization)}`} tone="text-emerald-400" />
        <Cell label="Biaxial Interaction" value={`${formatColumnNumber(result.biaxialInteraction.interactionValue)} / ${formatColumnNumber(result.biaxialInteraction.limit)}`} detail={result.biaxialInteraction.formula} tone="text-emerald-400" />
        <Cell label="Flexure X Capacity" value={`${formatColumnNumber(result.biaxialInteraction.Mux1)} kN·m`} detail={`Design: ${formatColumnNumber(result.designMoments.x.designMoment)} kN·m`} />
        <Cell label="Flexure Y Capacity" value={`${formatColumnNumber(result.biaxialInteraction.Muy1)} kN·m`} detail={`Design: ${formatColumnNumber(result.designMoments.y.designMoment)} kN·m`} />
        <Cell label="Longitudinal Reinforcement" value={`${formatColumnInteger(result.reinforcement.numberOfBars)} × ${formatColumnInteger(result.reinforcement.selectedBarDiameter)} mm`} detail={`Ast provided: ${formatColumnNumber(result.reinforcement.AstProvided)} mm²`} />
        <Cell label="Ties" value={`${formatColumnInteger(result.ties.tieDiameter)} mm @ ${formatColumnLength(result.ties.selectedSpacing)} mm c/c`} detail={`Restraint: ${result.ties.restraintStatus}`} />
      </div>
    </section>
    <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <h4 className="font-semibold">Reinforcement Details</h4>
      <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
        <Cell label="Ast required / minimum / provided" value={`${formatColumnNumber(result.reinforcement.AstRequired)} / ${formatColumnNumber(result.reinforcement.AstMinimum)} / ${formatColumnNumber(result.reinforcement.AstProvided)} mm²`} />
        <Cell label="Clear spacing X / Y" value={`${formatColumnLength(result.reinforcement.clearSpacingX)} / ${formatColumnLength(result.reinforcement.clearSpacingY)} mm`} />
        <Cell label="Cover" value={`${formatColumnLength(result.geometry.clearCover)} mm to tie`} />
        <Cell label="Slenderness X / Y" value={`${formatColumnNumber(result.slenderness.x.ratio)} / ${formatColumnNumber(result.slenderness.y.ratio)}`} />
      </div>
    </section>
    <ColumnReinforcementDiagram result={result} />
    <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <h4 className="mb-3 font-semibold">Engineering / IS 456 Checks</h4>
      <Checks checks={result.checks} />
    </section>
    <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <h4 className="mb-3 font-semibold">Detailed Calculation Results</h4>
      <Trace steps={result.calculationSteps} />
    </section>
    <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-semibold">PDF Report</h4>
          {reportStatus === 'failed' ? <p role="alert" className="mt-1 text-sm text-rose-400">FAILED — Unable to generate the report.</p> : null}
          {reportStatus === 'generating' ? <p className="mt-1 text-sm text-cyan-300">Generating report...</p> : null}
          {reportStatus === 'success' ? <p className="mt-1 text-sm text-emerald-400">SUCCESS — Report generated.</p> : null}
        </div>
        <button onClick={download} disabled={reportStatus === 'generating'} className="rounded-xl border border-cyan-500 px-4 py-3 font-semibold text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-60">
          {reportStatus === 'failed' ? 'Retry PDF' : 'Download PDF Report'}
        </button>
      </div>
    </section>
  </div>;
}
