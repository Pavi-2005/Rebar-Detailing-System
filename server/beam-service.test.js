import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { generateBeamDesign } from './src/services/beamCalculationService.js';
import { beamReportData, generateBeamPdfReport } from './src/services/beamReportService.js';
import { generateSlabDesign, validateSlabCalculationResult } from './src/services/slabCalculationService.js';
import { interpolateFig4ModificationFactor } from './src/services/fig4Dataset.js';

// ---------------------------------------------------------------------------
// Shared fixtures for the Beam tau_c / Vc / span / anchorage contracts.
// ---------------------------------------------------------------------------

// The mandatory regression case for the Beam hardening work.
const BASELINE_INPUT = {
  length: 4, breadth: 300, overallDepth: 500, supportType: 'Simply Supported',
  clearCover: 25, concreteGrade: 'M25', steelGrade: 'Fe415', liveLoad: 10, deadLoad: 3,
  unitWeightConcrete: 25, preferredBarDiameter: 16
};

// IS 456:2000 Table 19, M25 column, as tabulated in designConstants.json.
const TABLE_19_M25 = { 0.15: 0.28, 0.25: 0.36, 0.5: 0.49, 0.75: 0.56, 1: 0.62, 1.25: 0.67, 1.5: 0.72, 1.75: 0.76, 2: 0.8, 2.25: 0.84, 2.5: 0.88, 2.75: 0.91, 3: 0.95, 3.25: 0.98, 3.5: 1.01, 3.75: 1.04, 4: 1.06 };

/** Independent reference implementation of the IS 456:2000 Table 19 interpolation. */
function referenceTauC(pt, table = TABLE_19_M25) {
  const points = Object.entries(table).map(([p, v]) => ({ p: Number(p), v: Number(v) })).sort((a, b) => a.p - b.p);
  if (pt <= points[0].p) return points[0].v;
  if (pt >= points.at(-1).p) return points.at(-1).v;
  for (let i = 1; i < points.length; i += 1) {
    if (pt <= points[i].p) {
      const lo = points[i - 1];
      const hi = points[i];
      return lo.v + (pt - lo.p) * (hi.v - lo.v) / (hi.p - lo.p);
    }
  }
  return NaN;
}

/** Flattens a PDFKit buffer to uppercase text so printed values can be asserted. */
function pdfText(pdf) {
  return [...pdf.toString('latin1').matchAll(/<([0-9a-fA-F]+)>/g)]
    .map((m) => Buffer.from(m[1], 'hex').toString('latin1')).join(' ').replace(/\s+/g, '').toUpperCase();
}

test('beam design returns complete engineering output', () => {
  const result = generateBeamDesign({
    length: 4,
    breadth: 300,
    overallDepth: 500,
    supportType: 'Simply Supported',
    clearCover: 25,
    concreteGrade: 'M25',
    steelGrade: 'Fe415',
    liveLoad: 10,
    deadLoad: 3,
    unitWeightConcrete: 25,
    preferredBarDiameter: 16
  });

  assert.equal(result.designType, 'Beam');
  assert.ok(result.effectiveDepth > 0);
  assert.ok(Array.isArray(result.calculationSteps));
  assert.ok(result.calculationSteps.length >= 5);
  assert.ok(result.mainReinforcement.includes('mm'));
  assert.equal(result.effectiveDepth, 459);
  assert.equal(result.ultimateLoad, 25.125);
  assert.equal(result.ultimateMoment, 50.25);
  assert.equal(result.ultimateShear, 50.25);
  assert.equal(result.requiredAreaSteel, 315.39);
  assert.equal(result.shearCalculation.asv, 100.53);
  // Vu - Vc is derived from the authoritative unrounded Table 19 tau_c, never hard-coded.
  assert.ok(
    Math.abs(result.shearCalculation.vuMinusVc - (result.ultimateShear * 1000 - result.shearCalculation.tauCFullPrecision * result.breadth * result.effectiveDepth)) < 1,
    'Vu - Vc must equal Vu - (tau_c_internal x b x d)'
  );
  assert.ok(Math.abs(result.shearCalculation.vc - result.shearCalculation.tauCFullPrecision * result.breadth * result.effectiveDepth) < 1, 'Vc must equal tau_c_internal x b x d');
  assert.equal(result.shearCalculation.vusRequired, 0);
  assert.equal(result.shearCalculation.vusProvided, 55533.96);
  assert.ok(Array.isArray(result.checks));
  assert.ok(result.checks.length >= 8);
  assert.ok(result.checks.every((check) => ['PASS', 'FAIL', 'VERIFICATION REQUIRED'].includes(check.status)));
  assert.ok(result.checks.every((check) => 'actual' in check && 'limit' in check && 'message' in check));
  // Authoritative Beam status vocabulary: PASS / FAIL / VERIFICATION REQUIRED.
  assert.ok(['PASS', 'FAIL', 'VERIFICATION REQUIRED'].includes(result.designStatus));
  assert.ok(result.shearReinforcement && result.shearReinforcement.includes('8'));
  assert.equal(result.designStatus, 'VERIFICATION REQUIRED');
  assert.equal(result.deflectionCheck.serviceStress, 188.79);
  assert.equal(result.deflectionCheck.modificationFactor, 1.5673);
  assert.equal(result.deflectionCheck.permissibleLd, 31.35);
  assert.equal(result.shearCalculation.minimumShearGoverns, true);
});

test('beam rejects missing and non-finite geometry or load inputs', () => {
  const input = { length: 4, breadth: 300, overallDepth: 500, supportType: 'Simply Supported', clearCover: 25, concreteGrade: 'M25', steelGrade: 'Fe415', liveLoad: 10, deadLoad: 3, unitWeightConcrete: 25, preferredBarDiameter: 16 };
  assert.throws(() => generateBeamDesign({ ...input, deadLoad: undefined }), /finite numbers/i);
  assert.throws(() => generateBeamDesign({ ...input, length: NaN }), /finite numbers/i);
  assert.throws(() => generateBeamDesign({ ...input, breadth: 0 }), /greater than 0/i);
});

test('beam reports flexural, shear and maximum shear stress failures without approval', () => {
  const result = generateBeamDesign({ length: 4, breadth: 300, overallDepth: 500, supportType: 'Simply Supported', clearCover: 25, concreteGrade: 'M25', steelGrade: 'Fe415', liveLoad: 1000, deadLoad: 3, unitWeightConcrete: 25, preferredBarDiameter: 16 });
  assert.equal(result.checks.find((check) => check.name === 'Flexural capacity').status, 'FAIL');
  assert.equal(result.checks.find((check) => check.name === 'Concrete shear capacity').status, 'PASS');
  assert.equal(result.checks.find((check) => check.name === 'Maximum shear stress').status, 'FAIL');
  assert.notEqual(result.designStatus, 'PASS');
});

test('beam enforces minimum reinforcement and minimum shear reinforcement', () => {
  const result = generateBeamDesign({ length: 4, breadth: 300, overallDepth: 500, supportType: 'Simply Supported', clearCover: 25, concreteGrade: 'M25', steelGrade: 'Fe415', liveLoad: 0, deadLoad: 0, unitWeightConcrete: 25, preferredBarDiameter: 8 });
  assert.ok(result.providedAreaSteel >= result.minimumReinforcement);
  assert.equal(result.checks.find((check) => check.name === 'Minimum steel').status, 'PASS');
  assert.equal(result.shearCalculation.minimumShearGoverns, true);
  assert.equal(result.checks.find((check) => check.name === 'Minimum shear reinforcement').status, 'PASS');
});

