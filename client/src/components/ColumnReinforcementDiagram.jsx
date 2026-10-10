import { useMemo } from 'react';
import { columnDrawingData } from './columnDrawingData.js';
import { formatColumnInteger, formatColumnLength } from '../utils/columnPresentation.js';

const COLORS = { concrete: '#172554', outline: '#38bdf8', main: '#38bdf8', tie: '#c4b5fd', text: '#e2e8f0', muted: '#94a3b8', support: '#94a3b8' };
const display = (value) => formatColumnLength(value);

function Dimension({ x1, x2, y, label }) { return <g><line x1={x1} y1={y} x2={x2} y2={y} stroke={COLORS.text} /><path d={`M${x1} ${y}l7 -4v8zM${x2} ${y}l-7 -4v8z`} fill={COLORS.text} /><text x={(x1 + x2) / 2} y={y - 7} textAnchor="middle" fill={COLORS.text} fontSize="11">{label}</text></g>; }
function VerticalDimension({ x, y1, y2, label }) { const mid = (y1 + y2) / 2; return <g><line x1={x} y1={y1} x2={x} y2={y2} stroke={COLORS.text} /><path d={`M${x} ${y1}l-4 7h8zM${x} ${y2}l-4 -7h8z`} fill={COLORS.text} /><text x={x - 8} y={mid} textAnchor="middle" fill={COLORS.text} fontSize="11" transform={`rotate(-90 ${x - 8} ${mid})`}>{label}</text></g>; }

export default function ColumnReinforcementDiagram({ result }) {
  const data = useMemo(() => columnDrawingData(result), [result]);
  if (!data) return null;
  const section = { x: 92, y: 82, w: 250, h: 250 };
  const scaleX = section.w / data.width;
  const scaleY = section.h / data.depth;
  const point = (bar) => ({ x: section.x + section.w / 2 + Number(bar.x) * scaleX, y: section.y + section.h / 2 + Number(bar.y) * scaleY });
  const elevation = { x: 475, y: 82, w: 150, h: 250 };
  const tieYs = Array.from({ length: 6 }, (_, index) => elevation.y + 25 + index * 40);
  return <section className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold text-slate-200">Column reinforcement detail</h4><span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300">SCHEMATIC — NOT TO SCALE</span></div>
    <p className="mt-1 text-xs text-slate-400">Calculated bar-centre coordinates and reinforcement/tie values are shown; repeated elevation ties are symbolic, not a tie count.</p>
    <svg viewBox="0 0 750 510" className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950" role="img" aria-label="Column cross-section and elevation reinforcement detail">
      <text x="92" y="30" fill={COLORS.text} fontSize="15" fontWeight="600">Cross-section</text><text x="475" y="30" fill={COLORS.text} fontSize="15" fontWeight="600">Elevation</text>
      <rect {...section} fill={COLORS.concrete} stroke={COLORS.outline} strokeWidth="2" />
      <rect x={section.x + data.cover * scaleX} y={section.y + data.cover * scaleY} width={section.w - 2 * data.cover * scaleX} height={section.h - 2 * data.cover * scaleY} fill="none" stroke={COLORS.tie} strokeWidth="3" />
      {data.bars.map((bar, index) => { const p = point(bar); return <circle key={index} cx={p.x} cy={p.y} r={Math.max(5, data.diameter * scaleX / 2)} fill={COLORS.main} stroke="#e0f2fe" />; })}
      <Dimension x1={section.x} x2={section.x + section.w} y={section.y - 24} label={`${display(data.width)} mm width`} />
      <VerticalDimension x={section.x - 27} y1={section.y} y2={section.y + section.h} label={`${display(data.depth)} mm depth`} />
      <line x1={section.x + data.cover * scaleX} y1={section.y + data.cover * scaleY} x2={section.x + 12} y2={section.y + 48} stroke={COLORS.text} strokeDasharray="3 2" />
      <text x={section.x + 14} y={section.y + 44} fill={COLORS.text} fontSize="10">{`${display(data.cover)} mm clear cover`}</text>
      <line x1={section.x + data.cover * scaleX} y1={section.y + data.cover * scaleY} x2={section.x + 160} y2={section.y + 48} stroke={COLORS.tie} strokeDasharray="3 2" />
      <text x={section.x + 162} y={section.y + 44} fill={COLORS.tie} fontSize="10">{`${display(data.tieDiameter)} mm tie`}</text>
      <text x="92" y="400" fill={COLORS.main} fontSize="11">{`${formatColumnInteger(data.numberOfBars)} × ${formatColumnInteger(data.diameter)} mm longitudinal bars`}</text>
      <text x="92" y="418" fill={COLORS.tie} fontSize="11">{`${formatColumnInteger(data.tieDiameter)} mm closed tie; cover ${display(data.cover)} mm`}</text>
      <text x="92" y="436" fill={COLORS.muted} fontSize="11">{`Centre X/Y: ${display(data.centerX)} / ${display(data.centerY)} mm; clear: ${display(data.clearX)} / ${display(data.clearY)} mm`}</text>
      <rect {...elevation} fill={COLORS.concrete} stroke={COLORS.outline} strokeWidth="2" />
      <rect x={elevation.x - 12} y={elevation.y - 10} width={elevation.w + 24} height="9" fill={COLORS.support} /><rect x={elevation.x - 12} y={elevation.y + elevation.h + 1} width={elevation.w + 24} height="9" fill={COLORS.support} />
      {[elevation.x + 25, elevation.x + elevation.w - 25].map((x) => <line key={x} x1={x} y1={elevation.y + 5} x2={x} y2={elevation.y + elevation.h - 5} stroke={COLORS.main} strokeWidth="5" />)}
      {tieYs.map((y) => <rect key={y} x={elevation.x + 10} y={y} width={elevation.w - 20} height="5" fill={COLORS.tie} />)}
      <g transform={`translate(670 ${(elevation.y + elevation.h / 2)}) rotate(-90)`}><text textAnchor="middle" fill={COLORS.text} fontSize="11">{`${display(data.unsupportedLength)} mm unsupported length`}</text></g>
      <text x="475" y="400" fill={COLORS.main} fontSize="11">{`${formatColumnInteger(data.numberOfBars)} × ${formatColumnInteger(data.diameter)} mm longitudinal bars`}</text><text x="475" y="418" fill={COLORS.tie} fontSize="11">{`${formatColumnInteger(data.tieDiameter)} mm ties @ ${display(data.tieSpacing)} mm c/c (symbolic)`}</text>
    </svg>
  </section>;
}
