import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const constantsPath = path.join(__dirname, '..', 'constants', 'designConstants.json');
const constants = JSON.parse(fs.readFileSync(constantsPath, 'utf8'));
const { interpolateFig4ModificationFactor } = await import('./fig4Dataset.js');

const STANDARD_BAR_DIAMETERS = [8, 10, 12, 16, 20, 25, 28, 32];
const STIRRUP_DIAMETERS = [8, 10, 12];
const MIN_CLEAR_SPACING = 25;

// Physical face and structural role metadata carried by each reinforcement group.
// `face` describes where the steel physically sits ('top' | 'bottom');
// `structuralRole` describes what it does ('tension' | 'hanger/detailing' | 'compression' | null).
// Face/role are presentation metadata only — amounts, diameters and labels come from design.
const PHYSICAL_FACES = ['top', 'bottom'];
const STRUCTURAL_ROLES = ['tension', 'hanger/detailing', 'compression'];

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function optionalNumber(value) {
  return value === undefined || value === null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
}

function validatedOptionalNumber(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${fieldName} must be a finite number when supplied.`);
  return number;
}

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : value;
}

/**
 * Result-boundary normalisation for engineering result objects.
 *
 * JSON cannot represent NaN, Infinity or -Infinity: they are silently written as null (or dropped),
 * so the in-memory result and the API payload disagreed whenever the engine could not determine a
 * value. This walks the structure in place and replaces only non-finite numeric leaves with null —
 * "the engine could not determine this value" — never with 0.
 *
 * Strings, booleans, arrays, existing nulls and shared object references (e.g. `reinforcementCage`
 * aliasing `reinforcement`) are preserved, so this deliberately mutates rather than round-tripping
 * through JSON. No engineering value is recalculated.
 */
function normalizeNonFiniteNumbers(node, seen = new WeakSet()) {
  if (node === null || typeof node !== 'object') return node;
  if (seen.has(node)) return node;
  seen.add(node);
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (typeof value === 'number' && !Number.isFinite(value)) {
      node[key] = null;
    } else if (value !== null && typeof value === 'object') {
      normalizeNonFiniteNumbers(value, seen);
    }
  }
  return node;
}

function validateBeamInputs(values) {
  if (!values || typeof values !== 'object') throw new Error('Beam inputs are required.');
  const finiteFields = ['length', 'breadth', 'overallDepth', 'clearCover', 'preferredBarDiameter', 'liveLoad', 'deadLoad', 'unitWeightConcrete'];
  if (finiteFields.some((field) => !Number.isFinite(Number(values[field])))) throw new Error('All beam geometry, load and material inputs must be finite numbers.');
  const length = toNumber(values.length);
  const breadth = toNumber(values.breadth);
  const overallDepth = toNumber(values.overallDepth);
  const clearCover = toNumber(values.clearCover);
  const preferredBarDiameter = toNumber(values.preferredBarDiameter);
  const liveLoad = toNumber(values.liveLoad);
  const deadLoad = toNumber(values.deadLoad);
  const unitWeightConcrete = toNumber(values.unitWeightConcrete);

  if (!['Simply Supported', 'Continuous', 'Cantilever'].includes(values.supportType)) {
    throw new Error('Support type must be Simply Supported, Continuous, or Cantilever.');
  }
  if (length <= 0 || breadth <= 0 || overallDepth <= 0) throw new Error('Span, beam breadth and overall depth must be greater than 0.');
  if (clearCover <= 0 || preferredBarDiameter <= 0) throw new Error('Clear cover and preferred bar diameter must be greater than 0.');
  if (clearCover >= overallDepth) throw new Error('Clear cover cannot be greater than or equal to overall depth.');
  if (liveLoad < 0 || deadLoad < 0 || unitWeightConcrete <= 0) throw new Error('Live load, dead load and unit weight must be valid positive values.');
  if (!STANDARD_BAR_DIAMETERS.includes(preferredBarDiameter)) throw new Error(`Preferred bar diameter must be one of: ${STANDARD_BAR_DIAMETERS.join(', ')} mm.`);
  if (values.stirrupDiameter !== undefined && values.stirrupDiameter !== null && values.stirrupDiameter !== '' && !STIRRUP_DIAMETERS.includes(Number(values.stirrupDiameter))) throw new Error(`Stirrup diameter must be one of: ${STIRRUP_DIAMETERS.join(', ')} mm.`);
  if (!constants.concreteGrades?.[values.concreteGrade]) throw new Error('Invalid concrete grade. Use M20, M25, M30, or M35.');
  if (!constants.steelGrades?.[values.steelGrade]) throw new Error('Invalid steel grade. Use Fe250, Fe415, or Fe500.');
  const clearSpan = validatedOptionalNumber(values.clearSpan, 'clearSpan');
  const supportWidth = validatedOptionalNumber(values.supportWidth, 'supportWidth');
  const availableAnchorage = validatedOptionalNumber(values.availableAnchorage, 'availableAnchorage');
  const availableEmbedment = validatedOptionalNumber(values.availableEmbedment, 'availableEmbedment');
  const availableEmbedmentLength = validatedOptionalNumber(values.availableEmbedmentLength, 'availableEmbedmentLength');
  if (clearSpan !== null && clearSpan <= 0) throw new Error('clearSpan must be greater than 0 when supplied.');
  if (supportWidth !== null && supportWidth <= 0) throw new Error('supportWidth must be greater than 0 when supplied.');
  if (values.supportCondition !== undefined && !['Simply Supported', 'Continuous', 'Cantilever'].includes(values.supportCondition)) throw new Error('supportCondition must be Simply Supported, Continuous, or Cantilever.');
  if (values.supportCondition && values.supportCondition !== values.supportType) throw new Error('supportCondition must match supportType for the current single-support beam model.');
  if (availableAnchorage !== null && availableAnchorage <= 0) throw new Error('availableAnchorage must be greater than 0 when supplied.');
  if (availableEmbedment !== null && availableEmbedment <= 0) throw new Error('availableEmbedment must be greater than 0 when supplied.');
  if (availableEmbedmentLength !== null && availableEmbedmentLength <= 0) throw new Error('availableEmbedmentLength must be greater than 0 when supplied.');
  const termination = values.terminationSetbackFromSupportFace ?? values.barCurtailmentLocation;
  const terminationSetback = validatedOptionalNumber(termination, 'terminationSetbackFromSupportFace');
  if (terminationSetback !== null && terminationSetback < 0) throw new Error('terminationSetbackFromSupportFace must be a non-negative value when supplied.');
}

function calculateEffectiveSpan(values, inputLength) {
    const clearSpan = optionalNumber(values.clearSpan);
    const supportWidth = optionalNumber(values.supportWidth);
    if (clearSpan !== null && supportWidth !== null) {
      return {
        span: clearSpan + supportWidth / 1000,
        clearSpan,
        supportWidth,
        mode: 'GEOMETRY',
        spanSource: 'Effective/design span calculated from clear span and support width using the supplied support geometry.',
        definition: 'Calculated as clear span + support width using the supplied support geometry; verify the selected IS 456 Clause 22.2 support model.'
      };
    }
    return {
      span: inputLength,
      clearSpan,
      supportWidth,
      mode: 'EFFECTIVE_SPAN_INPUT',
       spanSource: 'Effective/design span directly supplied by user.',
      definition: 'Effective/design span supplied by user through length; clear span and support width were not both supplied.'
    };
  }

function calculateLoads(length, breadth, overallDepth, deadLoad, liveLoad, unitWeightConcrete) {
  const selfWeight = (breadth / 1000) * (overallDepth / 1000) * unitWeightConcrete;
  const totalDead = selfWeight + deadLoad;
  return {
    selfWeight,
    deadLoad: totalDead,
    serviceLoad: totalDead + liveLoad,
    liveLoad,
    ultimateLoad: 1.5 * totalDead + 1.5 * liveLoad
  };
}

function calculateMoment(supportType, span, ultimateLoad) {
  // Existing Beam input supports a uniformly distributed load and a single design span.
  // For a continuous member, use the established coefficient method for an interior span:
  // +wL²/12 at midspan and -wL²/10 over the interior support.
  const positiveMoment = supportType === 'Continuous' ? ultimateLoad * span * span / 12 : supportType === 'Cantilever' ? ultimateLoad * span * span / 2 : ultimateLoad * span * span / 8;
  const negativeMoment = supportType === 'Continuous' ? ultimateLoad * span * span / 10 : 0;
  const ultimateShear = supportType === 'Cantilever' ? ultimateLoad * span : ultimateLoad * span / 2;
  return { ultimateMoment: positiveMoment, positiveMoment, negativeMoment, ultimateShear,
    model: supportType === 'Continuous' ? 'Continuous-beam UDL coefficient method: Mu+ = wL²/12; Mu- = wL²/10.' : 'Existing single-span beam action model.' };
}

function calculateEffectiveDepth(overallDepth, clearCover, stirrupDiameter, mainBarDiameter) {
  const effectiveDepth = overallDepth - clearCover - stirrupDiameter - mainBarDiameter / 2;
  if (effectiveDepth <= 0) throw new Error('Effective depth is not valid for the selected reinforcement geometry.');
  return round(effectiveDepth);
}

function getXuMaxRatio(steelGrade) {
  return { Fe250: 0.53, Fe415: 0.48, Fe500: 0.46 }[steelGrade] || 0.48;
}

// IS 456:2000 Clause 38.1: rectangular stress block and Clause 26.5.1.1 limits.
function calculateFlexuralDesign({ moment, breadth, overallDepth, effectiveDepth, concreteGrade, steelGrade, providedArea }) {
  const fck = constants.concreteGrades[concreteGrade].fck;
  const fy = constants.steelGrades[steelGrade].fy;
  const xuMaxRatio = getXuMaxRatio(steelGrade);
  const xuMax = xuMaxRatio * effectiveDepth;
  const muLim = 0.36 * fck * breadth * xuMax * (effectiveDepth - 0.42 * xuMax) / 1e6;
  const astMin = 0.85 * breadth * effectiveDepth / fy;
  const astMax = 0.04 * breadth * overallDepth;
  const requiredMoment = moment * 1e6;
  const a = 0.87 * fy * 0.42 * (0.87 * fy) / (0.36 * fck * breadth);
  const b = -0.87 * fy * effectiveDepth;
  const c = requiredMoment;
  const discriminant = b * b - 4 * a * c;
  const requiredAst = discriminant >= 0 ? (-b - Math.sqrt(discriminant)) / (2 * a) : NaN;
  const ast = toNumber(providedArea);
  const xu = 0.87 * fy * ast / (0.36 * fck * breadth);
  const muProvided = 0.87 * fy * ast * (effectiveDepth - 0.42 * xu) / 1e6;

  return {
    fck, fy, breadth, effectiveDepth, xuMaxRatio, xuMax: round(xuMax), muLim: round(muLim),
    requiredAst: round(requiredAst), minimumReinforcement: round(astMin), maximumReinforcement: round(astMax),
    providedAst: round(ast), xu: round(xu), xuRatio: round(xu / effectiveDepth, 4),
    muProvided: round(muProvided), singlyReinforcedPossible: moment <= muLim,
    underReinforced: xu <= xuMax
  };
}

function barArea(diameter) {
  return Math.PI * diameter * diameter / 4;
}

function calculateClearSpacing(width, cover, stirrupDiameter, barDiameter, barCount) {
  const availableWidth = width - 2 * cover - 2 * stirrupDiameter;
  const clearSpacing = (availableWidth - barCount * barDiameter) / (barCount - 1);
  return { availableWidth: round(availableWidth), clearSpacing: round(clearSpacing), minimumRequired: MIN_CLEAR_SPACING };
}

function selectMainReinforcement({ requiredAst, minimumAst, maximumAst, preferredDiameter, breadth, cover, stirrupDiameter, overallDepth, moment, concreteGrade, steelGrade }) {
  const targetAst = Math.max(requiredAst, minimumAst);
  const diameters = [...new Set([preferredDiameter, ...STANDARD_BAR_DIAMETERS])].filter((diameter) => diameter > 0).sort((left, right) => left - right);
  const candidates = [];

  for (const diameter of diameters) {
    for (let count = 2; count <= 20; count += 1) {
      const providedAst = count * barArea(diameter);
      const spacing = calculateClearSpacing(breadth, cover, stirrupDiameter, diameter, count);
      const effectiveDepth = calculateEffectiveDepth(overallDepth, cover, stirrupDiameter, diameter);
      const flexure = calculateFlexuralDesign({ moment, breadth, overallDepth, effectiveDepth, concreteGrade, steelGrade, providedArea: providedAst });
      if (providedAst >= targetAst && providedAst <= maximumAst && spacing.clearSpacing >= spacing.minimumRequired && flexure.underReinforced) {
        candidates.push({ diameter, count, providedAst, spacing, effectiveDepth, flexure });
        break;
      }
    }
  }

  if (!candidates.length) return null;
  candidates.sort((left, right) => {
    const leftPenalty = Math.abs(left.diameter - preferredDiameter) * 1000 + left.count;
    const rightPenalty = Math.abs(right.diameter - preferredDiameter) * 1000 + right.count;
    return leftPenalty - rightPenalty;
  });
  return candidates[0];
}

// IS 456:2000 Table 19. Values between tabulated pt values are linearly interpolated.
// Outside the tabulated range, the nearest endpoint is used conservatively and recorded.
function getConcreteShearStrength(pt, concreteGrade) {
  const table = constants.shearStrengthTable[concreteGrade];
  if (!table) return { value: NaN, source: 'IS 456:2000 Table 19', method: 'unsupported concrete grade' };
  const points = Object.entries(table).map(([percentage, strength]) => ({ percentage: Number(percentage), strength: Number(strength) })).sort((a, b) => a.percentage - b.percentage);
  if (pt <= points[0].percentage) return { value: points[0].strength, lower: points[0], upper: points[0], source: 'IS 456:2000 Table 19', method: 'conservative lower endpoint' };
  if (pt >= points[points.length - 1].percentage) return { value: points[points.length - 1].strength, lower: points[points.length - 1], upper: points[points.length - 1], source: 'IS 456:2000 Table 19', method: 'conservative upper endpoint' };
  for (let index = 1; index < points.length; index += 1) {
    if (pt <= points[index].percentage) {
      const lower = points[index - 1];
      const upper = points[index];
      return {
        value: lower.strength + (pt - lower.percentage) * (upper.strength - lower.strength) / (upper.percentage - lower.percentage),
        lower,
        upper,
        source: 'IS 456:2000 Table 19',
        method: 'linear interpolation between tabulated pt values'
      };
    }
  }
  return { value: NaN, source: 'IS 456:2000 Table 19', method: 'unsupported pt value' };
}

function getTauCMax(concreteGrade) {
  return { M20: 2.8, M25: 3.1, M30: 3.5, M35: 3.7 }[concreteGrade] || NaN;
}

// IS 456:2000 Clauses 40 and 26.5.1.6: shear and vertical stirrups.
function calculateShearDesign({ breadth, effectiveDepth, ultimateShear, concreteGrade, steelGrade, providedAst, preferredStirrupDiameter = 8 }) {
  const fyv = Math.min(constants.steelGrades[steelGrade].fy, 415);
  // IS 456:2000 Table 19 selects tau_c from the percentage of tension reinforcement
  // pt = 100 Ast / (b d). That percentage is derived from the SAME authoritative provided
  // area that the result publishes (`providedAreaSteel`, 2 dp) and that the deflection
  // check already uses. Using a hidden higher-precision Ast here would make the printed
  // pt, tau_c and Vc mutually irreproducible: a reviewer working from the published Ast
  // would not be able to re-derive tau_c. The rounding difference is ~0.001% of Ast, far
  // below any code tolerance, and it is applied in the conservative direction (a slightly
  // smaller Ast gives a slightly smaller pt and therefore a slightly smaller tau_c).
  const pt = 100 * round(providedAst) / (breadth * effectiveDepth);
  const tauCData = getConcreteShearStrength(pt, concreteGrade);
  // tauC is kept at full precision. Vc is computed from THIS unrounded interpolated value,
  // never from the rounded display value, so the two can never disagree silently.
  const tauC = tauCData.value;
  const tauCMax = getTauCMax(concreteGrade);
  const tauV = ultimateShear * 1000 / (breadth * effectiveDepth);
  const vc = tauC * breadth * effectiveDepth;
  const vuMinusVc = ultimateShear * 1000 - vc;
  const vusRequired = Math.max(0, vuMinusVc);
  const minAsvPerSv = 0.4 * breadth / (0.87 * fyv);
  const minAsvRatio = 0.4 / (0.87 * fyv);
  const maxSpacing = Math.min(0.75 * effectiveDepth, 300);
  const stirrupDiameter = STIRRUP_DIAMETERS.includes(preferredStirrupDiameter) ? preferredStirrupDiameter : 8;
  const legs = 2;
  const asv = legs * barArea(stirrupDiameter);
  const requiredSpacingForShear = vusRequired > 0 ? 0.87 * fyv * asv * effectiveDepth / vusRequired : Infinity;
  const requiredSpacingForMinimum = asv / minAsvPerSv;
  const spacing = Math.min(maxSpacing, requiredSpacingForShear, requiredSpacingForMinimum);
  const providedSpacing = Math.max(50, Math.floor(spacing / 5) * 5);
  const vus = 0.87 * fyv * asv * effectiveDepth / providedSpacing;
  const totalShearResistance = vc + vus;
  const minimumShearRequired = asv / providedSpacing >= minAsvPerSv;
  const concreteShearStatus = tauV <= tauC ? 'ADEQUATE' : 'REINFORCEMENT REQUIRED';
  const maxStressPass = tauV <= tauCMax;
  const capacityPass = vus >= vusRequired;
  const shearReinforcementStatus = capacityPass ? 'PASS' : 'FAIL';
  const maximumShearStressStatus = maxStressPass ? 'PASS' : 'FAIL';
  const maxStirrupPass = providedSpacing <= maxSpacing;
  const overallShearStatus = capacityPass && maxStressPass && minimumShearRequired && maxStirrupPass ? 'PASS' : 'FAIL';
  const minimumShearGoverns = ultimateShear * 1000 <= vc && minimumShearRequired;
  return {
    fyv, pt: round(pt, 3), ptFullPrecision: pt, tauC: round(tauC, 3), tauCFullPrecision: tauC, tauCMax: round(tauCMax), tauCData: { source: tauCData.source, method: tauCData.method, lowerPt: tauCData.lower?.percentage ?? null, lowerTauC: tauCData.lower?.strength ?? null, upperPt: tauCData.upper?.percentage ?? null, upperTauC: tauCData.upper?.strength ?? null }, tauV: round(tauV), vc: round(vc), vuMinusVc: round(vuMinusVc), vusRequired: round(vusRequired),
    stirrupDiameter, legs, asv: round(asv), minAsvPerSv: round(minAsvPerSv, 4), requiredSpacingForShear: round(requiredSpacingForShear),
    requiredSpacingForMinimum: round(requiredSpacingForMinimum), maxSpacing: round(maxSpacing), providedSpacing, vus: round(vus),
    totalShearResistance: round(totalShearResistance), minimumPass: minimumShearRequired,
    providedAsvRatio: round(asv / (breadth * providedSpacing), 6), minimumRequiredAsvRatio: round(minAsvRatio, 6),
    // IS 456:2000 Clause 26.5.1.6 is a pure ratio check on Asv/(b x Sv).
    // `minAsvPerSv` (mm2/mm) is the equivalent spacing-based limit used for sizing only;
    // the reported check must always compare the two dimensionless ratios.
    providedAsvRatioPercent: round(asv / (breadth * providedSpacing) * 100, 4),
    minimumRequiredAsvRatioPercent: round(minAsvRatio * 100, 4),
    providedAsvRatioFullPrecision: asv / (breadth * providedSpacing),
    minimumRequiredAsvRatioFullPrecision: minAsvRatio,
    providedAsvRatioBasis: `Asv = ${round(asv)} mm2 / (b = ${breadth} mm x Sv = ${providedSpacing} mm)`,
    minimumRequiredAsvRatioBasis: `0.4 / (0.87 x fy = ${fyv} N/mm2)`,
    minimumShearGoverns, capacityPass, concreteShearStatus, concreteCapacityPass: tauV <= tauC, maxStressPass,
    maximumShearStressStatus, shearReinforcementStatus, maxStirrupPass, overallShearStatus, recommendedShearStatus: concreteShearStatus,
    recommendation: `${legs}-legged ${stirrupDiameter} mm dia @ ${providedSpacing} mm c/c`,
    finalStatus: overallShearStatus
  };
}

// IS 456:2000 Clause 26.2.1 and Table 5: deformed bars have 60% higher bond stress.
function calculateDevelopmentLength(barDiameter, concreteGrade, steelGrade, span, availableAnchorage = null, geometry = {}) {
  const basicBondStress = { M20: 1.2, M25: 1.4, M30: 1.5, M35: 1.7 }[concreteGrade];
  const deformedBarFactor = 1.6;
  const designBondStress = basicBondStress * deformedBarFactor;
  const designStress = 0.87 * constants.steelGrades[steelGrade].fy;
  const ld = barDiameter * designStress / (4 * designBondStress);
  const specifiedAnchorage = Number(availableAnchorage);
  const supportWidth = Number(geometry.supportWidth ?? geometry.support_width ?? 0);
  const clearCover = Number(geometry.clearCover ?? geometry.cover ?? 0);
  const stirrupDiameter = Number(geometry.stirrupDiameter ?? geometry.stirrup_diameter ?? 0);
  const availableEmbedment = Number(geometry.availableEmbedment ?? geometry.availableEmbedmentLength ?? geometry.embedment ?? 0);
  const supportCondition = geometry.supportCondition || geometry.support_type;
  const terminationInput = geometry.terminationSetbackFromSupportFace ?? geometry.barCurtailmentLocation ?? geometry.curtailmentLocation;
  const barCurtailmentLocation = optionalNumber(terminationInput);
  const clearSpan = Number(geometry.clearSpan);
  const effectiveSpan = Number(geometry.effectiveSpan ?? span);

  let available = Number.isFinite(specifiedAnchorage) && specifiedAnchorage > 0 ? specifiedAnchorage : null;
  let availableSource = available === null ? null : 'Explicit available anchorage input';
  let grossEmbedment = available;
  let anchorageDeduction = 0;
  if (available === null && Number.isFinite(availableEmbedment) && availableEmbedment > 0) {
    // Embedment is entered to the bar termination.  The available straight
    // anchorage excludes the local stirrup/termination clearance.
    anchorageDeduction = stirrupDiameter + Math.max(0, (barDiameter - stirrupDiameter) / 2);
    available = availableEmbedment - anchorageDeduction;
    grossEmbedment = availableEmbedment;
    availableSource = 'Explicit gross embedment input minus stirrup/termination clearance';
  }
  const hasSupportGeometry = Number.isFinite(supportWidth) && supportWidth > 0
    && Number.isFinite(clearSpan) && clearSpan > 0
    && Number.isFinite(effectiveSpan) && effectiveSpan > 0
    && Number.isFinite(barCurtailmentLocation) && barCurtailmentLocation >= 0;
  if (available === null && hasSupportGeometry) {
    const effectiveSupportAnchorage = supportWidth - clearCover - stirrupDiameter - barDiameter / 2 - (barCurtailmentLocation ?? 0);
    available = effectiveSupportAnchorage > 0 ? effectiveSupportAnchorage : null;
    grossEmbedment = supportWidth;
    anchorageDeduction = clearCover + stirrupDiameter + barDiameter / 2 + (barCurtailmentLocation ?? 0);
    availableSource = available === null ? null : 'Support width minus cover, stirrup, bar radius and curtailment distance';
  }

  const verificationRequired = available === null;
  const ratio = !verificationRequired && ld > 0 ? available / ld : null;
  const supportFace = 0;
  const supportFarFace = Number.isFinite(supportWidth) && supportWidth > 0 ? supportWidth : null;
  const reinforcementClearance = clearCover + stirrupDiameter + barDiameter / 2;
  const terminationSetback = Number.isFinite(barCurtailmentLocation) && barCurtailmentLocation >= 0 ? round(barCurtailmentLocation) : null;
  return {
    barDiameter,
    steelGrade,
    concreteGrade,
    basicBondStress,
    deformedBarFactor,
    designBondStress: round(designBondStress),
    designStress: round(designStress),
    ld: round(ld),
    ldRequired: round(ld),
    availableAnchorage: available,
    ldAvailable: available,
    grossEmbedment: grossEmbedment === null ? null : round(grossEmbedment),
    anchorageDeduction: available === null ? null : round(anchorageDeduction),
    availableAnchorageCalculation: available === null ? 'NOT PROVIDED' : `${round(grossEmbedment)} mm gross embedment - ${round(anchorageDeduction)} mm deduction = ${round(available)} mm available anchorage.`,
    anchorageRatio: ratio === null ? null : round(ratio, 4),
    supportCondition: supportCondition || null,
    supportWidth: Number.isFinite(supportWidth) && supportWidth > 0 ? round(supportWidth) : null,
    clearSpan: Number.isFinite(clearSpan) && clearSpan > 0 ? round(clearSpan, 4) : null,
    effectiveSpan: Number.isFinite(effectiveSpan) && effectiveSpan > 0 ? round(effectiveSpan, 4) : null,
    clearCover: Number.isFinite(clearCover) && clearCover > 0 ? round(clearCover) : null,
    stirrupDiameter: Number.isFinite(stirrupDiameter) && stirrupDiameter > 0 ? round(stirrupDiameter) : null,
    barCurtailmentLocation: terminationSetback,
    terminationSetbackFromSupportFace: terminationSetback,
    availableEmbedmentLength: available === null ? null : round(available),
    terminationDefinition: 'Termination setback is measured from the support face toward the span. Zero means the bar continues to the support face; it is not zero embedment.',
    geometry: {
      supportFace,
      supportFarFace,
      barTerminationLocation: terminationSetback,
      reinforcementClearance: Number.isFinite(reinforcementClearance) && reinforcementClearance > 0 ? round(reinforcementClearance) : null,
      physicalEmbedment: available
    },
    availableAnchorageSource: availableSource,
    anchorageAssumption: available === null ? 'Available anchorage cannot be established from the supplied support geometry, embedment and curtailment inputs; verification is required.' : `Available anchorage is established from geometry: ${availableSource}.`,
    verificationRequired,
    pass: !verificationRequired && available >= ld,
    status: verificationRequired ? 'VERIFICATION REQUIRED' : (available >= ld ? 'PASS' : 'FAIL'),
    developmentStatus: verificationRequired ? 'VERIFICATION REQUIRED' : (available >= ld ? 'PASS' : 'FAIL')
  };
}

function calculateTopReinforcement({ breadth, overallDepth, concreteGrade, steelGrade, preferredBarDiameter, clearCover, stirrupDiameter }) {
  const grossArea = breadth * overallDepth;
  const minimumArea = 0.0012 * grossArea;
  const diameterOptions = [8, 10, 12, 16, 20, 25, 28, 32].filter((diameter) => diameter >= Math.min(preferredBarDiameter, 12) || diameter === preferredBarDiameter);
  for (const diameter of diameterOptions) {
    const area = barArea(diameter);
    for (let count = 2; count <= 8; count += 1) {
      const providedArea = count * area;
      const spacing = calculateClearSpacing(breadth, clearCover, stirrupDiameter, diameter, count);
      if (providedArea >= minimumArea && spacing.clearSpacing >= spacing.minimumRequired) {
        return { diameter, count, area: round(providedArea), label: `${count}-${diameter} mm Ø`, status: 'PASS' };
      }
    }
  }

  return {
    diameter: preferredBarDiameter,
    count: 2,
    area: round(2 * barArea(preferredBarDiameter)),
    label: `${2}-${preferredBarDiameter} mm Ø`,
    status: 'VERIFICATION REQUIRED'
  };
}

function interpolateLegacyDeflectionFactor(dataset, ptValue, stressValue) {
  if (!dataset?.curves?.length) return { modificationFactor: NaN, method: 'IS 456 Fig. 4 dataset unavailable' };
  const curves = [...dataset.curves].sort((left, right) => left.fs - right.fs);
  const ptValues = curves[0].points.map((point) => point.pt);
  const clamp = (value, points) => Math.max(points[0], Math.min(points[points.length - 1], value));
  const pt = clamp(ptValue, ptValues);
  const stress = clamp(stressValue, curves.map((curve) => curve.fs));
  const ptIndex = Math.max(0, Math.min(ptValues.length - 2, ptValues.findIndex((value) => value >= pt) - 1));
  const stressIndex = Math.max(0, Math.min(curves.length - 2, curves.findIndex((curve) => curve.fs >= stress) - 1));
  const ptFraction = (pt - ptValues[ptIndex]) / (ptValues[ptIndex + 1] - ptValues[ptIndex]);
  const stressFraction = (stress - curves[stressIndex].fs) / (curves[stressIndex + 1].fs - curves[stressIndex].fs);
  const atLowerPt = curves[stressIndex].points[ptIndex].factor + stressFraction * (curves[stressIndex + 1].points[ptIndex].factor - curves[stressIndex].points[ptIndex].factor);
  const atUpperPt = curves[stressIndex].points[ptIndex + 1].factor + stressFraction * (curves[stressIndex + 1].points[ptIndex + 1].factor - curves[stressIndex].points[ptIndex + 1].factor);
  return {
    modificationFactor: atLowerPt + ptFraction * (atUpperPt - atLowerPt),
    pt, serviceStress: stress,
    ptLower: ptValues[ptIndex], ptUpper: ptValues[ptIndex + 1],
    fsLower: curves[stressIndex].fs, fsUpper: curves[stressIndex + 1].fs,
    ptClamped: pt !== ptValue, fsClamped: stress !== stressValue,
    datasetSource: dataset.source, datasetVersion: dataset.datasetVersion,
    method: 'Bilinear interpolation of the configured IS 456:2000 Fig. 4 dataset; dataset is an approximate digitization.'
  };
}

// IS 456:2000 Clause 23.2.1: basic span/depth ratios with Fig. 4 tension-steel modification.
function calculateDeflection(span, effectiveDepth, supportType, providedAst, requiredAst, breadth, steelGrade) {
  const basicRatio = { 'Simply Supported': 20, Continuous: 26, Cantilever: 7 }[supportType];
  const fy = constants.steelGrades[steelGrade].fy;
  const pt = providedAst * 100 / (breadth * effectiveDepth);
  const serviceStress = 0.58 * fy * requiredAst / providedAst;
  const interpolation = interpolateFig4ModificationFactor(pt, serviceStress);
  const modificationFactor = interpolation.modificationFactor;
  const permissibleLd = Number.isFinite(modificationFactor) ? basicRatio * modificationFactor : null;
  const actualLd = span * 1000 / effectiveDepth;
  const status = interpolation.status === 'VERIFICATION REQUIRED' ? 'VERIFICATION REQUIRED' : (Number.isFinite(actualLd) && Number.isFinite(permissibleLd) && actualLd <= permissibleLd ? 'PASS' : 'FAIL');
  return {
    basicRatio,
    ...interpolation,
    pt: round(pt, 3),
    serviceStress: round(serviceStress, 2),
    compressionReinforcementRatio: 0,
    compressionReinforcementEffect: 'Not applicable: singly reinforced beam with no compression reinforcement input.',
    modificationFactor: Number.isFinite(modificationFactor) ? round(modificationFactor, 4) : null,
    modificationMethod: interpolation.interpolationMethod,
    permissibleLd: Number.isFinite(permissibleLd) ? round(permissibleLd) : null,
    actualLd: round(actualLd),
    pass: status === 'PASS',
    status,
    verificationRequired: status === 'VERIFICATION REQUIRED'
  };
}

function buildCalculationSteps(result) {
  const s = result.shearCalculation;
  const d = result.developmentLength;
  const f = result.momentCapacity;
  const checks = result.checks.map((check) => `${check.name}: ${check.status} (${check.value})`).join('; ');
  return [
    `1. Effective depth: d = D - cover - stirrup - main bar/2 = ${result.overallDepth} - ${result.clearCover} - ${s.stirrupDiameter} - ${result.barDiameter}/2 = ${result.effectiveDepth} mm.`,
    `2. Self-weight: b x D x unit weight = ${result.breadth}/1000 x ${result.overallDepth}/1000 x ${result.unitWeightConcrete} = ${result.selfWeight} kN/m.`,
    `3. Total dead load = self-weight + applied dead load = ${result.selfWeight} + ${result.appliedDeadLoad} = ${result.deadLoad} kN/m.`,
    `4. Service load = dead load + live load = ${result.deadLoad} + ${result.liveLoad} = ${result.serviceLoad} kN/m.`,
    `5. Factored load = 1.5(DL + LL) = ${result.ultimateLoad} kN/m.`,
    `6. Ultimate moment (${result.beamType === 'Continuous' ? `Mu+ = wL²/12 = ${result.ultimateMoment} kN.m; Mu- = wL²/10 = ${result.continuousDesign?.negative.mu ?? 'Not determined'} kN.m` : result.beamType === 'Cantilever' ? 'Mu = wL²/2 at the fixed end' : 'Mu = wL²/8'})${result.beamType === 'Continuous' ? '' : ` = ${result.ultimateMoment} kN.m`}.`,
    `7. Ultimate shear: Vu = wL/2 or wL for cantilever = ${result.ultimateShear} kN.`,
    `8. Mu,lim = 0.36 fck b xu,max (d - 0.42 xu,max) = ${f.muLim} kN.m; xu,max = ${f.xuMaxRatio}d = ${f.xuMax} mm.`,
    `9. Required Ast from Mu = 0.87 fy Ast (d - 0.42 xu), xu = 0.87 fy Ast/(0.36 fck b): ${Number.isFinite(f.requiredAst) ? `${f.requiredAst} mm²` : 'Not determined; the singly reinforced section is inadequate for this moment'}.`,
    `10. Ast,min = 0.85 b d/fy = ${result.minimumReinforcement} mm².`,
    `11. Ast,max = 4% bD = ${result.maximumReinforcement} mm².`,
    `12. Selected bars: ${result.barCount > 0 ? `${result.barCount}-${result.barDiameter} mm dia` : 'Not determined; no bar arrangement satisfies the checks for this input'}; bar area = pi phi²/4 = ${result.barArea} mm².`,
    `13. Ast,provided = n x pi phi²/4 = ${result.barCount} x ${result.barArea} = ${result.providedAreaSteel} mm².`,
    `14. xu = 0.87 fy Ast/(0.36 fck b) = ${f.xu} mm; xu/d = ${f.xuRatio}; xu,max/d = ${f.xuMaxRatio}.`,
    `15. Moment capacity = 0.87 fy Ast (d - 0.42 xu) = ${f.muProvided} kN.m.`,
    `16. pt = 100 Ast/(bd) = 100 x ${result.providedAreaSteel}/(${result.breadth} x ${result.effectiveDepth}) = ${Number.isFinite(s.ptFullPrecision) ? s.ptFullPrecision : 'Not determined'}% (displayed as ${s.pt}%).`,
    `17. tau_v = Vu/(bd) = ${s.tauV} N/mm².`,
    `18. tau_c = IS 456 Table 19 interpolation at pt = ${s.pt}% (between pt=${s.tauCData?.lowerPt ?? 'N/A'}% → tau_c=${s.tauCData?.lowerTauC ?? 'N/A'} and pt=${s.tauCData?.upperPt ?? 'N/A'}% → tau_c=${s.tauCData?.upperTauC ?? 'N/A'}): tau_c = ${s.tauC} N/mm² (Vc computed from unrounded internal tau_c = ${Number.isFinite(s.tauCFullPrecision) ? round(s.tauCFullPrecision, 6) : 'Not determined'} N/mm²).`,
    `19. tau_c,max from IS 456 Table 20 for ${result.concreteGrade} = ${s.tauCMax} N/mm².`,
    `20. Vc = tau_c × b × d = ${s.vc} N (computed from unrounded interpolated tau_c = ${Number.isFinite(s.tauCFullPrecision) ? round(s.tauCFullPrecision, 6) : 'Not determined'} N/mm²; displayed tau_c = ${s.tauC} N/mm², b = ${result.breadth} mm, d = ${result.effectiveDepth} mm).`,
    `21. Vu - Vc = ${s.vuMinusVc} N; Vus_required = max(0, Vu - Vc) = ${s.vusRequired} N.`,
    `22. Provided Asv = ${s.legs} x pi x ${s.stirrupDiameter}²/4 = ${s.asv} mm² at Sv = ${s.providedSpacing} mm.`,
    `23. Vus_provided = 0.87 fyv Asv d/Sv = ${s.vus} N; Vc + Vus_provided = ${s.totalShearResistance} N.`,
    `24. Maximum stirrup spacing = min(0.75d, 300) = ${s.maxSpacing} mm; provided = ${s.providedSpacing} mm.`,
    `25. Minimum shear reinforcement (IS 456:2000 Clause 26.5.1.6): Asv/(b x Sv) = ${s.providedAsvRatio} (${s.providedAsvRatioPercent}% of the section area) against 0.4/(0.87 fy) = ${s.minimumRequiredAsvRatio} (${s.minimumRequiredAsvRatioPercent}%); the check compares these two dimensionless ratios and it ${s.providedAsvRatio >= s.minimumRequiredAsvRatio ? 'PASSES' : 'FAILS'}.`,
    `26. Development: tau_bd = ${d.basicBondStress} x ${d.deformedBarFactor} = ${d.designBondStress} N/mm²; Ld = phi x 0.87fy/(4 tau_bd) = ${d.ld} mm.`,
    `27. Anchorage: available = ${d.availableAnchorage !== null && d.availableAnchorage !== undefined ? `${d.availableAnchorage} mm` : 'Not determined'}; status = ${d.status}.`,
    `28. Deflection: actual L/d = ${result.deflectionCheck.actualLd}; permissible = ${result.deflectionCheck.permissibleLd !== null && result.deflectionCheck.permissibleLd !== undefined ? `${result.deflectionCheck.basicRatio} x ${result.deflectionCheck.modificationFactor} = ${result.deflectionCheck.permissibleLd}` : 'Not determined'}.`,
    `29. Final checks: ${checks}.`,
    `30. Final design status: ${result.designStatus}.`
  ].map((value, index) => ({ step: index + 1, description: value.split(':')[0], value }));
}

export function generateBeamDesign(values) {
  validateBeamInputs(values);
  const length = toNumber(values.length);
  const breadth = toNumber(values.breadth);
  const overallDepth = toNumber(values.overallDepth);
  const clearCover = toNumber(values.clearCover);
  const concreteGrade = values.concreteGrade;
  const steelGrade = values.steelGrade;
  const preferredBarDiameter = toNumber(values.preferredBarDiameter);
  const stirrupDiameter = STIRRUP_DIAMETERS.includes(toNumber(values.stirrupDiameter)) ? toNumber(values.stirrupDiameter) : 8;
  const unitWeightConcrete = toNumber(values.unitWeightConcrete);
  const spanData = calculateEffectiveSpan(values, length);
  const designSpan = spanData.span;
  const loads = calculateLoads(length, breadth, overallDepth, toNumber(values.deadLoad), toNumber(values.liveLoad), unitWeightConcrete);
  const moments = calculateMoment(values.supportType, designSpan, loads.ultimateLoad);
  const trialDepth = calculateEffectiveDepth(overallDepth, clearCover, stirrupDiameter, preferredBarDiameter);
  const trialFlexure = calculateFlexuralDesign({ moment: moments.positiveMoment, breadth, overallDepth, effectiveDepth: trialDepth, concreteGrade, steelGrade, providedArea: 0 });
  const selected = selectMainReinforcement({ requiredAst: trialFlexure.requiredAst, minimumAst: trialFlexure.minimumReinforcement, maximumAst: trialFlexure.maximumReinforcement, preferredDiameter: preferredBarDiameter, breadth, cover: clearCover, stirrupDiameter, overallDepth, moment: moments.positiveMoment, concreteGrade, steelGrade });
  const verificationRequired = !selected;
  const barDiameter = selected?.diameter || preferredBarDiameter;
  const barCount = selected?.count || 0;
  const effectiveDepth = selected?.effectiveDepth || trialDepth;
  const providedAst = selected?.providedAst || 0;
  const flexure = calculateFlexuralDesign({ moment: moments.positiveMoment, breadth, overallDepth, effectiveDepth, concreteGrade, steelGrade, providedArea: providedAst });
  const negativeTrial = values.supportType === 'Continuous'
    ? calculateFlexuralDesign({ moment: moments.negativeMoment, breadth, overallDepth, effectiveDepth: trialDepth, concreteGrade, steelGrade, providedArea: 0 }) : null;
  const selectedTop = values.supportType === 'Continuous'
    ? selectMainReinforcement({ requiredAst: negativeTrial.requiredAst, minimumAst: negativeTrial.minimumReinforcement, maximumAst: negativeTrial.maximumReinforcement, preferredDiameter: preferredBarDiameter, breadth, cover: clearCover, stirrupDiameter, overallDepth, moment: moments.negativeMoment, concreteGrade, steelGrade }) : null;
  const topReinforcement = values.supportType === 'Continuous'
    ? (selectedTop ? { diameter: selectedTop.diameter, count: selectedTop.count, area: round(selectedTop.providedAst), label: `${selectedTop.count}-${selectedTop.diameter} mm Ø`, status: 'PASS' } : { status: 'VERIFICATION REQUIRED', label: 'VERIFICATION REQUIRED' })
    : calculateTopReinforcement({ breadth, overallDepth, concreteGrade, steelGrade, preferredBarDiameter: barDiameter, clearCover, stirrupDiameter });
  const negativeFlexure = values.supportType === 'Continuous'
    ? calculateFlexuralDesign({ moment: moments.negativeMoment, breadth, overallDepth, effectiveDepth: selectedTop?.effectiveDepth || trialDepth, concreteGrade, steelGrade, providedArea: selectedTop?.providedAst || 0 }) : null;
  const shear = calculateShearDesign({ breadth, effectiveDepth, ultimateShear: moments.ultimateShear, concreteGrade, steelGrade, providedAst, preferredStirrupDiameter: stirrupDiameter });
  const development = calculateDevelopmentLength(barDiameter, concreteGrade, steelGrade, designSpan, values.availableAnchorage, {
    supportWidth: spanData.supportWidth,
    clearSpan: spanData.clearSpan,
    effectiveSpan: designSpan,
    clearCover,
    stirrupDiameter,
    availableEmbedment: values.availableEmbedmentLength ?? values.availableEmbedment,
    supportCondition: values.supportCondition || values.supportType,
    terminationSetbackFromSupportFace: values.terminationSetbackFromSupportFace ?? values.barCurtailmentLocation,
    cover: clearCover
  });
  const deflection = calculateDeflection(designSpan, effectiveDepth, values.supportType, flexure.providedAst, flexure.requiredAst, breadth, steelGrade);
  const spacingPass = selected ? selected.spacing.clearSpacing >= selected.spacing.minimumRequired : false;
  const standardCheck = (name, passed, actual, limit, message, clause, verification = false, statusOverride = null) => {
    const effectiveStatus = statusOverride || (passed ? (verification ? 'VERIFICATION REQUIRED' : 'PASS') : 'FAIL');
    return { name, check_name: name, status: effectiveStatus, statusCode: effectiveStatus.replaceAll(' ', '_'), actual_value: actual, actual, limit_value: limit, limit, utilization: Number.isFinite(actual) && Number.isFinite(limit) && limit !== 0 ? round(actual / limit, 4) : null, message, explanation: message, value: message, unit: '', severity: 'MANDATORY', codeReference: clause, clause };
  };
  const checkEntries = [
    standardCheck('Flexural capacity', flexure.muProvided >= moments.ultimateMoment && flexure.underReinforced, flexure.muProvided, moments.ultimateMoment, `${flexure.muProvided} kN.m >= ${moments.ultimateMoment} kN.m`, 'IS 456:2000 Clauses 38.1 and 38.2', verificationRequired),
    standardCheck('Minimum steel', providedAst >= flexure.minimumReinforcement, providedAst, flexure.minimumReinforcement, `${round(providedAst)} mm² >= ${flexure.minimumReinforcement} mm²`, 'IS 456:2000 Clause 26.5.1.1', verificationRequired),
    standardCheck('Maximum steel', providedAst <= flexure.maximumReinforcement, providedAst, flexure.maximumReinforcement, `${round(providedAst)} mm² <= ${flexure.maximumReinforcement} mm²`, 'IS 456:2000 Clause 26.5.1.1', verificationRequired),
    standardCheck('Under-reinforced section', flexure.underReinforced, flexure.xu, flexure.xuMax, `${flexure.xu} mm <= ${flexure.xuMax} mm`, 'IS 456:2000 Clause 38.1', verificationRequired),
    standardCheck('Longitudinal spacing', spacingPass, selected?.spacing.clearSpacing ?? NaN, MIN_CLEAR_SPACING, `${selected?.spacing.clearSpacing ?? 'N/A'} mm >= ${MIN_CLEAR_SPACING} mm`, 'IS 456:2000 Clause 26.3.3', verificationRequired),
    standardCheck('Concrete shear capacity', true, shear.tauV, shear.tauC, `${shear.tauV} versus ${shear.tauC}: ${shear.concreteShearStatus}`, 'IS 456:2000 Table 19'),
    standardCheck('Maximum shear stress', shear.maxStressPass, shear.tauV, shear.tauCMax, `${shear.tauV} N/mm² <= ${shear.tauCMax} N/mm²`, 'IS 456:2000 Table 20'),
    standardCheck('Minimum shear reinforcement', shear.providedAsvRatio >= shear.minimumRequiredAsvRatio, shear.providedAsvRatio, shear.minimumRequiredAsvRatio, `Asv/(b x Sv) = ${shear.providedAsvRatio} >= 0.4/(0.87 fy) = ${shear.minimumRequiredAsvRatio}`, 'IS 456:2000 Clause 26.5.1.6'),
    standardCheck('Stirrup capacity', shear.capacityPass, shear.totalShearResistance, moments.ultimateShear * 1000, `${shear.totalShearResistance} N >= ${moments.ultimateShear * 1000} N`, 'IS 456:2000 Clause 40.4'),
    standardCheck('Maximum stirrup spacing', shear.providedSpacing <= shear.maxSpacing, shear.providedSpacing, shear.maxSpacing, `${shear.providedSpacing} mm <= ${shear.maxSpacing} mm`, 'IS 456:2000 Clause 26.5.1.5'),
    standardCheck('Deflection', deflection.pass, deflection.actualLd, deflection.permissibleLd, `${Number.isFinite(deflection.actualLd) ? deflection.actualLd : 'Not determined'} <= ${deflection.permissibleLd ?? 'Not determined'}`, 'IS 456:2000 Clause 23.2', deflection.verificationRequired, deflection.status),
    standardCheck('Development length', development.pass, development.ld, development.availableAnchorage, `${development.ld} mm <= ${development.availableAnchorage ?? 'N/A'} mm`, 'IS 456:2000 Clause 26.2', development.verificationRequired, development.status),
    standardCheck('Anchorage adequacy', development.pass, development.ld, development.availableAnchorage, `Ld required ${development.ld} mm; available anchorage ${development.availableAnchorage !== null && development.availableAnchorage !== undefined ? `${development.availableAnchorage} mm` : 'NOT PROVIDED'}`, 'IS 456:2000 Clause 26.2', development.verificationRequired, development.status)
  ];
  if (values.supportType === 'Continuous') {
    checkEntries.splice(1, 0,
      standardCheck('Negative/support flexural capacity', negativeFlexure.muProvided >= moments.negativeMoment && negativeFlexure.underReinforced, negativeFlexure.muProvided, moments.negativeMoment, `${negativeFlexure.muProvided} kN.m >= ${moments.negativeMoment} kN.m`, 'IS 456:2000 Clauses 38.1 and 38.2', !selectedTop),
      standardCheck('Negative/support minimum steel', negativeFlexure.providedAst >= negativeFlexure.minimumReinforcement, negativeFlexure.providedAst, negativeFlexure.minimumReinforcement, `${negativeFlexure.providedAst} mm2 >= ${negativeFlexure.minimumReinforcement} mm2`, 'IS 456:2000 Clause 26.5.1.1', !selectedTop),
      standardCheck('Negative/support under-reinforced section', negativeFlexure.underReinforced, negativeFlexure.xu, negativeFlexure.xuMax, `${negativeFlexure.xu} mm <= ${negativeFlexure.xuMax} mm`, 'IS 456:2000 Clause 38.1', !selectedTop)
    );
  }
  const finalChecks = Object.fromEntries(checkEntries.map((check) => [
    check.name.replace(/[^a-zA-Z0-9]+(.)/g, (_, character) => character.toUpperCase()).replace(/^[A-Z]/, (character) => character.toLowerCase()),
    { status: check.status, actual: check.actual, limit: check.limit, reason: check.message, clause: check.clause }
  ]));
  const hasFail = checkEntries.some((check) => check.status === 'FAIL');
  const hasVerificationRequired = checkEntries.some((check) => check.status === 'VERIFICATION REQUIRED');
  const designStatus = hasFail ? 'FAIL' : hasVerificationRequired ? 'VERIFICATION REQUIRED' : 'PASS';
  const reinforcement = {
    flexuralModel: values.supportType === 'Continuous' ? 'Continuous beam: separately designed positive span and negative support regions' : 'Singly reinforced section',
    bottomBars: selected
      ? {
          barCount, diameter: barDiameter, area: round(providedAst), label: `${barCount}-${barDiameter} mm Ø`,
          // Physical tension steel sits at the bottom for Simply Supported/Continuous beams,
          // but at the TOP for Cantilever beams (hogging at the fixed support).
          face: values.supportType === 'Cantilever' ? 'top' : 'bottom',
          structuralRole: 'tension',
          role: values.supportType === 'Cantilever' ? 'Top flexural tension reinforcement' : 'Bottom flexural reinforcement'
        }
      : {
          status: 'VERIFICATION REQUIRED',
          face: values.supportType === 'Cantilever' ? 'top' : 'bottom',
          structuralRole: 'tension',
          role: values.supportType === 'Cantilever' ? 'Top flexural tension reinforcement' : 'Bottom flexural reinforcement'
        },
    topBars: {
      ...topReinforcement,
      // Cantilever bottom detailing steel (topBars content) sits at the bottom face.
      face: values.supportType === 'Cantilever' ? 'bottom' : 'top',
      structuralRole: values.supportType === 'Continuous' ? 'tension' : 'hanger/detailing',
      role: values.supportType === 'Continuous' ? 'Top negative-moment/support flexural reinforcement' : 'Top detailing/hanger reinforcement; not flexurally designed compression reinforcement'
    },
    stirrups: {
      diameter: shear.stirrupDiameter,
      legs: shear.legs,
      area: shear.asv,
      spacing: shear.providedSpacing,
      maximumSpacing: shear.maxSpacing,
      requiredShearCapacity: shear.vusRequired,
      providedShearCapacity: shear.vus,
      label: shear.recommendation,
      role: 'Shear reinforcement'
    },
    cover: round(clearCover),
    developmentLength: development.ldRequired,
    availableAnchorage: development.ldAvailable,
    grossEmbedment: development.grossEmbedment,
    anchorageDeduction: development.anchorageDeduction,
    availableAnchorageCalculation: development.availableAnchorageCalculation,
    anchorageRatio: development.anchorageRatio,
    anchorageStatus: development.developmentStatus,
    terminationLocation: development.terminationSetbackFromSupportFace,
    terminationSetbackFromSupportFace: development.terminationSetbackFromSupportFace,
    availableEmbedmentLength: development.availableEmbedmentLength,
    anchorageGeometry: development.geometry
  };
  const result = {
    designType: 'Beam', beamType: values.supportType, reinforcementCategory: 'Singly Reinforced', length: round(length), designSpan: round(designSpan), clearSpan: spanData.clearSpan === null ? null : round(spanData.clearSpan), supportWidth: spanData.supportWidth === null ? null : round(spanData.supportWidth), breadth: round(breadth, 0), overallDepth: round(overallDepth, 0), clearCover: round(clearCover), stirrupDiameter,
    effectiveDepth: round(effectiveDepth), unitWeightConcrete: round(unitWeightConcrete), selfWeight: loads.selfWeight, appliedDeadLoad: round(toNumber(values.deadLoad)), deadLoad: loads.deadLoad, totalDeadLoad: loads.deadLoad, serviceLoad: loads.serviceLoad, liveLoad: loads.liveLoad, ultimateLoad: loads.ultimateLoad, factoredLoad: loads.ultimateLoad, ultimateMoment: moments.ultimateMoment, ultimateShear: moments.ultimateShear,
    concreteGrade, steelGrade, spanDefinition: spanData.definition, spanMode: spanData.mode, spanSource: spanData.spanSource, requiredAreaSteel: flexure.requiredAst, minimumReinforcement: flexure.minimumReinforcement, maximumReinforcement: flexure.maximumReinforcement, barDiameter, barCount, barArea: round(barArea(barDiameter)), barSpacing: null, providedAreaSteel: round(providedAst), mainReinforcement: selected ? `${barCount}-${barDiameter} mm Ø` : 'VERIFICATION REQUIRED', bottomReinforcement: selected ? `${barCount}-${barDiameter} mm Ø` : 'VERIFICATION REQUIRED', topReinforcement: topReinforcement.label, compressionReinforcement: 'Not required for the singly reinforced flexural model.', availableWidthBetweenStirrups: selected?.spacing.availableWidth ?? null, minimumClearSpacing: MIN_CLEAR_SPACING, clearSpacingBetweenBars: selected ? selected.spacing.clearSpacing : null,
    shearStatus: shear.overallShearStatus, shearReinforcement: shear.recommendation,
    shearCalculation: {
      vu: moments.ultimateShear * 1000,
      d: effectiveDepth,
      tauv: shear.tauV,
      tauV: shear.tauV,
      ast: round(providedAst),
      pt: shear.pt,
      ptFullPrecision: shear.ptFullPrecision,
      tauC: shear.tauC,
      tauCFullPrecision: shear.tauCFullPrecision,
      tauCData: shear.tauCData,
      tauCMax: shear.tauCMax,
      vc: shear.vc,
      vuMinusVc: shear.vuMinusVc,
      vusRequired: shear.vusRequired,
      vus: shear.vus,
      vusProvided: shear.vus,
      totalShearResistance: shear.totalShearResistance,
      minimumShearGoverns: shear.minimumShearGoverns,
      providedAsvRatio: shear.providedAsvRatio,
      providedAsvRatioPercent: shear.providedAsvRatioPercent,
      minimumRequiredAsvRatio: shear.minimumRequiredAsvRatio,
      minimumRequiredAsvRatioPercent: shear.minimumRequiredAsvRatioPercent,
      minimumPass: shear.minimumPass,
      minimumShearFormula: `Asv/(b x Sv) = ${shear.providedAsvRatio} >= 0.4/(0.87 fy) = ${shear.minimumRequiredAsvRatio}`,
      minimumShearProvidedRatio: shear.providedAsvRatio,
      minimumShearRequiredRatio: shear.minimumRequiredAsvRatio,
      shearPass: shear.overallShearStatus === 'PASS',
      minShearPass: shear.providedAsvRatio >= shear.minimumRequiredAsvRatio,
      maxStirrupPass: shear.maxStirrupPass,
      stirrupDiameter: shear.stirrupDiameter,
      legs: shear.legs,
      asv: shear.asv,
      providedAsv: shear.asv,
      providedSpacing: shear.providedSpacing,
      maxSpacing: shear.maxSpacing
    },
    minimumShearReinforcement: {
      minimumAreaPerSpacing: shear.minAsvPerSv,
      providedArea: shear.asv,
      providedSpacing: shear.providedSpacing,
      providedRatio: shear.providedAsvRatio,
      requiredRatio: shear.minimumRequiredAsvRatio,
      providedRatioPercent: round(shear.providedAsvRatio * 100, 4),
      requiredRatioPercent: round(shear.minimumRequiredAsvRatio * 100, 4),
      formula: `Asv/(b x Sv) = ${shear.providedAsvRatio} >= 0.4/(0.87 fy) = ${shear.minimumRequiredAsvRatio}`,
      checkPass: shear.providedAsvRatio >= shear.minimumRequiredAsvRatio
    },
    maximumStirrupSpacing: { maxPermissible: shear.maxSpacing, provided: shear.providedSpacing, checkPass: shear.providedSpacing <= shear.maxSpacing },
    developmentLength: { ...development, checkPass: development.pass },
    developmentLengthRequired: development.ldRequired,
    developmentLengthAvailable: development.ldAvailable,
    anchorageRatio: development.anchorageRatio,
    developmentStatus: development.developmentStatus,
    supportGeometry: {
      supportCondition: development.supportCondition,
      clearSpan: development.clearSpan,
      effectiveSpan: development.effectiveSpan,
      supportFace: development.geometry.supportFace,
      supportFarFace: development.geometry.supportFarFace,
      supportWidth: development.supportWidth,
      clearCover: development.clearCover,
      stirrupDiameter: development.stirrupDiameter,
      barDiameter: development.barDiameter,
      reinforcementClearance: development.geometry.reinforcementClearance,
      availableEmbedmentLength: development.availableEmbedmentLength,
      availableAnchorageSource: development.availableAnchorageSource
    },
    terminationGeometry: {
      terminationSetbackFromSupportFace: development.terminationSetbackFromSupportFace,
      barTerminationLocation: development.geometry.barTerminationLocation,
      definition: development.terminationDefinition
    },
    geometry: { span: round(designSpan), breadth: round(breadth, 0), overallDepth: round(overallDepth, 0), clearCover: round(clearCover) },
    loads: { selfWeight: loads.selfWeight, superimposedDeadLoad: round(toNumber(values.deadLoad)), totalDeadLoad: loads.deadLoad, liveLoad: loads.liveLoad, serviceLoad: loads.serviceLoad, factoredLoad: loads.ultimateLoad },
    reinforcement,
    reinforcementCage: reinforcement,
    deflectionCheck: { ...deflection, checkPass: deflection.pass },
    momentCapacity: {
      fck: flexure.fck,
      fy: flexure.fy,
      astProvided: flexure.providedAst,
      requiredAst: flexure.requiredAst,
      xu: flexure.xu,
      xuMax: flexure.xuMax,
      xuMaxRatio: flexure.xuMaxRatio,
      xuRatio: flexure.xuRatio,
      muLim: flexure.muLim,
      muProvided: flexure.muProvided,
      designMoment: moments.ultimateMoment,
      checkPass: flexure.muProvided >= moments.ultimateMoment && flexure.underReinforced
    },
    deflectionStatus: deflection.status, designStatus, finalStatus: designStatus, finalChecks, anchorageReason: development.anchorageAssumption, checks: checkEntries, muLim: flexure.muLim, momentCapacityStatus: flexure.muProvided >= moments.ultimateMoment ? 'Capacity >= design moment' : 'Capacity < design moment', actualLd: deflection.actualLd, permissibleLd: deflection.permissibleLd,
    designLimitations: ['Only singly reinforced flexural design is implemented. Top bars are hanger/detailing bars except for the separately designed negative-support region of the continuous-beam model.']
  };
  result.analysisModel = moments.model;
  result.continuousDesign = values.supportType === 'Continuous' ? {
    positive: { mu: round(moments.positiveMoment), requiredAst: flexure.requiredAst, providedAst: flexure.providedAst, momentCapacity: flexure.muProvided, underReinforced: flexure.underReinforced, reinforcement: `${barCount}-${barDiameter} mm` },
    negative: { mu: round(moments.negativeMoment), requiredAst: negativeFlexure.requiredAst, providedAst: negativeFlexure.providedAst, momentCapacity: negativeFlexure.muProvided, underReinforced: negativeFlexure.underReinforced, reinforcement: topReinforcement.label }
  } : null;
  result.shearStatus = shear.overallShearStatus;
  result.shearCalculation.concreteShearStatus = shear.concreteShearStatus;
  result.shearCalculation.concreteCapacityPass = shear.concreteCapacityPass;
  result.shearCalculation.shearReinforcementStatus = shear.shearReinforcementStatus;
  result.shearCalculation.maxStressPass = shear.maxStressPass;
  result.shearCalculation.maximumShearStressStatus = shear.maximumShearStressStatus;
  result.shearCalculation.overallShearStatus = shear.overallShearStatus;
  result.shearCalculation.shearPass = shear.overallShearStatus === 'PASS';
  result.checks = result.checks.map((check) => ({ ...check, check_name: check.check_name || check.name, actual_value: check.actual_value ?? check.actual, limit_value: check.limit_value ?? check.limit }));
  result.calculationSteps = buildCalculationSteps(result);
  // Final result boundary: the JavaScript result must agree with its JSON/API representation, where
  // only finite numbers can exist. Non-finite numeric leaves become null (never 0, never NaN), and
  // designStatus/finalStatus logic above is untouched.
  return normalizeNonFiniteNumbers(result);
}