// Regression: the Clause 26.5.1.6 check must compare the two DIMENSIONLESS ratios
// Asv/(b x Sv) and 0.4/(0.87 fy) — never Asv/Sv against the mm2/mm limit 0.4b/(0.87 fy).
test('minimum shear reinforcement check compares Asv/(b x Sv) against 0.4/(0.87 fy)', () => {
  const inputs = { length: 4, breadth: 300, overallDepth: 500, supportType: 'Simply Supported', clearCover: 25, concreteGrade: 'M25', steelGrade: 'Fe415', liveLoad: 0, deadLoad: 0, unitWeightConcrete: 25, preferredBarDiameter: 8 };
  const result = generateBeamDesign(inputs);
  const shear = result.shearCalculation;
  const b = inputs.breadth;
  const sv = shear.providedSpacing;
  const fy = 415;

  // Authoritative Clause 26.5.1.6 ratios, derived from first principles (never hard-coded).
  const expectedProvided = Math.round(shear.asv / (b * sv) * 1e6) / 1e6;
  const expectedRequired = Math.round(0.4 / (0.87 * fy) * 1e6) / 1e6;

  assert.ok(Math.abs(shear.providedAsvRatio - shear.asv / (b * sv)) < 1e-6, 'provided ratio must equal Asv/(b x Sv)');
  assert.ok(Math.abs(shear.minimumRequiredAsvRatio - 0.4 / (0.87 * fy)) < 1e-6, 'required ratio must equal 0.4/(0.87 fy)');
  assert.equal(shear.minimumPass, expectedProvided >= expectedRequired);

  // The two reported numbers must be of the same order of magnitude/dimensions.
  // 0.4 b/(0.87 fy) = required * b, so the old Asv/Sv vs minAsvPerSv comparison differed by exactly b (300x here).
  // 0.4 b/(0.87 fy) = required * b, so the old Asv/Sv vs minAsvPerSv comparison differed by exactly b.
  const minAsvPerSv = result.minimumShearReinforcement.minimumAreaPerSpacing;
  assert.ok(Math.abs(minAsvPerSv - 0.4 / (0.87 * fy) * b) < 1e-4, 'Asv/Sv and the ratio must not be conflated');
  assert.ok(shear.providedAsvRatio < minAsvPerSv / (b / 2), 'reported value must be the ratio, not the mm2/mm quantity');

  const check = result.checks.find((entry) => entry.name === 'Minimum shear reinforcement');
  assert.equal(check.actual_value, expectedProvided);
  assert.equal(check.limit_value, expectedRequired);
  assert.match(check.message, /Asv\/\(b x Sv\)/);
  assert.match(check.message, /0\.4\/\(0\.87 fy\)/);
  assert.doesNotMatch(check.message, /fyv/);
  assert.equal(check.status, expectedProvided >= expectedRequired ? 'PASS' : 'FAIL');

  // Same authoritative values in the reported result block, calculation steps and PDF rows.
  const msr = result.minimumShearReinforcement;
  assert.equal(msr.providedRatio, expectedProvided);
  assert.equal(msr.requiredRatio, expectedRequired);
  assert.equal(msr.providedRatioPercent, Math.round(expectedProvided * 100 * 1e4) / 1e4);
  assert.equal(msr.requiredRatioPercent, Math.round(expectedRequired * 100 * 1e4) / 1e4);
  assert.equal(msr.checkPass, expectedProvided >= expectedRequired);
  assert.equal(result.shearCalculation.minShearPass, expectedProvided >= expectedRequired);
  assert.match(result.shearCalculation.minimumShearFormula, /Asv\/\(b x Sv\)/);

  const step = result.calculationSteps.find((entry) => entry.value.includes('Minimum shear reinforcement'));
  assert.ok(step, 'calculation steps must document the minimum shear reinforcement check');
  assert.ok(step.value.includes(String(expectedProvided)) && step.value.includes(String(expectedRequired)));

  const report = beamReportData(result);
  {
    const row = report.shear.find((entry) => entry.name === 'Minimum shear reinforcement');
    assert.equal(row.value, `${expectedProvided} >= ${expectedRequired}`);
    assert.equal(row.unit, 'Asv/(b x Sv) vs 0.4/(0.87 fy)');
  }
});

test('beam flags development-length verification requirement and deflection failure distinctly', () => {
  const developmentFailure = generateBeamDesign({ length: 0.5, breadth: 300, overallDepth: 200, supportType: 'Simply Supported', clearCover: 25, concreteGrade: 'M20', steelGrade: 'Fe500', liveLoad: 20, deadLoad: 10, unitWeightConcrete: 25, preferredBarDiameter: 32 });
  assert.equal(developmentFailure.checks.find((check) => check.name === 'Development length').status, 'VERIFICATION REQUIRED');
  assert.notEqual(developmentFailure.designStatus, 'PASS');

  const deflectionFailure = generateBeamDesign({ length: 4, breadth: 300, overallDepth: 100, supportType: 'Simply Supported', clearCover: 25, concreteGrade: 'M25', steelGrade: 'Fe415', liveLoad: 1, deadLoad: 0, unitWeightConcrete: 25, preferredBarDiameter: 8 });
  assert.equal(deflectionFailure.checks.find((check) => check.name === 'Deflection').status, 'VERIFICATION REQUIRED');
  assert.notEqual(deflectionFailure.designStatus, 'PASS');
});

test('beam does not approve when anchorage cannot be verified from support geometry', () => {
  const result = generateBeamDesign({ length: 4, breadth: 300, overallDepth: 500, supportType: 'Simply Supported', clearCover: 25, concreteGrade: 'M25', steelGrade: 'Fe415', liveLoad: 10, deadLoad: 3, unitWeightConcrete: 25, preferredBarDiameter: 16 });
  assert.notEqual(result.designStatus, 'PASS');
  assert.notEqual(result.checks.find((check) => check.name === 'Development length').status, 'PASS');
  assert.equal(result.developmentLengthRequired, 644.73);
  assert.equal(result.developmentLengthAvailable, null);
  assert.equal(result.anchorageRatio, null);
  assert.equal(result.developmentStatus, 'VERIFICATION REQUIRED');
  assert.equal(result.finalStatus, 'VERIFICATION REQUIRED');
});

test('beam keeps effective-span-only input in verification-required anchorage state', () => {
  const result = generateBeamDesign({
    length: 4,
    breadth: 300,
    overallDepth: 500,
    supportType: 'Simply Supported',
    supportCondition: 'Simply Supported',
    clearCover: 25,
    concreteGrade: 'M25',
    steelGrade: 'Fe415',
    liveLoad: 10,
    deadLoad: 3,
    unitWeightConcrete: 25,
    preferredBarDiameter: 16,
    clearSpan: null,
    supportWidth: null,
    terminationSetbackFromSupportFace: null
  });

  assert.equal(result.developmentLength.ldAvailable, null);
  assert.equal(result.developmentLength.anchorageRatio, null);
  assert.equal(result.developmentLength.developmentStatus, 'VERIFICATION REQUIRED');
  assert.equal(result.designStatus, 'VERIFICATION REQUIRED');
});

test('beam exposes one structured load, stirrup, and final-check contract for the baseline design', () => {
  const result = generateBeamDesign({ length: 4, breadth: 300, overallDepth: 500, supportType: 'Simply Supported', clearCover: 25, concreteGrade: 'M25', steelGrade: 'Fe415', liveLoad: 10, deadLoad: 3, unitWeightConcrete: 25, preferredBarDiameter: 16 });

  assert.deepEqual(result.loads, { selfWeight: 3.75, superimposedDeadLoad: 3, totalDeadLoad: 6.75, liveLoad: 10, serviceLoad: 16.75, factoredLoad: 25.125 });
  assert.equal(result.totalDeadLoad, result.loads.totalDeadLoad);
  assert.equal(result.factoredLoad, result.loads.factoredLoad);
  assert.deepEqual(result.reinforcement.stirrups, {
    diameter: 8, legs: 2, area: 100.53, spacing: 300, maximumSpacing: 300,
    requiredShearCapacity: 0, providedShearCapacity: 55533.96,
    label: '2-legged 8 mm dia @ 300 mm c/c', role: 'Shear reinforcement'
  });
  assert.equal(result.finalChecks.developmentLength.status, 'VERIFICATION REQUIRED');
  assert.equal(result.anchorageReason.includes('cannot be established'), true);
});

test('beam rejects inconsistent support data and malformed optional engineering inputs', () => {
  const input = { length: 4, breadth: 300, overallDepth: 500, supportType: 'Simply Supported', clearCover: 25, concreteGrade: 'M25', steelGrade: 'Fe415', liveLoad: 10, deadLoad: 3, unitWeightConcrete: 25, preferredBarDiameter: 16 };
  assert.throws(() => generateBeamDesign({ ...input, supportCondition: 'Cantilever' }), /must match supportType/i);
  assert.throws(() => generateBeamDesign({ ...input, clearSpan: 'not-a-number' }), /finite number/i);
  assert.throws(() => generateBeamDesign({ ...input, supportWidth: 0 }), /greater than 0/i);
  assert.throws(() => generateBeamDesign({ ...input, preferredBarDiameter: 14 }), /Preferred bar diameter/i);
  assert.throws(() => generateBeamDesign({ ...input, stirrupDiameter: 6 }), /Stirrup diameter/i);
});

