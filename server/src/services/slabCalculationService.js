import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { interpolateFig4ModificationFactor } from './fig4Dataset.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const constantsPath = path.join(__dirname, '..', 'constants', 'designConstants.json');
const constants = JSON.parse(fs.readFileSync(constantsPath, 'utf8'));

const round = (value, digits = 4) => Number(Number(value).toFixed(digits));
const nullableRound = (value, digits = 4) => value === null || value === undefined ? null : round(value, digits);
const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};
const normalizeDimension = (value, defaultUnit = 'mm') => {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  if (defaultUnit === 'm' && numeric < 1) return numeric * 1000;
  return numeric;
};

const isFinitePositive = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
};

function requirePositiveInput(values, field) {
  if (!isFinitePositive(values[field])) {
    throw new Error(`${field} must be a finite value greater than zero.`);
  }
  return Number(values[field]);
}

function getConcreteProperties(grade) {
  const concrete = constants.concreteGrades[grade];
  if (!concrete) throw new Error(`Unsupported concrete grade: ${grade}`);
  return concrete;
}

function getSteelProperties(grade) {
  const steel = constants.steelGrades[grade];
  if (!steel) throw new Error(`Unsupported steel grade: ${grade}`);
  return steel;
}

/** The restrained/Table 26 two-way limit under IS 456:2000 Annex D-1.11. */
export const TWO_WAY_LIMIT = 2;

function determineSlabType(length, width, coefficientTable) {
  const longer = Math.max(length, width);
  const shorter = Math.min(length, width);
  const ratio = longer / shorter;
  const isTable27 = coefficientTable?.tableId === 'IS_456_TABLE_27';
  const finitePoints = coefficientTable?.points?.filter((point) => Number.isFinite(point.m)) ?? [];
  const finiteCoefficientLimit = isTable27 && finitePoints.length ? finitePoints[finitePoints.length - 1].m : null;
  const isTwoWay = isTable27 || ratio <= TWO_WAY_LIMIT;
  const twoWayLimit = isTable27 ? null : TWO_WAY_LIMIT;
  const criterion = isTable27
    ? `IS 456:2000 Annex D-2.1 / Table 27 applies to this simply supported, free-to-lift panel. Finite coefficient interpolation is supported only through ly/lx = ${finiteCoefficientLimit}; higher finite ratios require verification because the infinity column is not a finite interpolation endpoint.`
    : `IS 456:2000 Annex D-1.11 / Table 26: two-way when ly/lx <= ${TWO_WAY_LIMIT}; one-way when ly/lx > ${TWO_WAY_LIMIT}.`;
  return {
    slabType: isTwoWay ? 'Two Way Slab' : 'One Way Slab',
    isTwoWay,
    isOneWay: !isTwoWay,
    aspectRatio: round(ratio, 3),
    aspectRatioExact: ratio,
    criterion,
    twoWayLimit,
    finiteCoefficientLimit,
    shortSpan: round(shorter, 3),
    longSpan: round(longer, 3)
  };
}

/**
 * Effective span for a simply supported slab, IS 456:2000 Clause 22.2.
 *
 * The effective span is the lesser of:
 *   (a) the clear span plus the effective depth, and
 *   (b) the centre-to-centre distance between supports.
 *
 * The supplied Length/Width are the CENTRE-TO-CENTRE support spans, so the clear
 * span is the centre-to-centre span less the support width. Both candidates are
 * returned so the comparison is explicit in the calculation trace rather than
 * implied by a single maximum expression.
 */
function calculateEffectiveSpan(totalSpan, supportThickness, supportType) {
  const spanValue = toNumber(totalSpan);
  const supportWidth = toNumber(supportThickness);

  if (spanValue <= 0) {
    throw new Error('Slab span must be positive');
  }

  const centreToCentreM = spanValue;
  const clearSpan = Math.max(spanValue - supportWidth / 1000, 0);

  // For a simply supported slab, Clause 22.2 compares clear span + effective depth
  // against the centre-to-centre support distance and takes the lesser.
  // The effective depth is not yet known at this point in the iteration, so the
  // comparison is completed in resolveEffectiveSpan() once the bar size is adopted.
  const method = supportType === 'Simply Supported'
    ? 'IS 456:2000 Clause 22.2: Leff = min(clear span + effective depth, centre-to-centre support span). Length/Width are the centre-to-centre support spans.'
    : supportType === 'Continuous'
      ? 'IS 456:2000 Clause 22.2: effective span is taken between centre lines of supports; support width is used to determine the clear span before validation.'
      : supportType === 'Cantilever'
        ? 'IS 456:2000 Clause 22.2: cantilever effective span is measured from face of support to free end.'
        : 'IS 456:2000 effective span method';

  return {
    clearSpan: round(clearSpan, 4),
    supportWidth: round(supportWidth / 1000, 4),
    centreToCentreSpan: round(centreToCentreM, 4),
    effectiveSpan: round(centreToCentreM, 4),
    method
  };
}

/**
 * Complete the Clause 22.2 comparison once the effective depth is known, and return
 * the explicit substitution text for the calculation trace.
 */
function resolveEffectiveSpan(spanData, effectiveDepthMm) {
  const clearSpan = spanData.clearSpan;
  const d = Number(effectiveDepthMm) / 1000;
  const clearPlusDepth = clearSpan + d;
  const centreToCentre = spanData.centreToCentreSpan;
  const effectiveSpan = Math.min(clearPlusDepth, centreToCentre);
  const governing = clearPlusDepth <= centreToCentre ? 'clear span + effective depth' : 'centre-to-centre support span';
  return {
    ...spanData,
    effectiveSpan: round(effectiveSpan, 4),
    clearSpanPlusDepth: round(clearPlusDepth, 4),
    governingEffectiveSpanBasis: governing,
    formula: 'Leff = min(clear span + d, centre-to-centre support span)',
    substitution: `clear span = ${round(clearSpan, 3)} m; d = ${Number(effectiveDepthMm).toFixed(0)} mm = ${round(d, 3)} m; `
      + `clear span + d = ${round(clearPlusDepth, 3)} m; centre-to-centre = ${round(centreToCentre, 3)} m; `
      + `Leff = min(${round(clearPlusDepth, 3)}, ${round(centreToCentre, 3)}) = ${round(effectiveSpan, 3)} m `
      + `(governed by the ${governing})`
  };
}

function normalizeSupportThickness(value) {
  if (!isFinitePositive(value)) {
    throw new Error('Support or wall thickness must be a finite value greater than zero.');
  }
  const numeric = Number(value);
  return numeric < 1 ? numeric * 1000 : numeric;
}

function calculateEffectiveDepth(slabThicknessMm, clearCoverMm, barDiameterMm) {
  const D = toNumber(slabThicknessMm);
  const cover = toNumber(clearCoverMm);
  const phi = toNumber(barDiameterMm);

  if (D <= 0 || cover <= 0 || phi <= 0) {
    throw new Error('Slab thickness, clear cover, and bar diameter must be positive.');
  }
  if (cover >= D) {
    throw new Error('Clear cover cannot be greater than or equal to slab thickness.');
  }

  const effectiveDepth = D - cover - phi / 2;
  if (effectiveDepth <= 0) {
    throw new Error('Effective depth is not valid for the selected cover and bar diameter.');
  }

  return round(effectiveDepth, 2);
}

function calculateLoads(values) {
  const slabThicknessM = toNumber(values.slabThickness) / 1000;
  const unitWeight = toNumber(values.unitWeightConcrete);
  const floorFinish = toNumber(values.floorFinishLoad);
  const liveLoad = toNumber(values.liveLoad);

  const selfWeight = slabThicknessM * unitWeight;
  const deadLoad = selfWeight + floorFinish;
  const serviceLoad = deadLoad + liveLoad;
  const ultimateLoad = 1.5 * deadLoad + 1.5 * liveLoad;

  return {
    selfWeight: round(selfWeight, 4),
    floorFinish: round(floorFinish, 4),
    liveLoad: round(liveLoad, 4),
    deadLoad: round(deadLoad, 4),
    serviceLoad: round(serviceLoad, 4),
    ultimateLoad: round(ultimateLoad, 4)
  };
}

/**
 * Explicit support-condition to IS 456 coefficient-table resolution.
 *
 * A slab that is simply supported on all four sides with corners free to lift is
 * covered by IS 456:2000 Table 27. Table 26 applies to slabs whose corners are
 * restrained against uplift (held down). Selecting the table by an unambiguous
 * support condition keeps the two datasets from being silently interchanged.
 */
export function resolveTwoWayCoefficientTable(supportType, cornerRestraint) {
  const tables = constants.twoWayMomentCoefficientTables;
  if (!tables || !tables.IS_456_TABLE_26 || !tables.IS_456_TABLE_27) {
    throw new Error('IS 456 two-way moment coefficient tables are not available in the design constants.');
  }

  const simplySupported = supportType === 'Simply Supported';
  const freeToLift = cornerRestraint === 'FREE_TO_LIFT';

  const tableId = simplySupported && freeToLift ? 'IS_456_TABLE_27' : 'IS_456_TABLE_26';
  const table = tables[tableId];

  return {
    tableId,
    tableReference: table.tableReference,
    momentConvention: table.momentConvention,
    appliesWhen: table.appliesWhen,
    tabulationNote: table.tabulationNote ?? null,
    points: table.points,
    reason: simplySupported && freeToLift
      ? 'Support type is Simply Supported and the corner restraint is FREE_TO_LIFT, so the IS 456:2000 Table 27 coefficients apply. Table 26 is not applicable to this support condition.'
      : `Support type ${supportType} with corner restraint ${cornerRestraint} is not the simply supported free-to-lift case, so the IS 456:2000 Table 26 coefficients apply.`,
    ruledOut: simplySupported && freeToLift ? 'IS 456:2000 Table 26 is not used for a simply supported slab with corners free to lift.' : null
  };
}

/**
 * Interpolate the two-way moment coefficients from the selected IS 456 table.
 * Only published rows are stored in the dataset, so intermediate aspect ratios are
 * linearly interpolated between the two adjacent published rows and the bracket is
 * reported so the calculation trace can show exactly which rows were used.
 */
export function getTwoWayCoefficients(aspectRatio, coefficientTable) {
  const points = coefficientTable?.points;
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error(`IS 456 coefficient table ${coefficientTable?.tableId ?? 'unknown'} has no usable tabulated rows.`);
  }

  const tableReference = coefficientTable.tableReference;
  const isTable27 = coefficientTable.tableId === 'IS_456_TABLE_27';
  const normalizedPoints = points.map((point) => ({
    ...point,
    m: point.m === 'Infinity' ? Infinity : Number(point.m)
  }));
  const infinityPoint = isTable27 ? normalizedPoints.find((point) => point.m === Infinity) : null;
  if (isTable27 && aspectRatio === Infinity && infinityPoint) {
    return {
      coefficientShort: infinityPoint.alphaX,
      coefficientLong: infinityPoint.alphaY,
      tableId: coefficientTable.tableId,
      tableReference,
      momentConvention: coefficientTable.momentConvention,
      lowerM: Infinity,
      upperM: Infinity,
      interpolationFraction: 0,
      source: `${tableReference}: exact published infinity column.`
    };
  }

  const finitePoints = normalizedPoints.filter((point) => Number.isFinite(point.m));
  if (!finitePoints.length) {
    throw new Error(`IS 456 coefficient table ${coefficientTable.tableId ?? 'unknown'} has no finite tabulated rows.`);
  }
  const first = finitePoints[0];
  const last = finitePoints[finitePoints.length - 1];
  if (aspectRatio <= first.m) {
    return {
      coefficientShort: first.alphaX,
      coefficientLong: first.alphaY,
      tableId: coefficientTable.tableId,
      tableReference,
      momentConvention: coefficientTable.momentConvention,
      lowerM: first.m,
      upperM: first.m,
      interpolationFraction: 0,
      source: isTable27
        ? `${tableReference}: exact published Table 27 row m = ${first.m}.`
        : `${tableReference} with ly/lx at or below the first tabulated row m = ${first.m}; the tabulated values are used directly.`
    };
  }

  if (isTable27 && Number.isFinite(aspectRatio) && aspectRatio > last.m) {
    const reason = `Coefficient not established: finite aspect ratio exceeds the largest finite published Table 27 row (m = ${last.m}); infinity column is not treated as a finite interpolation endpoint.`;
    const error = new Error(reason);
    error.name = 'Table27CoefficientNotEstablishedError';
    error.code = 'TABLE_27_COEFFICIENT_NOT_ESTABLISHED';
    error.aspectRatio = aspectRatio;
    error.finiteCoefficientLimit = last.m;
    throw error;
  }
  if (!isTable27 && aspectRatio >= last.m) {
    return {
      coefficientShort: last.alphaX,
      coefficientLong: last.alphaY,
      tableId: coefficientTable.tableId,
      tableReference,
      momentConvention: coefficientTable.momentConvention,
      lowerM: last.m,
      upperM: last.m,
      interpolationFraction: 0,
      source: `${tableReference} with ly/lx at or above the last tabulated row m = ${last.m}; the tabulated values are used directly.`
    };
  }

  // A ratio that is exactly a published row uses that row directly, with no
  // interpolation against a neighbouring row.
  const exactIndex = finitePoints.findIndex((point) => point.m === aspectRatio);
  if (exactIndex !== -1) {
    const exact = finitePoints[exactIndex];
    return {
      coefficientShort: exact.alphaX,
      coefficientLong: exact.alphaY,
      tableId: coefficientTable.tableId,
      tableReference,
      momentConvention: coefficientTable.momentConvention,
      lowerM: exact.m,
      upperM: exact.m,
      interpolationFraction: 0,
      source: isTable27
        ? `${tableReference}: exact published Table 27 row m = ${exact.m}.`
        : `${tableReference} at the published tabulated row m = ${exact.m}; the tabulated values are used directly.`
    };
  }

  let lower = finitePoints[0];
  let upper = finitePoints[finitePoints.length - 1];
  for (let i = 0; i < finitePoints.length - 1; i += 1) {
    if (finitePoints[i].m <= aspectRatio && finitePoints[i + 1].m >= aspectRatio) {
      lower = finitePoints[i];
      upper = finitePoints[i + 1];
      break;
    }
  }
  if (!Number.isFinite(lower.m) || !Number.isFinite(upper.m) || lower.m === upper.m) {
    throw new Error(`IS 456 coefficient table ${coefficientTable.tableId ?? 'unknown'} cannot establish a finite interpolation bracket for ly/lx = ${aspectRatio}.`);
  }

  const fraction = (aspectRatio - lower.m) / (upper.m - lower.m);
  const coefficientShort = lower.alphaX + fraction * (upper.alphaX - lower.alphaX);
  const coefficientLong = lower.alphaY + fraction * (upper.alphaY - lower.alphaY);

  return {
    coefficientShort: round(coefficientShort, 4),
    coefficientLong: round(coefficientLong, 4),
    tableId: coefficientTable.tableId,
    tableReference,
    momentConvention: coefficientTable.momentConvention,
    lowerM: lower.m,
    upperM: upper.m,
    interpolationFraction: round(fraction, 4),
    source: isTable27
      ? `Interpolated between published Table 27 rows m = ${lower.m} and m = ${upper.m}.`
      : `${tableReference} with linear interpolation between the published tabulated rows m = ${lower.m} and m = ${upper.m}.`
  };
}

function calculateTwoWayMoments(effectiveShortSpan, effectiveLongSpan, aspectRatio, ultimateLoad, coefficientTable) {
  const coeffs = getTwoWayCoefficients(aspectRatio, coefficientTable);
  const MuShort = coeffs.coefficientShort * ultimateLoad * effectiveShortSpan * effectiveShortSpan;
  const MuLong = coeffs.coefficientLong * ultimateLoad * effectiveShortSpan * effectiveShortSpan;

  return {
    effectiveShortSpan: round(effectiveShortSpan, 3),
    effectiveLongSpan: round(effectiveLongSpan, 3),
    aspectRatio: round(aspectRatio, 3),
    coefficientShort: round(coeffs.coefficientShort, 4),
    coefficientLong: round(coeffs.coefficientLong, 4),
    coefficientSource: coeffs.source,
    coefficientTableId: coeffs.tableId,
    coefficientTableReference: coeffs.tableReference,
    coefficientSelectionReason: coefficientTable.reason,
    coefficientRuledOut: coefficientTable.ruledOut,
    interpolationLowerM: coeffs.lowerM,
    interpolationUpperM: coeffs.upperM,
    interpolationFraction: coeffs.interpolationFraction,
    momentEquation: 'Mx = alpha_x x wu x lx^2; My = alpha_y x wu x lx^2 (lx is the short span).',
    shortSpanUsedForBothMoments: round(effectiveShortSpan, 3),
    MuShort: round(MuShort, 3),
    MuLong: round(MuLong, 3)
  };
}

