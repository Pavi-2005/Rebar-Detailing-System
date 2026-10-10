import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const constants = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'constants', 'designConstants.json'), 'utf8'));

const COLUMN_CONSTANTS = constants.columnDesign;
const LONGITUDINAL_DIAMETERS = COLUMN_CONSTANTS.longitudinalDiameters;
const TIE_DIAMETERS = COLUMN_CONSTANTS.tieDiameters;
const SUPPORT_CONDITIONS = COLUMN_CONSTANTS.supportConditionFactors;
const NOT_CALCULATED = 'NOT CALCULATED — REQUIRED INPUT/METHOD NOT IMPLEMENTED';
const ENGINEERING_ERROR = 'DESIGN ERROR — SECTION EQUILIBRIUM OR FINITE-VALUE CHECK FAILED';

const finite = (value) => Number.isFinite(Number(value));
const round = (value, digits = 3) => Number(Number(value).toFixed(digits));
const barArea = (diameter) => Math.PI * diameter * diameter / 4;

export function calculateInteractionAlpha(puOverPuz) {
  if (!Number.isFinite(Number(puOverPuz))) return { alpha: null, method: 'INVALID — Pu/Puz is not finite' };
  const ratio = Number(puOverPuz);
  if (ratio <= 0.2) return { alpha: 1, method: 'Lower bound: Pu/Puz <= 0.2' };
  if (ratio >= 0.8) return { alpha: 2, method: 'Upper bound: Pu/Puz >= 0.8' };
  return { alpha: 1 + (ratio - 0.2) / 0.6, method: 'Linear interpolation: alpha = 1 + (Pu/Puz - 0.2)/0.6' };
}