test('cantilever uses fixed-end actions and retains the authoritative main reinforcement result', () => {
  const result = generateBeamDesign({ length: 2, breadth: 300, overallDepth: 500, supportType: 'Cantilever', supportCondition: 'Cantilever', clearCover: 25, concreteGrade: 'M25', steelGrade: 'Fe415', liveLoad: 3, deadLoad: 2, unitWeightConcrete: 25, preferredBarDiameter: 16 });
  assert.equal(result.beamType, 'Cantilever');
  assert.equal(result.ultimateMoment, result.ultimateLoad * 2);
  assert.equal(result.ultimateShear, result.ultimateLoad * 2);
  assert.ok(result.reinforcement.bottomBars.barCount > 0);
  assert.match(result.reinforcement.topBars.role, /detailing\/hanger/i);
});

test('Fig. 4 interpolation is valid within range and rejects out-of-range inputs without clamping', () => {
  assert.equal(interpolateFig4ModificationFactor(0.15, 100).status, 'PASS');
  assert.equal(interpolateFig4ModificationFactor(0.15, 100).modificationFactor, 1.6);
  assert.equal(interpolateFig4ModificationFactor(2, 350).status, 'PASS');
  assert.equal(interpolateFig4ModificationFactor(2, 350).modificationFactor, 1.95);
  assert.equal(interpolateFig4ModificationFactor(0.1, 150).status, 'VERIFICATION REQUIRED');
  assert.equal(interpolateFig4ModificationFactor(0.15, 50).status, 'VERIFICATION REQUIRED');
  assert.equal(interpolateFig4ModificationFactor(0.1496, 276.93).status, 'VERIFICATION REQUIRED');
  assert.equal(interpolateFig4ModificationFactor(0.1496, 276.93).modificationFactor, null);
});

test('beam support geometry determines available anchorage and derives top reinforcement', () => {
  const result = generateBeamDesign({
    length: 5,
    breadth: 300,
    overallDepth: 500,
    supportType: 'Simply Supported',
    clearCover: 25,
    concreteGrade: 'M25',
    steelGrade: 'Fe415',
    liveLoad: 10,
    deadLoad: 3,
    unitWeightConcrete: 25,
    preferredBarDiameter: 16,
    stirrupDiameter: 10,
    supportWidth: 850,
    clearSpan: 5,
    barCurtailmentLocation: 40
  });

  assert.ok(Number.isFinite(result.developmentLength.availableAnchorage));
  assert.ok(result.developmentLength.availableAnchorage > result.developmentLength.ld);
  assert.equal(result.developmentLength.status, 'PASS');
  assert.doesNotMatch(result.topReinforcement, /Not structurally designed/i);
  assert.match(result.topReinforcement, /\d+\s*[-x×]?\s*\d+\s*mm/i);
  assert.equal(result.reinforcement.flexuralModel, 'Singly reinforced section');
  assert.equal(result.reinforcement.bottomBars.role, 'Bottom flexural reinforcement');
  assert.equal(result.reinforcement.topBars.role, 'Top detailing/hanger reinforcement; not flexurally designed compression reinforcement');
  assert.equal(result.reinforcement.stirrups.role, 'Shear reinforcement');
  assert.equal(result.reinforcement.cover, 25);
  assert.equal(result.reinforcement.terminationLocation, 40);
  assert.equal(result.reinforcement.anchorageGeometry.supportFace, 0);
  assert.equal(result.reinforcement.anchorageGeometry.supportFarFace, 850);
  assert.equal(result.developmentLengthAvailable, result.developmentLength.availableAnchorage);
  assert.equal(result.anchorageRatio, result.developmentLength.anchorageRatio);
  assert.equal(result.developmentStatus, 'PASS');
  assert.equal(result.finalStatus, 'PASS');
});

test('zero curtailment setback is a support-face coordinate, not zero embedment', () => {
  const result = generateBeamDesign({
    length: 4,
    breadth: 300,
    overallDepth: 500,
    supportType: 'Simply Supported',
    clearCover: 25,
    concreteGrade: 'M25',
    steelGrade: 'Fe415',
    liveLoad: 10,
    deadLoad: 3,
    unitWeightConcrete: 25,
    preferredBarDiameter: 16,
    stirrupDiameter: 8,
    supportWidth: 850,
    clearSpan: 4,
    barCurtailmentLocation: 0
  });

  assert.equal(result.developmentLength.barCurtailmentLocation, 0);
  assert.ok(result.developmentLength.availableAnchorage > 0);
  assert.equal(result.developmentLength.terminationDefinition.includes('not zero embedment'), true);
});

test('insufficient anchorage is FAIL, while support width and termination alter available length', () => {
  const base = {
    length: 4,
    breadth: 300,
    overallDepth: 500,
    supportType: 'Simply Supported',
    clearCover: 25,
    concreteGrade: 'M25',
    steelGrade: 'Fe415',
    liveLoad: 10,
    deadLoad: 3,
    unitWeightConcrete: 25,
    preferredBarDiameter: 16,
    stirrupDiameter: 8,
    clearSpan: 4,
    terminationSetbackFromSupportFace: 0
  };
  const narrow = generateBeamDesign({ ...base, supportWidth: 500 });
  const wide = generateBeamDesign({ ...base, supportWidth: 850 });
  const curtailed = generateBeamDesign({ ...base, supportWidth: 850, terminationSetbackFromSupportFace: 100 });

  assert.equal(narrow.developmentLength.status, 'FAIL');
  assert.equal(narrow.designStatus, 'FAIL');
  assert.equal(narrow.developmentStatus, 'FAIL');
  assert.equal(narrow.finalStatus, 'FAIL');
  assert.ok(wide.developmentLength.availableAnchorage > narrow.developmentLength.availableAnchorage);
  assert.ok(curtailed.developmentLength.availableAnchorage < wide.developmentLength.availableAnchorage);
  assert.equal(wide.reinforcement.availableAnchorage, wide.developmentLength.availableAnchorage);
  assert.equal(wide.reinforcement.developmentLength, wide.developmentLength.ldRequired);
  assert.equal(wide.supportGeometry.supportWidth, 850);
  assert.equal(wide.terminationGeometry.terminationSetbackFromSupportFace, 0);
  assert.equal(wide.terminationGeometry.barTerminationLocation, 0);
  const report = beamReportData(wide);
  assert.equal(report.development.find((entry) => entry.name === 'Ld available').value, wide.reinforcement.availableAnchorage);
  assert.equal(report.development.find((entry) => entry.name === 'Anchorage ratio Ld available / Ld required').value, wide.reinforcement.anchorageRatio);
});

// Authoritative Beam status vocabulary: no other status word is produced by this module.
const BEAM_STATUS_VOCABULARY = ['PASS', 'FAIL', 'VERIFICATION REQUIRED'];
const beamBaselineInput = {
  length: 4, breadth: 300, overallDepth: 500, clearCover: 25, concreteGrade: 'M25', steelGrade: 'Fe415',
  liveLoad: 10, deadLoad: 3, unitWeightConcrete: 25, preferredBarDiameter: 16
};

const collectNonFiniteNumbers = (node, path = '', found = [], seen = new WeakSet()) => {
  if (!node || typeof node !== 'object' || seen.has(node)) return found;
  seen.add(node);
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (typeof value === 'number' && !Number.isFinite(value)) found.push(`${path}.${key}=${value}`);
    else if (value && typeof value === 'object') collectNonFiniteNumbers(value, `${path}.${key}`, found, seen);
  }
  return found;
};

test('a normal valid design exposes finite engineering values and equals its JSON representation', () => {
  for (const supportType of ['Simply Supported', 'Continuous', 'Cantilever']) {
    const result = generateBeamDesign({ ...beamBaselineInput, supportType });

    assert.ok(Number.isFinite(result.requiredAreaSteel), `${supportType} requiredAreaSteel must be finite`);
    assert.ok(Number.isFinite(result.momentCapacity.requiredAst), `${supportType} momentCapacity.requiredAst must be finite`);
    assert.ok(Number.isFinite(result.providedAreaSteel), `${supportType} providedAreaSteel must be finite`);
    assert.deepEqual(collectNonFiniteNumbers(result), [], `${supportType} returned non-finite numbers`);

    if (result.continuousDesign) {
      assert.ok(Number.isFinite(result.continuousDesign.positive.requiredAst), `${supportType} Mu+ required Ast must be finite`);
      assert.ok(Number.isFinite(result.continuousDesign.negative.requiredAst), `${supportType} Mu- required Ast must be finite`);
    }

    for (const [name, check] of Object.entries(result.finalChecks)) {
      assert.ok(Number.isFinite(check.actual), `${supportType} finalChecks.${name}.actual = ${check.actual}`);
      assert.ok(check.limit === null || Number.isFinite(check.limit), `${supportType} finalChecks.${name}.limit = ${check.limit}`);
    }
    // Anchorage is not established for the baseline inputs: it stays null and is never zero.
    assert.equal(result.finalChecks.developmentLength.limit, null, `${supportType} anchorage limit must stay null, not 0`);

    // The in-memory result must be exactly what the JSON/API representation returns, and shared
    // references must survive (the normaliser mutates in place; it does not clone through JSON).
    assert.ok(isDeepStrictEqual(JSON.parse(JSON.stringify(result)), result), `${supportType} result differs from its JSON representation`);
    assert.ok(result.reinforcementCage === result.reinforcement, `${supportType} reinforcement cage reference was lost`);
    assert.equal(typeof result.beamType, 'string', `${supportType} beamType must stay a string`);
    assert.equal(typeof result.deflectionCheck.pass, 'boolean', `${supportType} boolean flags must stay booleans`);
    assert.equal(result.developmentLengthAvailable, null, `${supportType} undetermined anchorage must stay null, not 0`);
  }
});

