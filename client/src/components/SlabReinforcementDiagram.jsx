import { useMemo } from 'react';
import { slabPlanAxes } from './slabPlanGeometry.js';

const NOT_DETERMINED = 'Not determined';
const NOT_ESTABLISHED = 'NOT ESTABLISHED';

const finiteNumber = (value) => {
  if (value === undefined || value === null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const shown = (value, fallback = NOT_DETERMINED) => (
  value === undefined || value === null || value === '' || value === 'undefined' || value === 'null' ? fallback : value
);

const fmt = (value, digits) => {
  const numeric = finiteNumber(value);
  return numeric === null ? NOT_DETERMINED : Number(numeric.toFixed(digits));
};

const barLabel = (direction) => {
  const diameter = finiteNumber(direction?.diameter);
  const spacing = finiteNumber(direction?.spacing);
  if (diameter === null || spacing === null) return NOT_DETERMINED;
  return `${diameter} mm @ ${spacing} mm c/c`;
};

// Beam-module colour palette, reused verbatim so both drawings read as one system.
const COLORS = {
  main: '#38bdf8',
  secondary: '#c4b5fd',
  support: '#94a3b8',
  concrete: '#172554',
  outline: '#38bdf8',
  dimension: '#cbd5e1',
  text: '#e2e8f0',
  muted: '#94a3b8',
  warn: '#fcd34d'
};

// One canonical status vocabulary, matching the design engine.
const STATUS_STYLES = {
  PASS: { text: 'text-emerald-400', chip: 'border-emerald-500/40 bg-emerald-500/10' },
  APPROVED: { text: 'text-emerald-400', chip: 'border-emerald-500/40 bg-emerald-500/10' },
  FAIL: { text: 'text-rose-400', chip: 'border-rose-500/40 bg-rose-500/10' },
  'NOT APPROVED': { text: 'text-rose-400', chip: 'border-rose-500/40 bg-rose-500/10' },
  'VERIFICATION REQUIRED': { text: 'text-amber-300', chip: 'border-amber-500/40 bg-amber-500/10' },
  'NOT REQUIRED': { text: 'text-cyan-300', chip: 'border-cyan-500/40 bg-cyan-500/10' }
};

export function StatusBadge({ status }) {
  const value = String(shown(status));
  return <span className={`font-semibold ${STATUS_STYLES[value]?.text ?? 'text-slate-200'}`}>{value}</span>;
}

export function StatusChip({ status, className = '' }) {
  const value = String(shown(status));
  const style = STATUS_STYLES[value];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style?.chip ?? 'border-slate-700 bg-slate-900 text-slate-200'} ${style?.text ?? ''} ${className}`}>
      {value}
    </span>
  );
}

/**
 * Presentation-only mapping of the authoritative slab result into a drawing layout.
 * Nothing is calculated here: spans, thicknesses, covers, bar sizes and statuses are
 * all read from the result produced by the design engine.
 */
export function slabLayout(result = {}) {
  if (!result) return null;
  const short = result.shortDirectionReinforcement || {};
  const long = result.longDirectionReinforcement || {};
  return {
    lx: finiteNumber(result.shortSpan) ?? finiteNumber(result.effectiveShortSpan),
    ly: finiteNumber(result.longSpan) ?? finiteNumber(result.effectiveLongSpan),
    clearShort: finiteNumber(result.clearShortSpan),
    clearLong: finiteNumber(result.clearLongSpan),
    aspectRatio: finiteNumber(result.aspectRatio),
    thickness: finiteNumber(result.slabThickness),
    evaluatedThickness: finiteNumber(result.slabThickness),
    adoptedThickness: finiteNumber(result.adoptedThickness),
    // A missing adopted thickness is a design decision, not an absent value. Keep the
    // calculation status unchanged while using the clearer presentation term.
    adoptedLabel: finiteNumber(result.adoptedThickness) === null ? 'NOT ADOPTED' : shown(result.adoptedThicknessLabel, NOT_ESTABLISHED),
    cover: finiteNumber(result.clearCover),
    depthShort: finiteNumber(result.effectiveDepthShort),
    depthLong: finiteNumber(result.effectiveDepthLong),
    supportWidth: finiteNumber(result.supportWallThickness),
    supportType: shown(result.supportType),
    slabType: shown(result.slabType),
    cornerRestraint: shown(result.cornerRestraintLabel ?? result.cornerRestraint),
    cornerStatus: shown(result.cornerTorsionStatus),
    shortLabel: barLabel(short),
    longLabel: barLabel(long),
    shortAst: finiteNumber(result.shortDirectionAstProvided ?? short.AstProvided),
    longAst: finiteNumber(result.longDirectionAstProvided ?? long.AstProvided),
    schematicDisclosure: 'The plan is schematic and is not to scale. The panel outline follows the true short-span / long-span proportion, but the drawn bars are symbolic: the number of lines shown is NOT the number of bars in the slab and is not a bar-bending schedule. Bar sizes, spacings, spans, thickness and cover are the calculated values read from the design result. This drawing does NOT establish the IS 456:2000 Annex D-2.1.1 bar-extension detailing (the 50% continuation / 50% curtailment requirement is reported separately on the design page).'
  };
}

/** Beam-module dimension component: tick ends, arrowheads, label outside the measured span. */
function HorizontalDimension({ x1, x2, y, label, color = COLORS.dimension }) {
  const mid = (x1 + x2) / 2;
  return (
    <g>
      <line x1={x1} y1={y - 5} x2={x1} y2={y + 5} stroke={color} strokeWidth="1.2" />
      <line x1={x2} y1={y - 5} x2={x2} y2={y + 5} stroke={color} strokeWidth="1.2" />
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={color} strokeWidth="1.2" />
      <path d={`M ${x1} ${y} l 7 -3.5 v 7 Z`} fill={color} />
      <path d={`M ${x2} ${y} l -7 -3.5 v 7 Z`} fill={color} />
      <text x={mid} y={y - 8} textAnchor="middle" fill={color} fontSize="12" fontWeight="600">{label}</text>
    </g>
  );
}

function VerticalDimension({ y1, y2, x, label, color = COLORS.dimension }) {
  const mid = (y1 + y2) / 2;
  return (
    <g>
      <line x1={x - 5} y1={y1} x2={x + 5} y2={y1} stroke={color} strokeWidth="1.2" />
      <line x1={x - 5} y1={y2} x2={x + 5} y2={y2} stroke={color} strokeWidth="1.2" />
      <line x1={x} y1={y1} x2={x} y2={y2} stroke={color} strokeWidth="1.2" />
      <path d={`M ${x} ${y1} l -3.5 7 h 7 Z`} fill={color} />
      <path d={`M ${x} ${y2} l -3.5 -7 h 7 Z`} fill={color} />
      <text x={x - 8} y={mid} textAnchor="middle" fill={color} fontSize="12" fontWeight="600" transform={`rotate(-90 ${x - 8} ${mid})`}>{label}</text>
    </g>
  );
}

/** Supporting wall drawn outside the panel, with a hatched ground line. */
function WallSymbol({ x1, x2, y, side }) {
  const thickness = 9;
  const rectY = side === 'top' ? y - thickness : y;
  const ticks = [];
  const count = 9;
  for (let index = 0; index < count; index += 1) {
    ticks.push(x1 + ((x2 - x1) * (index + 0.5)) / count);
  }
  return (
    <g stroke={COLORS.support}>
      <rect x={x1} y={rectY} width={x2 - x1} height={thickness} fill={COLORS.support} fillOpacity="0.45" />
      <line x1={x1 - 6} y1={side === 'top' ? y - thickness - 5 : y + thickness + 5} x2={x2 + 6} y2={side === 'top' ? y - thickness - 5 : y + thickness + 5} strokeWidth="1.4" />
      {ticks.map((tickX, index) => (
        <line
          key={`hatch-${side}-${index}`}
          x1={tickX}
          y1={side === 'top' ? y - thickness - 5 : y + thickness + 5}
          x2={tickX + 6}
          y2={side === 'top' ? y - thickness - 12 : y + thickness + 12}
          strokeWidth="1"
        />
      ))}
    </g>
  );
}

/** Supporting wall on a vertical panel edge; paired with WallSymbol for all four edges. */
function VerticalWallSymbol({ y1, y2, x, side }) {
  const thickness = 9;
  const rectX = side === 'left' ? x - thickness : x;
  const groundX = side === 'left' ? x - thickness - 5 : x + thickness + 5;
  const ticks = Array.from({ length: 6 }, (_, index) => y1 + ((y2 - y1) * (index + 0.5)) / 6);
  return (
    <g stroke={COLORS.support}>
      <rect x={rectX} y={y1} width={thickness} height={y2 - y1} fill={COLORS.support} fillOpacity="0.45" />
      <line x1={groundX} y1={y1 - 6} x2={groundX} y2={y2 + 6} strokeWidth="1.4" />
      {ticks.map((tickY, index) => (
        <line key={`vertical-hatch-${side}-${index}`} x1={groundX} y1={tickY} x2={side === 'left' ? groundX - 7 : groundX + 7} y2={tickY + 6} strokeWidth="1" />
      ))}
    </g>
  );
}

export default function SlabReinforcementDiagram({ result }) {
  const layout = useMemo(() => slabLayout(result), [result]);
  if (!layout) return null;
  const { lx, ly, cover, depthShort, depthLong, supportWidth, supportType, slabType, cornerRestraint, cornerStatus, shortLabel, longLabel, schematicDisclosure } = layout;

  // ---- Reserved layout bands. Every text element owns one band, so no label can ever
  // land on the reinforcement, the dimension lines, another label or the panel edge.
  const canvas = { width: 940, height: 620 };
  const BANDS = {
    title: 30,
    subTitle: 52,
    supportLabel: 82,
    panel: { y: 96, h: 250 },
    supportLabelBottom: 372,
    lxDim: 412,
    notes: { y: 462, step: 20 },
    legend: { y: 556, step: 17 }
  };
  const panelLeft = 132;   // room for the rotated Ly dimension band
  const panelWidth = 470;

  // Panel drawn to the true ly/lx proportion, centred in its band.
  const ratio = lx && ly && ly / lx > 0 ? ly / lx : 1;
  let pw = panelWidth;
  let ph = pw / ratio;
  if (ph > BANDS.panel.h) {
    ph = BANDS.panel.h;
    pw = ph * ratio;
  }
  const px = panelLeft + (panelWidth - pw) / 2;
  const py = BANDS.panel.y + (BANDS.panel.h - ph) / 2;
  const px1 = px + pw;
  const py1 = py + ph;

  // Canonical plan-axis mapping: true long span Ly is SVG X and true short span Lx is
  // SVG Y. Bars that RUN along Lx are vertical; bars that RUN along Ly are horizontal.
  // This follows the normalized authoritative spans, never input-field order.
  const { shortAxis, longAxis } = slabPlanAxes({ shortSpan: lx, longSpan: ly });
  // Symbolic bar counts are based on the axis perpendicular to each bar only. They are
  // not calculated bar quantities and do not form a bar-bending schedule.
  const shortBarCount = Math.max(5, Math.min(11, Math.round(pw / 46)));
  const longBarCount = Math.max(4, Math.min(7, Math.round(ph / 36)));
  const shortBarXs = Array.from({ length: shortBarCount }, (_, i) => px + ((i + 1) * pw) / (shortBarCount + 1));
  const longBarYs = Array.from({ length: longBarCount }, (_, i) => py + ((i + 1) * ph) / (longBarCount + 1));

  // Cover indicated as a dashed inner offset rectangle (schematic, true proportion).
  const coverInset = layout.thickness ? Math.max(6, Math.min(22, (cover / layout.thickness) * ph * 0.5)) : 8;

  const notes = [];
  if (ratio !== 1) notes.push(`The panel is drawn at the true ly/lx proportion (${fmt(layout.aspectRatio, 3)}).`);
  notes.push('Bar lines are symbolic; the count shown is not the number of bars and is not a bar-bending schedule.');
  notes.push('This drawing does not establish the IS 456:2000 Annex D-2.1.1 bar-extension detailing; the 50% continuation / 50% curtailment requirement is reported on the design page.');

  const legendEntries = [
    { color: COLORS.main, title: 'Short direction (main) reinforcement', detail: `${shortLabel} — spans the short direction Lx`, weight: 3 },
    { color: COLORS.secondary, title: 'Long direction (distribution) reinforcement', detail: `${longLabel} — spans the long direction Ly`, weight: 1.8 },
    { color: COLORS.support, title: 'Supporting wall', detail: `${supportWidth !== null ? `${supportWidth} mm` : NOT_DETERMINED} — ${supportType}`, weight: 3 }
  ];
  const wallCaption = `Supporting wall — ${supportWidth !== null ? `${supportWidth} mm` : NOT_DETERMINED} (${supportType})`;

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-slate-200">Slab reinforcement layout</h4>
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
          SCHEMATIC — NOT TO SCALE
        </span>
      </div>
      <p className="text-xs text-slate-400">
        {`${slabType} · ${supportType} · corner restraint ${cornerRestraint}`}
      </p>
      <p className="mb-3 text-[11px] text-slate-500">{schematicDisclosure}</p>

      <svg viewBox={`0 0 ${canvas.width} ${canvas.height}`} className="w-full rounded-xl border border-slate-700 bg-slate-950" role="img" aria-label="Calculated slab reinforcement plan">
        <text x={panelLeft - 80} y={BANDS.title} fill="#f8fafc" fontSize="15" fontWeight="600">Plan</text>
        <text x={panelLeft - 80} y={BANDS.subTitle} fill={COLORS.muted} fontSize="11.5">
          Short-direction bars run along Lx / SVG Y (bottom layer); long-direction bars run along Ly / SVG X (upper layer)
        </text>

        {/* Supporting walls sit outside the panel, in their own bands */}
        <text x={px + pw / 2} y={BANDS.supportLabel} textAnchor="middle" fill={COLORS.muted} fontSize="11.5">{wallCaption}</text>
        <WallSymbol x1={px - 16} x2={px1 + 16} y={py - 4} side="top" />

        {/* Slab panel with schematic cover indication */}
        <rect x={px} y={py} width={pw} height={ph} fill={COLORS.concrete} stroke={COLORS.outline} strokeWidth="2" />
        <rect
          x={px + coverInset}
          y={py + coverInset}
          width={Math.max(pw - 2 * coverInset, 4)}
          height={Math.max(ph - 2 * coverInset, 4)}
          fill="none"
          stroke={COLORS.dimension}
          strokeWidth="1.2"
          strokeDasharray="5 4"
        />

        {/* Short-direction (main) bars first, so long-direction reads as the layer above */}
        {shortBarXs.map((x) => (
          <line key={`s-${x.toFixed(1)}`} x1={x} y1={py + 4} x2={x} y2={py1 - 4} stroke={COLORS.main} strokeWidth="3" strokeLinecap="round" />
        ))}
        {longBarYs.map((y) => (
          <line key={`l-${y.toFixed(1)}`} x1={px + 4} y1={y} x2={px1 - 4} y2={y} stroke={COLORS.secondary} strokeWidth="1.8" strokeLinecap="round" />
        ))}

        <VerticalWallSymbol y1={py - 16} y2={py1 + 16} x={px - 4} side="left" />
        <VerticalWallSymbol y1={py - 16} y2={py1 + 16} x={px1 + 4} side="right" />

        <text x={px + pw / 2} y={BANDS.supportLabelBottom} textAnchor="middle" fill={COLORS.muted} fontSize="11.5">{wallCaption}</text>
        <WallSymbol x1={px - 16} x2={px1 + 16} y={py1 + 4} side="bottom" />

        {/* Dimension bands, clear of the panel and of each other */}
        <VerticalDimension y1={py} y2={py1} x={px - 42} label={`Lx / short span = ${fmt(lx, 2)} m`} />
        <HorizontalDimension x1={px} x2={px1} y={BANDS.lxDim} label={`Ly / long span = ${fmt(ly, 2)} m`} />

        {/* Caption band: one line per fact, never overlapping the drawing */}
        <g>
          <text x={panelLeft - 80} y={BANDS.notes.y} fill={COLORS.main} fontSize="12">
            {`Short direction (main): ${shortLabel} · Ast ${fmt(layout.shortAst, 2)} mm²/m`}
          </text>
          <text x={panelLeft - 80} y={BANDS.notes.y + BANDS.notes.step} fill={COLORS.secondary} fontSize="12">
            {`Long direction (distribution): ${longLabel} · Ast ${fmt(layout.longAst, 2)} mm²/m`}
          </text>
          <text x={panelLeft - 80} y={BANDS.notes.y + BANDS.notes.step * 2} fill={COLORS.muted} fontSize="12">
            {`D = ${fmt(layout.thickness, 0)} mm · cover = ${fmt(cover, 0)} mm · d short = ${fmt(depthShort, 0)} mm · d long = ${fmt(depthLong, 0)} mm`}
          </text>
          <text x={panelLeft - 80} y={BANDS.notes.y + BANDS.notes.step * 3} fill={COLORS.muted} fontSize="12">
            {`Clear spans: short ${fmt(layout.clearShort, 2)} m · long ${fmt(layout.clearLong, 2)} m · ly/lx = ${fmt(layout.aspectRatio, 3)}`}
          </text>
        </g>

        {/* Legend band, below every other band */}
        <g>
          {legendEntries.map((entry, index) => {
            const y = BANDS.legend.y + index * BANDS.legend.step;
            return (
              <g key={entry.title}>
                <line x1={panelLeft - 80} y1={y - 4} x2={panelLeft - 58} y2={y - 4} stroke={entry.color} strokeWidth={entry.weight} strokeLinecap="round" />
                <text x={panelLeft - 50} y={y} fill={entry.color} fontSize="11.5" fontWeight="600">{entry.title}</text>
                <text x={panelLeft + 236} y={y} fill={COLORS.muted} fontSize="11.5">{entry.detail}</text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="mt-3 grid gap-x-6 gap-y-1 text-[11px] sm:grid-cols-2">
        <p className="flex justify-between gap-3"><span className="text-slate-500">Evaluated thickness</span><span className="text-slate-300">{`${fmt(layout.evaluatedThickness, 0)} mm`}</span></p>
        <p className="flex justify-between gap-3"><span className="text-slate-500">Adopted thickness</span><span className="text-slate-300">{layout.adoptedLabel}</span></p>
        <p className="flex justify-between gap-3"><span className="text-slate-500">Effective depth d short</span><span className="text-slate-300">{`${fmt(depthShort, 0)} mm`}</span></p>
        <p className="flex justify-between gap-3"><span className="text-slate-500">Effective depth d long</span><span className="text-slate-300">{`${fmt(depthLong, 0)} mm`}</span></p>
        <p className="flex justify-between gap-3"><span className="text-slate-500">Corner restraint</span><span className="text-slate-300">{cornerRestraint}</span></p>
        <p className="flex justify-between gap-3"><span className="text-slate-500">Corner torsion</span><span>{cornerStatus}</span></p>
      </div>

      {notes.length ? (
        <ul className="mt-3 list-none space-y-1 text-[11px] text-amber-300/90">
          {notes.map((note) => <li key={note}>{`• ${note}`}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