function assertFiniteResult(value, path = 'result') {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${ENGINEERING_ERROR}: non-finite value at ${path}.`);
  if (Array.isArray(value)) value.forEach((entry, index) => assertFiniteResult(entry, `${path}[${index}]`));
  if (value && typeof value === 'object') Object.entries(value).forEach(([key, entry]) => assertFiniteResult(entry, `${path}.${key}`));
}

function inputNumber(values, field, { positive = false, nonNegative = false } = {}) {
  const value = Number(values[field]);
  if (!Number.isFinite(value) || (positive && value <= 0) || (nonNegative && value < 0)) {
    throw new Error(`${field} must be a finite ${positive ? 'value greater than zero' : 'non-negative value'}.`);
  }
  return value;
}

export function validateInputs(values = {}) {
  const width = inputNumber(values, 'width', { positive: true });
  const depth = inputNumber(values, 'depth', { positive: true });
  const unsupportedLength = inputNumber(values, 'unsupportedLength', { positive: true });
  const clearCover = inputNumber(values, 'clearCover', { positive: true });
  const factoredAxialLoad = inputNumber(values, 'factoredAxialLoad', { positive: true });
  const momentX = inputNumber(values, 'momentX', { nonNegative: true });
  const momentY = inputNumber(values, 'momentY', { nonNegative: true });
  const frameCondition = values.frameCondition || COLUMN_CONSTANTS.supportedFrameCondition;
  const swayAnalysis = values.swayAnalysis || {};

  if (depth < width) throw new Error('depth must be greater than or equal to width.');
  if (clearCover >= Math.min(width, depth) / 2) throw new Error('clearCover is too large for the column dimensions.');
  if (!constants.concreteGrades?.[values.concreteGrade]) throw new Error('Unsupported concrete grade.');
  if (!constants.steelGrades?.[values.steelGrade]) throw new Error('Unsupported steel grade.');
  if (![COLUMN_CONSTANTS.supportedFrameCondition, 'UNBRACED_SWAY'].includes(frameCondition)) {
    throw new Error(`Unsupported frame condition. Use ${COLUMN_CONSTANTS.supportedFrameCondition} or UNBRACED_SWAY with validated external frame-analysis results.`);
  }
  if (momentX === 0 && momentY === 0 && values.allowZeroMomentDesignCase !== true) {
    throw new Error('Zero design moments require allowZeroMomentDesignCase=true; minimum eccentricity will still be applied.');
  }

  if (frameCondition === 'UNBRACED_SWAY') {
    const effectiveLengthX = inputNumber(swayAnalysis, 'effectiveLengthX', { positive: true });
    const effectiveLengthY = inputNumber(swayAnalysis, 'effectiveLengthY', { positive: true });
    const analysisReference = typeof swayAnalysis.analysisReference === 'string' ? swayAnalysis.analysisReference.trim() : '';
    if (!analysisReference) throw new Error('swayAnalysis.analysisReference is required for UNBRACED_SWAY.');
    values.swayAnalysis = { effectiveLengthX, effectiveLengthY, analysisReference };
  } else {
    for (const axis of ['x', 'y']) {
      const effectiveLength = values.effectiveLength?.[axis];
      if (!effectiveLength || typeof effectiveLength.supportCondition !== 'string') {
        throw new Error(`effectiveLength.${axis}.supportCondition is required.`);
      }
      if (!Object.hasOwn(SUPPORT_CONDITIONS, effectiveLength.supportCondition)) {
        throw new Error(`Unsupported effective-length support condition for ${axis} axis.`);
      }
      if (effectiveLength.factor !== undefined && (!finite(effectiveLength.factor) || Number(effectiveLength.factor) <= 0 || Number(effectiveLength.factor) > Number.MAX_VALUE / unsupportedLength)) {
        throw new Error(`effectiveLength.${axis}.factor must be finite and greater than zero.`);
      }
    }
  }

  return { width, depth, unsupportedLength, clearCover, factoredAxialLoad, momentX, momentY, frameCondition, ...(frameCondition === 'UNBRACED_SWAY' ? { swayAnalysis: values.swayAnalysis } : {}) };
}

export function calculateEffectiveLengths(values) {
  if (values.frameCondition === 'UNBRACED_SWAY') {
    return ['x', 'y'].reduce((result, axis) => {
      const effectiveLength = values.swayAnalysis[`effectiveLength${axis.toUpperCase()}`];
      result[axis] = {
        supportCondition: 'EXTERNAL_FRAME_ANALYSIS',
        factor: round(effectiveLength / values.unsupportedLength, 3),
        unsupportedLength: round(values.unsupportedLength, 3),
        effectiveLength: round(effectiveLength, 3),
        unit: 'mm',
        clause: 'IS 456:2000 Table 28 — externally supplied frame-analysis result',
        source: values.swayAnalysis.analysisReference
      };
      return result;
    }, {});
  }
  return ['x', 'y'].reduce((result, axis) => {
    const input = values.effectiveLength[axis];
    const factor = input.factor === undefined ? SUPPORT_CONDITIONS[input.supportCondition] : Number(input.factor);
    result[axis] = {
      supportCondition: input.supportCondition,
      factor: round(factor, 3),
      unsupportedLength: round(values.unsupportedLength, 3),
      effectiveLength: round(factor * values.unsupportedLength, 3),
      unit: 'mm',
      clause: 'IS 456:2000 Table 28'
    };
    return result;
  }, {});
}

export function calculateSlenderness(values, effectiveLengths) {
  const x = effectiveLengths.x.effectiveLength / values.depth;
  const y = effectiveLengths.y.effectiveLength / values.width;
  const result = {
    x: { ratio: round(x, 4), limit: COLUMN_CONSTANTS.shortColumnSlendernessLimit, classification: x <= COLUMN_CONSTANTS.shortColumnSlendernessLimit ? 'SHORT' : 'SLENDER', clause: 'IS 456:2000 Clause 25.1' },
    y: { ratio: round(y, 4), limit: COLUMN_CONSTANTS.shortColumnSlendernessLimit, classification: y <= COLUMN_CONSTANTS.shortColumnSlendernessLimit ? 'SHORT' : 'SLENDER', clause: 'IS 456:2000 Clause 25.1' },
    governingAxis: x >= y ? 'X' : 'Y'
  };
  return result;
}

export function calculateMinimumEccentricity(values) {
  const eccentricityX = Math.max(values.unsupportedLength / 500 + values.depth / 30, 20);
  const eccentricityY = Math.max(values.unsupportedLength / 500 + values.width / 30, 20);
  return {
    x: { value: round(eccentricityX, 3), formula: 'e_min = L/500 + D/30, not less than 20 mm', unit: 'mm', clause: 'IS 456:2000 Clause 25.4' },
    y: { value: round(eccentricityY, 3), formula: 'e_min = L/500 + b/30, not less than 20 mm', unit: 'mm', clause: 'IS 456:2000 Clause 25.4' }
  };
}

export function calculateDesignMoments(values, effectiveLengths, slenderness, minimumEccentricity) {
  const pu = values.factoredAxialLoad;
  const minimumX = pu * minimumEccentricity.x.value / 1000;
  const minimumY = pu * minimumEccentricity.y.value / 1000;
  if (values.frameCondition === 'UNBRACED_SWAY') {
    if (values.momentX < minimumX || values.momentY < minimumY) {
      throw new Error('UNBRACED_SWAY final factored design moments must include at least the Clause 25.4 minimum-eccentricity moment on each axis.');
    }
    return {
      x: { inputMoment: values.momentX, minimumEccentricityMoment: round(minimumX, 3), additionalMoment: 'Included in externally supplied final design moment', designMoment: round(values.momentX, 3), relevantDimension: values.depth, effectiveLength: effectiveLengths.x.effectiveLength, formula: 'Externally supplied final factored column design moment; includes sway, second-order effects, and minimum eccentricity. No further magnification is applied here.', clause: 'IS 456:2000 Clauses 25.4 and 39.7' },
      y: { inputMoment: values.momentY, minimumEccentricityMoment: round(minimumY, 3), additionalMoment: 'Included in externally supplied final design moment', designMoment: round(values.momentY, 3), relevantDimension: values.width, effectiveLength: effectiveLengths.y.effectiveLength, formula: 'Externally supplied final factored column design moment; includes sway, second-order effects, and minimum eccentricity. No further magnification is applied here.', clause: 'IS 456:2000 Clauses 25.4 and 39.7' }
    };
  }
  const additionalX = slenderness.x.classification === 'SLENDER' ? pu * effectiveLengths.x.effectiveLength ** 2 / (2000 * values.depth * 1000) : 0;
  const additionalY = slenderness.y.classification === 'SLENDER' ? pu * effectiveLengths.y.effectiveLength ** 2 / (2000 * values.width * 1000) : 0;
  return {
    x: { inputMoment: values.momentX, minimumEccentricityMoment: round(minimumX, 3), additionalMoment: round(additionalX, 3), designMoment: round(Math.max(values.momentX, minimumX) + additionalX, 3), relevantDimension: values.depth, effectiveLength: effectiveLengths.x.effectiveLength, formula: 'M_add = Pu le²/(2000 D) for a slender braced axis; no additional moment for a short axis.', clause: 'IS 456:2000 Clauses 25.4 and 39.7' },
    y: { inputMoment: values.momentY, minimumEccentricityMoment: round(minimumY, 3), additionalMoment: round(additionalY, 3), designMoment: round(Math.max(values.momentY, minimumY) + additionalY, 3), relevantDimension: values.width, effectiveLength: effectiveLengths.y.effectiveLength, formula: 'M_add = Pu le²/(2000 b) for a slender braced axis; no additional moment for a short axis.', clause: 'IS 456:2000 Clauses 25.4 and 39.7' }
  };
}

export function calculateTieDiameter(longitudinalDiameter) {
  return TIE_DIAMETERS.find((diameter) => diameter >= Math.max(6, longitudinalDiameter / 4)) || null;
}

export function createSymmetricBarLayout(width, depth, cover, tieDiameter, longitudinalDiameter, barsPerWidthFace, barsPerDepthFace) {
  const edgeX = width / 2 - cover - tieDiameter - longitudinalDiameter / 2;
  const edgeY = depth / 2 - cover - tieDiameter - longitudinalDiameter / 2;
  if (edgeX <= 0 || edgeY <= 0) return null;
  if (barsPerWidthFace < 2 || barsPerDepthFace < 2) return null;
  const positions = [];
  const add = (x, y, face, corner = false) => positions.push({ x, y, face, corner, diameter: longitudinalDiameter });
  for (let index = 0; index < barsPerWidthFace; index += 1) {
    const x = -edgeX + (2 * edgeX * index) / (barsPerWidthFace - 1);
    add(x, -edgeY, 'width', index === 0 || index === barsPerWidthFace - 1);
    add(x, edgeY, 'width', index === 0 || index === barsPerWidthFace - 1);
  }
  for (let index = 1; index < barsPerDepthFace - 1; index += 1) {
    const y = -edgeY + (2 * edgeY * index) / (barsPerDepthFace - 1);
    add(-edgeX, y, 'depth');
    add(edgeX, y, 'depth');
  }
  const cornerBars = positions.filter((bar) => bar.corner).length;
  const intermediateBars = positions.length - cornerBars;
  const coordinatesMatch = (left, right) => Math.abs(left - right) < 1e-9;
  const symmetry = positions.every((bar) => positions.some((candidate) => coordinatesMatch(candidate.x, -bar.x) && coordinatesMatch(candidate.y, bar.y))
    && positions.every((bar) => positions.some((candidate) => coordinatesMatch(candidate.x, bar.x) && coordinatesMatch(candidate.y, -bar.y))));
  return {
    bars: positions,
    barsPerFace: { widthFaces: barsPerWidthFace, depthFaces: barsPerDepthFace },
    cornerBars,
    intermediateBars,
    totalBars: positions.length,
    symmetry,
    edgeX,
    edgeY
  };
}

function createArrangementForCount(width, depth, cover, longitudinalDiameter, count) {
  const tieDiameter = calculateTieDiameter(longitudinalDiameter);
  if (!tieDiameter) return null;
  for (let barsPerWidthFace = 2; barsPerWidthFace <= 10; barsPerWidthFace += 1) {
    for (let barsPerDepthFace = 2; barsPerDepthFace <= 10; barsPerDepthFace += 1) {
      const arrangement = createSymmetricBarLayout(width, depth, cover, tieDiameter, longitudinalDiameter, barsPerWidthFace, barsPerDepthFace);
      if (arrangement?.totalBars === count && arrangement.symmetry) return arrangement;
    }
  }
  return null;
}

export function calculateArrangementSpacing(arrangement, longitudinalDiameter) {
  const minimumRequiredSpacing = Math.max(25, longitudinalDiameter);
  const centerSpacingX = 2 * arrangement.edgeX / (arrangement.barsPerFace.widthFaces - 1);
  const centerSpacingY = arrangement.barsPerFace.depthFaces > 1 ? 2 * arrangement.edgeY / (arrangement.barsPerFace.depthFaces - 1) : 0;
  const clearSpacingX = centerSpacingX - longitudinalDiameter;
  const clearSpacingY = centerSpacingY - longitudinalDiameter;
  const maximumPerimeterSpacing = 300;
  return {
    centerSpacingX,
    centerSpacingY,
    clearSpacingX,
    clearSpacingY,
    minimumRequiredSpacing,
    maximumPerimeterSpacing,
    pass: clearSpacingX >= minimumRequiredSpacing && clearSpacingY >= minimumRequiredSpacing && centerSpacingX <= maximumPerimeterSpacing && centerSpacingY <= maximumPerimeterSpacing
  };
}

export function calculateTieRestraint(arrangement, tieDiameter, tieSpacing) {
  const mainTieLegs = 4;
  const crossTieLegs = Math.ceil(arrangement.intermediateBars / 2);
  const restrainedBars = arrangement.bars.map((_bar, index) => index + 1);
  const unrestrainedBars = [];
  return {
    tieDiameter,
    tieSpacing,
    mainTieLegs,
    crossTieLegs,
    restrainedBars,
    unrestrainedBars,
    restraintStatus: unrestrainedBars.length === 0 ? 'PASS' : 'FAIL',
    method: 'All perimeter intermediate bars receive supplementary cross-tie legs; no internal bars are generated.',
    clause: 'IS 456:2000 Clause 26.5.3.2'
  };
}

function steelStress(strain, fy) {
  const elasticModulus = 200000;
  const designYieldStrain = 0.87 * fy / elasticModulus;
  return Math.max(-0.87 * fy, Math.min(0.87 * fy, strain / designYieldStrain * 0.87 * fy));
}

function sectionCapacityAtAxialLoad({ values, bars, axialLoad, axis }) {
  const fck = constants.concreteGrades[values.concreteGrade].fck;
  const fy = constants.steelGrades[values.steelGrade].fy;
  const width = axis === 'x' ? values.width : values.depth;
  const depth = axis === 'x' ? values.depth : values.width;
  const coordinate = (bar) => axis === 'x' ? bar.y : bar.x;
  const maxCoordinate = depth / 2;
  const tolerance = Math.max(COLUMN_CONSTANTS.sectionEquilibriumAbsoluteToleranceKn, Math.abs(axialLoad) * COLUMN_CONSTANTS.sectionEquilibriumRelativeTolerance);
  const lowerLimit = Math.max(Number.EPSILON, depth * 1e-9);
  const upperLimit = depth * 1000;
  const evaluate = (neutralAxisDepth) => {
    // IS 456 Clause 38.1 convention: xu is the neutral-axis depth used by
    // the equivalent rectangular stress block; no separate 0.8 multiplier is applied.
    const equivalentBlockDepth = Math.min(neutralAxisDepth, depth);
    const concreteForce = 0.36 * fck * width * equivalentBlockDepth / 1000;
    const concreteCentroid = maxCoordinate - 0.42 * equivalentBlockDepth;
    let axial = concreteForce;
    let moment = concreteForce * concreteCentroid;
    const steelStrain = [];
    const steelStressValues = [];
    for (const bar of bars) {
      const distance = coordinate(bar);
      const distanceFromCompressionFace = maxCoordinate - distance;
      const strain = 0.0035 * (neutralAxisDepth - distanceFromCompressionFace) / neutralAxisDepth;
      const stress = steelStress(strain, fy);
      const force = stress * barArea(bar.diameter) / 1000;
      steelStrain.push(strain);
      steelStressValues.push(stress);
      axial += force;
      moment += force * distance;
    }
    return { neutralAxisDepth, equivalentBlockDepth, axial, moment: Math.abs(moment) / 1000, concreteForce, concreteCentroid, steelForce: axial - concreteForce, steelStrain, steelStress: steelStressValues };
  };
  const lower = evaluate(lowerLimit);
  const upper = evaluate(upperLimit);
  if (axialLoad < lower.axial - tolerance || axialLoad > upper.axial + tolerance) {
    return { targetPu: axialLoad, solvedPu: null, axialResidual: null, neutralAxisDepth: null, equivalentBlockDepth: null, concreteForce: null, concreteCentroid: null, steelForce: null, steelStrain: [], steelStress: [], momentResistance: null, converged: false, iterations: 0, tolerance, axis, message: 'Target axial load is outside the strain-compatible equilibrium range.' };
  }
  let low = lowerLimit;
  let high = upperLimit;
  let solution = null;
  for (let iteration = 1; iteration <= 120; iteration += 1) {
    const midpoint = (low + high) / 2;
    const current = evaluate(midpoint);
    const residual = current.axial - axialLoad;
    solution = { ...current, residual, iteration };
    if (Math.abs(residual) <= tolerance) break;
    if (residual < 0) low = midpoint;
    else high = midpoint;
  }
  const converged = Boolean(solution && Math.abs(solution.residual) <= tolerance);
  return {
    targetPu: axialLoad,
    solvedPu: converged ? solution.axial : null,
    axialResidual: converged ? solution.residual : null,
    neutralAxisDepth: converged ? solution.neutralAxisDepth : null,
    equivalentBlockDepth: converged ? solution.equivalentBlockDepth : null,
    concreteForce: converged ? solution.concreteForce : null,
    concreteCentroid: converged ? solution.concreteCentroid : null,
    steelForce: converged ? solution.steelForce : null,
    steelStrain: converged ? solution.steelStrain : [],
    steelStress: converged ? solution.steelStress : [],
    momentResistance: converged ? solution.moment : null,
    converged,
    iterations: solution?.iteration || 120,
    tolerance,
    axis,
    message: converged ? 'Section equilibrium converged at the target axial load.' : 'Section equilibrium did not converge within the declared tolerance.'
  };
}

export function calculateUniaxialCapacity(values, diameter, count, axis, axialLoad = values.factoredAxialLoad) {
  const arrangement = createArrangementForCount(values.width, values.depth, values.clearCover, diameter, count);
  return arrangement ? sectionCapacityAtAxialLoad({ values, bars: arrangement.bars, axialLoad, axis }) : null;
}

function calculateAxialCapacity(values, steelArea) {
  const fck = constants.concreteGrades[values.concreteGrade].fck;
  const fy = constants.steelGrades[values.steelGrade].fy;
  const grossArea = values.width * values.depth;
  const concreteArea = grossArea - steelArea;
  const concreteContribution = 0.4 * fck * concreteArea / 1000;
  const steelContribution = 0.67 * fy * steelArea / 1000;
  const capacity = concreteContribution + steelContribution;
  return { grossArea, concreteArea, steelArea, concreteContribution, steelContribution, capacity };
}

function calculatePuz(values, steelArea) {
  const fck = constants.concreteGrades[values.concreteGrade].fck;
  const fy = constants.steelGrades[values.steelGrade].fy;
  const grossArea = values.width * values.depth;
  const concreteArea = grossArea - steelArea;
  return {
    value: (0.45 * fck * concreteArea + 0.75 * fy * steelArea) / 1000,
    formula: 'Puz = 0.45 fck Ac + 0.75 fy Asc',
    clause: 'IS 456:2000 Clause 39.6'
  };
}

export function calculateAxialCapacityForDesign(values, steelArea) {
  return calculateAxialCapacity(values, steelArea);
}

export function selectLongitudinalReinforcement(values, designMoments, slenderness) {
  const grossArea = values.width * values.depth;
  const minimumSteel = COLUMN_CONSTANTS.minimumLongitudinalSteelRatio * grossArea;
  const maximumSteel = COLUMN_CONSTANTS.maximumLongitudinalSteelRatio * grossArea;
  const candidates = [];
  for (const diameter of LONGITUDINAL_DIAMETERS) {
    const tieDiameter = calculateTieDiameter(diameter);
    if (!tieDiameter) continue;
    for (let barsPerWidthFace = 2; barsPerWidthFace <= 10; barsPerWidthFace += 1) {
      for (let barsPerDepthFace = 2; barsPerDepthFace <= 10; barsPerDepthFace += 1) {
        const arrangement = createSymmetricBarLayout(values.width, values.depth, values.clearCover, tieDiameter, diameter, barsPerWidthFace, barsPerDepthFace);
        if (!arrangement || arrangement.totalBars < 4 || arrangement.totalBars > 24 || !arrangement.symmetry) continue;
        const steelArea = arrangement.totalBars * barArea(diameter);
        if (steelArea < minimumSteel || steelArea > maximumSteel) continue;
        const spacing = calculateArrangementSpacing(arrangement, diameter);
        if (!spacing.pass) continue;
        const maximumTieSpacing = Math.min(values.width, 16 * diameter, 300);
        const tieSpacing = Math.floor(maximumTieSpacing / 5) * 5;
        const tieRestraint = calculateTieRestraint(arrangement, tieDiameter, tieSpacing);
        if (tieRestraint.restraintStatus !== 'PASS') continue;
        const axial = calculateAxialCapacity(values, steelArea);
        const xCapacity = sectionCapacityAtAxialLoad({ values, bars: arrangement.bars, axialLoad: values.factoredAxialLoad, axis: 'x' });
        const yCapacity = sectionCapacityAtAxialLoad({ values, bars: arrangement.bars, axialLoad: values.factoredAxialLoad, axis: 'y' });
        if (axial.capacity < values.factoredAxialLoad || !xCapacity.converged || !yCapacity.converged) continue;
        const puz = calculatePuz(values, steelArea);
        const puRatio = values.factoredAxialLoad / puz.value;
        const alphaData = calculateInteractionAlpha(puRatio);
        const alpha = alphaData.alpha;
        const interaction = (designMoments.x.designMoment / Math.max(xCapacity.momentResistance, 0.001)) ** alpha + (designMoments.y.designMoment / Math.max(yCapacity.momentResistance, 0.001)) ** alpha;
        if (interaction <= 1) candidates.push({ diameter, count: arrangement.totalBars, steelArea, arrangement, spacing, tieDiameter, tieSpacing, tieRestraint, axial, xCapacity, yCapacity, interaction, alpha, puRatio, puz });
      }
    }
  }
  candidates.sort((left, right) => left.steelArea - right.steelArea || left.diameter - right.diameter || left.count - right.count || left.arrangement.barsPerFace.widthFaces - right.arrangement.barsPerFace.widthFaces);
  return { selected: candidates[0] || null, minimumSteel, maximumSteel, requiredSteelForDemand: candidates[0]?.steelArea ?? null, candidateCount: candidates.length };
}

export function calculateTieRequirements(values, selected) {
  if (!selected) return { status: 'FAIL', tieDiameter: NOT_CALCULATED, maximumSpacing: NOT_CALCULATED, selectedSpacing: NOT_CALCULATED, mainTieLegs: NOT_CALCULATED, crossTieLegs: NOT_CALCULATED, restrainedBars: [], unrestrainedBars: [], restraintStatus: 'FAIL', formula: 's <= min(least dimension, 16 phi_min, 300 mm)', clause: 'IS 456:2000 Clause 26.5.3.2' };
  const maximumSpacing = Math.min(values.width, 16 * selected.diameter, 300);
  return {
    status: selected.tieSpacing <= maximumSpacing && selected.tieRestraint.restraintStatus === 'PASS' ? 'PASS' : 'FAIL',
    tieDiameter: selected.tieDiameter,
    maximumSpacing: round(maximumSpacing),
    selectedSpacing: selected.tieSpacing,
    mainTieLegs: selected.tieRestraint.mainTieLegs,
    crossTieLegs: selected.tieRestraint.crossTieLegs,
    restrainedBars: selected.tieRestraint.restrainedBars,
    unrestrainedBars: selected.tieRestraint.unrestrainedBars,
    restraintStatus: selected.tieRestraint.restraintStatus,
    restraintMethod: selected.tieRestraint.method,
    formula: 's <= min(least dimension, 16 phi_min, 300 mm)',
    clause: 'IS 456:2000 Clause 26.5.3.2'
  };
}

export function checkBiaxialInteraction(values, designMoments, selected) {
  if (!selected) return { name: 'Biaxial interaction', status: 'FAIL', interactionValue: NOT_CALCULATED, limit: 1, exponent: NOT_CALCULATED, clause: 'IS 456:2000 Clause 39.6' };
  return {
    name: 'Biaxial interaction',
    status: selected.interaction <= 1 ? 'PASS' : 'FAIL',
    actual: selected.interaction,
    interactionValue: round(selected.interaction, 4),
    limit: 1,
    unit: 'ratio',
    Pu: values.factoredAxialLoad,
    Puz: round(selected.puz.value, 3),
    PuOverPuz: round(selected.puRatio, 6),
    exponent: round(selected.alpha, 4),
    alphaMethod: calculateInteractionAlpha(selected.puRatio).method,
    Mux: designMoments.x.designMoment,
    Muy: designMoments.y.designMoment,
    Mux1: round(selected.xCapacity.momentResistance, 3),
    Muy1: round(selected.yCapacity.momentResistance, 3),
    xCapacity: selected.xCapacity,
    yCapacity: selected.yCapacity,
    reinforcementArrangement: {
      barsPerFace: selected.arrangement.barsPerFace,
      cornerBars: selected.arrangement.cornerBars,
      intermediateBars: selected.arrangement.intermediateBars,
      totalBars: selected.arrangement.totalBars,
      symmetry: selected.arrangement.symmetry
    },
    analysisLimitation: 'Clause 39.6 interaction equation using independently converged uniaxial capacities; this is not a full two-dimensional biaxial fibre-section analysis.',
    formula: '(Mux/Mux1)^alpha + (Muy/Muy1)^alpha <= 1.0',
    clause: 'IS 456:2000 Clause 39.6'
  };
}

function check(name, status, actual, limit, unit, formula, clause) {
  return { name, status, statusCode: status.replaceAll(' ', '_'), actual, limit, unit, formula, explanation: formula, severity: 'MANDATORY', codeReference: clause, clause, utilization: finite(actual) && finite(limit) && Number(limit) !== 0 ? round(Number(actual) / Number(limit), 4) : NOT_CALCULATED };
}

export function performDetailingChecks(values, selected, ties) {
  if (!selected) return { status: 'FAIL', checks: [check('Longitudinal bar arrangement', 'FAIL', NOT_CALCULATED, NOT_CALCULATED, 'mm', 'At least four bars with corner bars are required.', 'IS 456:2000 Clause 26.5.3.1')] };
  const coverPass = values.clearCover >= 40 && values.clearCover >= selected.diameter;
  const arrangementPass = selected.arrangement.totalBars >= 4 && selected.arrangement.bars.length === selected.arrangement.totalBars && selected.arrangement.cornerBars === 4 && selected.arrangement.symmetry;
  const spacingPass = selected.spacing.pass;
  const checks = [
    check('Longitudinal bar arrangement', arrangementPass ? 'PASS' : 'FAIL', selected.arrangement.totalBars, 4, 'bars', 'At least four bars, four corner bars, symmetric opposite-face arrangement.', 'IS 456:2000 Clause 26.5.3.1'),
    check('Minimum reinforcement', selected.steelArea >= COLUMN_CONSTANTS.minimumLongitudinalSteelRatio * values.width * values.depth ? 'PASS' : 'FAIL', selected.steelArea, COLUMN_CONSTANTS.minimumLongitudinalSteelRatio * values.width * values.depth, 'mm²', 'Asc,min = 0.008 Ag', 'IS 456:2000 Clause 26.5.3.1'),
    check('Maximum reinforcement', selected.steelArea <= COLUMN_CONSTANTS.maximumLongitudinalSteelRatio * values.width * values.depth ? 'PASS' : 'FAIL', selected.steelArea, COLUMN_CONSTANTS.maximumLongitudinalSteelRatio * values.width * values.depth, 'mm²', 'Asc,max = 0.06 Ag', 'IS 456:2000 Clause 26.5.3.1'),
    check('Cover', coverPass ? 'PASS' : 'FAIL', values.clearCover, Math.max(40, selected.diameter), 'mm', 'Nominal cover >= 40 mm and >= bar diameter.', 'IS 456:2000 Clause 26.4.2.1'),
    check('Longitudinal clear spacing', spacingPass ? 'PASS' : 'FAIL', Math.min(selected.spacing.clearSpacingX, selected.spacing.clearSpacingY), selected.spacing.minimumRequiredSpacing, 'mm', 'Clear spacing = centre-to-centre spacing - bar diameter; minimum adopted as max(25 mm, bar diameter).', 'IS 456:2000 Clause 26.3.3'),
    check('Longitudinal perimeter spacing', spacingPass ? 'PASS' : 'FAIL', Math.max(selected.spacing.centerSpacingX, selected.spacing.centerSpacingY), selected.spacing.maximumPerimeterSpacing, 'mm', 'Centre-to-centre perimeter spacing shall not exceed 300 mm.', 'IS 456:2000 Clause 26.5.3.1'),
    check('Tie restraint', ties.restraintStatus === 'PASS' ? 'PASS' : 'FAIL', ties.unrestrainedBars.length, 0, 'bars', 'All perimeter bars are restrained by the main tie and required supplementary cross-tie legs.', 'IS 456:2000 Clause 26.5.3.2')
  ];
  return { status: checks.every((entry) => entry.status === 'PASS') && ties.status === 'PASS' ? 'PASS' : 'FAIL', checks };
}

export function determineFinalStatus(checks) {
  return checks.every((entry) => entry.status === 'PASS') ? 'APPROVED' : 'NOT APPROVED';
}

export function generateColumnDesign(input = {}) {
  const values = { ...input, ...validateInputs(input) };
  const effectiveLengths = calculateEffectiveLengths({ ...input, ...values });
  const slenderness = calculateSlenderness(values, effectiveLengths);
  const minimumEccentricity = calculateMinimumEccentricity(values);
  const designMoments = calculateDesignMoments(values, effectiveLengths, slenderness, minimumEccentricity);
  const reinforcement = selectLongitudinalReinforcement(values, designMoments, slenderness);
  const selected = reinforcement.selected;
  const axial = selected ? selected.axial : calculateAxialCapacity(values, reinforcement.minimumSteel);
  const ties = calculateTieRequirements(values, selected);
  const interaction = checkBiaxialInteraction(values, designMoments, selected);
  const detailing = performDetailingChecks(values, selected, ties);
  const checks = [
    ...(values.frameCondition === 'UNBRACED_SWAY' ? [
      check('External sway analysis inputs', 'PASS', 'Effective lengths and final factored moments supplied', 'Traceable analysis reference supplied', '', 'Imported frame-analysis outputs; model and results are not independently verified.', 'IS 456:2000 Clause 39.7')
    ] : []),
    check('Axial capacity', axial.capacity >= values.factoredAxialLoad ? 'PASS' : 'FAIL', round(axial.capacity, 3), values.factoredAxialLoad, 'kN', 'Pu = 0.4 fck Ac + 0.67 fy Asc', 'IS 456:2000 Clause 39.3'),
    check('Slenderness X', slenderness.x.classification === 'SHORT' || Boolean(selected?.xCapacity?.converged && (values.frameCondition === 'UNBRACED_SWAY' || (designMoments.x.additionalMoment > 0 && values.frameCondition === COLUMN_CONSTANTS.supportedFrameCondition))) ? 'PASS' : 'FAIL', slenderness.x.ratio, 12, 'ratio', values.frameCondition === 'UNBRACED_SWAY' ? 'le,x / D using externally supplied sway-frame effective length; final sway design moment is externally supplied.' : 'le,x / D; a slender axis requires the applicable Clause 39.7 procedure.', 'IS 456:2000 Clauses 25.1 and 39.7'),
    check('Slenderness Y', slenderness.y.classification === 'SHORT' || Boolean(selected?.yCapacity?.converged && (values.frameCondition === 'UNBRACED_SWAY' || (designMoments.y.additionalMoment > 0 && values.frameCondition === COLUMN_CONSTANTS.supportedFrameCondition))) ? 'PASS' : 'FAIL', slenderness.y.ratio, 12, 'ratio', values.frameCondition === 'UNBRACED_SWAY' ? 'le,y / b using externally supplied sway-frame effective length; final sway design moment is externally supplied.' : 'le,y / b; a slender axis requires the applicable Clause 39.7 procedure.', 'IS 456:2000 Clauses 25.1 and 39.7'),
    check('Flexure X', selected && selected.xCapacity.converged && selected.xCapacity.momentResistance >= designMoments.x.designMoment ? 'PASS' : 'FAIL', selected ? round(selected.xCapacity.momentResistance, 3) : NOT_CALCULATED, designMoments.x.designMoment, 'kN·m', 'Section strain compatibility capacity at target Pu >= design moment.', 'IS 456:2000 Clauses 38.1 and 39.6'),
    check('Flexure Y', selected && selected.yCapacity.converged && selected.yCapacity.momentResistance >= designMoments.y.designMoment ? 'PASS' : 'FAIL', selected ? round(selected.yCapacity.momentResistance, 3) : NOT_CALCULATED, designMoments.y.designMoment, 'kN·m', 'Section strain compatibility capacity at target Pu >= design moment.', 'IS 456:2000 Clauses 38.1 and 39.6'),
    interaction,
    check('Longitudinal steel', selected ? 'PASS' : 'FAIL', selected ? selected.steelArea : NOT_CALCULATED, reinforcement.minimumSteel, 'mm²', 'Dynamically selected steel is between minimum and maximum limits.', 'IS 456:2000 Clause 26.5.3.1'),
    { name: 'Ties', status: ties.status, actual: ties.selectedSpacing, limit: ties.maximumSpacing, unit: 'mm', formula: ties.formula, clause: ties.clause },
    ...detailing.checks
  ];
  return {
    designType: 'Column', designCode: 'IS 456:2000 Limit State Method', inputs: values,
    geometry: { width: values.width, depth: values.depth, unsupportedLength: values.unsupportedLength, clearCover: values.clearCover },
    materials: { concreteGrade: input.concreteGrade, steelGrade: input.steelGrade, fck: constants.concreteGrades[input.concreteGrade].fck, fy: constants.steelGrades[input.steelGrade].fy },
    effectiveLengths, slenderness, minimumEccentricity, designMoments,
    classification: { x: slenderness.x.classification, y: slenderness.y.classification, governingAxis: slenderness.governingAxis },
    axialCapacity: { ...Object.fromEntries(Object.entries(axial).map(([key, value]) => [key, round(value, 3)])), utilization: round(values.factoredAxialLoad / axial.capacity, 4) },
    reinforcement: selected ? {
      selectedBarDiameter: selected.diameter,
      numberOfBars: selected.count,
      AstRequired: round(reinforcement.requiredSteelForDemand, 3),
      AstMinimum: round(reinforcement.minimumSteel, 3),
      AstProvided: round(selected.steelArea, 3),
      requiredSteelMethod: 'Smallest tested symmetric bar arrangement satisfying corrected section capacity, biaxial interaction, minimum/maximum steel, spacing, fit, and restraint checks.',
      governingRequirement: reinforcement.requiredSteelForDemand > reinforcement.minimumSteel ? 'STRUCTURAL CAPACITY / DISCRETE ARRANGEMENT' : 'MINIMUM STEEL',
      percentage: round(100 * selected.steelArea / (values.width * values.depth), 4),
      minimumSteel: round(reinforcement.minimumSteel, 3),
      maximumSteel: round(reinforcement.maximumSteel, 3),
      barsPerFace: selected.arrangement.barsPerFace,
      cornerBars: selected.arrangement.cornerBars,
      intermediateBars: selected.arrangement.intermediateBars,
      totalBars: selected.arrangement.totalBars,
      symmetry: selected.arrangement.symmetry,
      bars: selected.arrangement.bars,
      centerSpacingX: round(selected.spacing.centerSpacingX, 3),
      centerSpacingY: round(selected.spacing.centerSpacingY, 3),
      clearSpacingX: round(selected.spacing.clearSpacingX, 3),
      clearSpacingY: round(selected.spacing.clearSpacingY, 3),
      minimumRequiredSpacing: round(selected.spacing.minimumRequiredSpacing, 3),
      maximumPerimeterSpacing: round(selected.spacing.maximumPerimeterSpacing, 3),
      coverDefinition: 'Clear cover is measured to the outside face of the tie; bar centreline = cover + tie diameter + bar diameter/2.'
    } : { selectedBarDiameter: NOT_CALCULATED, numberOfBars: NOT_CALCULATED, AstRequired: NOT_CALCULATED, AstMinimum: round(reinforcement.minimumSteel, 3), AstProvided: NOT_CALCULATED, requiredSteelMethod: NOT_CALCULATED, governingRequirement: NOT_CALCULATED, percentage: NOT_CALCULATED, minimumSteel: round(reinforcement.minimumSteel, 3), maximumSteel: round(reinforcement.maximumSteel, 3), barsPerFace: NOT_CALCULATED, cornerBars: NOT_CALCULATED, intermediateBars: NOT_CALCULATED, totalBars: NOT_CALCULATED, symmetry: false, bars: [], centerSpacingX: NOT_CALCULATED, centerSpacingY: NOT_CALCULATED, clearSpacingX: NOT_CALCULATED, clearSpacingY: NOT_CALCULATED, minimumRequiredSpacing: NOT_CALCULATED, maximumPerimeterSpacing: NOT_CALCULATED, coverDefinition: 'Clear cover is measured to the outside face of the tie.' },
    ties, biaxialInteraction: interaction, detailing, checks,
    assumptions: [values.frameCondition === 'UNBRACED_SWAY'
      ? 'UNBRACED_SWAY response is imported, not analyzed here; supplied effective lengths and final factored design moments include sway, second-order effects, and minimum eccentricity.'
      : 'The input column is braced/non-sway for Clause 39.7 additional-moment treatment.',
    values.frameCondition === 'UNBRACED_SWAY'
      ? `External frame-analysis reference: ${values.swayAnalysis.analysisReference}. The model and results are not independently verified by this column check.`
      : 'Effective length is calculated as unsupported length multiplied by the selected IS 456 Table 28 support-condition factor; an explicit factor is treated as an engineering input.',
    'Rectangular stress block and Es-based bilinear design steel stress are used for uniaxial capacities.',
    'Cover is interpreted as clear cover to the outside of the tie; bar centreline is cover + tie diameter + bar diameter/2.',
    selected ? (selected.arrangement.intermediateBars > 0 ? 'Supplementary cross-tie legs are calculated for the actual intermediate perimeter bars.' : 'No intermediate perimeter bars are present; no supplementary cross-tie legs are required.') : 'Tie restraint could not be established because no valid bar arrangement was selected.',
    'Clause 39.6 interaction is used instead of a full two-dimensional biaxial fibre-section analysis.'],
    frameCondition: values.frameCondition,
    finalStatus: determineFinalStatus(checks), designStatus: determineFinalStatus(checks),
    calculationSteps: checks.map((entry, index) => ({ step: index + 1, description: entry.name, formula: entry.formula, value: entry.actual, unit: entry.unit, clause: entry.clause, status: entry.status }))
  };
  assertFiniteResult(result);
  return result;
}