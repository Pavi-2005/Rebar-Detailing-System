import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSlabDesign } from './src/services/slabCalculationService.js';
import { generatePdfReport, slabReportData } from './src/services/reportService.js';
import { slabShearStatusPresentation } from '../client/src/utils/reinforcementDetailingPresentation.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const designConstants = JSON.parse(fs.readFileSync(path.join(testDirectory, 'src', 'constants', 'designConstants.json'), 'utf8'));

// The reference case used throughout these tests.
export const slabInput = {
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
};

const finite = (value) => Number.isFinite(Number(value)) && value !== null && value !== undefined;
const approx = (actual, expected, digits = 6) => {
  assert.equal(finite(actual), true, `expected a finite value, received ${actual}`);
  assert.ok(Math.abs(Number(actual) - expected) < 0.5 * 10 ** -digits, `${actual} != ${expected}`);
};

const NOT_PROVIDED = 'NOT PROVIDED';
const NOT_ESTABLISHED = 'NOT ESTABLISHED';

// PDFKit writes text as hex-encoded glyph runs, so raw buffer scanning cannot find
// section headings. Decode every <hex> run and concatenate the text operators in order.
export function extractPdfText(buffer) {
  const raw = buffer.toString('latin1');
  const chunks = [];
  const runPattern = /<([0-9a-fA-F]+)>\s*(?:TJ|Tj)|\[((?:\s*<[0-9a-fA-F]+>\s*(?:-?\d+\s*)?)+)\]\s*TJ|\(((?:\\.|[^()\\])*)\)\s*Tj/g;
  let match;
  while ((match = runPattern.exec(raw)) !== null) {
    if (match[1]) {
      chunks.push(Buffer.from(match[1], 'hex').toString('latin1'));
    } else if (match[2]) {
      const inner = match[2].match(/<([0-9a-fA-F]+)>/g) || [];
      chunks.push(inner.map((hex) => Buffer.from(hex.replace(/[<>]/g, ''), 'hex').toString('latin1')).join(''));
    } else if (match[3] !== undefined) {
      chunks.push(match[3]);
    }
  }
  return chunks.join('');
}

test('effective spans and aspect ratio derive from the supplied geometry', () => {
  const result = generateSlabDesign(slabInput);
  const support = slabInput.wallThickness;

  // The short span is the smaller overall dimension. The previous implementation
  // reported the clear spans on the wrong axis (short = 5, long = 3).
  assert.equal(result.totalShortSpan, 3);
  assert.equal(result.totalLongSpan, 5);

  // IS 456:2000 Clause 22.2: clear span = total span - support width, and the
  // effective span is the greater of the total span and clear span + support width.
  assert.equal(result.clearShortSpan, 3 - support / 1000);
  assert.equal(result.clearLongSpan, 5 - support / 1000);
  assert.equal(result.effectiveShortSpan, 3);
  assert.equal(result.effectiveLongSpan, 5);
  // The span identifiers consumed by the UI must be the effective spans.
  assert.equal(result.shortSpan, result.effectiveShortSpan);
  assert.equal(result.longSpan, result.effectiveLongSpan);
  assert.equal(result.designOutput.shortSpan, result.effectiveShortSpan);
  assert.equal(result.designOutput.longSpan, result.effectiveLongSpan);
  approx(result.aspectRatio, 5 / 3, 3);
});

test('the calculation trace reports the clear spans on the correct axis', () => {
  const result = generateSlabDesign(slabInput);
  const steps = result.calculationSteps;
  const clearSpanStep = steps.find((entry) => entry.title === 'Clear span');
  const effectiveStep = steps.find((entry) => entry.title === 'Effective span');

  assert.ok(clearSpanStep, 'the trace must contain a dedicated clear-span step');
  // 3.00 m - 0.15 m = 2.85 m for the short span; 5.00 m - 0.15 m = 4.85 m for the long.
  assert.match(clearSpanStep.substitution, /Clear short span = 3 - 0\.15 = 2\.85 m/);
  assert.match(clearSpanStep.substitution, /clear long span = 5 - 0\.15 = 4\.85 m/);
  // The previous trace had these two swapped: "Clear short span = 5 - 0.15 = 2.85".
  assert.equal(/Clear short span = 5 /.test(clearSpanStep.substitution), false);
  assert.equal(/clear long span = 3 /.test(clearSpanStep.substitution), false);

  // IS 456:2000 Clause 22.2: Leff = min(clear span + d, centre-to-centre support span).
  assert.match(effectiveStep.formula, /min\(clear span \+ d, centre-to-centre support span\)/);
  assert.match(effectiveStep.substitution, /clear span \+ d = 3\.119 m; centre-to-centre = 3 m; Leff = min\(3\.119, 3\) = 3 m/);
  assert.match(effectiveStep.substitution, /clear span \+ d = 5\.107 m; centre-to-centre = 5 m; Leff = min\(5\.107, 5\) = 5 m/);
  assert.equal(effectiveStep.result, 'lx = 3 m; ly = 5 m');
});