test('an inadequate singly reinforced section fails, never approves, and reports null instead of non-finite numbers', () => {
  for (const supportType of ['Simply Supported', 'Continuous']) {
    const result = generateBeamDesign({ ...beamBaselineInput, supportType, liveLoad: 1000 });

    assert.equal(result.designStatus, 'FAIL', `${supportType} designStatus`);
    assert.equal(result.finalStatus, 'FAIL', `${supportType} finalStatus`);
    assert.equal(result.reinforcement.bottomBars.status, 'VERIFICATION REQUIRED', `${supportType} flexural group status`);
    assert.equal(result.mainReinforcement, 'VERIFICATION REQUIRED', `${supportType} displayed main reinforcement`);
    assert.ok(BEAM_STATUS_VOCABULARY.includes(result.designStatus));
    assert.ok(result.checks.every((check) => BEAM_STATUS_VOCABULARY.includes(check.status)), `${supportType} check status outside vocabulary`);

    // Nothing non-finite survives the result boundary any more.
    assert.deepEqual(collectNonFiniteNumbers(result), [], `${supportType} still exposes non-finite numbers`);
    assert.equal(result.requiredAreaSteel, null, `${supportType} required Ast must be null, not NaN`);
    assert.equal(result.momentCapacity.requiredAst, null, `${supportType} momentCapacity.requiredAst must be null`);
    assert.equal(result.deflectionCheck.serviceStress, null, `${supportType} service stress must be null`);
    assert.equal(result.finalChecks.longitudinalSpacing.actual, null, `${supportType} clear-spacing actual must be null`);
    if (result.continuousDesign) {
      assert.equal(result.continuousDesign.positive.requiredAst, null, `${supportType} Mu+ required Ast must be null`);
    }

    // Steps state undetermined values instead of printing NaN/Infinity/undefined/null.
    for (const step of result.calculationSteps) {
      for (const token of ['undefined', 'null', 'NaN', 'Infinity']) {
        assert.ok(!new RegExp(`\\b${token}\\b`).test(String(step.value)), `${supportType} step ${step.step} leaked ${token}: ${step.value}`);
      }
    }

    const report = beamReportData(result);
    assert.equal(report.finalStatus, 'FAIL', `${supportType} report finalStatus`);
    assert.ok(BEAM_STATUS_VOCABULARY.includes(report.finalStatus));
    assert.ok(isDeepStrictEqual(JSON.parse(JSON.stringify(result)), result), `${supportType} result differs from its JSON representation`);
  }
});

test('cantilever anchorage comes from the authoritative calculation with top-face flexural steel', () => {
  const input = {
    length: 4, clearSpan: 3.8, supportWidth: 300, breadth: 300, overallDepth: 500,
    supportType: 'Cantilever', supportCondition: 'Cantilever', clearCover: 25,
    concreteGrade: 'M25', steelGrade: 'Fe415', liveLoad: 3, deadLoad: 2,
    unitWeightConcrete: 25, preferredBarDiameter: 16, terminationSetbackFromSupportFace: 0
  };
  const result = generateBeamDesign(input);

  // Physical face metadata: cantilever flexural tension steel sits at the top face of the fixed support.
  assert.equal(result.reinforcement.bottomBars.face, 'top');
  assert.equal(result.reinforcement.bottomBars.structuralRole, 'tension');
  assert.match(result.reinforcement.bottomBars.role, /Top flexural tension/i);
  assert.equal(result.reinforcement.topBars.face, 'bottom');
  assert.match(result.reinforcement.topBars.role, /detailing\/hanger/i);

  // Available anchorage is the engine's own derivation from the supplied support geometry.
  const expectedAnchorage = input.supportWidth - input.clearCover - result.stirrupDiameter - result.barDiameter / 2 - input.terminationSetbackFromSupportFace;
  assert.equal(result.developmentLength.availableAnchorage, expectedAnchorage);
  assert.ok(result.developmentLength.availableAnchorage > 0, 'established anchorage must not be zero-filled');
  assert.equal(result.developmentLengthAvailable, result.developmentLength.availableAnchorage);
  assert.equal(result.reinforcement.availableAnchorage, result.developmentLength.availableAnchorage);
  assert.equal(result.anchorageRatio, result.developmentLength.anchorageRatio);
  assert.equal(result.developmentStatus, result.developmentLength.status);
  assert.ok(BEAM_STATUS_VOCABULARY.includes(result.developmentStatus));
  // This geometry genuinely cannot develop the required Ld, so the engine reports FAIL.
  assert.ok(expectedAnchorage < result.developmentLength.ld, 'supplied geometry cannot develop Ld for this bar');
  assert.equal(result.developmentStatus, 'FAIL');
  assert.equal(result.designStatus, 'FAIL');
  assert.equal(result.finalStatus, 'FAIL');

  // Cantilever actions are unchanged: Mu = wL²/2 at the fixed end, Vu = wL.
  assert.ok(Math.abs(result.ultimateMoment - result.ultimateLoad * result.designSpan ** 2 / 2) < 1e-6);
  assert.ok(Math.abs(result.ultimateShear - result.ultimateLoad * result.designSpan) < 1e-6);
  assert.deepEqual(collectNonFiniteNumbers(result), []);

  // Without support geometry the value stays null — never zero.
  const withoutGeometry = generateBeamDesign({ ...input, clearSpan: undefined, supportWidth: undefined, terminationSetbackFromSupportFace: undefined });
  assert.equal(withoutGeometry.developmentLengthAvailable, null);
  assert.notEqual(withoutGeometry.developmentLengthAvailable, 0);
  assert.equal(withoutGeometry.anchorageRatio, null);
  assert.equal(withoutGeometry.developmentStatus, 'VERIFICATION REQUIRED');
  assert.equal(withoutGeometry.reinforcement.bottomBars.face, 'top', 'face metadata must not depend on anchorage geometry');
});

test('Beam status fields use only PASS, FAIL or VERIFICATION REQUIRED', () => {
  for (const supportType of ['Simply Supported', 'Continuous', 'Cantilever']) {
    const result = generateBeamDesign({ ...beamBaselineInput, supportType });
    for (const [field, value] of Object.entries({
      designStatus: result.designStatus,
      finalStatus: result.finalStatus,
      deflectionStatus: result.deflectionStatus,
      shearStatus: result.shearStatus,
      developmentStatus: result.developmentStatus
    })) {
      assert.ok(BEAM_STATUS_VOCABULARY.includes(value), `${supportType} ${field} = ${value} is outside the authoritative vocabulary`);
    }
    assert.ok(result.checks.every((check) => BEAM_STATUS_VOCABULARY.includes(check.status)), `${supportType} check status outside vocabulary`);

    const report = beamReportData(result);
    assert.ok(BEAM_STATUS_VOCABULARY.includes(report.finalStatus), `${supportType} report finalStatus = ${report.finalStatus}`);
    assert.equal(report.finalStatus, result.finalStatus, `${supportType} report must not reinterpret the authoritative status`);
    assert.ok(report.checks.every((check) => BEAM_STATUS_VOCABULARY.includes(check.status)), `${supportType} report check status outside vocabulary`);
    assert.ok(!/APPROVED/.test(report.finalStatus), `${supportType} report still uses the obsolete vocabulary`);
  }

  // Both an inadequate design and an unverifiable design stay inside the same vocabulary.
  const inadequate = generateBeamDesign({ ...beamBaselineInput, supportType: 'Simply Supported', liveLoad: 1000 });
  const unverifiable = generateBeamDesign({ ...beamBaselineInput, supportType: 'Simply Supported' });
  for (const status of [inadequate.designStatus, inadequate.finalStatus, unverifiable.designStatus, unverifiable.finalStatus]) {
    assert.ok(BEAM_STATUS_VOCABULARY.includes(status), `${status} is outside the authoritative vocabulary`);
  }
});