/**
 * Flexural design for a one-metre strip.
 *
 * The flexural steel required by the design moment and the Clause 26.5.2.1 minimum
 * steel are two different quantities and are reported separately. Collapsing them
 * into a single "Ast required" field hides the actual flexural demand and, because
 * the minimum usually governs a slab, silently feeds the minimum value into the
 * service-stress (fs) calculation of the Fig. 4 deflection check.
 */
function calculateRequiredAst(ultimateMomentKnM, effectiveDepthMm, concreteGrade, steelGrade, widthMm = 1000, overallDepthMm = effectiveDepthMm) {
  const concrete = getConcreteProperties(concreteGrade);
  const steel = getSteelProperties(steelGrade);
  const fck = concrete.fck;
  const fy = steel.fy;
  const d = effectiveDepthMm;
  const b = widthMm;

  const xuMax = steelGrade === 'Fe500' ? 0.46 * d : steelGrade === 'Fe415' ? 0.48 * d : 0.53 * d;
  const muLim = (0.36 * fck * b * xuMax * (d - 0.42 * xuMax)) / 1e6;

  const minimumPercent = minimumPercentForSteel(steelGrade);
  const astMinimum = (minimumPercent / 100) * b * overallDepthMm;
  const astMaximum = 0.04 * b * overallDepthMm;

  if (ultimateMomentKnM > muLim) {
    return {
      // The flexural demand could not be satisfied by a singly reinforced section,
      // so no flexural steel area is established. This is deliberately NOT filled
      // with the minimum value.
      astFlexuralRequired: null,
      AstFlexuralRequired: null,
      astMinimum: round(astMinimum, 2),
      AstMinimum: round(astMinimum, 2),
      astRequiredForDesign: null,
      AstRequired: null,
      astMaximum: round(astMaximum, 2),
      AstMaximum: round(astMaximum, 2),
      minimumPercent,
      minimumRule: 'IS 456:2000 Clause 26.5.2.1',
      xu: null,
      xuMax: round(xuMax, 2),
      muLim: round(muLim, 2),
      muRequired: round(ultimateMomentKnM, 2),
      sectionAdequate: false,
      status: 'FAIL',
      message: 'Section inadequate as singly reinforced section: Mu exceeds Mu_lim.'
    };
  }

  const A = 0.36 * fck * b * 0.42;
  const B = -0.36 * fck * b * d;
  const C = ultimateMomentKnM * 1e6;
  const discriminant = B * B - 4 * A * C;
  if (discriminant < 0) {
    throw new Error('Unable to solve neutral axis depth for the required reinforced section.');
  }
  const xu1 = (-B + Math.sqrt(discriminant)) / (2 * A);
  const xu2 = (-B - Math.sqrt(discriminant)) / (2 * A);
  const validRoots = [xu1, xu2].filter((root) => root > 0 && root <= xuMax);
  if (validRoots.length === 0) {
    throw new Error('Required moment does not have a valid under-reinforced neutral-axis solution.');
  }
  const xu = Math.min(...validRoots);
  const astFlexuralRequired = (0.36 * fck * b * xu) / (0.87 * fy);
  // The governing design requirement is the larger of the flexural demand and the
  // minimum steel, but both values remain individually available and authoritative.
  const astRequiredForDesign = Math.max(astFlexuralRequired, astMinimum);

  return {
    astFlexuralRequired: round(astFlexuralRequired, 2),
    AstFlexuralRequired: round(astFlexuralRequired, 2),
    astMinimum: round(astMinimum, 2),
    AstMinimum: round(astMinimum, 2),
    astRequiredForDesign: round(astRequiredForDesign, 2),
    AstRequired: round(astRequiredForDesign, 2),
    astMaximum: round(astMaximum, 2),
    AstMaximum: round(astMaximum, 2),
    minimumPercent,
    minimumRule: 'IS 456:2000 Clause 26.5.2.1',
    governingDriver: astFlexuralRequired >= astMinimum ? 'FLEXURAL' : 'MINIMUM',
    xu: round(xu, 2),
    xuMax: round(xuMax, 2),
    muLim: round(muLim, 2),
    muRequired: round(ultimateMomentKnM, 2),
    sectionAdequate: true
  };
}

function minimumPercentForSteel(steelGrade) {
  return steelGrade === 'Fe500' ? 0.12 : 0.15;
}

function barArea(mmDiameter) {
  return (Math.PI / 4) * mmDiameter * mmDiameter;
}

function selectPracticalReinforcement(requiredAst, minimumAst, effectiveDepth, barDiameterOptions = [8, 10, 12, 16, 20], maxSpacingLimit = 300, momentRequired = null, concreteGrade = null, steelGrade = null, depthCalculator = () => effectiveDepth) {
  if (!isFinitePositive(requiredAst) || !isFinitePositive(minimumAst) || !isFinitePositive(effectiveDepth)) {
    return {
      diameter: null,
      spacing: null,
      AstProvided: null,
      maxSpacing: null,
      clearSpacing: null,
      valid: false,
      message: 'Reinforcement selection cannot proceed because required section values are unavailable.'
    };
  }
  const maxSpacing = Math.min(maxSpacingLimit, 3 * effectiveDepth);
  let best = null;

  for (const diameter of barDiameterOptions) {
    const areaPerBar = barArea(diameter);
    for (const spacing of [75, 100, 125, 150, 175, 200, 225, 250, 275, 300]) {
      if (spacing > maxSpacing) continue;
      const actualDepth = depthCalculator(diameter);
      if (!isFinitePositive(actualDepth)) continue;
      const astProvided = (areaPerBar * 1000) / spacing;
      const clearSpacing = spacing - diameter;
      const minimumClearSpacing = Math.max(diameter, constants.slabDetailing.minimumClearSpacingMm);
      const isPhysicallyPossible = clearSpacing >= minimumClearSpacing;
      const meetsRequired = astProvided >= Math.max(requiredAst, minimumAst);
      const withinMaximumSpacing = spacing <= maxSpacing;
      const capacity = momentRequired === null ? null : calculateMomentCapacity(actualDepth, astProvided, concreteGrade, steelGrade, 1000);
      const meetsCapacity = capacity === null || (capacity.status === 'PASS' && capacity.MuProvided >= momentRequired);
      if (meetsRequired && isPhysicallyPossible && withinMaximumSpacing && meetsCapacity) {
        const objective = astProvided - Math.max(requiredAst, minimumAst);
        if (!best || objective < best.objective || (Math.abs(objective - best.objective) < 1e-6 && spacing < best.spacing)) {
          best = {
            diameter,
            spacing,
            AstProvided: round(astProvided, 2),
            AstProvidedExact: astProvided,
            maxSpacing: round(maxSpacing, 2),
            clearSpacing: round(clearSpacing, 2),
            objective,
            barArea: round(areaPerBar, 2),
            effectiveDepth: round(actualDepth, 2)
          };
        }
      }
    }
  }

  if (!best) {
    return {
      diameter: null,
      spacing: null,
      AstProvided: null,
      maxSpacing: round(maxSpacing, 2),
      clearSpacing: null,
      valid: false,
      message: 'No practical reinforcement arrangement satisfies required steel, minimum steel, and spacing limits.'
    };
  }

  return {
    ...best,
    valid: true,
    message: 'Practical reinforcement arrangement satisfies required steel and spacing limits.'
  };
}

function calculateMomentCapacity(effectiveDepthMm, AstProvided, concreteGrade, steelGrade, widthMm = 1000) {
  const concrete = getConcreteProperties(concreteGrade);
  const steel = getSteelProperties(steelGrade);
  const fck = concrete.fck;
  const fy = steel.fy;
  const b = widthMm;
  const d = effectiveDepthMm;
  if (!isFinitePositive(AstProvided)) {
    return {
      xu: null,
      xuMax: round(steelGrade === 'Fe500' ? 0.46 * d : steelGrade === 'Fe415' ? 0.48 * d : 0.53 * d, 2),
      MuProvided: null,
      isBalanced: false,
      status: 'FAIL'
    };
  }
  const xuMax = steelGrade === 'Fe500' ? 0.46 * d : steelGrade === 'Fe415' ? 0.48 * d : 0.53 * d;
  const xu = (0.87 * fy * AstProvided) / (0.36 * fck * b);
  const xuLimitPass = xu <= xuMax;
  if (!xuLimitPass) {
    return {
      xu: round(xu, 2),
      xuMax: round(xuMax, 2),
      MuProvided: null,
      isBalanced: false,
      status: 'FAIL',
      message: 'Provided reinforcement exceeds xu,max; under-reinforced capacity is not valid.'
    };
  }
  const muProvided = (0.87 * fy * AstProvided * (d - 0.42 * xu)) / 1e6;
  return {
    xu: round(xu, 2),
    xuMax: round(xuMax, 2),
    MuProvided: round(muProvided, 2),
    isBalanced: xu <= xuMax,
    status: 'PASS'
  };
}

function interpolateTableValue(table, percentage) {
  const points = Object.entries(table).map(([key, value]) => ({ percentage: Number(key), value })).sort((a, b) => a.percentage - b.percentage);
  if (percentage <= points[0].percentage) return points[0].value;
  if (percentage >= points[points.length - 1].percentage) return points[points.length - 1].value;
  for (let index = 0; index < points.length - 1; index += 1) {
    const lower = points[index];
    const upper = points[index + 1];
    if (percentage >= lower.percentage && percentage <= upper.percentage) {
      const fraction = (percentage - lower.percentage) / (upper.percentage - lower.percentage);
      return lower.value + fraction * (upper.value - lower.value);
    }
  }
  return null;
}

function validateDeflectionDataset(dataset) {
  if (!dataset || dataset.xAxis !== 'pt_percent' || dataset.yAxis !== 'fs_N_per_mm2' || !Array.isArray(dataset.curves) || dataset.curves.length < 2) {
    throw new Error('IS 456 Fig. 4 dataset must declare axes and at least two stress curves.');
  }
  const stressValues = dataset.curves.map((curve) => curve.fs);
  if (stressValues.some((value) => !Number.isFinite(value)) || new Set(stressValues).size !== stressValues.length) {
    throw new Error('IS 456 Fig. 4 dataset contains missing or duplicate stress curve labels.');
  }
  const referencePoints = dataset.curves[0].points;
  if (!Array.isArray(referencePoints) || referencePoints.length < 2) {
    throw new Error('IS 456 Fig. 4 dataset requires at least two pt points per curve.');
  }
  const ptValues = referencePoints.map((point) => point.pt);
  if (ptValues.some((value) => !Number.isFinite(value)) || new Set(ptValues).size !== ptValues.length) {
    throw new Error('IS 456 Fig. 4 dataset contains missing or duplicate pt values.');
  }
  dataset.curves.forEach((curve) => {
    if (!Array.isArray(curve.points) || curve.points.length !== ptValues.length || curve.points.some((point, index) => point.pt !== ptValues[index] || !Number.isFinite(point.factor))) {
      throw new Error('IS 456 Fig. 4 dataset has inconsistent pt points or missing factors.');
    }
  });
  return { stressValues, ptValues };
}

function interpolateDeflectionFactor(dataset, ptValue, fsValue) {
  const result = interpolateFig4ModificationFactor(ptValue, fsValue);
  return {
    ...result,
    datasetSource: dataset?.source ?? result.datasetSource,
    datasetVersion: dataset?.datasetVersion ?? result.datasetVersion,
    method: result.interpolationMethod,
    message: result.message,
    status: result.status,
    validInput: result.validInput,
    ptClamped: result.ptClamped,
    fsClamped: result.fsClamped,
    clampingApplied: result.clampingApplied
  };
}

/**
 * Shear check on a conservative one-metre strip at the IS 456:2000 Clause 40
 * critical section. The ARITHMETIC is unchanged; only its justification is now explicit.
 *
 * Basis of this method (deliberately conservative, stated rather than implied):
 *
 * 1. ONE-METRE STRIP. The slab is analysed per metre width (b = 1000 mm) with the
 *    ultimate load taken as wu (kN/m2) acting over that metre. IS 456:2000 Table 19
 *    gives tau_c per unit width, so a 1 m strip is the natural analysis width. Taking
 *    the full wu over the full metre does NOT apply any two-way load-sharing
 *    (tributary-width) reduction, so the shear demand is an UPPER BOUND. This is
 *    conservative: a true two-way load distribution would shed load toward the
 *    supports and reduce the strip reaction.
 *
 * 2. SHORT DIRECTION GOVERNS. The reaction considered is wu x lx / 2 taken on the
 *    SHORT span. For a two-way panel the short direction is the stiffer and more
 *    heavily loaded of the two, and the critical section is taken across the short
 *    span. The long-direction strip reaction (wu x ly / 2) is larger in absolute
 *    terms but is carried over a much longer shear span; it is not the governing
 *    flexural-shear case and is not separately checked here. A separate long-direction
 *    shear check is NOT performed: it would require a two-way load-distribution
 *    (tributary width) model that this engine does not implement, and inventing a
 *    second shear equation without that basis would not be justified.
 *
 * 3. SUPPORT-FACE CORRECTION. IS 456:2000 Clause 40 places the critical section at a
 *    distance d from the FACE of the support. The effective span is measured
 *    centre-to-centre, so the support face lies half a support width nearer midspan
 *    than the support centreline. The lever arm is therefore
 *    lx/2 - (support width)/2 - d. Omitting the half-support-width term (the previous
 *    behaviour) measured d from the centreline and OVERSTATED Vu.
 *
 * 4. NO SHEAR REINFORCEMENT IS DESIGNED. The check verifies the IS 456:2000 Table 19
 *    and Table 20 concrete limits. Shear reinforcement has not been required or
 *    provided by this engine; if the concrete check ever fails, the item is reported
 *    as FAIL rather than assumed to be carried by the flexural steel.
 */