test('slab classification follows the selected Table 27 or Table 26 design path', () => {
  const twoWay = generateSlabDesign(slabInput);
  assert.equal(twoWay.slabType, 'Two Way Slab');
  assert.ok(twoWay.aspectRatio <= 2);

  // The classification check always states the governing rule and both outcomes.
  const classification = twoWay.checksByCategory.classification;
  assert.match(classification.reason, /Table 27/);
  assert.match(classification.reason, /finite coefficient interpolation is supported only through ly\/lx = 2\.5/i);
  assert.equal(classification.limitValue, null);
  assert.equal(twoWay.finiteCoefficientLimit, 2.5);
  assert.equal(classification.actualValue, twoWay.aspectRatio);
  assert.equal(classification.codeReference, 'IS 456:2000 Table 27');

  // The Table 27 path includes the exact published 2.0 row.
  const exactBoundary = generateSlabDesign({ ...slabInput, length: 6, width: 3 });
  assert.equal(exactBoundary.aspectRatio, 2);
  assert.equal(exactBoundary.slabType, 'Two Way Slab');
  assert.equal(exactBoundary.checksByCategory.classification.status, 'PASS');

  // Table 27 supports finite interpolation above 2.0 through its 2.5 row.
  const aboveTwo = generateSlabDesign({ ...slabInput, length: 6.01, width: 3 });
  assert.equal(aboveTwo.slabType, 'Two Way Slab');
  assert.equal(aboveTwo.coefficientInterpolationLowerM, 2);
  assert.equal(aboveTwo.coefficientInterpolationUpperM, 2.5);

  const restrained = generateSlabDesign({ ...slabInput, cornerRestraint: 'RESTRAINED', length: 6, width: 3 });
  assert.equal(restrained.checksByCategory.classification.limitValue, 2);
  assert.match(restrained.checksByCategory.classification.reason, /Table 26/);
  assert.throws(() => generateSlabDesign({ ...slabInput, cornerRestraint: 'RESTRAINED', length: 6.01, width: 3 }), /ONE-WAY SLAB DESIGN NOT IMPLEMENTED/);
});

test('load calculation reproduces self weight, dead, service and ultimate load', () => {
  const result = generateSlabDesign(slabInput);
  const d = result.slabThickness / 1000;

  approx(result.selfWeight, d * slabInput.unitWeightConcrete, 4);
  approx(result.floorFinish, slabInput.floorFinishLoad, 4);
  approx(result.deadLoad, result.selfWeight + slabInput.floorFinishLoad, 4);
  approx(result.liveLoad, slabInput.liveLoad, 4);
  approx(result.serviceLoad, result.deadLoad + result.liveLoad, 4);
  approx(result.ultimateLoad, 1.5 * (result.deadLoad + result.liveLoad), 4);
  assert.equal(result.loadSummary.ultimateLoad, result.ultimateLoad);
  assert.equal(result.loadSummary.unit, 'kN/m²');
});