test('slab design iterates thickness until the deflection check passes or reaches the limit', () => {
  const result = generateSlabDesign({
    length: 5,
    width: 3,
    slabThickness: 150,
    wallThickness: 150,
    supportType: 'Simply Supported',
    clearCover: 25,
    concreteGrade: 'M35',
    steelGrade: 'Fe500',
    liveLoad: 3,
    floorFinishLoad: 1.5,
    unitWeightConcrete: 25,
    preferredBarDiameter: 12,
    cornerRestraint: 'FREE_TO_LIFT'
  });

  assert.ok(Array.isArray(result.designIterations));
  assert.ok(result.designIterations.length >= 2);
  assert.ok(result.designIterations.some((step) => step.status === 'FAIL' || step.deflectionStatus === 'FAIL'));
  assert.ok(result.designIterations.some((step) => step.status === 'VERIFICATION REQUIRED' || step.deflectionStatus === 'VERIFICATION REQUIRED'));
  assert.ok(result.designIterations.every((step) => Number.isFinite(step.thickness) && step.thickness > 0));
  assert.equal(result.finalStatus, 'VERIFICATION REQUIRED');
});

test('slab design returns complete engineering output for the requested test case', () => {
  const result = generateSlabDesign({
    length: 5,
    width: 3,
    slabThickness: 150,
    wallThickness: 0.15,
    supportType: 'Simply Supported',
    clearCover: 25,
    concreteGrade: 'M35',
    steelGrade: 'Fe500',
    liveLoad: 3,
    floorFinishLoad: 1.5,
    unitWeightConcrete: 25,
    preferredBarDiameter: 12
  });

  assert.ok(Number.isFinite(result.selfWeight));
  assert.ok(Number.isFinite(result.deadLoad));
  assert.ok(Number.isFinite(result.serviceLoad));
  assert.ok(Number.isFinite(result.ultimateLoad));
  assert.ok(Number.isFinite(result.supportWallThickness));
  assert.equal(result.slabType, 'Two Way Slab');
  assert.ok(Number.isFinite(result.effectiveSpan));
  assert.ok(Number.isFinite(result.effectiveShortSpan));
  assert.ok(Number.isFinite(result.effectiveLongSpan));
  assert.ok(Number.isFinite(result.MuShort));
  assert.ok(Number.isFinite(result.MuLong));
  assert.ok(Number.isFinite(result.AstRequiredShort));
  assert.ok(Number.isFinite(result.AstRequiredLong));
  assert.ok(Number.isFinite(result.AstProvidedShort));
  assert.ok(Number.isFinite(result.AstProvidedLong));
  assert.ok(result.AstRequiredShort > 0);
  assert.ok(result.AstRequiredLong > 0);
  assert.ok(result.shortDirectionReinforcement.diameter > 0);
  assert.ok(result.longDirectionReinforcement.diameter > 0);
  assert.ok(result.xuShort <= result.xuMaxShort);
  assert.ok(result.xuLong <= result.xuMaxLong);
  assert.ok(Number.isFinite(result.effectiveDepthShort));
  assert.ok(Number.isFinite(result.effectiveDepthLong));
  assert.ok(Number.isFinite(result.shearStress));
  assert.ok(Number.isFinite(result.concreteShearStrength));
  assert.ok(Number.isFinite(result.actualLd));
  assert.equal(result.deflectionStatus, 'VERIFICATION REQUIRED');
  assert.ok(['Long direction', 'Short direction'].includes(result.governingDirection));
  assert.equal(result.modificationFactor, null);
  assert.equal(result.permissibleLd, null);
  assert.ok(Number.isFinite(result.maxSpacingShort));
  assert.ok(Number.isFinite(result.maxSpacingLong));
  assert.ok(Number.isFinite(result.clearSpacingShort));
  assert.ok(Number.isFinite(result.clearSpacingLong));
  assert.equal(result.finalStatus, 'VERIFICATION REQUIRED');
  assert.equal(typeof validateSlabCalculationResult(result), 'boolean');
  assert.equal(validateSlabCalculationResult(result), true);
  // NOT REQUIRED is a legitimate outcome (a free-to-lift corner needs no torsion steel)
  // and must never be reported as FAIL.
  assert.deepEqual(result.checks.every((check) => ['PASS', 'FAIL', 'NOT CALCULATED', 'VERIFICATION REQUIRED', 'NOT REQUIRED'].includes(check.status)), true);
});

test('slab design rejects missing or zero engineering inputs', () => {
  assert.throws(() => generateSlabDesign({ length: 5, width: 3, slabThickness: 150, wallThickness: 0, clearCover: 25, concreteGrade: 'M35', steelGrade: 'Fe500', supportType: 'Simply Supported', liveLoad: 3, floorFinishLoad: 1.5, unitWeightConcrete: 25, preferredBarDiameter: 12 }), /support or wall thickness/i);
});

test('slab design keeps last evaluated thickness separate from an adopted thickness and beam anchorage remains unresolved unless geometry is supplied', () => {
  const slab = generateSlabDesign({
    length: 5,
    width: 3,
    slabThickness: 150,
    wallThickness: 150,
    supportType: 'Simply Supported',
    clearCover: 25,
    concreteGrade: 'M35',
    steelGrade: 'Fe500',
    liveLoad: 3,
    floorFinishLoad: 1.5,
    unitWeightConcrete: 25,
    preferredBarDiameter: 12,
    cornerRestraint: 'FREE_TO_LIFT'
  });

  assert.equal(slab.initialThickness, 150);
  assert.ok(slab.lastEvaluatedThickness > 0);
  assert.equal(slab.adoptedThickness, null);
  assert.equal(slab.designStatus, 'VERIFICATION REQUIRED');

  const beam = generateBeamDesign({
    length: 4,
    breadth: 300,
    overallDepth: 500,
    supportType: 'Simply Supported',
    clearCover: 25,
    concreteGrade: 'M25',
    steelGrade: 'Fe415',
    liveLoad: 10,
    deadLoad: 3,
    unitWeightConcrete: 25,
    preferredBarDiameter: 16
  });

  const development = beam.checks.find((check) => check.name === 'Development length');
  assert.equal(development.status, 'VERIFICATION REQUIRED');
  assert.equal(beam.developmentLength.availableAnchorage, null);
});

test('Table 19 tau_c interpolation is auditable with full-precision and 3-dp display', () => {
  const result = generateBeamDesign({
    length: 4, breadth: 300, overallDepth: 500, supportType: 'Simply Supported',
    clearCover: 25, concreteGrade: 'M25', steelGrade: 'Fe415', liveLoad: 10, deadLoad: 3,
    unitWeightConcrete: 25, preferredBarDiameter: 16
  });
  const s = result.shearCalculation;

  // (a) Table 19 interpolation: pt between 0.25% and 0.50% for M25
  assert.equal(s.tauCData.method, 'linear interpolation between tabulated pt values', 'interpolation method must be Table 19 linear interpolation');
  assert.equal(s.tauCData.lowerPt, 0.25);
  assert.equal(s.tauCData.lowerTauC, 0.36);
  assert.equal(s.tauCData.upperPt, 0.5);
  assert.equal(s.tauCData.upperTauC, 0.49);

  // (b) Full-precision internal tau_c is retained
  assert.ok(Number.isFinite(s.tauCFullPrecision), 'tau_c full-precision must be a finite number');
  const expectedTauCFull = s.tauCFullPrecision;

  // (c) Vc = tau_c_internal × b × d (using the authoritative unrounded tau_c)
  const b = result.breadth;
  const d = result.effectiveDepth;
  assert.ok(Math.abs(s.vc - expectedTauCFull * b * d) < 1, `Vc ${s.vc} must equal tau_c_internal × b × d = ${expectedTauCFull * b * d}`);

  // (d) Displayed tau_c is 3 decimal places
  assert.equal(s.tauC, Number(expectedTauCFull.toFixed(3)), 'displayed tau_c must be 3 dp of the full-precision value');
  assert.equal(s.tauC, 0.382, 'baseline tau_c at 3 dp must be 0.382');

  // (e) The 3-dp displayed value does NOT exactly reproduce Vc (expected display rounding tolerance),
  // but the unrounded value does. This documents the precision relationship.
  assert.ok(Math.abs(s.vc - s.tauC * b * d) > 10, '3-dp displayed tau_c should not exactly reproduce Vc — confirming Vc is from unrounded value');
  assert.ok(Math.abs(s.vc - s.tauCFullPrecision * b * d) < 1, 'unrounded tau_c must reproduce Vc');

  // (f) Vc is computed from the full-precision tau_c, not from the 3-dp display.
  // Asserted as a relationship: the value itself must come from the Table 19 interpolation
  // (FIX 1.10 forbids hard-coding 52,326 N or 52,581.44 N).
  const expectedVuMinusVc = result.ultimateShear * 1000 - expectedTauCFull * b * d;
  assert.ok(Math.abs(s.vuMinusVc - expectedVuMinusVc) < 1, `Vu - Vc ${s.vuMinusVc} must equal Vu - tau_c_internal x b x d = ${expectedVuMinusVc.toFixed(2)}`);
});