function calculateShear(effectiveDepthMm, ultimateLoadKnM2, spanM, supportWidthM, concreteGrade, astProvided) {
  const d = effectiveDepthMm;
  const b = 1000;

  // Geometry, stated explicitly so the critical section location is unambiguous.
  const supportHalfWidthM = supportWidthM / 2;
  const centrelineToSupportFaceM = supportHalfWidthM;
  const criticalSectionFromCentrelineM = Math.max(spanM / 2 - centrelineToSupportFaceM - d / 1000, 0);
  const distanceFromCentrelineToMidspanM = spanM / 2;

  const reactionKnPerM = ultimateLoadKnM2 * distanceFromCentrelineToMidspanM;
  // Shear at the critical section = reaction at the centreline less the load
  // acting between the centreline and the critical section.
  const ultimateShearKnPerM = Math.max(ultimateLoadKnM2 * criticalSectionFromCentrelineM, 0);
  const vU = ultimateShearKnPerM * 1000;
  const tauV = vU / (b * d);
  const tensionSteelPercent = (100 * astProvided) / (b * d);
  const tauCTable = constants.shearStrengthTable[concreteGrade];
  // IS 456:2000 Table 19 is read at the provided tension-steel percentage. Values
  // below the first published row are not interpolated: the first row value is used.
  const tauC = tauCTable ? interpolateTableValue(tauCTable, tensionSteelPercent) : null;
  const tauCMax = constants.maximumShearStress?.[concreteGrade] ?? null;

  const criticalSection = `Critical section at d = ${round(effectiveDepthMm, 2)} mm from the FACE of the support `
    + `(${round(centrelineToSupportFaceM, 4)} m from the support centreline for a ${round(supportWidthM * 1000, 0)} mm wide support), `
    + `i.e. ${round(criticalSectionFromCentrelineM, 4)} m from the support centreline; `
    + `one-metre strip reaction at the centreline = ${round(reactionKnPerM, 3)} kN/m.`;

  if (!Number.isFinite(tauC) || !Number.isFinite(tauCMax)) {
    return {
      Vu: round(ultimateShearKnPerM, 3),
      reaction: round(reactionKnPerM, 3),
      criticalSection,
      criticalSectionFromCentrelineM: round(criticalSectionFromCentrelineM, 4),
      supportFaceToCentrelineM: round(centrelineToSupportFaceM, 4),
      shearStress: round(tauV, 4),
      concreteShearStrength: tauC,
      maxShearStress: tauCMax,
      capacity: null,
      reinforcement: 'NOT CALCULATED — REQUIRED SHEAR TABLE DATA NOT IMPLEMENTED.',
      status: 'FAIL',
      message: 'Required IS 456 shear table data is unavailable.'
    };
  }

  const concreteCapacityKnPerM = tauC * b * d / 1000;
  return {
    Vu: round(ultimateShearKnPerM, 3),
    reaction: round(reactionKnPerM, 3),
    criticalSection,
    criticalSectionFromCentrelineM: round(criticalSectionFromCentrelineM, 4),
    supportFaceToCentrelineM: round(centrelineToSupportFaceM, 4),
    shearStress: round(tauV, 4),
    concreteShearStrength: round(tauC, 4),
    maxShearStress: round(tauCMax, 4),
    tensionSteelPercent: round(tensionSteelPercent, 4),
    capacity: round(concreteCapacityKnPerM, 3),
    reinforcement: tauV <= tauC ? 'Not required / not applicable because concrete shear capacity is adequate.' : 'Required review: concrete shear capacity is inadequate.',
    status: tauV <= tauC ? 'PASS' : tauV <= tauCMax ? 'FAIL' : 'FAIL',
    message: tauV <= tauC ? 'Shear stress is within concrete shear capacity.' : tauV <= tauCMax ? 'Shear stress exceeds concrete shear strength; shear reinforcement may be required.' : 'Shear stress exceeds maximum permissible stress.'
  };
}

/**
 * Deflection check per IS 456:2000 Clause 23.2.1.
 *
 * `fs` is the service stress in the tension steel. It is derived from the steel
 * required by flexure for the design moment, NOT from the Clause 26.5.2.1 minimum
 * steel. For a slab the minimum usually governs the provided area, so reusing the
 * minimum value here would raise fs substantially and understate deflection. The
 * two inputs are exposed on the result so the source of each value is auditable.
 */
function calculateDeflection(effectiveSpanM, effectiveDepthMm, supportType, astProvided, astFlexuralRequired, steelGrade, widthMm = 1000) {
  const z = effectiveSpanM * 1000;
  const actualLd = z / effectiveDepthMm;
  const basicRatio = supportType === 'Cantilever' ? 7 : supportType === 'Continuous' ? 26 : 20;
  const astProvidedExact = Number(astProvided);
  const astFlexuralExact = Number(astFlexuralRequired);
  const tensionSteelPercent = (100 * astProvidedExact) / (widthMm * effectiveDepthMm);
  const chart = constants.slabDeflection;
  const fy = getSteelProperties(steelGrade).fy;
  const serviceStress = round(0.58 * fy * astFlexuralExact / astProvidedExact, 2);
  const serviceStressExact = 0.58 * fy * astFlexuralExact / astProvidedExact;
  const interpolation = interpolateDeflectionFactor(chart, tensionSteelPercent, serviceStress);
  const modificationFactor = interpolation.modificationFactor;
  const permissibleLd = Number.isFinite(modificationFactor) ? basicRatio * modificationFactor : null;
  const status = interpolation.status === 'VERIFICATION REQUIRED' ? 'VERIFICATION REQUIRED' : (Number.isFinite(actualLd) && Number.isFinite(permissibleLd) && actualLd <= permissibleLd ? 'PASS' : 'FAIL');
  const pass = status === 'PASS';
  // State precisely which Fig. 4 inputs fall outside the validated dataset, so the
  // VERIFICATION REQUIRED reason is specific rather than generic.
  const outOfRange = [];
  if (interpolation.ptRange && tensionSteelPercent < interpolation.ptRange.min) outOfRange.push(`pt = ${round(tensionSteelPercent, 4)}% is below the validated lower bound of ${interpolation.ptRange.min}%`);
  if (interpolation.ptRange && tensionSteelPercent > interpolation.ptRange.max) outOfRange.push(`pt = ${round(tensionSteelPercent, 4)}% is above the validated upper bound of ${interpolation.ptRange.max}%`);
  if (interpolation.fsRange && serviceStress < interpolation.fsRange.min) outOfRange.push(`fs = ${round(serviceStress, 2)} N/mm² is below the validated lower bound of ${interpolation.fsRange.min} N/mm²`);
  if (interpolation.fsRange && serviceStress > interpolation.fsRange.max) outOfRange.push(`fs = ${round(serviceStress, 2)} N/mm² is above the validated upper bound of ${interpolation.fsRange.max} N/mm²`);
  return {
    governingSpan: round(effectiveSpanM, 3),
    actualLd: round(actualLd, 2),
    permissibleLd: Number.isFinite(permissibleLd) ? round(permissibleLd, 2) : null,
    basicRatio: round(basicRatio, 2),
    tensionSteelPercent: round(tensionSteelPercent, 4),
    serviceStress: round(serviceStress, 2),
    astUsedForPt: astProvidedExact,
    // Named for what it actually is: the flexural requirement, not the minimum.
    astRequiredForFs: astFlexuralExact,
    astFlexuralRequiredUsedForFs: astFlexuralExact,
    astProvidedUsedForFs: astProvidedExact,
    astUsedForFsBasis: 'Flexural steel required by the design moment (IS 456:2000 Clause 23.2.1(b) service stress), not the Clause 26.5.2.1 minimum reinforcement.',
    ptWidth: widthMm,
    ptEffectiveDepth: effectiveDepthMm,
    ptFormula: 'pt = 100 x Ast provided / (b x d)',
    fsFormula: 'fs = 0.58 x fy x Ast flexural required / Ast provided',
    ptTrace: `Ast used for pt = ${astProvidedExact} mm²/m; b = ${widthMm} mm; d = ${effectiveDepthMm} mm; pt = 100 × ${astProvidedExact} / (${widthMm} × ${effectiveDepthMm}) = ${tensionSteelPercent} %`,
    // The trace reports the same rounded service stress that the result publishes,
    // so the two can never disagree.
    fsTrace: `fs = 0.58 × ${fy} × ${astFlexuralExact} / ${astProvidedExact} = ${serviceStress} N/mm² (unrounded ${serviceStressExact})`,
    modificationFactor: Number.isFinite(modificationFactor) ? round(modificationFactor, 4) : null,
    ...Object.fromEntries(Object.entries(interpolation).map(([key, value]) => [key, typeof value === 'number' ? round(value, 6) : value])),
    status,
    pass,
    verificationRequired: status === 'VERIFICATION REQUIRED',
    method: 'IS 456:2000 Clause 23.2.1 basic span/depth ratio multiplied by the Fig. 4 modification factor.',
    source: chart.source,
    interpolation: chart.interpolation,
    outOfRangeInputs: outOfRange,
    message: interpolation.status === 'VERIFICATION REQUIRED'
      ? `Deflection verification requires manual/code-figure verification because the calculated reinforcement percentage lies below the validated digitized Fig. 4 dataset range. `
        + `${outOfRange.length ? `${outOfRange.join('; ')}. ` : ''}`
        + 'The slab has NOT been proven to fail deflection: the Fig. 4 modification factor could not be established from the validated dataset, so no automatic approval is possible. No clamping, faking or extrapolation is used.'
      : (pass ? 'Actual L/d is within the permissible modified L/d.' : 'Actual L/d exceeds the permissible modified L/d; slab thickness/depth is insufficient for deflection control.')
  };
}

function selectGoverningDeflection(shortSpan, shortDepth, shortReinforcement, shortRequired, longSpan, longDepth, longReinforcement, longRequired, supportType, steelGrade) {
  // The Fig. 4 service stress uses the flexural requirement of each direction.
  const shortDeflection = calculateDeflection(shortSpan, shortDepth, supportType, shortReinforcement.AstProvidedExact, shortRequired.astFlexuralRequired, steelGrade);
  const longDeflection = calculateDeflection(longSpan, longDepth, supportType, longReinforcement.AstProvidedExact, longRequired.astFlexuralRequired, steelGrade);
  const governingDirection = longDeflection.actualLd > shortDeflection.actualLd ? 'Long direction' : 'Short direction';
  const governing = governingDirection === 'Long direction' ? longDeflection : shortDeflection;
  return {
    ...governing,
    governingDirection,
    short: shortDeflection,
    long: longDeflection
  };
}

const NOT_PROVIDED = 'NOT PROVIDED';
const NOT_ESTABLISHED = 'NOT ESTABLISHED';
const NOT_REQUIRED = 'NOT REQUIRED';

// Single canonical status vocabulary for every engineering check. UI consumers format
// the display text; the engine never emits differently-cased duplicates.
const CHECK_STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  VERIFICATION_REQUIRED: 'VERIFICATION REQUIRED',
  NOT_REQUIRED: 'NOT REQUIRED'
});

const ALLOWED_CHECK_STATUSES = Object.freeze(Object.values(CHECK_STATUS));

export function normalizeCheckStatus(status) {
  return ALLOWED_CHECK_STATUSES.includes(status) ? status : CHECK_STATUS.FAIL;
}

/**
 * Beam-module parity: every check exposes a consistent field set so the UI, the PDF
 * and the calculation trace all consume the same authoritative values.
 */
function createCheck(id, name, status, actual, limit, reason, clause, unit = '', verificationRequired = false) {
  const valuesAvailable = Number.isFinite(Number(actual)) && (limit === null || Number.isFinite(Number(limit)));
  let normalizedStatus = normalizeCheckStatus(status);
  // A check that explicitly requires verification is never silently downgraded to PASS,
  // and a check with no evaluable numeric evidence cannot be reported as PASS.
  if (verificationRequired) normalizedStatus = CHECK_STATUS.VERIFICATION_REQUIRED;
  if (!valuesAvailable && normalizedStatus === CHECK_STATUS.PASS) normalizedStatus = CHECK_STATUS.FAIL;
  const utilization = valuesAvailable && limit !== null && Number(limit) !== 0 ? Number(actual) / Number(limit) : null;
  return {
    id,
    title: name,
    name,
    check_name: name,
    status: normalizedStatus,
    statusCode: normalizedStatus.replaceAll(' ', '_'),
    actualValue: actual,
    limitValue: limit,
    actual,
    actual_value: actual,
    limit,
    limit_value: limit,
    utilization: utilization === null ? null : round(utilization, 4),
    reason,
    message: reason,
    explanation: reason,
    value: reason,
    unit,
    severity: 'MANDATORY',
    codeReference: clause,
    clause,
    verificationRequired: normalizedStatus === CHECK_STATUS.VERIFICATION_REQUIRED
  };
}

// Corner torsion is determined from the Annex D provisions applicable to the selected
// support and corner-restraint condition; Clause 26.5.2.1 is not that basis.
const CORNER_TORSION_FREE_BASIS = 'IS 456:2000 Annex D-2.1';
const CORNER_TORSION_FREE_REASON = 'The slab is explicitly configured as FREE_TO_LIFT with no corner-restraint assumption; '
  + 'the IS 456:2000 Table 27 coefficients are therefore used under IS 456:2000 Annex D-2.1. '
  + 'No corner torsion steel is designed. Corner torsion basis: IS 456:2000 Annex D provisions applicable to the selected '
  + 'support and corner-restraint condition. Clause 26.5.2.1 is not used as the basis for the corner-torsion determination.';
const CORNER_TORSION_RESTRAINED_BASIS = 'IS 456:2000 Annex D provisions applicable to the selected support and corner-restraint condition.';
const CORNER_TORSION_RESTRAINED_REASON = 'The corner is configured as RESTRAINED. Corner torsion basis: IS 456:2000 Annex D provisions applicable to the selected '
  + 'support and corner-restraint condition. Clause 26.5.2.1 is not used as the basis for the corner-torsion determination. '
  + 'Restrained corner torsion detailing is not implemented, so this item cannot be closed automatically.';

/**
 * IS 456:2000 Annex D-2.1.1 bar extension / curtailment requirement for a slab
 * designed with the Annex D-2.1 (simply supported, Table 27) coefficients.
 *
 * At least 50% of the tension reinforcement provided at midspan must be carried
 * through to the supports. The remainder may be curtailed to within 0.1 lx (or
 * 0.1 ly, as applicable to the direction) of the support face.
 *
 * This is reported as an explicit detailing requirement with the computed
 * termination distance. It is a REQUIREMENT statement, not a bar-bending schedule:
 * the number of bars actually curtailed depends on the bar arrangement, which this
 * engine reports as an area and spacing rather than a discrete bar count.
 */
function annexD211BarExtension(effectiveSpanM, direction) {
  const lx = Number(effectiveSpanM);
  const terminationAllowance = round(0.1 * lx, 4);
  return {
    reference: 'IS 456:2000 Annex D-2.1.1',
    direction,
    tensionReinforcementProvidedAtMidspan: true,
    minimumFractionCarriedToSupport: 0.5,
    minimumPercentCarriedToSupport: 50,
    requirement: `At least 50% of the tension reinforcement provided at midspan must be extended to the supports. `
      + `The remaining 50% may be curtailed to within 0.1 l${direction === 'short' ? 'x' : 'y'} of the support face.`,
    terminationAllowanceM: terminationAllowance,
    terminationAllowanceExpression: `0.1 x ${lx} m = ${terminationAllowance} m from the support face`,
    status: 'VERIFICATION REQUIRED',
    // The engine computes the areas and the geometric allowance, but does not issue a
    // discrete bar schedule, so the actual curtailed bar count cannot be confirmed here.
    verificationNote: 'The 50% continuation and 50% curtailment allowance is computed and reported. '
      + 'Confirming the number of bars actually curtailed requires a bar-bending schedule, which this design output does not issue.'
  };
}

function createCornerTorsionCheck(cornerRestraint, torsionNote, torsionStatus, clause) {
  const isFree = cornerRestraint === 'FREE_TO_LIFT';
  const base = {
    actual: cornerRestraint,
    limit: 'FREE_TO_LIFT',
    utilization: null,
    unit: '',
    severity: 'MANDATORY',
    codeReference: clause,
    clause,
    cornerRestraint,
    torsionReinforcement: torsionNote,
    torsionStatus,
    verificationRequired: false
  };
  if (isFree) {
    return {
      ...createCheck('cornerTorsion', 'Corner torsion restraint', CHECK_STATUS.NOT_REQUIRED, cornerRestraint, null, `${torsionNote} ${CORNER_TORSION_FREE_REASON}`, clause, '', false),
      ...base,
      verificationRequired: false
    };
  }
  return {
    ...createCheck('cornerTorsion', 'Corner torsion restraint', CHECK_STATUS.VERIFICATION_REQUIRED, cornerRestraint, null, `${torsionNote} ${CORNER_TORSION_RESTRAINED_REASON}`, clause, '', true),
    ...base,
    verificationRequired: true
  };
}