test('two-way moments use the IS 456 Table 27 coefficients and the short span', () => {
  const result = generateSlabDesign(slabInput);

  // Simply supported + FREE_TO_LIFT must select Table 27, never Table 26.
  assert.equal(result.coefficientTableId, 'IS_456_TABLE_27');
  assert.equal(result.coefficientTableReference, 'IS 456:2000 Table 27');
  assert.equal(result.coefficientSource.includes('Table 27'), true);
  assert.equal(result.coefficientSource.includes('Table 26'), false);
  assert.match(result.coefficientSelectionReason, /Table 27 coefficients apply/);
  assert.match(result.coefficientTableRuledOut, /Table 26 is not used/);
  assert.equal(result.alphaX, result.coefficientShort);
  assert.equal(result.alphaY, result.coefficientLong);
  assert.equal(result.shortSpanUsedForBothMoments, result.effectiveShortSpan);

  // The published Table 27 rows bracket ly/lx = 1.667 as 1.5 and 1.75.
  assert.equal(result.coefficientInterpolationLowerM, 1.5);
  assert.equal(result.coefficientInterpolationUpperM, 1.75);

  approx(result.MuShort, result.coefficientShort * result.ultimateLoad * result.effectiveShortSpan ** 2, 3);
  approx(result.MuLong, result.coefficientLong * result.ultimateLoad * result.effectiveShortSpan ** 2, 3);
  assert.equal(result.designForces.MuX, result.MuShort);
  assert.equal(result.designForces.MuY, result.MuLong);
});

test('flexural design keeps the flexural requirement separate from the minimum steel', () => {
  const result = generateSlabDesign(slabInput);

  for (const direction of ['Short', 'Long']) {
    const required = result[`AstRequired${direction}`];
    const flexural = result[`AstFlexuralRequired${direction}`];
    const minimum = result[`AstMinimum${direction}`];
    const provided = result[`AstProvided${direction}`];
    const capacity = result[`momentCapacity${direction}`];
    const requiredMoment = result[`Mu${direction}`];

    // The three areas are distinct values, not one collapsed "Ast required" field.
    assert.equal(finite(flexural), true, `${direction} flexural Ast must be finite`);
    assert.equal(finite(minimum), true, `${direction} minimum Ast must be finite`);
    assert.ok(flexural < minimum, `${direction} minimum steel must govern for this slab`);
    approx(required, Math.max(flexural, minimum), 2);
    assert.ok(provided >= required, `${direction} provided Ast must meet the governing requirement`);
    assert.ok(provided >= minimum, `${direction} provided Ast must meet the minimum Ast`);

    // Mu = 0.87 fy Ast (d - 0.42 xu) with xu = 0.87 fy Ast/(0.36 fck b)
    const xu = result[`xu${direction}`];
    approx(capacity, (0.87 * result.fy * provided * (result[`effectiveDepth${direction}`] - 0.42 * xu)) / 1e6, 2);
    assert.ok(capacity >= requiredMoment, `${direction} moment capacity must meet the design moment`);
    assert.ok(xu <= result[`xuMax${direction}`], `${direction} section must remain under-reinforced`);
  }

  assert.equal(result.shortDirectionFlexuralStatus, 'PASS');
  assert.equal(result.longDirectionFlexuralStatus, 'PASS');
  assert.equal(result.checksByCategory.flexureShort.status, 'PASS');
  assert.equal(result.checksByCategory.flexureLong.status, 'PASS');
});

test('minimum reinforcement follows the applicable IS 456 slab provision', () => {
  const fe500 = generateSlabDesign(slabInput);
  const fe415 = generateSlabDesign({ ...slabInput, steelGrade: 'Fe415' });

  // IS 456:2000 Clause 26.5.2.1: 0.12% for Fe500, 0.15% for mild steel, of b x D.
  approx(fe500.AstMinimumShort, 0.0012 * 1000 * fe500.slabThickness, 2);
  approx(fe415.AstMinimumShort, 0.0015 * 1000 * fe415.slabThickness, 2);
  // The governing percentage is what the clause sets; the absolute area depends on
  // the adopted thickness, which the engine may differ between the two runs.
  approx(100 * fe500.AstMinimumShort / (1000 * fe500.slabThickness), 0.12, 4);
  approx(100 * fe415.AstMinimumShort / (1000 * fe415.slabThickness), 0.15, 4);
  assert.equal(fe500.shortDirectionAstMinimum, fe500.AstMinimumShort);
  assert.equal(fe500.longDirectionAstMinimum, fe500.AstMinimumLong);
});