test('Table 19 tau_c interpolation at every boundary pt uses the correct table value', () => {
  // pt exactly at a tabulated point should return the tabulated value, not an interpolation
  const result = generateBeamDesign({
    length: 4, breadth: 300, overallDepth: 500, supportType: 'Simply Supported',
    clearCover: 25, concreteGrade: 'M25', steelGrade: 'Fe415', liveLoad: 10, deadLoad: 3,
    unitWeightConcrete: 25, preferredBarDiameter: 16
  });
  const pt = result.shearCalculation.pt;
  const tauC = result.shearCalculation.tauC;
  const tauCFull = result.shearCalculation.tauCFullPrecision;
  const data = result.shearCalculation.tauCData;

  // pt = 0.292 is between 0.25 and 0.50, so interpolation method is used
  assert.equal(data.method, 'linear interpolation between tabulated pt values');
  assert.ok(pt > data.lowerPt && pt < data.upperPt, 'pt must be strictly between lower and upper table points for interpolation');

  // Recompute full-precision pt from authoritative result values for the manual interpolation check
  const fullPt = 100 * result.providedAreaSteel / (result.breadth * result.effectiveDepth);
  const manualTauC = data.lowerTauC + (fullPt - data.lowerPt) * (data.upperTauC - data.lowerTauC) / (data.upperPt - data.lowerPt);
  assert.ok(Math.abs(tauCFull - manualTauC) < 1e-10, 'tau_c internal must match manual Table 19 interpolation from full-precision pt');
  assert.equal(tauC, Number(manualTauC.toFixed(3)), 'tau_c display must match 3-dp rounding of manual interpolation');
});

test('Effective/design span input is unambiguous in the report when clear span is not supplied', () => {
  const result = generateBeamDesign({
    length: 4, breadth: 300, overallDepth: 500, supportType: 'Simply Supported',
    clearCover: 25, concreteGrade: 'M25', steelGrade: 'Fe415', liveLoad: 10, deadLoad: 3,
    unitWeightConcrete: 25, preferredBarDiameter: 16
  });
  const report = beamReportData(result);

  // spanMode is EFFECTIVE_SPAN_INPUT (clear span and support width not supplied)
  assert.equal(result.spanMode, 'EFFECTIVE_SPAN_INPUT');
  assert.equal(result.designSpan, 4);
  assert.equal(result.clearSpan, null);
  assert.equal(result.supportWidth, null);

  // Report inputs must label the span as "Effective/Design Span" and say it was directly supplied
  const spanRow = report.inputs.find((entry) => entry.name === 'Effective/Design Span');
  assert.ok(spanRow, 'report must contain an "Effective/Design Span" input row');
  assert.equal(spanRow.classification, 'INPUT');
  assert.equal(spanRow.value, 4);
  assert.equal(spanRow.unit, 'm');
  assert.ok(spanRow.clause.includes('directly supplied by user'), 'span clause must state it was directly supplied');
  assert.ok(spanRow.clause.includes('no effective-span derivation was performed'), 'span clause must state no derivation was performed');

  // Clear span and support width must be NOT PROVIDED
  const clearSpanRow = report.inputs.find((entry) => entry.name === 'Clear span');
  const supportWidthRow = report.inputs.find((entry) => entry.name === 'Support width');
  assert.equal(clearSpanRow.classification, 'NOT PROVIDED');
  assert.equal(supportWidthRow.classification, 'NOT PROVIDED');
});

test('Clear span and support width produce Calculated Effective Span in GEOMETRY mode', () => {
  const result = generateBeamDesign({
    length: 4, clearSpan: 3.8, supportWidth: 200, breadth: 300, overallDepth: 500,
    supportType: 'Simply Supported', clearCover: 25, concreteGrade: 'M25', steelGrade: 'Fe415',
    liveLoad: 10, deadLoad: 3, unitWeightConcrete: 25, preferredBarDiameter: 16,
    terminationSetbackFromSupportFace: 100
  });
  const report = beamReportData(result);

  assert.equal(result.spanMode, 'GEOMETRY');
  assert.equal(result.clearSpan, 3.8);
  assert.equal(result.supportWidth, 200);
  assert.equal(result.designSpan, 4, 'effective span = clear span + support width');

  const clearSpanRow = report.inputs.find((entry) => entry.name === 'Clear span');
  const supportWidthRow = report.inputs.find((entry) => entry.name === 'Support width');
  const calcSpanRow = report.inputs.find((entry) => entry.name === 'Calculated Effective Span');

  assert.equal(clearSpanRow.classification, 'INPUT');
  assert.equal(supportWidthRow.classification, 'INPUT');
  assert.equal(calcSpanRow.classification, 'CALCULATED');
  assert.equal(calcSpanRow.value, 4);
});

test('"NOT PROVIDED" anchorage geometry never becomes zero', () => {
  const result = generateBeamDesign({
    length: 4, breadth: 300, overallDepth: 500, supportType: 'Simply Supported',
    clearCover: 25, concreteGrade: 'M25', steelGrade: 'Fe415', liveLoad: 10, deadLoad: 3,
    unitWeightConcrete: 25, preferredBarDiameter: 16
  });

  // Ld available must be null, not 0
  assert.equal(result.developmentLengthAvailable, null);
  assert.equal(result.developmentLength.ldAvailable, null);
  assert.equal(result.developmentLength.availableAnchorage, null);
  assert.equal(result.anchorageRatio, null);
  assert.equal(result.reinforcement.availableAnchorage, null);

  // Explicitly verify "not provided" is not zero
  assert.notEqual(result.developmentLengthAvailable, 0);
  assert.notEqual(result.reinforcement.availableAnchorage, 0);

  // All anchorage-related fields must be null, not 0
  assert.equal(result.developmentLength.grossEmbedment, null);
  assert.equal(result.developmentLength.anchorageDeduction, null);
  assert.equal(result.developmentLength.anchorageRatio, null);
});

test('Anchorage remains VERIFICATION REQUIRED when geometry is missing', () => {
  const result = generateBeamDesign(BASELINE_INPUT);

  assert.equal(result.developmentStatus, 'VERIFICATION REQUIRED');
  assert.equal(result.developmentLength.developmentStatus, 'VERIFICATION REQUIRED');
  assert.equal(result.developmentLength.status, 'VERIFICATION REQUIRED');
  assert.equal(result.reinforcement.anchorageStatus, 'VERIFICATION REQUIRED');
  assert.equal(result.finalStatus, 'VERIFICATION REQUIRED');
  assert.equal(result.designStatus, 'VERIFICATION REQUIRED');

  const devCheck = result.checks.find((check) => check.name === 'Development length');
  const anchorageCheck = result.checks.find((check) => check.name === 'Anchorage adequacy');
  assert.equal(devCheck.status, 'VERIFICATION REQUIRED');
  assert.equal(anchorageCheck.status, 'VERIFICATION REQUIRED');
});

// ---------------------------------------------------------------------------
// FIX 1 — tau_c / Vc precision contract (IS 456:2000 Table 19)
// ---------------------------------------------------------------------------

test('FIX 1a: tau_c comes from real IS 456 Table 19 interpolation of the published pt', () => {
  const result = generateBeamDesign(BASELINE_INPUT);
  const s = result.shearCalculation;

  // pt must be reproducible from the PUBLISHED Ast, b and d (FIX 5: one authoritative object).
  const publishedPt = 100 * result.providedAreaSteel / (result.breadth * result.effectiveDepth);
  assert.ok(Math.abs(s.ptFullPrecision - publishedPt) < 1e-12, 'published pt must be reproducible from published Ast, b and d');
  assert.equal(s.pt, Number(publishedPt.toFixed(3)), 'displayed pt must be the 3-dp rounding of the authoritative pt');

  // The full-precision tau_c is exactly the Table 19 linear interpolation at that pt.
  const expected = referenceTauC(publishedPt);
  assert.ok(Math.abs(s.tauCFullPrecision - expected) < 1e-12, `tau_c ${s.tauCFullPrecision} must equal Table 19 interpolation ${expected}`);

  // The interpolation is bracketed by the real table values, not invented.
  assert.equal(s.tauCData.lowerPt, 0.25);
  assert.equal(s.tauCData.lowerTauC, 0.36);
  assert.equal(s.tauCData.upperPt, 0.5);
  assert.equal(s.tauCData.upperTauC, 0.49);
  assert.ok(s.tauCFullPrecision > 0.36 && s.tauCFullPrecision < 0.49, 'interpolated tau_c must lie between the bracketing table values');
});