// Structured, authoritative calculation trace. The UI and the PDF both render this
// array; no consumer formats its own copy of the trace.
function buildCalculationTrace(context) {
  const { result, loads, slabInfo, spans, momentDesign, shortRequired, longRequired, shortReinforcement, longReinforcement, shortCapacity, longCapacity, shear, deflection, checks, finalStatus, evaluatedThicknessCount, incrementCount, lastEvaluatedThickness, adoptionCount, adoptedThickness, initialThicknessMm, maxThicknessMm, thicknessStepMm, supportWidthMm, concreteGrade, steelGrade, clearCoverMm, cornerRestraint } = context;

  // The trace is grouped so the UI can present it as collapsible sections instead of
  // one continuous wall of text. Grouping is presentation metadata; the step order,
  // numbering and values are unchanged.
  const GROUPS = [
    [1, 5, 'inputGeometry', 'Input & Geometry'],
    [6, 6, 'thicknessEvaluation', 'Thickness Evaluation'],
    [7, 12, 'loading', 'Loading'],
    [13, 16, 'momentCoefficients', 'Moment Coefficients'],
    [17, 24, 'flexuralShort', 'Flexural Design — Short Direction'],
    [25, 30, 'flexuralLong', 'Flexural Design — Long Direction'],
    [31, 32, 'shear', 'Shear'],
    [33, 35, 'serviceability', 'Serviceability'],
    [36, 39, 'detailingFinal', 'Detailing & Final Verification']
  ];
  const groupFor = (id) => GROUPS.filter(([from, to]) => id >= from && id <= to).map(([, , key, label]) => ({ id: key, label }))[0] ?? { id: 'other', label: 'Other' };

  const trace = [];
  const step = (id, title, formula, substitution, value, unit = '', status = null) => {
    const group = groupFor(id);
    trace.push({ id, step: id, title, formula, substitution, result: value, value, unit, status, group: group.id, groupLabel: group.label });
  };

  step(1, 'Input geometry', 'Lx, Ly, D, support width, support type', `Total short span = ${spans.totalShortSpan} m; total long span = ${spans.totalLongSpan} m; initial D = ${round(initialThicknessMm, 2)} mm; support = ${result.supportType} of ${round(supportWidthMm, 0)} mm; ${concreteGrade}/${steelGrade}; cover = ${clearCoverMm} mm`, `Slab ${slabInfo.slabType}, ${result.supportType}`);
  step(2, 'Clear span', 'Clear span = total span - support width (IS 456:2000 Clause 22.2)', `Clear short span = ${spans.totalShortSpan} - ${spans.supportWidth} = ${spans.clearShortSpan} m; clear long span = ${spans.totalLongSpan} - ${spans.supportWidth} = ${spans.clearLongSpan} m`, `Short ${spans.clearShortSpan} m; long ${spans.clearLongSpan} m`, 'm');
  step(3, 'Effective span', 'Leff = min(clear span + d, centre-to-centre support span) (IS 456:2000 Clause 22.2); Length/Width are the centre-to-centre support spans', `Short: ${spans.shortSpanResolution?.substitution ?? spans.method}; long: ${spans.longSpanResolution?.substitution ?? spans.method}`, `lx = ${result.effectiveShortSpan} m; ly = ${result.effectiveLongSpan} m`, 'm');
  step(4, 'Aspect ratio', 'ly/lx (IS 456:2000 Clause 24.1)', `${result.effectiveLongSpan} / ${result.effectiveShortSpan}`, result.aspectRatio, '-');
  step(5, 'Slab classification', slabInfo.criterion, slabInfo.finiteCoefficientLimit == null
    ? `ly/lx = ${result.aspectRatio}; Table 26 two-way limit = ${slabInfo.twoWayLimit}`
    : `ly/lx = ${result.aspectRatio}; largest finite Table 27 coefficient row = ${slabInfo.finiteCoefficientLimit}`, slabInfo.slabType);
  step(6, 'Thickness iteration', 'Evaluate D from the initial to the maximum thickness in fixed steps and adopt the first thickness that satisfies every required check', `D = ${round(initialThicknessMm, 2)} mm to ${round(maxThicknessMm, 2)} mm in ${thicknessStepMm} mm steps: ${evaluatedThicknessCount} thicknesses evaluated (${incrementCount} increments), last evaluated D = ${lastEvaluatedThickness} mm. Thresholds fully satisfied: ${adoptionCount}.`, `Adopted D = ${adoptedThickness === null ? NOT_ESTABLISHED : `${adoptedThickness} mm`}`, 'mm');
  step(7, 'Self weight', 'self weight = (D/1000) x unit weight of concrete', `${round(result.slabThickness, 2)}/1000 x ${loads.unitWeight} = ${loads.selfWeight}`, loads.selfWeight, 'kN/m²');
  step(8, 'Floor finish', 'Floor finish load (input)', `${loads.floorFinish}`, loads.floorFinish, 'kN/m²');
  step(9, 'Dead load', 'DL = self weight + floor finish', `${loads.selfWeight} + ${loads.floorFinish} = ${loads.deadLoad}`, loads.deadLoad, 'kN/m²');
  step(10, 'Live load', 'Live load (input)', `${loads.liveLoad}`, loads.liveLoad, 'kN/m²');
  step(11, 'Service load', 'Service load = DL + LL', `${loads.deadLoad} + ${loads.liveLoad} = ${loads.serviceLoad}`, loads.serviceLoad, 'kN/m²');
  step(12, 'Ultimate load', 'wu = 1.5 x (DL + LL)', `1.5 x (${loads.deadLoad} + ${loads.liveLoad}) = ${loads.ultimateLoad}`, loads.ultimateLoad, 'kN/m²');
  step(13, 'IS 456 moment coefficient table selection', momentDesign ? `${momentDesign.coefficientTableReference}: ${momentDesign.coefficientSelectionReason}` : NOT_PROVIDED, momentDesign ? `Support type = ${result.supportType}; corner restraint = ${cornerRestraint}; table = ${momentDesign.coefficientTableReference}${momentDesign.coefficientRuledOut ? ` (${momentDesign.coefficientRuledOut})` : ''}` : 'Not applicable to a one-way slab', momentDesign ? momentDesign.coefficientTableReference : NOT_PROVIDED);
  step(14, 'IS 456 moment coefficient resolution', momentDesign ? momentDesign.coefficientSource : NOT_PROVIDED, momentDesign ? momentDesign.coefficientSource : 'Not applicable to a one-way slab', momentDesign ? `alpha_x = ${momentDesign.coefficientShort}; alpha_y = ${momentDesign.coefficientLong}` : NOT_PROVIDED);
  step(15, 'Short-direction moment', 'Mx = alpha_x x wu x lx^2', momentDesign ? `${momentDesign.coefficientShort} x ${loads.ultimateLoad} x ${momentDesign.effectiveShortSpan}^2` : 'Not applicable to a one-way slab', momentDesign ? momentDesign.MuShort : NOT_PROVIDED, 'kN·m/m');
  step(16, 'Long-direction moment', 'My = alpha_y x wu x lx^2', momentDesign ? `${momentDesign.coefficientLong} x ${loads.ultimateLoad} x ${momentDesign.effectiveShortSpan}^2` : 'Not applicable to a one-way slab', momentDesign ? momentDesign.MuLong : NOT_PROVIDED, 'kN·m/m');
  step(17, 'Effective depth - short direction', 'd_short = D - cover - bar/2 (single layer of short-direction bars)', `${round(result.slabThickness, 2)} - ${clearCoverMm} - ${shortReinforcement.diameter ?? preferredBarDiameterText(context)}/2 = ${result.effectiveDepthShort}`, result.effectiveDepthShort, 'mm');
  step(18, 'Effective depth - long direction', 'd_long = D - cover - short bar - long bar/2 (long-direction bars sit above the short-direction layer)', `${round(result.slabThickness, 2)} - ${clearCoverMm} - ${shortReinforcement.diameter ?? NOT_PROVIDED} - ${longReinforcement.diameter ?? NOT_PROVIDED}/2 = ${result.effectiveDepthLong}`, result.effectiveDepthLong, 'mm');
  step(19, 'Flexural Ast - short direction', 'Mu = 0.87 fy Ast (d - 0.42 xu), xu = 0.87 fy Ast/(0.36 fck b)', `Mu = ${momentDesign ? momentDesign.MuShort : 0} kN·m/m; b = 1000 mm; d = ${result.effectiveDepthShort} mm; xu = ${shortRequired.xu ?? NOT_PROVIDED} mm`, shortRequired.astFlexuralRequired ?? NOT_PROVIDED, 'mm²/m');
  step(20, 'Minimum Ast - short direction', 'Ast,min = 0.12% x b x D (Fe500) per IS 456:2000 Clause 26.5.2.1', `0.12/100 x 1000 x ${round(result.slabThickness, 2)} = ${shortRequired.astMinimum}`, shortRequired.astMinimum, 'mm²/m');
  step(21, 'Governing required Ast - short direction', 'Ast,required for design = max(Ast flexural required, Ast min)', `max(${shortRequired.astFlexuralRequired ?? NOT_PROVIDED}, ${shortRequired.astMinimum}) = ${shortRequired.astRequiredForDesign ?? NOT_PROVIDED}; governed by the ${shortRequired.governingDriver === 'FLEXURAL' ? 'flexural' : 'minimum'} requirement`, shortRequired.astRequiredForDesign ?? NOT_PROVIDED, 'mm²/m');
  step(22, 'Provided Ast - short direction', 'Ast,provided = (pi phi^2/4) x 1000 / spacing', shortReinforcement.AstProvided === null ? NOT_PROVIDED : `(pi x ${shortReinforcement.diameter}^2/4) x 1000 / ${shortReinforcement.spacing}`, shortReinforcement.AstProvided ?? NOT_PROVIDED, 'mm²/m');
  step(23, 'Neutral axis depth - short direction', 'xu = 0.87 fy Ast/(0.36 fck b)', `0.87 x ${steelFy(steelGrade)} x ${shortReinforcement.AstProvided ?? 'Ast'} / (0.36 x ${concreteFck(concreteGrade)} x 1000)`, shortCapacity.xu ?? NOT_PROVIDED, 'mm');
  step(24, 'Moment capacity - short direction', 'Mu,cap = 0.87 fy Ast (d - 0.42 xu)', shortCapacity.MuProvided === null ? NOT_PROVIDED : `0.87 x ${steelFy(steelGrade)} x ${shortReinforcement.AstProvided} x (${result.effectiveDepthShort} - 0.42 x ${shortCapacity.xu})`, shortCapacity.MuProvided ?? NOT_PROVIDED, 'kN·m/m');
  step(25, 'Flexural Ast - long direction', 'Mu = 0.87 fy Ast (d - 0.42 xu), xu = 0.87 fy Ast/(0.36 fck b)', `Mu = ${momentDesign ? momentDesign.MuLong : 0} kN·m/m; b = 1000 mm; d = ${result.effectiveDepthLong} mm; xu = ${longRequired.xu ?? NOT_PROVIDED} mm`, longRequired.astFlexuralRequired ?? NOT_PROVIDED, 'mm²/m');
  step(26, 'Minimum Ast - long direction', 'Ast,min = 0.12% x b x D (Fe500) per IS 456:2000 Clause 26.5.2.1', `0.12/100 x 1000 x ${round(result.slabThickness, 2)} = ${longRequired.astMinimum}`, longRequired.astMinimum, 'mm²/m');
  step(27, 'Governing required Ast - long direction', 'Ast,required for design = max(Ast flexural required, Ast min)', `max(${longRequired.astFlexuralRequired ?? NOT_PROVIDED}, ${longRequired.astMinimum}) = ${longRequired.astRequiredForDesign ?? NOT_PROVIDED}; governed by the ${longRequired.governingDriver === 'FLEXURAL' ? 'flexural' : 'minimum'} requirement`, longRequired.astRequiredForDesign ?? NOT_PROVIDED, 'mm²/m');
  step(28, 'Provided Ast - long direction', 'Ast,provided = (pi phi^2/4) x 1000 / spacing', longReinforcement.AstProvided === null ? NOT_PROVIDED : `(pi x ${longReinforcement.diameter}^2/4) x 1000 / ${longReinforcement.spacing}`, longReinforcement.AstProvided ?? NOT_PROVIDED, 'mm²/m');
  step(29, 'Neutral axis depth - long direction', 'xu = 0.87 fy Ast/(0.36 fck b)', `0.87 x ${steelFy(steelGrade)} x ${longReinforcement.AstProvided ?? 'Ast'} / (0.36 x ${concreteFck(concreteGrade)} x 1000)`, longCapacity.xu ?? NOT_PROVIDED, 'mm');
  step(30, 'Moment capacity - long direction', 'Mu,cap = 0.87 fy Ast (d - 0.42 xu)', longCapacity.MuProvided === null ? NOT_PROVIDED : `0.87 x ${steelFy(steelGrade)} x ${longReinforcement.AstProvided} x (${result.effectiveDepthLong} - 0.42 x ${longCapacity.xu})`, longCapacity.MuProvided ?? NOT_PROVIDED, 'kN·m/m');
  step(31, 'Shear calculation', 'Vu = wu x (lx/2 - support width/2 - d) on a one-metre strip; the critical section is at d from the support FACE', `wu = ${loads.ultimateLoad} kN/m²; lx = ${result.effectiveShortSpan} m; support width = ${spans.supportWidth} m; d = ${result.effectiveDepthShort} mm`, shear.Vu, 'kN/m');
  step(32, 'Concrete shear capacity', 'tau_v = Vu x 1000/(b x d); tau_c from IS 456 Table 19 at the provided tension steel percentage', `tau_v = ${shear.shearStress} N/mm²; pt = ${shear.tensionSteelPercent ?? NOT_PROVIDED}%; tau_c = ${shear.concreteShearStrength} N/mm²; tau_c,max = ${shear.maxShearStress} N/mm²`, `Concrete capacity = ${shear.capacity ?? NOT_PROVIDED} kN/m`, 'kN/m', shear.status);
  step(33, 'Deflection calculation', 'Actual L/d = effective span/d, governing direction', `Governing direction = ${deflection.governingDirection}; span = ${deflection.governingSpan} m; d = ${deflection.governingDirection === 'Long direction' ? result.effectiveDepthLong : result.effectiveDepthShort} mm`, deflection.actualLd, '-');
  step(34, 'Deflection service stress and Fig. 4 interpolation', deflection.ptFormula && deflection.fsFormula ? `${deflection.ptFormula}; ${deflection.fsFormula} (IS 456:2000 Clause 23.2.1(c), Fig. 4)` : 'IS 456:2000 Clause 23.2.1(c), Fig. 4', deflection.ptTrace && deflection.fsTrace ? `${deflection.ptTrace}; ${deflection.fsTrace}` : NOT_ESTABLISHED, deflection.modificationFactor ?? NOT_ESTABLISHED, '-', deflection.status);
  step(35, 'Permissible L/d', 'Permissible L/d = basic span/depth ratio x modification factor', deflection.modificationFactor === null ? `Basic ratio = ${deflection.basicRatio}; modification factor = ${NOT_ESTABLISHED}` : `${deflection.basicRatio} x ${deflection.modificationFactor}`, deflection.permissibleLd ?? NOT_ESTABLISHED, '-', deflection.status);
  step(36, 'Maximum spacing', 'Maximum main reinforcement spacing = min(3d, 300 mm) (IS 456:2000 Clause 26.3.3)', `Short: min(3 x ${result.effectiveDepthShort}, 300) = ${shortReinforcement.maxSpacing} mm; long: min(3 x ${result.effectiveDepthLong}, 300) = ${longReinforcement.maxSpacing} mm`, `Short ${shortReinforcement.spacing ?? NOT_PROVIDED} mm; long ${longReinforcement.spacing ?? NOT_PROVIDED} mm`, 'mm');
  step(37, 'Clear spacing', 'Clear spacing = provided spacing - bar diameter (IS 456:2000 Clause 26.3.2)', `Short: ${shortReinforcement.spacing} - ${shortReinforcement.diameter} = ${shortReinforcement.clearSpacing} mm; long: ${longReinforcement.spacing} - ${longReinforcement.diameter} = ${longReinforcement.clearSpacing} mm`, `Minimum clear spacing = ${constants.slabDetailing.minimumClearSpacingMm} mm`, 'mm');
  step(38, 'Cover and corner torsion', 'Nominal cover (IS 456:2000 Clause 26.4) and corner torsion basis (IS 456:2000 Annex D provisions)', `Cover input = ${clearCoverMm} mm; the Clause 26.4 requirement depends on the exposure condition, the required fire resistance, the bar diameter and the aggregate size, none of which are supplied, so the cover requirement is NOT ESTABLISHED. Corner restraint = ${cornerRestraint}. Corner torsion is determined from the applicable Annex D provisions, not Clause 26.5.2.1.`, result.cornerTorsionStatus === NOT_REQUIRED ? NOT_REQUIRED : result.cornerTorsionReinforcement, '', checks.find((check) => check.id === 'cover')?.status ?? null);
  step(39, 'Final checks and design status', 'Every authoritative check status, then the governing design status', checks.map((check) => `${check.title}: ${check.status}`).join('; '), `${checks.filter((check) => check.status === 'PASS').length} PASS, ${checks.filter((check) => check.status === NOT_REQUIRED).length} NOT REQUIRED, ${checks.filter((check) => check.status === 'VERIFICATION REQUIRED').length} VERIFICATION REQUIRED, ${checks.filter((check) => check.status === 'FAIL').length} FAIL; adopted thickness = ${adoptedThickness === null ? NOT_ESTABLISHED : `${adoptedThickness} mm`}; final status = ${finalStatus}`, '', finalStatus);

  return trace;
}

