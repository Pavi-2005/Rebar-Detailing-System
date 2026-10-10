import { useMemo } from 'react';

const NOT_DETERMINED = 'Not determined';

const COLORS = {
  main: '#38bdf8',
  secondary: '#c4b5fd',
  stirrup: '#fbbf24',
  support: '#94a3b8',
  concrete: '#172554',
  outline: '#38bdf8',
  dimension: '#cbd5e1',
  text: '#e2e8f0',
  muted: '#94a3b8',
  warn: '#fcd34d'
};

// Presentation helper: undefined/null engineering values must never reach the drawing.
const shown = (value, fallback = NOT_DETERMINED) => (
  value === undefined || value === null || value === '' || value === 'undefined' || value === 'null' ? fallback : value
);

// Presentation helper: a missing value must stay missing (null) so that the drawing shows
// "Not determined" instead of a misleading 0 produced by Number(null)/Number('').
const finiteNumber = (value) => {
  if (value === undefined || value === null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const firstLabel = (...values) => {
  const found = values.find((value) => typeof value === 'string'
    && value.trim() !== ''
    && value.trim().toLowerCase() !== 'undefined'
    && value.trim().toLowerCase() !== 'null');
  return found ? found.trim() : null;
};

function positions(count, start, end) {
  if (!Number.isFinite(count) || count < 1) return [];
  return count === 1 ? [(start + end) / 2] : Array.from({ length: count }, (_, index) => start + (end - start) * index / (count - 1));
}

// Bar labels are produced by the backend as "<count>-<diameter> mm Ø"; parsing them for drawing is presentation only.
function parseBarLabel(label) {
  const text = typeof label === 'string' ? label.trim() : '';
  const match = text.match(/^(\d+)\s*[-–x×]\s*(\d+(?:\.\d+)?)/i);
  if (!match) return { count: null, diameter: null, label: text || null };
  return { count: Number(match[1]), diameter: Number(match[2]), label: text };
}

/**
 * Presentation-only mapping of the authoritative backend result into a drawing layout.
 * No engineering value is calculated here: bar selection, stirrup design, support type and
 * the flexural design model are read from the result (the submitted input is used only as a
 * fallback for geometry that the result does not echo).
 */
export function reinforcementLayout(result = {}, input = {}) {
  const cage = result.reinforcement || result.reinforcementCage || {};
  const stirrupCage = cage.stirrups || {};
  const shear = result.shearCalculation || {};
  const supportType = result.beamType || input.supportType || 'Simply Supported';
  const isContinuous = supportType === 'Continuous';
  const isCantilever = supportType === 'Cantilever';

  // The backend designs the primary flexural steel into `bottomBars` for every support type and
  // now reports the physical face/structural role that steel carries. Those fields are
  // authoritative; the fallback only reproduces them for results produced before the metadata existed.
  const designedGroup = cage.bottomBars || {};
  const secondaryGroup = cage.topBars || {};
  const flexuralFace = designedGroup.face === 'top' || designedGroup.face === 'bottom'
    ? designedGroup.face
    : (isCantilever ? 'top' : 'bottom');
  const secondaryFacing = secondaryGroup.face === 'top' || secondaryGroup.face === 'bottom'
    ? secondaryGroup.face
    : (isCantilever ? 'bottom' : 'top');
  const flexuralStructuralRole = firstLabel(designedGroup.structuralRole) || 'tension';
  const secondaryStructuralRole = firstLabel(secondaryGroup.structuralRole) || (isContinuous ? 'tension' : 'hanger/detailing');

  const flexuralBars = parseBarLabel(firstLabel(designedGroup.label, result.bottomReinforcement, result.mainReinforcement));
  const secondaryBars = parseBarLabel(firstLabel(secondaryGroup.label, result.topReinforcement));

  const faceRole = (face, structuralRole, designedFlexural) => {
    if (designedFlexural) {
      return face === 'top'
        ? 'Designed flexural tension reinforcement; physically the top steel at the fixed support'
        : 'Designed flexural tension reinforcement; bottom steel in the positive-moment region';
    }
    if (structuralRole === 'tension') return 'Designed negative-moment/support flexural reinforcement';
    return `${face === 'top' ? 'Top' : 'Bottom'} hanger/detailing reinforcement — not flexurally designed compression steel`;
  };
  const groupAt = (bars, face, structuralRole, designedFlexural) => ({
    bars,
    face,
    structuralRole,
    designedFlexural,
    kind: designedFlexural ? 'main' : (structuralRole === 'tension' ? 'support' : 'hanger'),
    role: faceRole(face, structuralRole, designedFlexural)
  });

  const designedFaceGroup = groupAt(flexuralBars, flexuralFace, flexuralStructuralRole, true);
  const secondaryFaceGroup = groupAt(secondaryBars, secondaryFacing, secondaryStructuralRole, false);
  const topFace = { ...(flexuralFace === 'top' ? designedFaceGroup : secondaryFaceGroup), face: 'top' };
  const bottomFace = { ...(flexuralFace === 'top' ? secondaryFaceGroup : designedFaceGroup), face: 'bottom' };
  const mainFace = designedFaceGroup;

  const stirrupSpacing = finiteNumber(stirrupCage.spacing)
    ?? finiteNumber(result.maximumStirrupSpacing?.provided)
    ?? finiteNumber(shear.providedSpacing);
  const stirrupDiameter = finiteNumber(stirrupCage.diameter)
    ?? finiteNumber(shear.stirrupDiameter)
    ?? finiteNumber(result.stirrupDiameter);
  const stirrupMaximumSpacing = finiteNumber(stirrupCage.maximumSpacing)
    ?? finiteNumber(result.maximumStirrupSpacing?.maxPermissible)
    ?? finiteNumber(shear.maxSpacing);
  const stirrupLegs = finiteNumber(stirrupCage.legs) ?? finiteNumber(shear.legs);
  const stirrupArea = finiteNumber(stirrupCage.area) ?? finiteNumber(shear.asv) ?? finiteNumber(shear.providedAsv);
  // `reinforcement.stirrups.label` is the authoritative stirrup description and is printed
  // verbatim; the composed text is only a fallback for results that do not carry the field.
  const stirrupLabel = firstLabel(stirrupCage.label, result.shearReinforcement);
  const stirrupText = stirrupLabel
    || (stirrupDiameter !== null && stirrupSpacing !== null
      ? `${stirrupLegs !== null ? `${stirrupLegs}-legged ` : ''}${stirrupDiameter} mm Ø @ ${stirrupSpacing} mm c/c`
      : null);

  // Anchorage values are read, never recomputed: a missing value stays null and is printed as
  // "Not determined" (it is never shown as zero).
  const development = result.developmentLength || {};
  const anchorage = {
    ldRequired: finiteNumber(result.developmentLengthRequired)
      ?? finiteNumber(cage.developmentLength)
      ?? finiteNumber(development.ldRequired)
      ?? finiteNumber(development.ld),
    available: finiteNumber(result.developmentLengthAvailable)
      ?? finiteNumber(cage.availableAnchorage)
      ?? finiteNumber(development.ldAvailable)
      ?? finiteNumber(development.availableAnchorage),
    status: firstLabel(result.developmentStatus, cage.anchorageStatus, development.developmentStatus, development.status)
  };

  return {
    supportType,
    designType: firstLabel(cage.flexuralModel, result.reinforcementCategory) || 'Singly reinforced section',
    isContinuous,
    isCantilever,
    topFace,
    bottomFace,
    mainFace,
    mainFaceName: mainFace.face,
    topFaceIsDesignedFlexuralSteel: topFace.structuralRole === 'tension',
    schematicDisclosure: 'The elevation and cross-section are schematic (not to scale and not a bar-bending schedule). Bar sizes, stirrup diameter/spacing and steel areas are the calculated values read from the design result; stirrup counts and bar positions are schematic. Longitudinal bar lengths and curtailment are not calculated by the design engine, so bars are drawn full length and must not be read as placing lengths.',
    anchorage,
    compressionReinforcement: firstLabel(result.compressionReinforcement),
    span: finiteNumber(result.designSpan) ?? finiteNumber(result.length) ?? finiteNumber(input.length),
    spanDefinition: firstLabel(result.spanDefinition),
    width: finiteNumber(result.breadth) ?? finiteNumber(input.breadth),
    depth: finiteNumber(result.overallDepth) ?? finiteNumber(input.overallDepth),
    cover: finiteNumber(cage.cover) ?? finiteNumber(result.clearCover) ?? finiteNumber(input.clearCover),
    effectiveDepth: finiteNumber(result.effectiveDepth),
    requiredAst: finiteNumber(result.requiredAreaSteel) ?? finiteNumber(result.momentCapacity?.requiredAst),
    providedAst: finiteNumber(result.providedAreaSteel) ?? finiteNumber(result.momentCapacity?.astProvided),
    ultimateMoment: finiteNumber(result.ultimateMoment),
    ultimateShear: finiteNumber(result.ultimateShear),
    stirrups: {
      diameter: stirrupDiameter,
      spacing: stirrupSpacing,
      spacingForCount: stirrupSpacing !== null && stirrupSpacing > 0 ? stirrupSpacing : null,
      maximumSpacing: stirrupMaximumSpacing,
      legs: stirrupLegs,
      area: stirrupArea,
      label: stirrupLabel,
      text: stirrupText || NOT_DETERMINED
    }
  };
}

function HorizontalDimension({ x1, x2, y, label, color = COLORS.dimension }) {
  const mid = (x1 + x2) / 2;
  return (
    <g>
      <line x1={x1} y1={y - 5} x2={x1} y2={y + 5} stroke={color} strokeWidth="1.2" />
      <line x1={x2} y1={y - 5} x2={x2} y2={y + 5} stroke={color} strokeWidth="1.2" />
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={color} strokeWidth="1.2" />
      <path d={`M ${x1} ${y} l 7 -3.5 v 7 Z`} fill={color} />
      <path d={`M ${x2} ${y} l -7 -3.5 v 7 Z`} fill={color} />
      <text x={mid} y={y - 7} textAnchor="middle" fill={color} fontSize="12">{label}</text>
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
      <text x={x - 7} y={mid} textAnchor="middle" fill={color} fontSize="12" transform={`rotate(-90 ${x - 7} ${mid})`}>{label}</text>
    </g>
  );
}

function SupportSymbol({ x, baseY }) {
  return (
    <g stroke={COLORS.support}>
      <path d={`M ${x - 15} ${baseY} L ${x + 15} ${baseY} L ${x} ${baseY - 22} Z`} fill={COLORS.support} fillOpacity="0.28" />
      <line x1={x - 24} y1={baseY + 6} x2={x + 24} y2={baseY + 6} strokeWidth="1.6" />
      {positions(4, x - 18, x + 18).map((tickX, index) => (
        <line key={`hatch-${index}`} x1={tickX} y1={baseY + 6} x2={tickX + 7} y2={baseY + 14} strokeWidth="1" />
      ))}
    </g>
  );
}

function FixedSupportSymbol({ x, y1, y2 }) {
  const height = y2 - y1;
  return (
    <g stroke={COLORS.support}>
      <rect x={x - 26} y={y1 - 6} width="26" height={height + 12} fill="#334155" fillOpacity="0.55" />
      {positions(7, y1 - 2, y2 + 2).map((lineY, index) => (
        <line key={`fixed-hatch-${index}`} x1={x - 26} y1={lineY} x2={x - 12} y2={lineY + 11} strokeWidth="1" />
      ))}
    </g>
  );
}

function LegendSymbol({ x, y, symbol, color }) {
  if (symbol === 'filled') return <circle cx={x} cy={y} r="6.5" fill={color} />;
  if (symbol === 'hollow') return <circle cx={x} cy={y} r="6" fill="none" stroke={color} strokeWidth="2" />;
  if (symbol === 'square') return <rect x={x - 6.5} y={y - 6.5} width="13" height="13" fill="none" stroke={color} strokeWidth="2" />;
  return <path d={`M ${x - 7} ${y + 6} L ${x + 7} ${y + 6} L ${x} ${y - 7} Z`} fill={color} fillOpacity="0.75" stroke={color} />;
}


export default function BeamReinforcementDiagram({ result, input = {} }) {
  const layout = useMemo(() => reinforcementLayout(result, input), [result, input]);
  const {
    supportType, designType, isContinuous, isCantilever, topFace, bottomFace, mainFace,
    span, spanDefinition, width, depth, cover, effectiveDepth, requiredAst, providedAst,
    ultimateMoment, ultimateShear, stirrups, anchorage, schematicDisclosure
  } = layout;

  const canvas = { width: 900, height: 860 };

  // --- Elevation geometry: the drawn depth keeps the true span/depth proportion, clamped so that
  // both short and very long beams stay readable. The cross-section always keeps the true b/D ratio.
  const spanMm = span !== null ? span * 1000 : null;
  const naturalHeight = spanMm && depth ? 620 * (depth / spanMm) : 620 * 0.125;
  const beamHeight = clamp(naturalHeight, 78, 168);
  const depthScaleAdjusted = spanMm !== null && depth !== null && Math.abs(beamHeight - naturalHeight) > 0.5;
  const beam = { x: 120, y: 96, w: 620, h: beamHeight };
  const supportBase = beam.y + beam.h + 26;
  const spanDimensionY = supportBase + 44;

  const coverPx = depth ? clamp(((cover ?? 25) / depth) * beam.h, 5, 22) : 8;
  const stirrupTop = beam.y + coverPx;
  const stirrupBottom = beam.y + beam.h - coverPx;
  const barStroke = (diameter) => (diameter !== null && depth ? clamp((diameter / depth) * beam.h, 2.5, 7) : 3.5);
  const sectionBarRadius = (diameter) => (diameter !== null && depth ? clamp((diameter / depth) * 100, 3.5, 9) : 4.5);

  const elevationBars = (face, isTopFace) => {
    const count = face.bars.count;
    if (!count) return null;
    const stroke = barStroke(face.bars.diameter);
    const hook = Math.max(9, stroke * 2.4);
    const band = Math.min(12, Math.max(4, stroke * 2.4));
    const levels = isTopFace
      ? positions(count, stirrupTop + stroke / 2, stirrupTop + stroke / 2 + band)
      : positions(count, stirrupBottom - stroke / 2 - band, stirrupBottom - stroke / 2);
    const color = face.kind === 'main' ? COLORS.main : COLORS.secondary;
    const anchoredIntoSupport = isCantilever && isTopFace && face.designedFlexural;
    const x1 = anchoredIntoSupport ? beam.x - 22 : beam.x + 16;
    const x2 = beam.x + beam.w - 16;
    const leftHook = anchoredIntoSupport ? Math.max(hook, 22) : hook;
    return levels.map((y, index) => (
      <g key={`${isTopFace ? 'top' : 'bottom'}-face-bar-${index}`} stroke={color} strokeWidth={stroke} strokeLinecap="round" fill="none">
        <line x1={x1} y1={y} x2={x2} y2={y} />
        <line x1={x1} y1={y} x2={x1} y2={isTopFace ? y + leftHook : y - leftHook} />
        <line x1={x2} y1={y} x2={x2} y2={isTopFace ? y + hook : y - hook} />
      </g>
    ));
  };

  const stirrupSpacingForCount = stirrups.spacingForCount;
  const stirrupCountRaw = stirrupSpacingForCount !== null && spanMm ? Math.round(spanMm / stirrupSpacingForCount) : null;
  const maxStirrupsDrawn = 16;
  const minStirrupsDrawn = 3;
  const stirrupCount = stirrupCountRaw ? Math.trunc(clamp(stirrupCountRaw, minStirrupsDrawn, maxStirrupsDrawn)) : 0;
  const stirrupCountIsClamped = stirrupCountRaw !== null && stirrupCount !== stirrupCountRaw;
  const stirrupXs = stirrupCount ? positions(stirrupCount, beam.x + 16, beam.x + beam.w - 16) : [];

  // --- Cross-section geometry
  const sectionDepth = 200;
  const naturalSectionWidth = depth && width ? sectionDepth * (width / depth) : sectionDepth * 0.6;
  const sectionWidth = clamp(naturalSectionWidth, 84, 236);
  const section = { x: 150, y: 486, w: sectionWidth, h: sectionDepth };
  const coverPxSection = depth ? clamp(((cover ?? 25) / depth) * sectionDepth, 6, 26) : 10;
  const inner = {
    x: section.x + coverPxSection,
    y: section.y + coverPxSection,
    w: section.w - 2 * coverPxSection,
    h: section.h - 2 * coverPxSection
  };
  const bottomRadius = sectionBarRadius(bottomFace.bars.diameter);
  const topRadius = sectionBarRadius(topFace.bars.diameter);
  const bottomSectionXs = positions(bottomFace.bars.count, inner.x + bottomRadius, inner.x + inner.w - bottomRadius);
  const topSectionXs = positions(topFace.bars.count, inner.x + topRadius, inner.x + inner.w - topRadius);
  const bottomSectionY = inner.y + inner.h - bottomRadius;
  const topSectionY = inner.y + topRadius;

  const secondaryFace = mainFace.face === 'top' ? bottomFace : topFace;
  const supportNote = isCantilever
    ? 'Fixed support at the left end, free end at the right'
    : isContinuous
      ? 'Continuous-beam model: end supports plus mid-span support'
      : 'Simply supported ends';
  const legendEntries = [
    { symbol: 'filled', color: COLORS.main, title: `Main tension reinforcement (physical ${mainFace.face} face)`, detail: `${shown(mainFace.bars.label)} — ${mainFace.role}` },
    {
      symbol: 'hollow',
      color: COLORS.secondary,
      title: secondaryFace.structuralRole === 'tension' ? `Top negative-moment/support reinforcement (physical ${secondaryFace.face} face)` : `${secondaryFace.face === 'top' ? 'Top' : 'Bottom'} hanger/detailing reinforcement (physical ${secondaryFace.face} face)`,
      detail: `${shown(secondaryFace.bars.label)} — ${secondaryFace.role}`
    },
    {
      symbol: 'square',
      color: COLORS.stirrup,
      title: 'Stirrup (shear reinforcement)',
      detail: `${stirrups.text}${stirrups.maximumSpacing !== null ? ` · max ${stirrups.maximumSpacing} mm` : ''}`
    },
    { symbol: 'triangle', color: COLORS.support, title: 'Support', detail: supportNote }
  ];
  const scheduleRows = [
    ['Effective span L', span !== null ? `${span} m` : NOT_DETERMINED],
    ['Section b × D', width !== null && depth !== null ? `${width} mm × ${depth} mm` : NOT_DETERMINED],
    ['Effective depth d', effectiveDepth !== null ? `${effectiveDepth} mm` : NOT_DETERMINED],
    ['Clear cover', cover !== null ? `${cover} mm` : NOT_DETERMINED],
    ['Required Ast', requiredAst !== null ? `${requiredAst} mm²` : NOT_DETERMINED],
    ['Provided Ast', providedAst !== null ? `${providedAst} mm²` : NOT_DETERMINED],
    ['Design moment Mu / shear Vu', ultimateMoment !== null && ultimateShear !== null ? `${ultimateMoment} kN·m / ${ultimateShear} kN` : NOT_DETERMINED],
    ['Provided stirrup area Asv', stirrups.area !== null ? `${stirrups.area} mm²` : NOT_DETERMINED],
    ['Ld required', anchorage.ldRequired !== null ? `${anchorage.ldRequired} mm` : NOT_DETERMINED],
    ['Anchorage available', anchorage.available !== null ? `${anchorage.available} mm` : NOT_DETERMINED],
    ['Anchorage status', shown(anchorage.status)]
  ];
  const notes = [];
  if (depthScaleAdjusted) notes.push('The elevation depth is drawn schematically so long spans stay readable; the cross-section keeps the true b/D proportion.');
  if (stirrupCountIsClamped) notes.push(`Stirrups are drawn representatively (${stirrupCount} of ${stirrupCountRaw} at the calculated ${stirrupSpacingForCount} mm c/c); the calculated spacing and diameter are unchanged.`);
  if (mainFace.bars.count === null) notes.push('The longitudinal bar arrangement was not established by the design engine for this input, so no longitudinal bars are drawn.');
  if (stirrups.spacing === null) notes.push('Stirrup spacing was not determined by the design engine, so no stirrup symbols are drawn.');
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4">
      <h4 className="font-semibold text-slate-200">Beam reinforcement layout</h4>
      <p className="text-xs text-slate-400">
        Calculated cage: {shown(designType)} · {shown(supportType)}{spanDefinition ? ` · ${spanDefinition}` : ''}
      </p>
      <p className="mb-3 text-[11px] text-slate-500">{schematicDisclosure}</p>
      <svg viewBox={`0 0 ${canvas.width} ${canvas.height}`} className="w-full rounded-xl border border-slate-700 bg-slate-950" role="img" aria-label="Calculated beam reinforcement elevation and cross section">
        <text x="120" y="30" fill="#f8fafc" fontSize="15" fontWeight="600">Elevation</text>
        <text x="120" y="50" fill={COLORS.muted} fontSize="11.5">
          {isCantilever
            ? 'Fixed support at one end with the free end cantilevering'
            : isContinuous
              ? 'Positive span reinforcement at the bottom, negative support reinforcement at the top'
              : 'Bottom main reinforcement in the positive bending region'}
        </text>

        <rect x={beam.x} y={beam.y} width={beam.w} height={beam.h} fill={COLORS.concrete} stroke={COLORS.outline} strokeWidth="2" />

        {stirrupXs.map((x, index) => (
          <rect key={`elevation-stirrup-${index}`} x={x - 4.5} y={stirrupTop} width="9" height={Math.max(12, stirrupBottom - stirrupTop)} rx="1.5" fill="none" stroke={COLORS.stirrup} strokeWidth="2" />
        ))}

        {elevationBars(bottomFace, false)}
        {elevationBars(topFace, true)}

        {isCantilever ? (
          <g>
            <FixedSupportSymbol x={beam.x} y1={beam.y} y2={beam.y + beam.h} />
            <text x={beam.x - 34} y={beam.y - 12} fill={COLORS.muted} fontSize="11.5">Fixed end</text>
            <text x={beam.x + beam.w} y={supportBase - 8} textAnchor="end" fill={COLORS.muted} fontSize="11.5">Free end</text>
          </g>
        ) : isContinuous ? (
          <g>{positions(3, beam.x, beam.x + beam.w).map((x, index) => <SupportSymbol key={`support-${index}`} x={x} baseY={supportBase} />)}</g>
        ) : (
          <g>{[beam.x, beam.x + beam.w].map((x, index) => <SupportSymbol key={`support-${index}`} x={x} baseY={supportBase} />)}</g>
        )}

        <HorizontalDimension x1={beam.x} x2={beam.x + beam.w} y={spanDimensionY} label={span !== null ? `Effective span L = ${span} m` : 'Effective span not determined'} />

        <text x="120" y={spanDimensionY + 30} fill={COLORS.main} fontSize="12">
          Main tension bars (physical {mainFace.face} face): {shown(mainFace.bars.label)}
        </text>
        <text x="120" y={spanDimensionY + 50} fill={COLORS.secondary} fontSize="12">
          {secondaryFace.structuralRole === 'tension' ? 'Top negative/support bars' : `${secondaryFace.face === 'top' ? 'Top' : 'Bottom'} hanger/detailing bars`} (physical {secondaryFace.face} face): {shown(secondaryFace.bars.label)}
        </text>
        <text x="120" y={spanDimensionY + 70} fill={COLORS.stirrup} fontSize="12">
          Stirrups: {stirrups.text}{stirrups.maximumSpacing !== null ? ` (max spacing ${stirrups.maximumSpacing} mm)` : ''}
        </text>
        <text x="120" y={spanDimensionY + 90} fill={COLORS.muted} fontSize="12">
          Anchorage: Ld required {anchorage.ldRequired !== null ? `${anchorage.ldRequired} mm` : NOT_DETERMINED} · available {anchorage.available !== null ? `${anchorage.available} mm` : NOT_DETERMINED}{anchorage.status ? ` · ${anchorage.status}` : ''}
        </text>
        {/* Cross-section: true b/D proportion, stirrup outline, cover and both bar faces */}
        <text x="150" y="454" fill="#f8fafc" fontSize="15" fontWeight="600">Reinforcement cross-section</text>
        <rect x={section.x} y={section.y} width={section.w} height={section.h} fill={COLORS.concrete} stroke={COLORS.outline} strokeWidth="2" />
        <rect x={inner.x} y={inner.y} width={inner.w} height={inner.h} rx="3" fill="none" stroke={COLORS.stirrup} strokeWidth="2.5" />
        {topSectionXs.map((x, index) => (
          <circle key={`section-top-${index}`} cx={x} cy={topSectionY} r={topRadius} fill={topFace.kind === 'main' ? COLORS.main : COLORS.secondary} stroke="#0f172a" strokeWidth="1" />
        ))}
        {bottomSectionXs.map((x, index) => (
          <circle key={`section-bottom-${index}`} cx={x} cy={bottomSectionY} r={bottomRadius} fill={bottomFace.kind === 'main' ? COLORS.main : COLORS.secondary} stroke="#0f172a" strokeWidth="1" />
        ))}
        <VerticalDimension y1={section.y} y2={section.y + section.h} x={section.x - 44} label={depth !== null ? `D = ${depth} mm` : 'D not determined'} />
        <HorizontalDimension x1={section.x} x2={section.x + section.w} y={section.y + section.h + 38} label={width !== null ? `b = ${width} mm` : 'b not determined'} />
        <text x={section.x + section.w + 16} y={topSectionY + 4} fill={COLORS.secondary} fontSize="11">{shown(topFace.bars.label)}</text>
        <text x={section.x + section.w + 16} y={bottomSectionY + 4} fill={COLORS.main} fontSize="11">{shown(bottomFace.bars.label)}</text>
        <text x={section.x} y={section.y + section.h + 62} fill={COLORS.muted} fontSize="10.5">
          {cover !== null ? `Clear cover ${cover} mm to the stirrup` : 'Clear cover not determined'} · {effectiveDepth !== null ? `effective depth d = ${effectiveDepth} mm` : 'effective depth not determined'}
        </text>

        {/* Compact legend built from the calculated reinforcement labels */}
        <text x="470" y="430" fill="#f8fafc" fontSize="15" fontWeight="600">Legend</text>
        {legendEntries.map((entry, index) => {
          const y = 458 + index * 40;
          return (
            <g key={`legend-${index}`}>
              <LegendSymbol x={482} y={y} symbol={entry.symbol} color={entry.color} />
              <text x={500} y={y + 1} fill={COLORS.text} fontSize="12" fontWeight="600">{entry.title}</text>
              <text x={500} y={y + 16} fill={COLORS.muted} fontSize="10.5">{entry.detail}</text>
            </g>
          );
        })}

        {/* Determined design values straight from the backend result */}
        <text x="470" y="626" fill="#f8fafc" fontSize="13" fontWeight="600">Determined design values</text>
        {scheduleRows.map(([label, value], index) => (
          <g key={`schedule-${label}`}>
            <text x="470" y={648 + index * 17} fill={COLORS.muted} fontSize="10.5">{label}</text>
            <text x="876" y={648 + index * 17} textAnchor="end" fill={COLORS.text} fontSize="10.5">{value}</text>
          </g>
        ))}

      </svg>
      {notes.length ? (
        <ul className="mt-3 list-none space-y-1 text-[11px] text-amber-300/90">
          {notes.map((note) => <li key={note}>• {note}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