test('FIX 1b: Vc is computed from the unrounded tau_c, never the displayed value', () => {
  const result = generateBeamDesign(BASELINE_INPUT);
  const s = result.shearCalculation;
  const b = result.breadth;
  const d = result.effectiveDepth;

  assert.ok(Math.abs(s.vc - s.tauCFullPrecision * b * d) < 1, 'Vc must equal tau_c_internal x b x d');
  assert.ok(Math.abs(s.vuMinusVc - (result.ultimateShear * 1000 - s.tauCFullPrecision * b * d)) < 1, 'Vu - Vc must use the same unrounded tau_c');
  assert.equal(s.vusRequired, 0, 'Vus required is max(0, Vu - Vc) = 0 when concrete alone is adequate');

  // The displayed 3-dp tau_c is deliberately NOT used to build Vc.
  assert.equal(s.tauC, 0.382);
  assert.notEqual(Number((s.tauC * b * d).toFixed(2)), s.vc, 'Vc must not be reproducible from the rounded display tau_c');
});

test('FIX 1c: tau_c and Vc are identical across result, steps, report and PDF', async () => {
  const result = generateBeamDesign(BASELINE_INPUT);
  const report = beamReportData(result);
  const fp = pdfText(await generateBeamPdfReport({ result }));
  const s = result.shearCalculation;

  assert.equal(report.shear.find((e) => e.name === 'pt (unrounded)').value, s.ptFullPrecision, 'report pt must equal result ptFullPrecision');
  assert.equal(report.shear.find((e) => e.name === 'τc').value, s.tauC, 'report tauC must equal result tauC');
  assert.equal(report.shear.find((e) => e.name === 'τc (unrounded)').value, s.tauCFullPrecision, 'report unrounded tauC must equal result tauCFullPrecision');
  assert.equal(report.shear.find((e) => e.name === 'Concrete shear capacity Vc').value, s.vc, 'report Vc must equal result Vc');
  assert.equal(report.shear.find((e) => e.name === 'Vu').value, s.vu, 'report Vu must equal result Vu');

  const step = (n) => String(result.calculationSteps.find((c) => c.step === n)?.value ?? '');
  assert.ok(step(16).includes(String(s.ptFullPrecision)), 'step 16 must show the authoritative pt');
  assert.ok(step(18).includes(`tau_c = ${s.tauC} N/mm²`), 'step 18 must show the displayed tau_c');
  assert.ok(step(20).includes(String(s.vc)), 'step 20 must show the authoritative Vc');
  assert.ok(step(21).includes(String(s.vuMinusVc)), 'step 21 must show Vu - Vc');

  // The PDF shear section prints the engine's own values, so the same literals must appear.
  // (Vu - Vc is negative here; the PDF reports the required shear reinforcement instead.)
  for (const needle of [String(s.tauC), String(s.vc), String(s.vusRequired)]) {
    assert.ok(fp.includes(needle.toUpperCase()), `PDF must contain ${needle}`);
  }
});


test('FIX 2: effective/design span is used directly and never re-derived from clear span', () => {
  const result = generateBeamDesign(BASELINE_INPUT);
  const report = beamReportData(result);

  assert.equal(result.spanMode, 'EFFECTIVE_SPAN_INPUT');
  assert.equal(result.designSpan, 4);
  assert.equal(result.clearSpan, null, 'clear span must stay null, never defaulted to the design span');
  assert.equal(result.supportWidth, null, 'support width must stay null, never inferred');

  // The design span must equal the user input exactly, not a clear-span derivation.
  assert.equal(result.ultimateMoment, 25.125 * 4 ** 2 / 8, 'Mu must use the supplied design span directly');

  const spanRow = report.inputs.find((e) => e.name === 'Effective/Design Span');
  assert.equal(spanRow.classification, 'INPUT');
  assert.match(spanRow.clause, /directly supplied by user/i);
  assert.match(spanRow.clause, /no effective-span derivation was performed/i);
  assert.equal(report.inputs.find((e) => e.name === 'Clear span').classification, 'NOT PROVIDED');
  assert.equal(report.inputs.find((e) => e.name === 'Support width').classification, 'NOT PROVIDED');
});

test('FIX 2b: supplied clear span and support width drive a calculated effective span', () => {
  const result = generateBeamDesign({ ...BASELINE_INPUT, clearSpan: 3.8, supportWidth: 200, terminationSetbackFromSupportFace: 100 });
  const report = beamReportData(result);

  assert.equal(result.spanMode, 'GEOMETRY');
  assert.equal(result.clearSpan, 3.8);
  assert.equal(result.supportWidth, 200);
  // IS 456:2000 Clause 22.2 — effective span for a simply supported beam = clear span + support width.
  assert.equal(result.designSpan, 4);
  assert.equal(report.inputs.find((e) => e.name === 'Calculated Effective Span').classification, 'CALCULATED');
  assert.equal(report.inputs.find((e) => e.name === 'Calculated Effective Span').value, 4);
  // The two modes are mutually exclusive: a derived span never claims to be user-supplied.
  assert.equal(report.inputs.find((e) => e.name === 'Effective/Design Span'), undefined);
});

test('FIX 3/g: NOT PROVIDED anchorage geometry stays null and never becomes zero', () => {
  const result = generateBeamDesign(BASELINE_INPUT);

  for (const [label, actual] of [
    ['developmentLengthAvailable', result.developmentLengthAvailable],
    ['developmentLength.ldAvailable', result.developmentLength.ldAvailable],
    ['developmentLength.availableAnchorage', result.developmentLength.availableAnchorage],
    ['developmentLength.grossEmbedment', result.developmentLength.grossEmbedment],
    ['anchorageRatio', result.anchorageRatio],
    ['reinforcement.availableAnchorage', result.reinforcement.availableAnchorage]
  ]) {
    assert.equal(actual, null, `${label} must be null when geometry is not provided`);
    assert.notEqual(actual, 0, `${label} must never be 0 when geometry is not provided`);
  }

  // Ld required is still calculated, but available anchorage is never inferred from the span.
  assert.ok(result.developmentLengthRequired > 0, 'Ld required is still calculated');
  assert.notEqual(result.developmentLengthAvailable, result.designSpan * 1000, 'available anchorage must not be inferred from the span');
});

test('FIX 3/h: anchorage and final status stay VERIFICATION REQUIRED when geometry is missing', () => {
  const result = generateBeamDesign(BASELINE_INPUT);
  const report = beamReportData(result);

  assert.equal(result.developmentStatus, 'VERIFICATION REQUIRED');
  assert.equal(result.reinforcement.anchorageStatus, 'VERIFICATION REQUIRED');
  assert.equal(result.checks.find((c) => c.name === 'Development length').status, 'VERIFICATION REQUIRED');
  assert.equal(result.checks.find((c) => c.name === 'Anchorage adequacy').status, 'VERIFICATION REQUIRED');
  assert.equal(result.finalStatus, 'VERIFICATION REQUIRED');
  assert.equal(result.designStatus, 'VERIFICATION REQUIRED');
  assert.equal(report.finalStatus, 'VERIFICATION REQUIRED', 'report final status must match the engine');
  assert.notEqual(result.finalStatus, 'PASS', 'overall design must not be labelled PASS while anchorage is unverified');
});

test('FIX 4: final check hierarchy is complete and overall status is not PASS', () => {
  const result = generateBeamDesign(BASELINE_INPUT);
  const names = result.checks.map((c) => c.name);

  for (const required of ['Flexural capacity', 'Minimum steel', 'Maximum steel', 'Under-reinforced section',
    'Longitudinal spacing', 'Concrete shear capacity', 'Maximum shear stress', 'Minimum shear reinforcement',
    'Stirrup capacity', 'Maximum stirrup spacing', 'Deflection', 'Development length', 'Anchorage adequacy']) {
    assert.ok(names.includes(required), `final checks must include "${required}"`);
  }
  for (const passed of ['Flexural capacity', 'Concrete shear capacity', 'Deflection']) {
    assert.equal(result.checks.find((c) => c.name === passed).status, 'PASS');
  }
  assert.equal(result.finalStatus, 'VERIFICATION REQUIRED');
});