function steelFy(steelGrade) {
  return getSteelProperties(steelGrade).fy;
}

function concreteFck(concreteGrade) {
  return getConcreteProperties(concreteGrade).fck;
}

function preferredBarDiameterText(context) {
  return context.preferredBarDiameterMm;
}

export function validateSlabCalculationResult(result) {
  const requiredFields = [
    'effectiveSpan',
    'effectiveShortSpan',
    'effectiveLongSpan',
    'ultimateLoad',
    'MuShort',
    'MuLong',
    'AstRequiredShort',
    'AstRequiredLong',
    'AstProvidedShort',
    'AstProvidedLong',
    'effectiveDepthShort',
    'effectiveDepthLong',
    'momentCapacityShort',
    'momentCapacityLong',
    'shearStress',
    'concreteShearStrength',
    'Vu',
    'maxShearStress',
    'governingSpan',
    'governingDirection',
    'governingDeflectionSpan',
    'basicLd',
    'tensionSteelPercent',
    'modificationFactor',
    'actualLd',
    'permissibleLd',
    'maxSpacingShort',
    'maxSpacingLong',
    'clearSpacingShort',
    'clearSpacingLong',
    'cornerRestraint',
    'finalStatus'
  ];

  return requiredFields.every((field) => {
    if (!result || result[field] === undefined) return false;
    if (result[field] === null) {
      return ['modificationFactor', 'permissibleLd'].includes(field);
    }
    if (['finalStatus', 'governingDirection', 'cornerRestraint'].includes(field)) return typeof result[field] === 'string' && result[field].length > 0;
    const value = Number(result[field]);
    return Number.isFinite(value) && value !== Infinity && value !== -Infinity;
  });
}