test('maximum and clear spacing satisfy IS 456 Clause 26.3.2 and 26.3.3', () => {
  const result = generateSlabDesign(slabInput);

  for (const direction of ['Short', 'Long']) {
    const detail = direction === 'Short' ? result.shortDirectionReinforcement : result.longDirectionReinforcement;
    const depth = result[`effectiveDepth${direction}`];
    // Maximum main steel spacing = min(3d, 300 mm).
    approx(detail.maxSpacing, Math.min(3 * depth, 300), 2);
    assert.ok(detail.spacing <= detail.maxSpacing);
    approx(detail.clearSpacing, detail.spacing - detail.diameter, 2);
    assert.ok(detail.clearSpacing >= result.minimumClearSpacing);
  }
  assert.equal(result.checksByCategory.spacingShort.status, 'PASS');
  assert.equal(result.checksByCategory.clearSpacingLong.status, 'PASS');
});

test('selected bar diameter and provided steel are consistent with the bar area', () => {
  const result = generateSlabDesign(slabInput);

  for (const detail of [result.shortDirectionReinforcement, result.longDirectionReinforcement]) {
    assert.ok(finite(detail.diameter) && finite(detail.spacing));
    approx(detail.AstProvided, ((Math.PI / 4) * detail.diameter ** 2 * 1000) / detail.spacing, 2);
    assert.equal(detail.label, `${detail.diameter} mm @ ${detail.spacing} mm c/c`);
  }
  // Effective depths follow the adopted bar sizes.
  approx(result.effectiveDepthShort, result.slabThickness - result.clearCover - result.shortDirectionReinforcement.diameter / 2, 2);
  approx(result.effectiveDepthLong, result.slabThickness - result.clearCover - result.shortDirectionReinforcement.diameter - result.longDirectionReinforcement.diameter / 2, 2);
});

test('shear is checked at the critical section against the Table 19 concrete strength', () => {
  const result = generateSlabDesign(slabInput);
  const d = result.effectiveDepthShort;
  const supportWidthM = result.supportWallThickness / 1000;

  // IS 456:2000 Clause 40: the critical section is d from the FACE of the support.
  // The support face is half a support width in from the centreline, so the lever arm
  // to the critical section is lx/2 - supportWidth/2 - d.
  approx(result.Vu, Math.max(result.ultimateLoad * (result.effectiveShortSpan / 2 - supportWidthM / 2 - d / 1000), 0), 3);
  approx(result.shearReaction, result.ultimateLoad * result.effectiveShortSpan / 2, 3);
  approx(result.shearCriticalSectionFromCentrelineM, result.effectiveShortSpan / 2 - supportWidthM / 2 - d / 1000, 4);
  approx(result.shearSupportFaceToCentrelineM, supportWidthM / 2, 4);
  approx(result.shearStress, (result.Vu * 1000) / (1000 * d), 4);
  assert.match(result.criticalSection, /from the FACE of the support/);
  // Table 19 is read at the provided steel percentage; pt <= 0.15% uses the first row.
  assert.equal(result.concreteShearStrength, 0.29);
  approx(result.shearCapacity, 0.29 * 1000 * d / 1000, 3);
  approx(result.shearStress, 0.0774, 4);
  assert.equal(result.maxShearStress, 3.7);
  approx(result.shearCapacity, 78.01, 2);
  assert.ok(result.concreteShearStrength <= result.maxShearStress);
  assert.ok(result.shearStress <= result.concreteShearStrength);
  assert.equal(result.shearStatus, 'PASS');
  assert.equal(result.checksByCategory.shear.status, 'PASS');
});

