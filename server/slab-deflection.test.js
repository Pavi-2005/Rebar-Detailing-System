import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSlabDesign } from './src/services/slabCalculationService.js';
import { interpolateFig4ModificationFactor, validateFig4Dataset } from './src/services/fig4Dataset.js';
import { generatePdfReport, slabReportData } from './src/services/reportService.js';

const slabInput = {
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

const approx = (actual, expected, digits = 6) => {
  assert.equal(Number.isFinite(Number(actual)) && actual !== null && actual !== undefined, true, `expected a finite value, received ${actual}`);
  assert.ok(Math.abs(Number(actual) - expected) < 0.5 * 10 ** -digits, `${actual} != ${expected}`);
};

test('Fig. 4 dataset exposes validated ranges and ordered axes', () => {
  const dataset = validateFig4Dataset();

  assert.deepEqual(dataset.validPtRange, { min: 0.15, max: 2 });
  assert.deepEqual(dataset.validFsRange, { min: 100, max: 350 });
  assert.deepEqual(dataset.ptValues, [0.15, 0.25, 0.5, 0.75, 1, 1.5, 2]);
  assert.deepEqual(dataset.fsValues, [100, 150, 200, 250, 300, 350]);
});

test('Fig. 4 interpolation handles boundaries, corners, and interior values', () => {
  const lower = interpolateFig4ModificationFactor(0.15, 100);
  const upper = interpolateFig4ModificationFactor(2, 350);
  const corner = interpolateFig4ModificationFactor(0.5, 200);
  const interior = interpolateFig4ModificationFactor(0.2, 175);

  assert.equal(lower.status, 'PASS');
  assert.equal(lower.ptLower, 0.15);
  assert.equal(lower.ptUpper, 0.25);
  assert.equal(lower.fsLower, 100);
  assert.equal(lower.fsUpper, 150);
  assert.equal(lower.ptInterpolationRatio, 0);
  assert.equal(lower.fsInterpolationRatio, 0);
  assert.equal(lower.modificationFactor, 1.6);

  assert.equal(upper.status, 'PASS');
  assert.equal(upper.ptInterpolationRatio, 1);
  assert.equal(upper.fsInterpolationRatio, 1);
  assert.equal(upper.modificationFactor, 1.95);

  assert.equal(corner.status, 'PASS');
  assert.equal(corner.modificationFactor, 1.7);
  assert.equal(interior.status, 'PASS');
  assert.equal(interior.ptLower, 0.15);
  assert.equal(interior.ptUpper, 0.25);
  assert.equal(interior.fsLower, 150);
  assert.equal(interior.fsUpper, 200);
  assert.equal(interior.ptInterpolationRatio, 0.5);
  assert.equal(interior.fsInterpolationRatio, 0.5);
  assert.equal(interior.modificationFactor, 1.475);
  assert.deepEqual([
    interior.factorAtLowerPtLowerFs,
    interior.factorAtLowerPtUpperFs,
    interior.factorAtUpperPtLowerFs,
    interior.factorAtUpperPtUpperFs
  ], [1.45, 1.3, 1.65, 1.5]);
});

test('Fig. 4 interpolation rejects values outside pt or fs range without clamping', () => {
  const belowPt = interpolateFig4ModificationFactor(0.1499, 276.93);
  const abovePt = interpolateFig4ModificationFactor(2.01, 276.93);
  const belowFs = interpolateFig4ModificationFactor(0.5, 99.99);
  const aboveFs = interpolateFig4ModificationFactor(0.5, 350.01);

  for (const result of [belowPt, abovePt, belowFs, aboveFs]) {
    assert.equal(result.status, 'VERIFICATION REQUIRED');
    assert.equal(result.modificationFactor, null);
    assert.equal(result.clampingApplied, false);
    assert.equal(result.ptClamped, false);
    assert.equal(result.fsClamped, false);
  }
  assert.equal(belowPt.rangeViolation, 'pt');
  assert.equal(belowFs.rangeViolation, 'fs');
});

test('current slab input retains unresolved final thickness when pt is outside Fig. 4 range', async () => {
  const result = generateSlabDesign(slabInput);
  const report = slabReportData({ ...slabInput, result });
  const pdf = await generatePdfReport({ ...slabInput, result });
  const text = pdf.toString('latin1');

  assert.equal(result.initialThickness, 150);
  assert.equal(result.lastEvaluatedThickness, 300);
  assert.equal(result.adoptedThickness, null);
  assert.equal(result.designStatus, 'VERIFICATION REQUIRED');
  // pt is derived from the provided steel, so it is unchanged by the fs correction.
  assert.equal(result.deflectionPt, 0.146689);
  assert.equal(result.deflectionAstUsedForPt, 376.9911184307752);
  assert.equal(result.deflectionPtWidth, 1000);
  assert.equal(result.deflectionPtEffectiveDepth, 257);
  // fs must use the flexural steel required by the design moment, NOT the minimum.
  assert.equal(result.deflectionAstRequiredForFs, result.AstFlexuralRequiredLong);
  assert.equal(result.deflectionAstRequiredForFs, 58.15);
  assert.equal(result.deflectionFs, 44.73);
  approx(result.deflectionAstProvidedUsedForFs, result.AstProvidedLong, 2);
  assert.equal(result.deflectionPtTrace, 'Ast used for pt = 376.9911184307752 mm²/m; b = 1000 mm; d = 257 mm; pt = 100 × 376.9911184307752 / (1000 × 257) = 0.14668915114037945 %');
  assert.equal(result.deflectionFsTrace, 'fs = 0.58 × 500 × 58.15 / 376.9911184307752 = 44.73 N/mm² (unrounded 44.73182304716961)');
  assert.deepEqual(result.deflectionPtRange, { min: 0.15, max: 2 });
  assert.deepEqual(result.deflectionFsRange, { min: 100, max: 350 });
  assert.equal(result.deflectionStatus, 'VERIFICATION REQUIRED');
  assert.equal(result.modificationFactor, null);
  assert.equal(result.permissibleLd, null);
  assert.equal(result.deflectionMessage.includes('validated Fig. 4 dataset range'), false);
  assert.equal(result.deflectionMessage.includes('validated digitized Fig. 4 dataset range'), true);
  assert.equal(result.finalDesign.adoptedThickness, null);
  assert.equal(result.finalDesign.designStatus, 'VERIFICATION REQUIRED');
  assert.deepEqual(result.designIterations.map((iteration) => iteration.thickness), [150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300]);
  assert.equal(result.designIterations.every((iteration) => Number.isFinite(iteration.astUsedForPt)
    && Number.isFinite(iteration.pt)
    && Number.isFinite(iteration.fs)
    && Number.isFinite(iteration.actualLd)
    && (iteration.permissibleLd === null || Number.isFinite(iteration.permissibleLd))), true);
  assert.equal(result.designIterations.at(-1).pt, result.deflectionPt);
  assert.equal(result.designIterations.at(-1).fs, result.deflectionFs);
  assert.equal(report.deflection.modificationFactor, null);
  assert.equal(report.deflection.permissibleLd, null);
  assert.equal(report.deflection.status, 'VERIFICATION REQUIRED');
  assert.equal(report.deflection.message, result.deflectionMessage);
  assert.equal(report.deflection.astUsedForPt, result.deflectionAstUsedForPt);
  assert.equal(report.deflection.ptTrace, result.deflectionPtTrace);
  assert.equal(pdf.toString('latin1').slice(0, 4), '%PDF');
});

test('supported Fig. 4 candidate carries actual interpolation values independently', () => {
  const result = generateSlabDesign({ ...slabInput, slabThickness: 150, maxSlabThickness: 150 });
  const iteration = result.designIterations[0];

  assert.equal(iteration.thickness, 150);
  assert.equal(iteration.deflectionStatus, 'FAIL');
  assert.equal(iteration.modificationFactor, result.modificationFactor);
  assert.equal(iteration.permissibleLd, result.permissibleLd);
  assert.equal(Number.isFinite(result.modificationFactor), true);
  assert.equal(Number.isFinite(result.permissibleLd), true);
  assert.equal(result.finalDesign.deflection.modificationFactor, result.modificationFactor);
  assert.equal(result.finalDesign.deflection.ptLower, result.deflectionPtLower);
});