export function generateSlabDesign(values = {}) {
  const projectName = values.projectName || 'Untitled Project';
  const initialThicknessMm = normalizeDimension(values.slabThickness, 'mm');
  const maxThicknessMm = normalizeDimension(values.maxSlabThickness ?? 300, 'mm');
  const thicknessStepMm = Number.isFinite(Number(values.thicknessIncrement)) ? Number(values.thicknessIncrement) : 10;
  const length = requirePositiveInput({ length: values.slabLength ?? values.length }, 'length');
  const width = requirePositiveInput({ width: values.slabWidth ?? values.width }, 'width');
  const supportThicknessValue = values.wallThickness ?? values.supportWallThickness ?? values.supportThickness ?? values.wallWidth;
  const supportThicknessMm = normalizeSupportThickness(supportThicknessValue);
  const supportType = values.supportType;
  const concreteGrade = values.concreteGrade;
  const steelGrade = values.steelGrade;
  const clearCoverMm = requirePositiveInput(values, 'clearCover');
  const preferredBarDiameterMm = requirePositiveInput(values, 'preferredBarDiameter');
  requirePositiveInput(values, 'floorFinishLoad');
  requirePositiveInput(values, 'liveLoad');
  requirePositiveInput(values, 'unitWeightConcrete');

  if (!supportType) throw new Error('supportType is required.');
  const concrete = getConcreteProperties(concreteGrade);
  const steel = getSteelProperties(steelGrade);

  if (initialThicknessMm <= 0) throw new Error('Slab thickness must be positive.');
  const supportWidthMm = supportThicknessMm;
  if (supportThicknessMm <= 0) throw new Error('Support or wall thickness must be positive.');
  if (clearCoverMm <= 0) throw new Error('Clear cover must be positive.');
  if (clearCoverMm >= initialThicknessMm) throw new Error('Clear cover cannot be greater than or equal to slab thickness.');
  if (preferredBarDiameterMm <= 0) throw new Error('Preferred bar diameter must be positive.');

  // Thickness search schedule. Evaluating D from the initial to the maximum thickness in
  // fixed steps produces a known number of evaluated thicknesses and one fewer increments.
  // This is deliberately separate from `adoptionCount` (how many thicknesses fully
  // satisfied every required check), which is frequently zero.
  const thicknessSchedule = (() => {
    const step = Number.isFinite(thicknessStepMm) && thicknessStepMm > 0 ? thicknessStepMm : 10;
    const evaluatedThicknessCount = Math.floor((maxThicknessMm - initialThicknessMm) / step) + 1;
    return {
      initialThickness: round(initialThicknessMm, 2),
      maximumThickness: round(maxThicknessMm, 2),
      step: round(step, 2),
      incrementCount: Math.max(evaluatedThicknessCount - 1, 0),
      evaluatedThicknessCount: Math.max(evaluatedThicknessCount, 0),
      adoptionCount: 0
    };
  })();

  function buildCandidate(thicknessMm) {
    // The short and long directions are derived from the ordered geometry, so the
    // "short" span is always the smaller overall dimension. The previous code assigned
    // the total short span to the short direction but then subtracted the support width
    // from the wrong axis in the trace, which reported the clear spans backwards.
    const totalShortSpan = Math.min(length, width);
    const totalLongSpan = Math.max(length, width);
    const shortSpanData = calculateEffectiveSpan(totalShortSpan, supportThicknessMm, supportType);
    const longSpanData = calculateEffectiveSpan(totalLongSpan, supportThicknessMm, supportType);
    const spans = {
      totalShortSpan: round(totalShortSpan, 4),
      totalLongSpan: round(totalLongSpan, 4),
      clearShortSpan: shortSpanData.clearSpan,
      clearLongSpan: longSpanData.clearSpan,
      supportWidth: shortSpanData.supportWidth,
      effectiveSpan: longSpanData.effectiveSpan,
      method: `${shortSpanData.method} Short and long directions are derived from the ordered panel geometry (short = ${totalShortSpan} m, long = ${totalLongSpan} m) and calculated independently.`
    };
    // Provisional effective spans (centre-to-centre) are used to classify the panel and to
    // seed the moment design; they are re-resolved against the adopted effective depth
    // after the reinforcement has converged (see resolveEffectiveSpan below).
    let effectiveShortSpan = shortSpanData.effectiveSpan;
    let effectiveLongSpan = longSpanData.effectiveSpan;
    const cornerRestraint = values.cornerRestraint ?? 'FREE_TO_LIFT';
    if (!['FREE_TO_LIFT', 'RESTRAINED'].includes(cornerRestraint)) {
      throw new Error('cornerRestraint must be FREE_TO_LIFT or RESTRAINED.');
    }
    // Classification depends on the selected design path. Table 27's infinity column
    // is not a finite interpolation endpoint; Table 26 retains its Annex D-1.11 limit.
    const coefficientTable = resolveTwoWayCoefficientTable(supportType, cornerRestraint);
    const slabInfo = determineSlabType(effectiveShortSpan, effectiveLongSpan, coefficientTable);

    // Do not send an out-of-range or one-way panel to the two-way coefficient engine.
    if (slabInfo.slabType === 'One Way Slab') {
      throw new Error('ONE-WAY SLAB DESIGN NOT IMPLEMENTED. ly/lx = '
        + `${slabInfo.aspectRatio} is greater than 2, so this panel is classified as a one-way slab `
        + 'per IS 456:2000 Annex D-1.11 / Table 26. This engine implements two-way slab design only and must not '
        + 'apply two-way coefficients to a one-way panel. A one-way design method is required.');
    }
    const loads = calculateLoads({ ...values, slabThickness: thicknessMm, unitWeightConcrete: values.unitWeightConcrete });

    let effectiveDepthShort = calculateEffectiveDepth(thicknessMm, clearCoverMm, preferredBarDiameterMm);
    let effectiveDepthLong = effectiveDepthShort;

    // Interpolate only within the selected table's published range. Out-of-range and
    // one-way panels have already been rejected above.
    let momentDesign = null;
    if (slabInfo.slabType === 'Two Way Slab') {
      try {
        momentDesign = calculateTwoWayMoments(effectiveShortSpan, effectiveLongSpan, slabInfo.aspectRatioExact, loads.ultimateLoad, coefficientTable);
      } catch (error) {
        if (error.code === 'TABLE_27_COEFFICIENT_NOT_ESTABLISHED') {
          error.geometry = {
            shortSpan: effectiveShortSpan,
            longSpan: effectiveLongSpan,
            shortSpanData,
            longSpanData
          };
        }
        throw error;
      }
    }

    let shortRequired = calculateRequiredAst(momentDesign ? momentDesign.MuShort : 0, effectiveDepthShort, concreteGrade, steelGrade, 1000, thicknessMm);
    let longRequired = calculateRequiredAst(momentDesign ? momentDesign.MuLong : 0, effectiveDepthLong, concreteGrade, steelGrade, 1000, thicknessMm);
    const barOptions = [preferredBarDiameterMm, 8, 10, 12, 16, 20].filter((value, index, list) => list.indexOf(value) === index);
    const shortDepthFor = (diameter) => thicknessMm - clearCoverMm - diameter / 2;
    const longDepthFor = (firstLayerDiameter) => (diameter) => thicknessMm - clearCoverMm - firstLayerDiameter - diameter / 2;
    let shortReinforcement = selectPracticalReinforcement(shortRequired.AstRequired, shortRequired.AstMinimum, effectiveDepthShort, barOptions, 300, momentDesign?.MuShort ?? 0, concreteGrade, steelGrade, shortDepthFor);
    let longReinforcement = selectPracticalReinforcement(longRequired.AstRequired, longRequired.AstMinimum, effectiveDepthLong, barOptions, 300, momentDesign?.MuLong ?? 0, concreteGrade, steelGrade, longDepthFor(preferredBarDiameterMm));

    for (let iteration = 0; iteration < 8 && shortReinforcement.valid && longReinforcement.valid; iteration += 1) {
      const nextDepthShort = calculateEffectiveDepth(thicknessMm, clearCoverMm, shortReinforcement.diameter);
      const nextDepthLong = thicknessMm - clearCoverMm - shortReinforcement.diameter - longReinforcement.diameter / 2;
      if (nextDepthLong <= 0) break;
      const nextShortRequired = calculateRequiredAst(momentDesign ? momentDesign.MuShort : 0, nextDepthShort, concreteGrade, steelGrade, 1000, thicknessMm);
      const nextLongRequired = calculateRequiredAst(momentDesign ? momentDesign.MuLong : 0, nextDepthLong, concreteGrade, steelGrade, 1000, thicknessMm);
      const nextShortReinforcement = selectPracticalReinforcement(nextShortRequired.AstRequired, nextShortRequired.AstMinimum, nextDepthShort, barOptions, 300, momentDesign?.MuShort ?? 0, concreteGrade, steelGrade, shortDepthFor);
      const nextLongReinforcement = selectPracticalReinforcement(nextLongRequired.AstRequired, nextLongRequired.AstMinimum, nextDepthLong, barOptions, 300, momentDesign?.MuLong ?? 0, concreteGrade, steelGrade, longDepthFor(shortReinforcement.diameter));
      effectiveDepthShort = nextDepthShort;
      effectiveDepthLong = nextDepthLong;
      shortRequired = nextShortRequired;
      longRequired = nextLongRequired;
      const converged = nextShortReinforcement.diameter === shortReinforcement.diameter && nextShortReinforcement.spacing === shortReinforcement.spacing && nextLongReinforcement.diameter === longReinforcement.diameter && nextLongReinforcement.spacing === longReinforcement.spacing;
      shortReinforcement = nextShortReinforcement;
      longReinforcement = nextLongReinforcement;
      if (converged) break;
    }

    // Clause 22.2 requires the comparison against the ADOPTED effective depth, which is
    // only known once the bar sizes have converged. Re-resolve both directions here and
    // use the resulting effective spans for the shear and deflection checks below.
    const resolvedShortSpan = resolveEffectiveSpan(shortSpanData, effectiveDepthShort);
    const resolvedLongSpan = resolveEffectiveSpan(longSpanData, effectiveDepthLong);
    effectiveShortSpan = resolvedShortSpan.effectiveSpan;
    effectiveLongSpan = resolvedLongSpan.effectiveSpan;
    spans.clearShortSpan = resolvedShortSpan.clearSpan;
    spans.clearLongSpan = resolvedLongSpan.clearSpan;
    spans.effectiveSpan = resolvedLongSpan.effectiveSpan;
    spans.shortSpanResolution = resolvedShortSpan;
    spans.longSpanResolution = resolvedLongSpan;
    spans.inputSpanDefinition = 'Length and Width are the CENTRE-TO-CENTRE support spans. The clear span is the centre-to-centre span less the support width.';

    const shortCapacity = calculateMomentCapacity(effectiveDepthShort, shortReinforcement.AstProvided, concreteGrade, steelGrade, 1000);
    const longCapacity = calculateMomentCapacity(effectiveDepthLong, longReinforcement.AstProvided, concreteGrade, steelGrade, 1000);
    const shear = calculateShear(effectiveDepthShort, loads.ultimateLoad, effectiveShortSpan, supportThicknessMm / 1000, concreteGrade, shortReinforcement.AstProvided);
    const deflection = selectGoverningDeflection(effectiveShortSpan, effectiveDepthShort, shortReinforcement, shortRequired, effectiveLongSpan, effectiveDepthLong, longReinforcement, longRequired, supportType, steelGrade);
    const checks = [];
    checks.push(createCheck('effectiveSpan', 'Effective span validity', CHECK_STATUS.PASS, spans.effectiveSpan, null, spans.effectiveSpan > 0 ? 'Effective span is finite and positive.' : 'Effective span is not valid.', 'IS 456:2000 Clause 22.2', 'm'));
    checks.push(createCheck('classification', 'Slab classification', CHECK_STATUS.PASS, slabInfo.aspectRatio, slabInfo.twoWayLimit, `ly/lx = ${slabInfo.aspectRatio} -> ${slabInfo.slabType}. ${slabInfo.criterion}`, coefficientTable.tableReference, '-'));
    checks.push(createCheck('flexureShort', 'Short-direction flexural capacity', shortCapacity.status === 'PASS' && shortCapacity.MuProvided >= momentDesign?.MuShort ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL, shortCapacity.MuProvided, momentDesign?.MuShort ?? 0, `Mu provided ${shortCapacity.MuProvided ?? 'NOT CALCULATED'} >= Mu required ${momentDesign?.MuShort ?? 'NOT CALCULATED'} kN·m/m and xu ${shortCapacity.xu ?? 'NOT CALCULATED'} <= xu,max ${shortCapacity.xuMax} mm.`, 'IS 456:2000 Clause 38.1', 'kN·m/m'));
    checks.push(createCheck('flexureLong', 'Long-direction flexural capacity', longCapacity.status === 'PASS' && longCapacity.MuProvided >= momentDesign?.MuLong ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL, longCapacity.MuProvided, momentDesign?.MuLong ?? 0, `Mu provided ${longCapacity.MuProvided ?? 'NOT CALCULATED'} >= Mu required ${momentDesign?.MuLong ?? 'NOT CALCULATED'} kN·m/m and xu ${longCapacity.xu ?? 'NOT CALCULATED'} <= xu,max ${longCapacity.xuMax} mm.`, 'IS 456:2000 Clause 38.1', 'kN·m/m'));
    checks.push(createCheck('requiredSteelShort', 'Short required reinforcement', shortReinforcement.valid && shortReinforcement.AstProvided >= shortRequired.astRequiredForDesign ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL, shortReinforcement.AstProvided, shortRequired.astRequiredForDesign, `Ast provided ${shortReinforcement.AstProvided ?? 'NOT CALCULATED'} >= Ast required for design ${shortRequired.astRequiredForDesign ?? 'NOT CALCULATED'} mm²/m (flexural ${shortRequired.astFlexuralRequired ?? 'NOT CALCULATED'}; minimum ${shortRequired.astMinimum} mm²/m).`, 'IS 456:2000 Clause 38.1', 'mm²/m'));
    checks.push(createCheck('requiredSteelLong', 'Long required reinforcement', longReinforcement.valid && longReinforcement.AstProvided >= longRequired.astRequiredForDesign ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL, longReinforcement.AstProvided, longRequired.astRequiredForDesign, `Ast provided ${longReinforcement.AstProvided ?? 'NOT CALCULATED'} >= Ast required for design ${longRequired.astRequiredForDesign ?? 'NOT CALCULATED'} mm²/m (flexural ${longRequired.astFlexuralRequired ?? 'NOT CALCULATED'}; minimum ${longRequired.astMinimum} mm²/m).`, 'IS 456:2000 Clause 38.1', 'mm²/m'));
    checks.push(createCheck('minimumSteelShort', 'Short minimum reinforcement', shortReinforcement.valid && shortReinforcement.AstProvided >= shortRequired.astMinimum ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL, shortReinforcement.AstProvided, shortRequired.astMinimum, `Ast provided ${shortReinforcement.AstProvided ?? 'NOT CALCULATED'} >= Ast min ${shortRequired.astMinimum} mm²/m.`, 'IS 456:2000 Clause 26.5.2.1', 'mm²/m'));
    checks.push(createCheck('minimumSteelLong', 'Long minimum reinforcement', longReinforcement.valid && longReinforcement.AstProvided >= longRequired.astMinimum ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL, longReinforcement.AstProvided, longRequired.astMinimum, `Ast provided ${longReinforcement.AstProvided ?? 'NOT CALCULATED'} >= Ast min ${longRequired.astMinimum} mm²/m.`, 'IS 456:2000 Clause 26.5.2.1', 'mm²/m'));
    checks.push(createCheck('spacingShort', 'Short maximum spacing', shortReinforcement.valid && shortReinforcement.spacing <= shortReinforcement.maxSpacing ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL, shortReinforcement.spacing, shortReinforcement.maxSpacing, `Provided spacing ${shortReinforcement.spacing ?? 'NOT CALCULATED'} mm <= max ${shortReinforcement.maxSpacing ?? 'NOT CALCULATED'} mm.`, 'IS 456:2000 Clause 26.3.3', 'mm'));
    checks.push(createCheck('spacingLong', 'Long maximum spacing', longReinforcement.valid && longReinforcement.spacing <= longReinforcement.maxSpacing ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL, longReinforcement.spacing, longReinforcement.maxSpacing, `Provided spacing ${longReinforcement.spacing ?? 'NOT CALCULATED'} mm <= max ${longReinforcement.maxSpacing ?? 'NOT CALCULATED'} mm.`, 'IS 456:2000 Clause 26.3.3', 'mm'));
    const minimumClearSpacingShort = Math.max(shortReinforcement.diameter ?? 0, constants.slabDetailing.minimumClearSpacingMm);
    const minimumClearSpacingLong = Math.max(longReinforcement.diameter ?? 0, constants.slabDetailing.minimumClearSpacingMm);
    checks.push(createCheck('clearSpacingShort', 'Short clear spacing', shortReinforcement.valid && shortReinforcement.clearSpacing >= minimumClearSpacingShort ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL, shortReinforcement.clearSpacing, minimumClearSpacingShort, `Clear spacing ${shortReinforcement.clearSpacing ?? 'NOT CALCULATED'} mm >= minimum ${minimumClearSpacingShort} mm.`, 'IS 456:2000 Clause 26.3.2', 'mm'));
    checks.push(createCheck('clearSpacingLong', 'Long clear spacing', longReinforcement.valid && longReinforcement.clearSpacing >= minimumClearSpacingLong ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL, longReinforcement.clearSpacing, minimumClearSpacingLong, `Clear spacing ${longReinforcement.clearSpacing ?? 'NOT CALCULATED'} mm >= minimum ${minimumClearSpacingLong} mm.`, 'IS 456:2000 Clause 26.3.2', 'mm'));
    checks.push(createCheck('shear', 'Shear check', shear.status === 'PASS' ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL, shear.shearStress, shear.concreteShearStrength, shear.message, 'IS 456:2000 Clause 40 and Table 19', 'N/mm²'));
    checks.push(createCheck('deflection', 'Deflection control', deflection.status, deflection.actualLd, deflection.permissibleLd, deflection.message, 'IS 456:2000 Clause 23.2 and Fig. 4', '-', deflection.verificationRequired));
    // Cover is split into two distinct items:
    //  (a) a GEOMETRIC check that the clear cover can physically accommodate the bar
    //      (cover >= bar diameter), which is determinable from the inputs; and
    //  (b) the DURABILITY / fire-resistance basis required by Clause 26.4, which
    //      depends on the exposure condition, fire rating, bar diameter and aggregate
    //      size. Those are NOT design inputs, so (b) is NOT ESTABLISHED.
    // The cover is never compared against the slab thickness: that is not a Clause 26.4 check.
    const coverGeometricPass = clearCoverMm >= shortReinforcement.diameter && clearCoverMm >= longReinforcement.diameter;
    checks.push(createCheck('coverGeometric', 'Cover vs bar diameter (geometric)', coverGeometricPass ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL, clearCoverMm, Math.max(shortReinforcement.diameter ?? 0, longReinforcement.diameter ?? 0),
      `Clear cover ${clearCoverMm} mm vs bar diameter ${Math.max(shortReinforcement.diameter ?? 0, longReinforcement.diameter ?? 0)} mm: `
      + `${coverGeometricPass ? 'the cover physically accommodates the bar (geometric check PASS)' : 'the cover is less than the bar diameter and is not physically buildable'}.`,
      'IS 456:2000 Clause 26.4 (geometric bar accommodation)', 'mm'));
    checks.push(createCheck('cover', 'Cover durability / fire basis', CHECK_STATUS.VERIFICATION_REQUIRED, clearCoverMm, null,
      `Nominal clear cover of ${clearCoverMm} mm is a user input. IS 456:2000 Clause 26.4 requires the nominal cover to be derived from the exposure condition, the required fire resistance, the bar diameter and the aggregate size; these are not supplied, so the durability/fire cover requirement is NOT ESTABLISHED and cannot be code-verified automatically. The cover is not compared with the slab thickness.`,
      'IS 456:2000 Clause 26.4', 'mm', true));
    checks.push(createCornerTorsionCheck(cornerRestraint, cornerRestraint === 'FREE_TO_LIFT' ? 'Not required under the explicit FREE_TO_LIFT assumption.' : 'REVIEW REQUIRED — restrained corner torsion design not implemented.', cornerRestraint === 'FREE_TO_LIFT' ? NOT_REQUIRED : 'VERIFICATION REQUIRED', cornerRestraint === 'FREE_TO_LIFT' ? CORNER_TORSION_FREE_BASIS : CORNER_TORSION_RESTRAINED_BASIS));

    // Annex D-2.1.1 bar extension / curtailment. The requirement and the 0.1l termination
    // distance are computed; the discrete curtailed bar count needs a bar schedule, so the
    // item is reported as VERIFICATION REQUIRED rather than claimed as satisfied.
    const shortBarExtension = annexD211BarExtension(effectiveShortSpan, 'short');
    const longBarExtension = annexD211BarExtension(effectiveLongSpan, 'long');
    checks.push(createCheck('barExtension', 'Bar extension / curtailment (Annex D-2.1.1)', CHECK_STATUS.VERIFICATION_REQUIRED, 0.5, 0.5,
      `At least 50% of the midspan tension reinforcement must be extended to the supports. `
      + `Short direction: 0.1 lx = ${shortBarExtension.terminationAllowanceM} m from the support face; `
      + `long direction: 0.1 ly = ${longBarExtension.terminationAllowanceM} m from the support face. `
      + `${shortBarExtension.verificationNote}`,
      'IS 456:2000 Annex D-2.1.1', '-', true));

    const hasFail = checks.some((check) => check.status === 'FAIL');
    const hasVerification = checks.some((check) => check.status === 'VERIFICATION REQUIRED');
    const hasNotRequired = checks.some((check) => check.status === NOT_REQUIRED);
    // Beam-module status hierarchy: FAIL dominates VERIFICATION REQUIRED, and
    // NOT REQUIRED is a legitimate outcome that must never be promoted to FAIL.
    const finalStatus = hasFail ? 'NOT APPROVED' : hasVerification ? 'VERIFICATION REQUIRED' : 'APPROVED';
    void hasNotRequired;

    const result = {
      projectName,
      designType: 'Slab',
      initialSlabThickness: round(initialThicknessMm, 2),
      initialThickness: round(initialThicknessMm, 2),
      lastEvaluatedThickness: round(thicknessMm, 2),
      adoptedThickness: finalStatus === 'APPROVED' ? round(thicknessMm, 2) : null,
      designStatus: finalStatus,
      supportType,
      slabType: slabInfo.slabType,
      slabThickness: round(thicknessMm, 2),
      supportWallThickness: round(supportThicknessMm, 2),
      supportThickness: round(supportThicknessMm, 2),
      clearCover: round(clearCoverMm, 2),
      length: round(length, 3),
      width: round(width, 3),
      slabLength: round(length, 3),
      slabWidth: round(width, 3),
      effectiveSpan: round(spans.effectiveSpan, 4),
      clearSpan: round(spans.clearShortSpan, 4),
      totalShortSpan: round(spans.totalShortSpan, 4),
      totalLongSpan: round(spans.totalLongSpan, 4),
      clearShortSpan: round(shortSpanData.clearSpan, 4),
      clearLongSpan: round(longSpanData.clearSpan, 4),
      supportWidth: round(spans.supportWidth, 4),
      effectiveSpanMethod: spans.method,
      effectiveShortSpan: round(effectiveShortSpan, 3),
      effectiveLongSpan: round(effectiveLongSpan, 3),
      // Authoritative span identifiers used by the UI, the PDF and the drawing.
      // Previously only the two-way helper's local `shortSpan`/`longSpan` existed,
      // so every consumer that read result.shortSpan/result.longSpan rendered blank.
      shortSpan: round(effectiveShortSpan, 3),
      longSpan: round(effectiveLongSpan, 3),
      shortSpanLabel: 'Lx',
      longSpanLabel: 'Ly',
      aspectRatio: round(slabInfo.aspectRatio, 3),
      finiteCoefficientLimit: slabInfo.finiteCoefficientLimit,
      selfWeight: loads.selfWeight,
      floorFinish: loads.floorFinish,
      liveLoad: loads.liveLoad,
      deadLoad: loads.deadLoad,
      serviceLoad: loads.serviceLoad,
      ultimateLoad: loads.ultimateLoad,
      coefficientShort: momentDesign ? momentDesign.coefficientShort : null,
      coefficientLong: momentDesign ? momentDesign.coefficientLong : null,
      alphaX: momentDesign ? momentDesign.coefficientShort : null,
      alphaY: momentDesign ? momentDesign.coefficientLong : null,
      coefficientSource: momentDesign ? momentDesign.coefficientSource : null,
      coefficientTableId: momentDesign ? momentDesign.coefficientTableId : null,
      coefficientTableReference: momentDesign ? momentDesign.coefficientTableReference : null,
      coefficientSelectionReason: momentDesign ? momentDesign.coefficientSelectionReason : null,
      coefficientTableRuledOut: momentDesign ? momentDesign.coefficientRuledOut : null,
      coefficientInterpolationLowerM: momentDesign ? momentDesign.interpolationLowerM : null,
      coefficientInterpolationUpperM: momentDesign ? momentDesign.interpolationUpperM : null,
      coefficientInterpolationFraction: momentDesign ? momentDesign.interpolationFraction : null,
      momentEquation: momentDesign ? momentDesign.momentEquation : null,
      shortSpanUsedForBothMoments: momentDesign ? momentDesign.shortSpanUsedForBothMoments : null,
      MuShort: momentDesign ? momentDesign.MuShort : null,
      MuLong: momentDesign ? momentDesign.MuLong : null,
      MuX: momentDesign ? momentDesign.MuShort : null,
      MuY: momentDesign ? momentDesign.MuLong : null,
      effectiveDepthShort: round(effectiveDepthShort, 2),
      effectiveDepthLong: round(effectiveDepthLong, 2),
      // The physical layer assumption that produces the two effective depths. This is a
      // real detailing assumption (long-direction bars sit above the short-direction
      // layer) and must be stated rather than silently applied.
      effectiveDepthLayerAssumption: `Short-direction bars form the bottom layer, so d_short = D - cover - phi_short/2 = ${round(effectiveDepthShort, 2)} mm. The long-direction bars are placed physically above the short-direction layer, so d_long = D - cover - phi_short - phi_long/2 = ${round(effectiveDepthLong, 2)} mm.`,
      effectiveDepthShortBasis: 'D - clear cover - short bar diameter / 2 (single bottom layer).',
      effectiveDepthLongBasis: 'D - clear cover - short bar diameter - long bar diameter / 2 (long-direction layer above the short-direction layer).',
      AstRequiredShort: nullableRound(shortRequired.astRequiredForDesign, 2),
      AstFlexuralRequiredShort: nullableRound(shortRequired.astFlexuralRequired, 2),
      AstMinimumShort: round(shortRequired.astMinimum, 2),
      AstMinShort: round(shortRequired.astMinimum, 2),
      AstProvidedShort: nullableRound(shortReinforcement.AstProvided, 2),
      xuShort: nullableRound(shortCapacity.xu, 2),
      xuMaxShort: round(shortCapacity.xuMax, 2),
      momentCapacityShort: nullableRound(shortCapacity.MuProvided, 2),
      shortDirectionReinforcement: {
        diameter: shortReinforcement.diameter,
        spacing: shortReinforcement.spacing,
        AstProvided: nullableRound(shortReinforcement.AstProvided, 2),
        // Authoritative per-direction steel areas. The flexural requirement and the
        // Clause 26.5.2.1 minimum are separate values; the design requirement is their
        // maximum. Collapsing them hides the real flexural demand.
        AstRequired: nullableRound(shortRequired.astRequiredForDesign, 2),
        AstFlexuralRequired: nullableRound(shortRequired.astFlexuralRequired, 2),
        AstMinimum: nullableRound(shortRequired.astMinimum, 2),
        AstMaximum: nullableRound(shortRequired.AstMaximum, 2),
        governingDriver: shortRequired.governingDriver ?? null,
        xu: nullableRound(shortCapacity.xu, 2),
        xuMax: nullableRound(shortCapacity.xuMax, 2),
        momentCapacity: nullableRound(shortCapacity.MuProvided, 2),
        momentRequired: momentDesign ? momentDesign.MuShort : null,
        flexuralStatus: checks[2].status,
        requiredSteelStatus: checks[4].status,
        minimumSteelStatus: checks[6].status,
        maximumSpacingStatus: checks[8].status,
        clearSpacingStatus: checks[10].status,
        label: `${shortReinforcement.diameter ?? NOT_PROVIDED} mm @ ${shortReinforcement.spacing ?? NOT_PROVIDED} mm c/c`,
        maxSpacing: nullableRound(shortReinforcement.maxSpacing, 2),
        clearSpacing: nullableRound(shortReinforcement.clearSpacing, 2),
        effectiveDepth: round(effectiveDepthShort, 2)
      },
      shortDirectionAstRequired: nullableRound(shortRequired.astRequiredForDesign, 2),
      shortDirectionAstFlexuralRequired: nullableRound(shortRequired.astFlexuralRequired, 2),
      shortDirectionAstMinimum: nullableRound(shortRequired.astMinimum, 2),
      shortDirectionAstProvided: nullableRound(shortReinforcement.AstProvided, 2),
      shortDirectionMomentRequired: momentDesign ? momentDesign.MuShort : null,
      shortDirectionMomentCapacity: nullableRound(shortCapacity.MuProvided, 2),
      shortDirectionFlexuralStatus: checks[2].status,
      fck: concrete.fck,
      fy: steel.fy,
      AstRequiredLong: nullableRound(longRequired.astRequiredForDesign, 2),
      AstFlexuralRequiredLong: nullableRound(longRequired.astFlexuralRequired, 2),
      AstMinimumLong: round(longRequired.astMinimum, 2),
      AstMinLong: round(longRequired.astMinimum, 2),
      AstProvidedLong: nullableRound(longReinforcement.AstProvided, 2),
      xuLong: nullableRound(longCapacity.xu, 2),
      xuMaxLong: round(longCapacity.xuMax, 2),
      momentCapacityLong: nullableRound(longCapacity.MuProvided, 2),
      longDirectionReinforcement: {
        diameter: longReinforcement.diameter,
        spacing: longReinforcement.spacing,
        AstProvided: nullableRound(longReinforcement.AstProvided, 2),
        AstRequired: nullableRound(longRequired.astRequiredForDesign, 2),
        AstFlexuralRequired: nullableRound(longRequired.astFlexuralRequired, 2),
        AstMinimum: nullableRound(longRequired.astMinimum, 2),
        AstMaximum: nullableRound(longRequired.AstMaximum, 2),
        governingDriver: longRequired.governingDriver ?? null,
        xu: nullableRound(longCapacity.xu, 2),
        xuMax: nullableRound(longCapacity.xuMax, 2),
        momentCapacity: nullableRound(longCapacity.MuProvided, 2),
        momentRequired: momentDesign ? momentDesign.MuLong : null,
        flexuralStatus: checks[3].status,
        requiredSteelStatus: checks[5].status,
        minimumSteelStatus: checks[7].status,
        maximumSpacingStatus: checks[9].status,
        clearSpacingStatus: checks[11].status,
        label: `${longReinforcement.diameter ?? NOT_PROVIDED} mm @ ${longReinforcement.spacing ?? NOT_PROVIDED} mm c/c`,
        maxSpacing: nullableRound(longReinforcement.maxSpacing, 2),
        clearSpacing: nullableRound(longReinforcement.clearSpacing, 2),
        effectiveDepth: round(effectiveDepthLong, 2)
      },
      longDirectionAstRequired: nullableRound(longRequired.astRequiredForDesign, 2),
      longDirectionAstFlexuralRequired: nullableRound(longRequired.astFlexuralRequired, 2),
      longDirectionAstMinimum: nullableRound(longRequired.astMinimum, 2),
      longDirectionAstProvided: nullableRound(longReinforcement.AstProvided, 2),
      longDirectionMomentRequired: momentDesign ? momentDesign.MuLong : null,
      longDirectionMomentCapacity: nullableRound(longCapacity.MuProvided, 2),
      longDirectionFlexuralStatus: checks[3].status,
      shortDirectionMinCheck: { status: shortReinforcement.valid && shortReinforcement.AstProvided >= shortRequired.astMinimum ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL, actual: shortReinforcement.AstProvided, limit: shortRequired.astMinimum },
      longDirectionMinCheck: { status: longReinforcement.valid && longReinforcement.AstProvided >= longRequired.astMinimum ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL, actual: longReinforcement.AstProvided, limit: longRequired.astMinimum },
      // Cover is a user input, not a code-verified value: Clause 26.4 needs the exposure
      // condition, fire resistance, bar diameter and aggregate size.
      coverVerification: {
        providedClearCover: round(clearCoverMm, 2),
        status: CHECK_STATUS.VERIFICATION_REQUIRED,
        established: false,
        label: NOT_ESTABLISHED,
        reason: 'Cover verification: VERIFICATION REQUIRED / NOT ESTABLISHED — the IS 456:2000 Clause 26.4 durability and fire-resistance cover requirement depends on the exposure condition, the required fire resistance, the bar diameter and the aggregate size, none of which are supplied. The user-provided cover is carried as an input and is checked geometrically against the bar diameter only; it is not compared with the slab thickness.'
      },
      spacingShort: { maxSpacing: nullableRound(shortReinforcement.maxSpacing, 2), providedSpacing: shortReinforcement.spacing, status: checks[8].status, governingRule: constants.slabDetailing.maximumSpacingRule },
      spacingLong: { maxSpacing: nullableRound(longReinforcement.maxSpacing, 2), providedSpacing: longReinforcement.spacing, status: checks[9].status, governingRule: constants.slabDetailing.maximumSpacingRule },
      maximumBarDiameterRule: 'IS 456:2000 Clause 26.5.2.2: the diameter of a bar forming the main reinforcement of a solid slab shall not exceed 1/8 of the slab thickness, subject to a maximum of 12 mm.',
      shearStress: round(shear.shearStress, 4),
      concreteShearStrength: round(shear.concreteShearStrength, 4),
      maxShearStress: round(shear.maxShearStress, 4),
      Vu: shear.Vu,
      shearReaction: shear.reaction,
      shearCapacity: shear.capacity,
      criticalSection: shear.criticalSection,
      shearCriticalSectionFromCentrelineM: shear.criticalSectionFromCentrelineM,
      shearSupportFaceToCentrelineM: shear.supportFaceToCentrelineM,
      // Explicit basis statement for the shear model, so the UI and PDF can state that
      // this is a conservative one-metre-strip check rather than implying a two-way
      // load-distribution model.
      shearBasis: {
        analysisWidth: 'One-metre strip (b = 1000 mm)',
        conservative: true,
        conservatismNote: 'The full ultimate load wu is taken over the full one-metre strip with no two-way tributary-width (load-sharing) reduction, so the computed shear demand is an upper bound.',
        governingDirection: 'Short direction (short span lx)',
        longDirectionCheck: 'Not performed. A separate long-direction check would require a two-way load-distribution model that this engine does not implement.',
        criticalSectionBasis: 'IS 456:2000 Clause 40: critical section at distance d from the FACE of the support. The effective span is centre-to-centre, so the lever arm is lx/2 - (support width)/2 - d.',
        shearReinforcementDesigned: false,
        shearReinforcementNote: 'No shear reinforcement is designed. The check verifies the Table 19 and Table 20 concrete limits only; a failure is reported as FAIL rather than assumed to be carried by the flexural steel.'
      },
      shearReinforcement: shear.reinforcement,
      shearTensionSteelPercent: shear.tensionSteelPercent,
      shearStatus: shear.status,
      actualLd: round(deflection.actualLd, 2),
      permissibleLd: deflection.permissibleLd,
      basicLd: deflection.basicRatio,
      governingSpan: deflection.governingSpan,
      governingDirection: deflection.governingDirection,
      governingDeflectionSpan: deflection.governingSpan,
      tensionSteelPercent: deflection.tensionSteelPercent,
      deflectionServiceStress: deflection.serviceStress,
      modificationFactor: deflection.modificationFactor,
      deflectionPt: deflection.pt,
      deflectionFs: deflection.fs,
      deflectionAstUsedForPt: deflection.astUsedForPt,
      deflectionAstRequiredForFs: deflection.astRequiredForFs,
      deflectionAstFlexuralRequiredUsedForFs: deflection.astFlexuralRequiredUsedForFs,
      deflectionAstProvidedUsedForFs: deflection.astProvidedUsedForFs,
      deflectionAstUsedForFsBasis: deflection.astUsedForFsBasis,
      deflectionOutOfRangeInputs: deflection.outOfRangeInputs,
      deflectionPtWidth: deflection.ptWidth,
      deflectionPtEffectiveDepth: deflection.ptEffectiveDepth,
      deflectionPtFormula: deflection.ptFormula,
      deflectionFsFormula: deflection.fsFormula,
      deflectionPtTrace: deflection.ptTrace,
      deflectionFsTrace: deflection.fsTrace,
      deflectionPtLower: deflection.ptLower,
      deflectionPtUpper: deflection.ptUpper,
      deflectionPtRange: deflection.ptRange,
      deflectionFsLower: deflection.fsLower,
      deflectionFsUpper: deflection.fsUpper,
      deflectionFsRange: deflection.fsRange,
      deflectionPtInterpolationRatio: deflection.ptInterpolationRatio,
      deflectionFsInterpolationRatio: deflection.fsInterpolationRatio,
      deflectionFactorAtLowerPtLowerFs: deflection.factorAtLowerPtLowerFs,
      deflectionFactorAtLowerPtUpperFs: deflection.factorAtLowerPtUpperFs,
      deflectionFactorAtUpperPtLowerFs: deflection.factorAtUpperPtLowerFs,
      deflectionFactorAtUpperPtUpperFs: deflection.factorAtUpperPtUpperFs,
      deflectionPtClamped: deflection.ptClamped,
      deflectionFsClamped: deflection.fsClamped,
      deflectionClampingApplied: deflection.clampingApplied,
      deflectionDatasetSource: deflection.datasetSource,
      deflectionDatasetVersion: deflection.datasetVersion,
      deflectionShort: deflection.short,
      deflectionLong: deflection.long,
      deflectionMethod: deflection.method,
      deflectionSource: deflection.source,
      deflectionInterpolation: deflection.interpolation,
      deflectionStatus: deflection.status,
      deflectionMessage: deflection.message,
      maxSpacingShort: nullableRound(shortReinforcement.maxSpacing, 2),
      maxSpacingLong: nullableRound(longReinforcement.maxSpacing, 2),
      clearSpacingShort: nullableRound(shortReinforcement.clearSpacing, 2),
      clearSpacingLong: nullableRound(longReinforcement.clearSpacing, 2),
      minimumClearSpacing: constants.slabDetailing.minimumClearSpacingMm,
      minimumClearSpacingRule: constants.slabDetailing.minimumClearSpacingRule,
      maximumSpacingRule: constants.slabDetailing.maximumSpacingRule,
      minimumReinforcementRule: 'IS 456:2000 Clause 26.5.2.1: for mild steel, the minimum area of main reinforcement in each direction of a solid slab shall be 0.15% of the gross cross-sectional area, and 0.12% where high-grade deformed bars (Fe500) are used; this value governs over the ductile detailing minimum.',
      cornerRestraint,
      cornerRestraintLabel: cornerRestraint === 'FREE_TO_LIFT' ? 'FREE TO LIFT' : 'RESTRAINED',
      cornerTorsionReinforcement: cornerRestraint === 'FREE_TO_LIFT' ? 'Not required under the explicit FREE_TO_LIFT assumption.' : 'REVIEW REQUIRED — restrained corner torsion design not implemented.',
      cornerTorsionStatus: cornerRestraint === 'FREE_TO_LIFT' ? NOT_REQUIRED : 'VERIFICATION REQUIRED',
      cornerTorsionBasis: cornerRestraint === 'FREE_TO_LIFT' ? CORNER_TORSION_FREE_BASIS : CORNER_TORSION_RESTRAINED_BASIS,
      cornerTorsionReason: cornerRestraint === 'FREE_TO_LIFT' ? CORNER_TORSION_FREE_REASON
        : CORNER_TORSION_RESTRAINED_REASON,
      // IS 456:2000 Annex D-2.1.1 bar extension / curtailment requirement.
      barExtension: {
        reference: 'IS 456:2000 Annex D-2.1.1',
        requirement: 'At least 50% of the tension reinforcement provided at midspan must be extended to the supports; the remaining 50% may be curtailed to within 0.1 lx (or 0.1 ly) of the support face.',
        short: shortBarExtension,
        long: longBarExtension,
        status: 'VERIFICATION REQUIRED',
        verificationNote: shortBarExtension.verificationNote
      },
      finalStatus,
      checks,
      mainReinforcement: `${shortReinforcement.diameter ?? NOT_PROVIDED} mm @ ${shortReinforcement.spacing ?? NOT_PROVIDED} mm c/c`,
      distributionReinforcement: `${longReinforcement.diameter ?? NOT_PROVIDED} mm @ ${longReinforcement.spacing ?? NOT_PROVIDED} mm c/c`,
      mainReinforcementLabel: 'Short direction (main)',
      distributionReinforcementLabel: 'Long direction (distribution)',
      momentCapacityStatus: shortCapacity.MuProvided >= (momentDesign?.MuShort ?? 0) && longCapacity.MuProvided >= (momentDesign?.MuLong ?? 0) ? 'Capacity >= design moment' : 'Capacity < design moment',
      checksByCategory: {
        effectiveSpan: checks[0],
        classification: checks[1],
        flexureShort: checks[2],
        flexureLong: checks[3],
        requiredSteelShort: checks[4],
        requiredSteelLong: checks[5],
        minimumSteelShort: checks[6],
        minimumSteelLong: checks[7],
        spacingShort: checks[8],
        spacingLong: checks[9],
        clearSpacingShort: checks[10],
        clearSpacingLong: checks[11],
        shear: checks[12],
        deflection: checks[13],
        coverGeometric: checks[14],
        cover: checks[15],
        cornerTorsion: checks[16],
        barExtension: checks[17]
      },
      designStatus: finalStatus,
      validationStatus: validateSlabCalculationResult({
        effectiveSpan: round(spans.effectiveSpan, 4),
        effectiveShortSpan: round(effectiveShortSpan, 3),
        effectiveLongSpan: round(effectiveLongSpan, 3),
        ultimateLoad: loads.ultimateLoad,
        MuShort: momentDesign ? momentDesign.MuShort : null,
        MuLong: momentDesign ? momentDesign.MuLong : null,
        AstRequiredShort: shortRequired.astRequiredForDesign,
        AstRequiredLong: longRequired.astRequiredForDesign,
        AstProvidedShort: shortReinforcement.AstProvided,
        AstProvidedLong: longReinforcement.AstProvided,
        effectiveDepthShort: effectiveDepthShort,
        effectiveDepthLong: effectiveDepthLong,
        momentCapacityShort: shortCapacity.MuProvided,
        momentCapacityLong: longCapacity.MuProvided,
        shearStress: shear.shearStress,
        concreteShearStrength: shear.concreteShearStrength,
        Vu: shear.Vu,
        maxShearStress: shear.maxShearStress,
        governingSpan: deflection.governingSpan,
        governingDirection: deflection.governingDirection,
        governingDeflectionSpan: deflection.governingSpan,
        basicLd: deflection.basicRatio,
        tensionSteelPercent: deflection.tensionSteelPercent,
        modificationFactor: deflection.modificationFactor,
        actualLd: deflection.actualLd,
        permissibleLd: deflection.permissibleLd,
        maxSpacingShort: shortReinforcement.maxSpacing,
        maxSpacingLong: longReinforcement.maxSpacing,
        clearSpacingShort: shortReinforcement.clearSpacing,
        clearSpacingLong: longReinforcement.clearSpacing,
        finalStatus,
        cornerRestraint
      })
    };

    result.validationMessage = result.validationStatus ? 'All required engineering values are finite and valid.' : 'Validation failed: one or more required engineering values are undefined, null, NaN or Infinity.';

    // Authoritative design-output block. The UI renders this verbatim; it never
    // re-derives a displayed value from raw inputs.
    result.designOutput = {
      designType: 'Slab',
      projectName,
      slabType: result.slabType,
      supportType: result.supportType,
      concreteGrade,
      steelGrade,
      slabThickness: result.slabThickness,
      initialThickness: result.initialThickness,
      lastEvaluatedThickness: result.lastEvaluatedThickness,
      adoptedThickness: result.adoptedThickness === null ? NOT_ESTABLISHED : result.adoptedThickness,
      effectiveDepthShort: result.effectiveDepthShort,
      effectiveDepthLong: result.effectiveDepthLong,
      shortSpan: result.shortSpan,
      longSpan: result.longSpan,
      shortSpanUnit: 'm',
      aspectRatio: result.aspectRatio,
      clearSpan: result.clearSpan,
      clearShortSpan: result.clearShortSpan,
      clearLongSpan: result.clearLongSpan,
      totalShortSpan: result.totalShortSpan,
      totalLongSpan: result.totalLongSpan,
      coefficientTableReference: result.coefficientTableReference,
      supportWallThickness: result.supportWallThickness,
      clearCover: result.clearCover,
      coverVerificationStatus: result.coverVerification.status,
      effectiveDepthShortBasis: result.effectiveDepthShortBasis,
      effectiveDepthLongBasis: result.effectiveDepthLongBasis,
      cornerRestraint: result.cornerRestraint,
      cornerRestraintLabel: result.cornerRestraintLabel
    };

    result.loadSummary = {
      selfWeight: result.selfWeight,
      floorFinish: result.floorFinish,
      deadLoad: result.deadLoad,
      liveLoad: result.liveLoad,
      serviceLoad: result.serviceLoad,
      ultimateLoad: result.ultimateLoad,
      unit: 'kN/m²'
    };

    result.designForces = {
      aspectRatio: result.aspectRatio,
      coefficientSource: result.coefficientSource,
      coefficientTableId: result.coefficientTableId,
      coefficientTableReference: result.coefficientTableReference,
      coefficientSelectionReason: result.coefficientSelectionReason,
      coefficientTableRuledOut: result.coefficientTableRuledOut,
      coefficientInterpolationLowerM: result.coefficientInterpolationLowerM,
      coefficientInterpolationUpperM: result.coefficientInterpolationUpperM,
      alphaX: result.alphaX,
      alphaY: result.alphaY,
      MuShort: result.MuShort,
      MuLong: result.MuLong,
      MuX: result.MuX,
      MuY: result.MuY,
      momentEquation: result.momentEquation,
      shortSpanUsedForBothMoments: result.shortSpanUsedForBothMoments,
      momentUnit: 'kN·m/m'
    };

    result.calculationSteps = buildCalculationTrace({
      result,
      loads: { ...loads, unitWeight: values.unitWeightConcrete },
      slabInfo,
      spans,
      momentDesign,
      shortRequired,
      longRequired,
      shortReinforcement,
      longReinforcement,
      shortCapacity,
      longCapacity,
      shear,
      deflection,
      checks,
      finalStatus: finalStatus,
      // Thickness-iteration metadata is computed from the search schedule up front so the
      // trace reports the real evaluation count rather than the (still empty) iteration list.
      evaluatedThicknessCount: thicknessSchedule.evaluatedThicknessCount,
      incrementCount: thicknessSchedule.incrementCount,
      lastEvaluatedThickness: round(currentThickness, 2),
      adoptionCount: thicknessSchedule.adoptionCount,
      adoptedThickness: result.adoptedThickness,
      initialThicknessMm,
      maxThicknessMm,
      thicknessStepMm,
      supportWidthMm,
      concreteGrade,
      steelGrade,
      clearCoverMm,
      preferredBarDiameterMm,
      cornerRestraint
    });

    result.finalStatus = result.validationStatus && checks.every((check) => check.status === 'PASS' || check.status === NOT_REQUIRED) ? 'APPROVED' : (hasVerification ? 'VERIFICATION REQUIRED' : 'NOT APPROVED');
    result.lastEvaluatedThickness = round(thicknessMm, 2);
    result.adoptedThickness = result.finalStatus === 'APPROVED' ? round(thicknessMm, 2) : null;
    result.designStatus = result.finalStatus;
    if (!result.validationStatus) {
      result.designStatus = 'NOT APPROVED';
    }
    if (result.finalStatus === 'APPROVED') result.success = true;
    result.finalDesign = {
      initialThickness: round(initialThicknessMm, 2),
      lastEvaluatedThickness: round(thicknessMm, 2),
      adoptedThickness: result.finalStatus === 'APPROVED' ? round(thicknessMm, 2) : null,
      designStatus: result.finalStatus,
      effectiveDepthX: result.effectiveDepthShort,
      effectiveDepthY: result.effectiveDepthLong,
      loads: {
        selfWeight: result.selfWeight,
        floorFinish: result.floorFinish,
        deadLoad: result.deadLoad,
        liveLoad: result.liveLoad,
        serviceLoad: result.serviceLoad,
        ultimateLoad: result.ultimateLoad
      },
      moments: { short: result.MuShort, long: result.MuLong },
      reinforcement: {
        short: result.shortDirectionReinforcement,
        long: result.longDirectionReinforcement,
        AstRequiredShort: result.AstRequiredShort,
        AstRequiredLong: result.AstRequiredLong,
        AstProvidedShort: result.AstProvidedShort,
        AstProvidedLong: result.AstProvidedLong
      },
      shear: {
        stress: result.shearStress,
        concreteStrength: result.concreteShearStrength,
        capacity: result.shearCapacity,
        status: result.shearStatus
      },
      deflection: {
        governingDirection: result.governingDirection,
        governingSpan: result.governingSpan,
        pt: result.deflectionPt,
        fs: result.deflectionFs,
        astUsedForPt: result.deflectionAstUsedForPt,
        astRequiredForFs: result.deflectionAstRequiredForFs,
        ptWidth: result.deflectionPtWidth,
        ptEffectiveDepth: result.deflectionPtEffectiveDepth,
        ptFormula: result.deflectionPtFormula,
        fsFormula: result.deflectionFsFormula,
        ptTrace: result.deflectionPtTrace,
        fsTrace: result.deflectionFsTrace,
        ptLower: result.deflectionPtLower,
        ptUpper: result.deflectionPtUpper,
        ptRange: result.deflectionPtRange,
        ptInterpolationRatio: result.deflectionPtInterpolationRatio,
        fsLower: result.deflectionFsLower,
        fsUpper: result.deflectionFsUpper,
        fsRange: result.deflectionFsRange,
        fsInterpolationRatio: result.deflectionFsInterpolationRatio,
        factorAtLowerPtLowerFs: result.deflectionFactorAtLowerPtLowerFs,
        factorAtLowerPtUpperFs: result.deflectionFactorAtLowerPtUpperFs,
        factorAtUpperPtLowerFs: result.deflectionFactorAtUpperPtLowerFs,
        factorAtUpperPtUpperFs: result.deflectionFactorAtUpperPtUpperFs,
        message: result.deflectionMessage,
        actualLd: result.actualLd,
        permissibleLd: result.permissibleLd,
        modificationFactor: result.modificationFactor,
        status: result.deflectionStatus,
        method: result.deflectionMethod,
        source: result.deflectionSource
      },
      detailing: {
        clearCover: result.clearCover,
        maxSpacingShort: result.maxSpacingShort,
        maxSpacingLong: result.maxSpacingLong,
        clearSpacingShort: result.clearSpacingShort,
        clearSpacingLong: result.clearSpacingLong,
        cornerRestraint: result.cornerRestraint,
        cornerTorsionStatus: result.cornerTorsionStatus
      },
      status: result.finalStatus,
      checks: result.checks
    };
    return result;
  }

  let currentThickness = initialThicknessMm;
  let latestDesign = null;
  const designIterations = [];

  const buildCoefficientNotEstablishedResult = (error) => {
    const reason = error.message;
    const geometry = error.geometry || {};
    const shortSpan = geometry.shortSpan ?? Math.min(length, width);
    const longSpan = geometry.longSpan ?? Math.max(length, width);
    const aspectRatio = round(error.aspectRatio ?? longSpan / shortSpan, 6);
    const check = createCheck(
      'table27Coefficient',
      'Table 27 coefficient',
      CHECK_STATUS.VERIFICATION_REQUIRED,
      aspectRatio,
      error.finiteCoefficientLimit,
      reason,
      'IS 456:2000 Annex D-2.1 / Table 27',
      '-',
      true
    );
    return {
      designType: 'Slab',
      projectName,
      supportType,
      cornerRestraint: values.cornerRestraint ?? 'FREE_TO_LIFT',
      cornerRestraintLabel: (values.cornerRestraint ?? 'FREE_TO_LIFT') === 'FREE_TO_LIFT' ? 'FREE TO LIFT' : 'RESTRAINED',
      slabType: 'Two Way Slab',
      shortSpan: round(shortSpan, 3),
      longSpan: round(longSpan, 3),
      aspectRatio,
      coefficientTableId: 'IS_456_TABLE_27',
      coefficientTableReference: 'IS 456:2000 Table 27',
      coefficientStatus: CHECK_STATUS.VERIFICATION_REQUIRED,
      coefficientSource: reason,
      coefficientNotEstablishedReason: reason,
      coefficientSelectionReason: 'Simply Supported + FREE_TO_LIFT selects IS 456:2000 Table 27.',
      coefficientShort: null,
      coefficientLong: null,
      alphaX: null,
      alphaY: null,
      MuShort: null,
      MuLong: null,
      finalStatus: CHECK_STATUS.VERIFICATION_REQUIRED,
      designStatus: CHECK_STATUS.VERIFICATION_REQUIRED,
      adoptedThickness: null,
      validationStatus: false,
      checks: [check],
      checksByCategory: { table27Coefficient: check },
      designOutput: {
        designType: 'Slab',
        projectName,
        slabType: 'Two Way Slab',
        supportType,
        shortSpan: round(shortSpan, 3),
        longSpan: round(longSpan, 3),
        aspectRatio,
        coefficientTableReference: 'IS 456:2000 Table 27'
      },
      designForces: {
        aspectRatio,
        coefficientTableId: 'IS_456_TABLE_27',
        coefficientTableReference: 'IS 456:2000 Table 27',
        coefficientSelectionReason: 'Simply Supported + FREE_TO_LIFT selects IS 456:2000 Table 27.',
        coefficientSource: reason,
        alphaX: null,
        alphaY: null,
        MuShort: null,
        MuLong: null
      },
      calculationSteps: [{
        id: 1,
        step: 1,
        title: 'IS 456 moment coefficient lookup',
        formula: 'Resolve coefficients from finite published Table 27 rows.',
        substitution: reason,
        result: CHECK_STATUS.VERIFICATION_REQUIRED,
        status: CHECK_STATUS.VERIFICATION_REQUIRED,
        group: 'momentCoefficients',
        groupLabel: 'Moment Coefficients'
      }]
    };
  };

  while (currentThickness <= maxThicknessMm) {
    let candidate;
    try {
      candidate = buildCandidate(currentThickness);
    } catch (error) {
      if (error.code === 'TABLE_27_COEFFICIENT_NOT_ESTABLISHED') {
        return buildCoefficientNotEstablishedResult(error);
      }
      throw error;
    }
    latestDesign = candidate;
    designIterations.push({
      thickness: round(currentThickness, 2),
      selfWeight: candidate.selfWeight,
      deadLoad: candidate.deadLoad,
      ultimateLoad: candidate.ultimateLoad,
      Mu: candidate.MuShort,
      MuShort: candidate.MuShort,
      MuLong: candidate.MuLong,
      Ast: candidate.AstProvidedShort,
      AstShort: candidate.AstProvidedShort,
      AstLong: candidate.AstProvidedLong,
      d: candidate.effectiveDepthShort,
      effectiveDepthShort: candidate.effectiveDepthShort,
      effectiveDepthLong: candidate.effectiveDepthLong,
      actualLd: candidate.actualLd,
      permissibleLd: candidate.permissibleLd,
      pt: candidate.deflectionPt,
      fs: candidate.deflectionFs,
      astUsedForPt: candidate.deflectionAstUsedForPt,
      astRequiredForFs: candidate.deflectionAstRequiredForFs,
      ptWidth: candidate.deflectionPtWidth,
      ptEffectiveDepth: candidate.deflectionPtEffectiveDepth,
      ptFormula: candidate.deflectionPtFormula,
      fsFormula: candidate.deflectionFsFormula,
      ptTrace: candidate.deflectionPtTrace,
      fsTrace: candidate.deflectionFsTrace,
      ptLower: candidate.deflectionPtLower,
      ptUpper: candidate.deflectionPtUpper,
      ptRange: candidate.deflectionPtRange,
      ptInterpolationRatio: candidate.deflectionPtInterpolationRatio,
      fsLower: candidate.deflectionFsLower,
      fsUpper: candidate.deflectionFsUpper,
      fsRange: candidate.deflectionFsRange,
      fsInterpolationRatio: candidate.deflectionFsInterpolationRatio,
      modificationFactor: candidate.modificationFactor,
      shearStatus: candidate.shearStatus,
      status: candidate.deflectionStatus === 'FAIL' ? 'FAIL' : (candidate.designStatus || candidate.finalStatus || 'NOT APPROVED'),
      finalStatus: candidate.finalStatus,
      deflectionStatus: candidate.deflectionStatus,
      checks: candidate.checks
    });
    if (candidate.finalStatus === 'APPROVED') {
      latestDesign.initialThickness = round(initialThicknessMm, 2);
      latestDesign.lastEvaluatedThickness = round(currentThickness, 2);
      latestDesign.adoptedThickness = round(currentThickness, 2);
      latestDesign.designStatus = 'APPROVED';
      break;
    }
    if (currentThickness >= maxThicknessMm) {
      latestDesign.initialThickness = round(initialThicknessMm, 2);
      latestDesign.lastEvaluatedThickness = round(currentThickness, 2);
      latestDesign.adoptedThickness = null;
      latestDesign.designStatus = 'VERIFICATION REQUIRED';
      break;
    }
    currentThickness += thicknessStepMm;
  }

  latestDesign.designIterations = designIterations;
  latestDesign.iterationHistory = designIterations;
  // Expose the search schedule so the UI, the PDF and the tests all report the same
  // evaluation count. `adoptionCount` is the number of evaluated thicknesses that fully
  // satisfied every required check, which is a different (often zero) quantity.
  latestDesign.thicknessIteration = {
    ...thicknessSchedule,
    adoptionCount: designIterations.filter((iteration) => iteration.finalStatus === 'APPROVED').length,
    lastEvaluatedThickness: round(latestDesign.slabThickness, 2),
    evaluatedThicknesses: designIterations.map((iteration) => iteration.thickness)
  };
  latestDesign.evaluatedThicknessCount = latestDesign.thicknessIteration.evaluatedThicknessCount;
  latestDesign.incrementCount = latestDesign.thicknessIteration.incrementCount;
  latestDesign.adoptionCount = latestDesign.thicknessIteration.adoptionCount;
  latestDesign.adoptedThicknessLabel = latestDesign.adoptedThickness === null ? NOT_ESTABLISHED : `${latestDesign.adoptedThickness} mm`;
  latestDesign.adoptedThicknessStatus = latestDesign.adoptedThickness === null ? 'VERIFICATION REQUIRED' : 'ADOPTED';
  // The adopted thickness must never be inferred from the last evaluated thickness:
  // if nothing satisfied every check, no thickness was adopted.
  latestDesign.adoptedThicknessReason = latestDesign.adoptedThickness === null
    ? `No slab thickness between ${round(initialThicknessMm, 2)} mm and ${round(maxThicknessMm, 2)} mm satisfied every required check, so no thickness has been adopted.`
    : `Thickness ${latestDesign.adoptedThickness} mm is the first evaluated thickness that satisfied every required check.`;
  latestDesign.initialThickness = round(initialThicknessMm, 2);
  latestDesign.lastEvaluatedThickness = round(latestDesign.slabThickness, 2);
  latestDesign.adoptedThickness = latestDesign.finalStatus === 'APPROVED' ? round(latestDesign.slabThickness, 2) : null;
  latestDesign.designStatus = latestDesign.finalStatus === 'APPROVED' ? 'APPROVED' : 'VERIFICATION REQUIRED';
  const detailingDirection = (direction) => ({
    barDiameter: direction.diameter ?? NOT_ESTABLISHED,
    spacing: direction.spacing ?? NOT_ESTABLISHED,
    astProvided: direction.AstProvided ?? NOT_ESTABLISHED,
    numberOfBars: NOT_ESTABLISHED,
    availablePlacementWidth: NOT_ESTABLISHED,
    barArrangement: NOT_ESTABLISHED,
    detailingStatus: NOT_ESTABLISHED
  });
  const detailing = {
    ...(latestDesign.finalDesign?.detailing || {}),
    shortDirection: detailingDirection(latestDesign.shortDirectionReinforcement || {}),
    longDirection: detailingDirection(latestDesign.longDirectionReinforcement || {})
  };
  latestDesign.detailing = detailing;
  const finalDesign = { ...latestDesign.finalDesign, ...latestDesign, designIterations };
  finalDesign.initialThickness = round(initialThicknessMm, 2);
  finalDesign.lastEvaluatedThickness = round(latestDesign.slabThickness, 2);
  finalDesign.adoptedThickness = latestDesign.adoptedThickness === null ? null : round(latestDesign.adoptedThickness, 2);
  finalDesign.adoptedThicknessLabel = latestDesign.adoptedThicknessLabel;
  finalDesign.adoptedThicknessStatus = latestDesign.adoptedThicknessStatus;
  finalDesign.adoptedThicknessReason = latestDesign.adoptedThicknessReason;
  finalDesign.designStatus = latestDesign.finalStatus === 'APPROVED' ? 'APPROVED' : 'VERIFICATION REQUIRED';
  finalDesign.detailing = detailing;
  delete finalDesign.finalDesign;
  latestDesign.finalDesign = finalDesign;
  latestDesign.finalStatus = latestDesign.finalStatus || 'VERIFICATION REQUIRED';
  return latestDesign;
}