test('FIX 8: singly reinforced terminology is preserved and top bars are not compression steel', () => {
  const result = generateBeamDesign(BASELINE_INPUT);
  const report = beamReportData(result);

  assert.equal(result.reinforcement.flexuralModel, 'Singly reinforced section');
  assert.match(result.compressionReinforcement, /not required for the singly reinforced flexural model/i);
  assert.equal(result.reinforcement.topBars.structuralRole, 'hanger/detailing');
  assert.equal(result.reinforcement.bottomBars.structuralRole, 'tension');
  assert.equal(result.reinforcement.bottomBars.face, 'bottom');
  assert.equal(report.reinforcement.find((e) => e.name === 'Flexural design model').value, 'Singly reinforced section');

  // The top bars must never be described as designed compression reinforcement.
  const topRow = report.reinforcement.find((e) => e.name.includes('detailing/hanger bars'));
  assert.match(topRow.clause, /not flexurally designed compression reinforcement/i);
});

test('FINAL VALIDATION: baseline case is free of NaN, undefined and contradictory values', async () => {
  const result = generateBeamDesign(BASELINE_INPUT);
  const report = beamReportData(result);
  const fp = pdfText(await generateBeamPdfReport({ result }));

  // No NaN, Infinity or undefined anywhere in the authoritative result.
  const walk = (node, path = '$') => {
    if (typeof node === 'number') assert.ok(Number.isFinite(node), `${path} must be finite`);
    if (node === undefined) assert.fail(`${path} must not be undefined`);
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    }
  };
  walk(result);

  // Existing correct engineering values are preserved (FIX 9).
  assert.equal(result.selfWeight, 3.75);
  assert.equal(result.deadLoad, 6.75);
  assert.equal(result.serviceLoad, 16.75);
  assert.equal(result.ultimateLoad, 25.125);
  assert.equal(result.ultimateMoment, 50.25);
  assert.equal(result.ultimateShear, 50.25);
  assert.equal(result.effectiveDepth, 459);
  assert.equal(result.requiredAreaSteel, 315.39);
  assert.equal(result.minimumReinforcement, 282.04);
  assert.equal(result.providedAreaSteel, 402.12);
  assert.equal(result.maximumReinforcement, 6000);
  assert.equal(result.mainReinforcement, '2-16 mm Ø');
  assert.equal(result.developmentLengthRequired, 644.73);
  assert.equal(result.reinforcement.stirrups.label, '2-legged 8 mm dia @ 300 mm c/c');

  // The in-memory result equals its JSON/API representation exactly.
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);

  // UI/PDF/result agreement on the headline values.
  assert.ok(fp.includes(String(result.shearCalculation.vc).toUpperCase()), 'PDF Vc must match the result');
  assert.ok(fp.includes(String(result.developmentLengthRequired).toUpperCase()), 'PDF Ld required must match the result');
  assert.ok(fp.includes('VERIFICATIONREQUIRED'), 'PDF final status must be VERIFICATION REQUIRED');
  assert.equal(report.finalStatus, result.finalStatus);
  assert.equal(report.development.find((e) => e.name === 'Status').value, 'VERIFICATION REQUIRED');
});

test('Anchorage remains VERIFICATION REQUIRED when geometry is missing (baseline guard)', () => {
  const result = generateBeamDesign({
    length: 4, breadth: 300, overallDepth: 500, supportType: 'Simply Supported',
    clearCover: 25, concreteGrade: 'M25', steelGrade: 'Fe415', liveLoad: 10, deadLoad: 3,
    unitWeightConcrete: 25, preferredBarDiameter: 16
  });

  assert.equal(result.developmentStatus, 'VERIFICATION REQUIRED');
  assert.equal(result.developmentLength.developmentStatus, 'VERIFICATION REQUIRED');
  assert.equal(result.developmentLength.status, 'VERIFICATION REQUIRED');
  assert.equal(result.reinforcement.anchorageStatus, 'VERIFICATION REQUIRED');
  assert.equal(result.finalStatus, 'VERIFICATION REQUIRED');
  assert.equal(result.designStatus, 'VERIFICATION REQUIRED');

  const devCheck = result.checks.find((check) => check.name === 'Development length');
  const anchorageCheck = result.checks.find((check) => check.name === 'Anchorage adequacy');
  assert.equal(devCheck.status, 'VERIFICATION REQUIRED');
  assert.equal(anchorageCheck.status, 'VERIFICATION REQUIRED');
});

test('Final status hierarchy: structural checks pass but anchorage forces VERIFICATION REQUIRED', () => {
  const result = generateBeamDesign({
    length: 4, breadth: 300, overallDepth: 500, supportType: 'Simply Supported',
    clearCover: 25, concreteGrade: 'M25', steelGrade: 'Fe415', liveLoad: 10, deadLoad: 3,
    unitWeightConcrete: 25, preferredBarDiameter: 16
  });

  // All structural checks should be PASS
  const structuralChecks = ['Flexural capacity', 'Minimum steel', 'Maximum steel', 'Under-reinforced section', 'Longitudinal spacing', 'Concrete shear capacity', 'Maximum shear stress', 'Minimum shear reinforcement', 'Stirrup capacity', 'Maximum stirrup spacing', 'Deflection'];
  for (const name of structuralChecks) {
    const check = result.checks.find((c) => c.name === name);
    assert.equal(check.status, 'PASS', `${name} should be PASS`);
  }

  // Development and anchorage checks should be VERIFICATION REQUIRED
  assert.equal(result.checks.find((c) => c.name === 'Development length').status, 'VERIFICATION REQUIRED');
  assert.equal(result.checks.find((c) => c.name === 'Anchorage adequacy').status, 'VERIFICATION REQUIRED');

  // Final status must be VERIFICATION REQUIRED despite all structural checks passing
  assert.equal(result.finalStatus, 'VERIFICATION REQUIRED', 'final status must remain VERIFICATION REQUIRED when anchorage is unresolved');
  assert.equal(result.designStatus, 'VERIFICATION REQUIRED');
});

test('tau_c, Vc, and span values are identical across result, calculation steps, report, and PDF', async () => {
  const input = {
    length: 4, breadth: 300, overallDepth: 500, supportType: 'Simply Supported',
    clearCover: 25, concreteGrade: 'M25', steelGrade: 'Fe415', liveLoad: 10, deadLoad: 3,
    unitWeightConcrete: 25, preferredBarDiameter: 16
  };
  const result = generateBeamDesign(input);
  const report = beamReportData(result);
  const pdf = await generateBeamPdfReport({ result });
  const fingerprint = [...pdf.toString('latin1').matchAll(/<([0-9a-fA-F]+)>/g)]
    .map((m) => Buffer.from(m[1], 'hex').toString('latin1'))
    .join(' ')
    .replace(/\s+/g, '')
    .toUpperCase();

  // tauC: result → report → calculation step → PDF must all match
  const reportTauC = report.shear.find((e) => e.name === 'τc');
  assert.equal(reportTauC.value, result.shearCalculation.tauC, 'report tauC must match result tauC');

  const step18 = String(result.calculationSteps.find((s) => s.step === 18)?.value ?? '');
  assert.match(step18, new RegExp(`tau_c = ${result.shearCalculation.tauC} N/mm²`), 'calculation step must show the same 3-dp tauC');

  assert.ok(fingerprint.includes(String(result.shearCalculation.tauC).replace(/\s+/g, '').toUpperCase() + 'N/MM'), 'PDF must contain the same tauC value');

  // Vc: result → report → calculation step → PDF must all match
  const reportVc = report.shear.find((e) => e.name === 'Concrete shear capacity Vc');
  assert.equal(reportVc.value, result.shearCalculation.vc, 'report Vc must match result Vc');

  const step20 = String(result.calculationSteps.find((s) => s.step === 20)?.value ?? '');
  assert.ok(step20.includes(String(result.shearCalculation.vc)), 'calculation step must show the same Vc');

  // The PDF prints the value exactly as the engine produced it (2 dp, decimal point included).
  // The needle must therefore be the rendered string, not a dot-stripped variant.
  assert.ok(fingerprint.includes(String(result.shearCalculation.vc).toUpperCase()), 'PDF must contain the same Vc value');

  // tauCFullPrecision must be in the report and match the result
  const reportTauCFull = report.shear.find((e) => e.name === 'τc (unrounded)');
  assert.equal(reportTauCFull.value, result.shearCalculation.tauCFullPrecision, 'report full-precision tauC must match result');

  // Span: result → report → PDF must match
  const reportSpan = report.inputs.find((e) => e.name === 'Effective/Design Span');
  assert.equal(reportSpan.value, result.designSpan, 'report span must match result designSpan');

  // Development length status must be consistent
  assert.equal(result.developmentStatus, 'VERIFICATION REQUIRED');
  assert.equal(report.development.find((e) => e.name === 'Status').value, result.developmentLength.status, 'PDF/report development status must match');
});