test('Table 19 correction changes only the M35 lower endpoint', () => {
  const table = designConstants.shearStrengthTable;

  assert.equal(table.M35['0.15'], 0.29);
  assert.deepEqual(table.M35, {
    '0.15': 0.29, '0.25': 0.38, '0.50': 0.52, '0.75': 0.62,
    '1.00': 0.70, '1.25': 0.75, '1.50': 0.79, '1.75': 0.83,
    '2.00': 0.86, '2.50': 0.89, '3.00': 0.92
  });
  assert.deepEqual(table.M20, { '0.15': 0.28, '0.25': 0.36, '0.50': 0.48, '0.75': 0.56, '1.00': 0.62, '1.25': 0.67, '1.50': 0.70, '1.75': 0.72, '2.00': 0.74, '2.50': 0.76, '3.00': 0.78 });
  assert.deepEqual(table.M25, { '0.15': 0.29, '0.25': 0.36, '0.50': 0.49, '0.75': 0.57, '1.00': 0.64, '1.25': 0.70, '1.50': 0.74, '1.75': 0.77, '2.00': 0.79, '2.50': 0.82, '3.00': 0.83 });
  assert.deepEqual(table.M30, { '0.15': 0.30, '0.25': 0.37, '0.50': 0.50, '0.75': 0.59, '1.00': 0.66, '1.25': 0.72, '1.50': 0.76, '1.75': 0.80, '2.00': 0.82, '2.50': 0.85, '3.00': 0.88 });
  // This repository's supplied slab Table 19 dataset contains M20-M35 only. M40,
  // M45 and M50 have no Table 19 rows here, so this narrow correction must not invent
  // or alter unsupported-grade data.
  assert.equal(table.M40, undefined);
  assert.equal(table.M45, undefined);
  assert.equal(table.M50, undefined);
});

test('slab PDF reports the authoritative corrected Table 19 shear result', async () => {
  const result = generateSlabDesign(slabInput);
  const pdf = await generatePdfReport({ ...slabInput, result });
  const text = extractPdfText(pdf);

  assert.equal(pdf.toString('latin1').slice(0, 4), '%PDF');
  assert.ok(text.includes('tau_c (IS 456 Table 19): 0.29'), 'PDF must consume calculated tau_c, not a report-side constant');
  assert.ok(text.includes('Concrete shear capacity: 78.01 kN/m'), 'PDF must consume the capacity derived from corrected tau_c');
  assert.ok(text.includes('Status: PASS'), 'corrected concrete shear result remains PASS');
  assert.equal(/\bundefined\b|\bNaN\b|\bInfinity\b/.test(text), false);
});

test('deflection keeps VERIFICATION REQUIRED when the Fig. 4 factor cannot be established', () => {
  const result = generateSlabDesign(slabInput);

  // pt = 100 Ast/(b d) and fs = 0.58 fy Ast,req/Ast,prov
  approx(result.deflectionPt, (100 * result.deflectionAstUsedForPt) / (1000 * result.deflectionPtEffectiveDepth), 4);
  approx(result.deflectionServiceStress, 0.58 * result.fy * result.deflectionAstRequiredForFs / result.deflectionAstUsedForPt, 2);

  if (result.modificationFactor === null) {
    // Outside the validated dataset: never fabricated, never silently clamped.
    assert.equal(result.permissibleLd, null);
    assert.equal(result.modificationFactor, NOT_ESTABLISHED === NOT_ESTABLISHED ? null : null);
    assert.equal(result.deflectionStatus, 'VERIFICATION REQUIRED');
    assert.equal(result.checksByCategory.deflection.status, 'VERIFICATION REQUIRED');
    assert.equal(result.deflectionClampingApplied, false);
    assert.ok(result.deflectionMessage.length > 0);
  } else {
    approx(result.permissibleLd, result.basicLd * result.modificationFactor, 2);
    assert.ok(['PASS', 'FAIL'].includes(result.deflectionStatus));
  }
});

test('corner torsion is NOT REQUIRED for a free-to-lift corner and is never reported as FAIL', () => {
  const result = generateSlabDesign(slabInput);
  const check = result.checks.find((entry) => entry.name === 'Corner torsion restraint');

  assert.equal(result.cornerRestraint, 'FREE_TO_LIFT');
  assert.equal(result.cornerRestraintLabel, 'FREE TO LIFT');
  assert.equal(result.cornerTorsionStatus, 'NOT REQUIRED');
  assert.equal(check.status, 'NOT REQUIRED');
  assert.notEqual(check.status, 'FAIL');
  assert.equal(result.adoptedThickness === null || finite(result.adoptedThickness), true);
});

test('a restrained corner is distinguished from a free-to-lift corner', () => {
  const result = generateSlabDesign({ ...slabInput, cornerRestraint: 'RESTRAINED' });
  const check = result.checks.find((entry) => entry.name === 'Corner torsion restraint');

  assert.equal(result.cornerRestraintLabel, 'RESTRAINED');
  assert.notEqual(result.cornerTorsionStatus, 'NOT REQUIRED');
  assert.equal(check.status, 'VERIFICATION REQUIRED');
  assert.notEqual(check.status, 'PASS', 'an unimplemented restrained-corner case must never auto-pass');
  assert.ok(result.cornerTorsionReason.length > 0);
});

test('final status is derived from the authoritative checks and never hides a verification', () => {
  const result = generateSlabDesign(slabInput);
  const checks = result.checks;
  const hasFail = checks.some((check) => check.status === 'FAIL');
  const hasVerification = checks.some((check) => check.status === 'VERIFICATION REQUIRED');

  if (hasFail) {
    assert.equal(result.finalStatus, 'NOT APPROVED');
  } else if (hasVerification) {
    assert.equal(result.finalStatus, 'VERIFICATION REQUIRED');
  } else {
    assert.equal(result.finalStatus, 'APPROVED');
  }
  assert.equal(result.designStatus, result.finalStatus);
  assert.equal(result.finalDesign.designStatus, result.finalStatus);
  // A VERIFICATION REQUIRED check must never be reported as PASS.
  if (hasVerification) assert.notEqual(result.finalStatus, 'APPROVED');
});

test('thickness iteration never adopts a thickness that satisfied nothing', () => {
  const result = generateSlabDesign(slabInput);
  const iterations = result.designIterations;

  assert.equal(iterations.length > 0, true);
  assert.equal(iterations[0].thickness, slabInput.slabThickness);
  assert.equal(result.initialThickness, slabInput.slabThickness);
  for (const iteration of iterations) {
    assert.equal(finite(iteration.thickness), true);
    assert.equal(finite(iteration.effectiveDepthShort), true);
    assert.equal(finite(iteration.effectiveDepthLong), true);
    assert.equal(iteration.permissibleLd === null || finite(iteration.permissibleLd), true);
  }

  if (result.adoptedThickness === null) {
    assert.equal(result.adoptedThicknessLabel, NOT_ESTABLISHED);
    assert.equal(result.adoptedThicknessStatus, 'VERIFICATION REQUIRED');
    assert.notEqual(result.adoptedThickness, result.lastEvaluatedThickness);
    assert.equal(result.finalStatus, 'VERIFICATION REQUIRED');
  } else {
    assert.equal(result.adoptedThickness, result.adoptedThicknessLabel);
    assert.ok(iterations.some((iteration) => iteration.thickness === result.adoptedThickness));
  }
});

test('the calculation trace is complete, structured and free of blank engineering values', () => {
  const result = generateSlabDesign(slabInput);
  const steps = result.calculationSteps;

  assert.equal(Array.isArray(steps), true);
  assert.equal(steps.length, 39);
  steps.forEach((entry, index) => {
    assert.equal(entry.step, index + 1);
    assert.ok(entry.title && entry.title.length > 0, `step ${entry.step} needs a title`);
    assert.ok(entry.formula && entry.formula.length > 0, `step ${entry.step} needs a formula`);
    assert.ok(entry.substitution && entry.substitution.length > 0, `step ${entry.step} needs a substitution`);
    // Every step is grouped so the UI can present the trace as collapsible sections.
    assert.ok(entry.group && entry.groupLabel, `step ${entry.step} needs a group`);
    assert.ok(entry.result !== null && entry.result !== undefined && entry.result !== '', `step ${entry.step} has a blank result`);
    const serialised = JSON.stringify(entry);
    assert.equal(/undefined|NaN|Infinity/.test(serialised), false, `step ${entry.step} leaked an invalid token: ${serialised}`);
  });

  // Trace values must equal the authoritative result fields they describe.
  const byTitle = (needle) => steps.find((entry) => entry.title.toLowerCase().includes(needle));
  assert.equal(byTitle('short span lx') ? steps[1].result.includes(`${result.effectiveShortSpan} m`) : true, true);
  assert.equal(Number(byTitle('aspect ratio').result), result.aspectRatio);
  assert.equal(Number(byTitle('self weight').result), result.selfWeight);
  assert.equal(Number(byTitle('ultimate load').result), result.ultimateLoad);
  assert.equal(Number(byTitle('governing required ast - short').result), result.AstRequiredShort);
  assert.equal(Number(byTitle('provided ast - short').result), result.AstProvidedShort);
  assert.equal(Number(byTitle('moment capacity - short').result), result.momentCapacityShort);
  assert.equal(Number(byTitle('governing required ast - long').result), result.AstRequiredLong);
  assert.equal(Number(byTitle('moment capacity - long').result), result.momentCapacityLong);
  assert.equal(byTitle('final checks and design status').result.includes(result.finalStatus), true);
  assert.equal(byTitle('permissible l/d').result, result.permissibleLd === null ? NOT_ESTABLISHED : String(result.permissibleLd));
});

test('end-to-end: calculation result, UI-consumed fields and PDF report agree', async () => {
  const result = generateSlabDesign(slabInput);
  const report = slabReportData({ ...slabInput, result });
  const pdf = await generatePdfReport({ ...slabInput, result });
  const pdfText = extractPdfText(pdf);

  // --- Previously broken fields must now be populated -------------------------
  assert.equal(result.shortSpan, 3);
  assert.equal(result.longSpan, 5);
  assert.equal(finite(result.shortDirectionAstRequired), true);
  assert.equal(finite(result.longDirectionAstRequired), true);
  assert.ok(result.calculationSteps.length > 0);
  assert.equal(typeof result.finalStatus, 'string');
  assert.ok(result.finalStatus.length > 0);

  // --- UI-consumed fields come from the same authoritative values -------------
  const output = result.designOutput;
  assert.equal(output.shortSpan, result.shortSpan);
  assert.equal(output.longSpan, result.longSpan);
  assert.equal(output.effectiveDepthShort, result.effectiveDepthShort);
  assert.equal(output.effectiveDepthLong, result.effectiveDepthLong);
  assert.equal(output.slabThickness, result.slabThickness);
  assert.equal(output.aspectRatio, result.aspectRatio);
  assert.equal(report.shortSpan, result.shortSpan);
  assert.equal(report.longSpan, result.longSpan);
  assert.equal(report.shortDirectionAstRequired, result.shortDirectionAstRequired);
  assert.equal(report.longDirectionAstRequired, result.longDirectionAstRequired);
  assert.equal(report.calculationSteps.length, result.calculationSteps.length);
  assert.equal(report.checks.length, result.checks.length);
  assert.equal(report.finalStatus, result.finalStatus);

  // --- PDF must contain the standardized report sections, in report order ---------
  const requiredSections = [
    'FINAL DESIGN STATUS', 'PROJECT / INPUTS / LOADS', 'GEOMETRY / DESIGN FORCES',
    'REINFORCEMENT DESIGN SUMMARY', 'SLAB REINFORCEMENT LAYOUT', 'DESIGN CHECKS',
    'DETAILED CALCULATION TRACE', 'ASSUMPTIONS / LIMITATIONS', 'FINAL VERIFICATION SUMMARY'
  ];
  let lastIndex = -1;
  for (const heading of requiredSections) {
    const index = pdfText.indexOf(heading);
    assert.ok(index > -1, `PDF is missing the ${heading} section. Extracted: ${pdfText.slice(0, 400)}`);
    assert.ok(index > lastIndex, `PDF section ${heading} is out of order.`);
    lastIndex = index;
  }
  // The PDF must carry the same authoritative numbers as the result and the UI.
  assert.ok(pdfText.includes(`Lx / Ly${result.shortSpan.toFixed(3)} / ${result.longSpan.toFixed(3)} m`), 'PDF is missing the authoritative spans');
  assert.ok(pdfText.includes(`Required steel for design: ${result.shortDirectionAstRequired} mm²/m`.replace('²', '²')), 'PDF is missing the short required steel');
  assert.ok(pdfText.includes(`Final design status: ${result.finalStatus}`), 'PDF is missing the final status');
  assert.equal(/\bundefined\b|\bNaN\b/.test(pdfText), false, 'PDF leaked an invalid token');
  assert.equal(pdf.toString('latin1').slice(0, 4), '%PDF');

  // --- No undefined / null / NaN leaks into any consumer ---------------------
  for (const consumer of [result.designOutput, result.loadSummary, result.designForces, result.shortDirectionReinforcement, result.longDirectionReinforcement, report]) {
    const serialised = JSON.stringify(consumer, (key, value) => (value === undefined ? '<<undefined>>' : value));
    assert.equal(serialised.includes('<<undefined>>'), false, `undefined leaked into ${Object.keys(consumer)[0] ?? 'consumer'}: ${serialised}`);
  }
  const stepsSerialised = JSON.stringify(result.calculationSteps);
  assert.equal(/\bundefined\b|\bNaN\b|\bInfinity\b/.test(stepsSerialised), false);
  const checksSerialised = JSON.stringify(result.checks);
  assert.equal(/\bundefined\b|\bNaN\b/.test(checksSerialised), false);
});

test('slab report presentation keeps shear, service load, span basis and Ast labels authoritative', async () => {
  const result = generateSlabDesign(slabInput);
  const pdf = await generatePdfReport({ ...slabInput, result });
  const pdfText = extractPdfText(pdf);

  assert.equal(slabShearStatusPresentation(result), result.shearStatus);
  assert.equal(result.shearStatus, 'PASS');
  assert.match(pdfText, /Shear: PASS/);
  assert.ok(pdfText.includes(`Self weight / service load = ${result.selfWeight.toFixed(3)} / ${result.serviceLoad.toFixed(3)} kN/m2`));
  assert.equal(result.serviceLoad, 12);

  const effectiveSpanIndex = pdfText.indexOf('Effective span validity');
  assert.notEqual(effectiveSpanIndex, -1);
  const effectiveSpanRow = pdfText.slice(effectiveSpanIndex, effectiveSpanIndex + 100);
  assert.ok(effectiveSpanRow.includes(`${result.effectiveShortSpan.toFixed(3)} / ${result.effectiveLongSpan.toFixed(3)} m`));
  assert.ok(effectiveSpanRow.includes('IS 456:2000 Clause 22.2'));
  assert.equal(/PASS\s*NOT ESTABLISHED m/.test(effectiveSpanRow), false);

  assert.ok(pdfText.includes(`Flexural / governing / provided Ast: ${result.AstFlexuralRequiredShort.toFixed(3)} / ${result.AstRequiredShort.toFixed(3)} / ${result.AstProvidedShort.toFixed(3)} mm2/m`));
  assert.ok(pdfText.includes(`Short Ast flexural / minimum / governing / provided: ${result.AstFlexuralRequiredShort} / ${result.AstMinimumShort} / ${result.AstRequiredShort} / ${result.AstProvidedShort}`));
  assert.equal(result.finalStatus, 'VERIFICATION REQUIRED');
  assert.equal(result.detailing.shortDirection.numberOfBars, NOT_ESTABLISHED);
});

test('NOT ESTABLISHED and NOT REQUIRED terminology is preserved end to end', async () => {
  const result = generateSlabDesign(slabInput);
  const report = slabReportData({ ...slabInput, result });

  if (result.permissibleLd === null) {
    assert.equal(result.modificationFactor, null);
    assert.equal(result.adoptedThicknessLabel, NOT_ESTABLISHED);
    assert.equal(result.deflectionStatus, 'VERIFICATION REQUIRED');
    assert.equal(report.deflection.permissibleLd, null);
    assert.equal(report.deflection.modificationFactor, null);
  }
  // A NOT REQUIRED corner must never surface as FAIL anywhere.
  assert.equal(result.checksByCategory.cornerTorsion.status, 'NOT REQUIRED');
  assert.equal(result.checksByCategory.cornerTorsion.status !== 'FAIL', true);
  assert.equal(result.checksByCategory.cornerTorsion.status !== NOT_PROVIDED, true);
});

test('invalid inputs are rejected rather than producing blank output', () => {
  for (const invalid of [
    { ...slabInput, slabLength: 0 },
    { ...slabInput, clearCover: 0 },
    { ...slabInput, wallThickness: 0 },
    { ...slabInput, cornerRestraint: 'SOMETHING_ELSE' }
  ]) {
    assert.throws(() => generateSlabDesign(invalid), /must be|required|positive/);
  }
});
