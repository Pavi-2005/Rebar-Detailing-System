import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSlabDesign,
  getTwoWayCoefficients,
  resolveTwoWayCoefficientTable,
  normalizeCheckStatus
} from './src/services/slabCalculationService.js';
import { generatePdfReport, slabReportData } from './src/services/reportService.js';
import { slabDetailingPresentation } from '../client/src/utils/reinforcementDetailingPresentation.js';

// The reference input used for all regression checks.
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

const finite = (value) => Number.isFinite(Number(value)) && value !== null && value !== undefined;
const approx = (actual, expected, digits = 6) => {
  assert.equal(finite(actual), true, `expected a finite value, received ${actual}`);
  assert.ok(Math.abs(Number(actual) - expected) < 0.5 * 10 ** -digits, `${actual} != ${expected}`);
};

const NOT_ESTABLISHED = 'NOT ESTABLISHED';
const NOT_REQUIRED = 'NOT REQUIRED';
const VERIFICATION_REQUIRED = 'VERIFICATION REQUIRED';

test('slab detailing count stays unestablished and is carried authoritatively to UI and PDF', async () => {
  const result = generateSlabDesign(slabInput);
  const uiDetailing = slabDetailingPresentation(result.detailing);

  for (const [key, source, ui] of [
    ['shortDirection', result.shortDirectionReinforcement, uiDetailing.shortDirection],
    ['longDirection', result.longDirectionReinforcement, uiDetailing.longDirection]
  ]) {
    const detailing = result.detailing[key];
    assert.equal(detailing.barDiameter, source.diameter);
    assert.equal(detailing.spacing, source.spacing);
    assert.equal(detailing.astProvided, source.AstProvided);
    assert.equal(detailing.numberOfBars, NOT_ESTABLISHED);
    assert.equal(detailing.availablePlacementWidth, NOT_ESTABLISHED);
    assert.equal(detailing.barArrangement, NOT_ESTABLISHED);
    assert.equal(detailing.detailingStatus, NOT_ESTABLISHED);
    assert.equal(ui.numberOfBars, detailing.numberOfBars);
    assert.equal(ui.availablePlacementWidth, detailing.availablePlacementWidth);
    assert.equal(ui.barArrangement, detailing.barArrangement);
    assert.equal(ui.detailingStatus, detailing.detailingStatus);
  }

  const pdf = await generatePdfReport({ ...slabInput, result });
  const text = extractPdfText(pdf);
  assert.equal((text.match(/Number of bars: NOT ESTABLISHED/g) || []).length, 2);
  assert.match(text, /REINFORCEMENT DESIGN SUMMARY[\s\S]*?12 mm @ \d+ mm c\/c/);
});

// PDFKit writes text as hex-encoded glyph runs; decode them to read the report.
function extractPdfText(buffer) {
  const raw = buffer.toString('latin1');
  const chunks = [];
  const runPattern = /<([0-9a-fA-F]+)>\s*(?:TJ|Tj)|\[((?:\s*<[0-9a-fA-F]+>\s*(?:-?\d+\s*)?)+)\]\s*TJ|\(((?:\\.|[^()\\])*)\)\s*Tj/g;
  let match;
  while ((match = runPattern.exec(raw)) !== null) {
    if (match[1]) chunks.push(Buffer.from(match[1], 'hex').toString('latin1'));
    else if (match[2]) {
      const inner = match[2].match(/<[0-9a-fA-F]+>/g) || [];
      chunks.push(inner.map((hex) => Buffer.from(hex.replace(/[<>]/g, ''), 'hex').toString('latin1')).join(''));
    } else if (match[3] !== undefined) chunks.push(match[3]);
  }
  return chunks.join('');
}

// --- 1-4: geometry -------------------------------------------------------

test('1-4: 5m x 3m geometry, clear spans, effective spans and aspect ratio', () => {
  const result = generateSlabDesign(slabInput);
  const support = slabInput.wallThickness / 1000;

  assert.equal(result.totalShortSpan, 3);
  assert.equal(result.totalLongSpan, 5);
  assert.equal(result.shortSpan, 3);
  assert.equal(result.longSpan, 5);
  assert.equal(result.clearShortSpan, 3 - support);
  assert.equal(result.clearLongSpan, 5 - support);
  assert.equal(result.effectiveShortSpan, 3);
  assert.equal(result.effectiveLongSpan, 5);
  approx(result.aspectRatio, 5 / 3, 3);
  assert.equal(result.aspectRatio, 1.667);
});

// --- 5: support-condition to coefficient-table mapping --------------------

test('5: FREE_TO_LIFT + Simply Supported selects the IS 456 Table 27 coefficients', () => {
  const table27 = resolveTwoWayCoefficientTable('Simply Supported', 'FREE_TO_LIFT');
  const table26 = resolveTwoWayCoefficientTable('Simply Supported', 'RESTRAINED');

  assert.equal(table27.tableId, 'IS_456_TABLE_27');
  assert.equal(table27.tableReference, 'IS 456:2000 Table 27');
  assert.equal(table26.tableId, 'IS_456_TABLE_26');
  assert.equal(table26.tableReference, 'IS 456:2000 Table 26');

  const result = generateSlabDesign(slabInput);
  assert.equal(result.coefficientTableId, 'IS_456_TABLE_27');
  assert.equal(JSON.stringify(result).includes('Table 26 coefficients apply'), false);
  assert.match(result.coefficientSelectionReason, /Table 27/);
  assert.match(result.coefficientTableRuledOut, /Table 26 is not used/);
});


// --- 6-8: Table 27 interpolation -----------------------------------------

test('6-8: Table 27 interpolation brackets ly/lx = 1.667 between the published 1.5 and 1.75 rows', () => {
  const table = resolveTwoWayCoefficientTable('Simply Supported', 'FREE_TO_LIFT');
  const publishedRows = table.points.map((point) => point.m);

  // Table 27 ends in a published infinity column, not a fabricated finite 3.0 row.
  assert.deepEqual(publishedRows, [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2, 2.5, 'Infinity']);
  // The previous dataset fabricated 1.6 and 1.7 rows that are not in the published table.
  assert.equal(publishedRows.includes(1.6), false);
  assert.equal(publishedRows.includes(1.7), false);

  const atTabulated = getTwoWayCoefficients(1.5, table);
  assert.equal(atTabulated.coefficientShort, 0.104);
  assert.equal(atTabulated.coefficientLong, 0.046);
  assert.equal(atTabulated.lowerM, 1.5);
  assert.equal(atTabulated.upperM, 1.5);

  const atUpperTabulated = getTwoWayCoefficients(1.75, table);
  assert.equal(atUpperTabulated.coefficientShort, 0.113);
  assert.equal(atUpperTabulated.coefficientLong, 0.037);
  assert.equal(atUpperTabulated.lowerM, 1.75);
  assert.equal(atUpperTabulated.upperM, 1.75);

  const atReference = getTwoWayCoefficients(1.667, table);
  assert.equal(atReference.lowerM, 1.5);
  assert.equal(atReference.upperM, 1.75);
  assert.match(atReference.source, /Interpolated between published Table 27 rows m = 1\.5 and m = 1\.75/);
  approx(atReference.coefficientShort, 0.110, 3);
  approx(atReference.coefficientLong, 0.040, 3);

  const atTwo = getTwoWayCoefficients(2.0, table);
  assert.equal(atTwo.coefficientShort, 0.118);
  assert.equal(atTwo.coefficientLong, 0.029);
  const atTwoPointTwo = getTwoWayCoefficients(2.2, table);
  assert.equal(atTwoPointTwo.lowerM, 2);
  assert.equal(atTwoPointTwo.upperM, 2.5);
  assert.match(atTwoPointTwo.source, /Interpolated between published Table 27 rows m = 2 and m = 2\.5/);
  approx(atTwoPointTwo.coefficientShort, 0.1196, 4);
  approx(atTwoPointTwo.coefficientLong, 0.0254, 4);

  const atTwoPointFive = getTwoWayCoefficients(2.5, table);
  assert.equal(atTwoPointFive.coefficientShort, 0.122);
  assert.equal(atTwoPointFive.coefficientLong, 0.020);
  assert.equal(atTwoPointFive.lowerM, 2.5);
  assert.equal(atTwoPointFive.upperM, 2.5);
  assert.match(atTwoPointFive.source, /exact published Table 27 row m = 2\.5/);

  const atInfinity = getTwoWayCoefficients(Infinity, table);
  assert.equal(atInfinity.coefficientShort, 0.124);
  assert.equal(atInfinity.coefficientLong, 0.014);
  assert.match(atInfinity.source, /exact published infinity column/);

  for (const finiteRatio of [2.6, 3.0]) {
    assert.throws(
      () => getTwoWayCoefficients(finiteRatio, table),
      /Coefficient not established: finite aspect ratio exceeds the largest finite published Table 27 row \(m = 2\.5\); infinity column is not treated as a finite interpolation endpoint\./
    );
  }

  const result = generateSlabDesign(slabInput);
  assert.equal(result.coefficientInterpolationLowerM, 1.5);
  assert.equal(result.coefficientInterpolationUpperM, 1.75);
  approx(result.alphaX, 0.110, 3);
  approx(result.alphaY, 0.040, 3);
  approx(result.MuShort, 17.820, 3);
  approx(result.MuLong, 6.480, 3);
});

// --- 9-10: moments generated from the coefficient chain -------------------

test('9-10: Mx and My are generated from ratio -> coefficient -> moment equation', () => {
  const result = generateSlabDesign(slabInput);

  // wu = 1.5 x (7.5 + 1.5 + 3) = 18 kN/m2, lx = 3 m
  approx(result.ultimateLoad, 18, 4);
  approx(result.MuShort, result.alphaX * result.ultimateLoad * result.effectiveShortSpan ** 2, 3);
  approx(result.MuLong, result.alphaY * result.ultimateLoad * result.effectiveShortSpan ** 2, 3);
  approx(result.MuShort, 17.82, 2);
  approx(result.MuLong, 6.48, 2);
});

// --- 11-13: separate flexural / minimum / provided steel ------------------

test('11-13: flexural, minimum, governing and provided steel remain separate values', () => {
  const result = generateSlabDesign(slabInput);

  // Minimum steel for Fe500: 0.12% x 1000 x 300.
  approx(result.AstMinimumShort, 0.0012 * 1000 * result.slabThickness, 2);
  approx(result.AstMinimumLong, 0.0012 * 1000 * result.slabThickness, 2);
  assert.equal(result.AstMinimumShort, 360);
  assert.equal(result.AstMinimumLong, 360);

  // Flexural requirement is far below the minimum for this slab.
  approx(result.AstFlexuralRequiredShort, 153.56, 1);
  approx(result.AstFlexuralRequiredLong, 58.15, 1);
  assert.ok(result.AstFlexuralRequiredShort < result.AstMinimumShort);
  assert.ok(result.AstFlexuralRequiredLong < result.AstMinimumLong);

  // Governing requirement is the maximum, so the minimum governs in both directions.
  assert.equal(result.AstRequiredShort, 360);
  assert.equal(result.AstRequiredLong, 360);

  // 12 mm @ 300 mm c/c provides 376.99 mm2/m.
  approx(result.AstProvidedShort, ((Math.PI / 4) * 12 ** 2 * 1000) / 300, 2);
  approx(result.AstProvidedLong, ((Math.PI / 4) * 12 ** 2 * 1000) / 300, 2);
  approx(result.AstProvidedShort, 376.99, 2);
  assert.equal(result.shortDirectionReinforcement.label, '12 mm @ 300 mm c/c');
  assert.equal(result.longDirectionReinforcement.label, '12 mm @ 300 mm c/c');
});

// --- 14-15: effective depths --------------------------------------------

test('14-15: effective depths are 269 mm short and 257 mm long with a stated layer assumption', () => {
  const result = generateSlabDesign(slabInput);
  const { slabThickness, clearCover } = result;
  const shortBar = result.shortDirectionReinforcement.diameter;
  const longBar = result.longDirectionReinforcement.diameter;

  approx(result.effectiveDepthShort, slabThickness - clearCover - shortBar / 2, 2);
  approx(result.effectiveDepthLong, slabThickness - clearCover - shortBar - longBar / 2, 2);
  assert.equal(result.effectiveDepthShort, 269);
  assert.equal(result.effectiveDepthLong, 257);
  // The layer assumption must be stated, not silently applied.
  assert.match(result.effectiveDepthLayerAssumption, /above the short-direction layer/);
  assert.match(result.effectiveDepthShortBasis, /D - clear cover/);
  assert.match(result.effectiveDepthLongBasis, /above the short-direction layer/);
});

// --- 16-17: corner torsion ----------------------------------------------

test('16-17: corner torsion is NOT REQUIRED and the check is never reported as PASS', () => {
  const result = generateSlabDesign(slabInput);
  const check = result.checks.find((entry) => entry.id === 'cornerTorsion');

  assert.equal(result.cornerRestraint, 'FREE_TO_LIFT');
  assert.equal(result.cornerTorsionStatus, NOT_REQUIRED);
  assert.equal(result.checksByCategory.cornerTorsion.status, NOT_REQUIRED);
  assert.equal(check.status, NOT_REQUIRED);
  assert.notEqual(check.status, 'PASS');
  assert.notEqual(check.status, 'FAIL');
  // A NOT REQUIRED check must never contribute to a failure.
  const failed = result.checks.filter((entry) => entry.status === 'FAIL');
  assert.equal(failed.some((entry) => entry.id === 'cornerTorsion'), false);
});

// --- 18: deflection safety ----------------------------------------------

test('18: deflection stays VERIFICATION REQUIRED when pt is outside the validated Fig. 4 range', () => {
  const result = generateSlabDesign(slabInput);

  // pt is computed from the PROVIDED steel, so it is unchanged by the fs correction.
  approx(result.deflectionPt, (100 * result.AstProvidedLong) / (1000 * result.effectiveDepthLong), 6);
  assert.ok(result.deflectionPt < 0.15, 'pt must remain below the validated Fig. 4 lower bound');
  assert.equal(result.deflectionStatus, VERIFICATION_REQUIRED);
  assert.equal(result.modificationFactor, null);
  assert.equal(result.permissibleLd, null);
  // The slab is NOT proven to fail deflection; it is unresolved.
  assert.notEqual(result.deflectionStatus, 'FAIL');
  assert.match(result.deflectionMessage, /has NOT been proven to fail deflection/);
  assert.match(result.deflectionMessage, /validated digitized Fig\. 4 dataset range/);
  assert.equal(result.deflectionClampingApplied, false);
  assert.equal(result.deflectionPtClamped, false);
  assert.equal(result.deflectionFsClamped, false);
  // The out-of-range inputs must be named explicitly.
  assert.ok(result.deflectionOutOfRangeInputs.some((entry) => /pt = 0\.1467% is below/.test(entry)));
});

// The Fig. 4 service stress must use the flexural steel, not the minimum.
test('the Fig. 4 service stress uses the flexural steel, never the Clause 26.5.2.1 minimum', () => {
  const result = generateSlabDesign(slabInput);

  // fs = 0.58 x fy x Ast flexural required / Ast provided (long direction governs).
  approx(result.deflectionAstRequiredForFs, result.AstFlexuralRequiredLong, 2);
  approx(result.deflectionAstFlexuralRequiredUsedForFs, result.AstFlexuralRequiredLong, 2);
  approx(result.deflectionAstProvidedUsedForFs, result.AstProvidedLong, 2);
  assert.notEqual(
    result.deflectionAstRequiredForFs,
    result.AstMinimumLong,
    'fs must not reuse the minimum steel field'
  );
  approx(
    result.deflectionFs,
    0.58 * result.fy * result.AstFlexuralRequiredLong / result.AstProvidedLong,
    2
  );
  assert.match(result.deflectionAstUsedForFsBasis, /not the Clause 26\.5\.2\.1 minimum reinforcement/);
});

// --- 19-20: thickness iteration metadata --------------------------------

test('19-20: the thickness search evaluates 16 thicknesses and adopts none when nothing passes', () => {
  const result = generateSlabDesign(slabInput);

  assert.equal(result.initialThickness, 150);
  assert.equal(result.thicknessIteration.maximumThickness, 300);
  assert.equal(result.thicknessIteration.step, 10);
  // 150..300 in 10 mm steps is 16 evaluated thicknesses and 15 increments.
  assert.equal(result.evaluatedThicknessCount, 16);
  assert.equal(result.incrementCount, 15);
  assert.equal(result.thicknessIteration.evaluatedThicknessCount, 16);
  assert.equal(result.thicknessIteration.incrementCount, 15);
  assert.equal(result.lastEvaluatedThickness, 300);
  assert.equal(result.designIterations.length, 16);
  assert.deepEqual(
    result.thicknessIteration.evaluatedThicknesses,
    [150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300]
  );

  // The trace must not describe this as "0 iterations".
  const iterationStep = result.calculationSteps.find((entry) => entry.title === 'Thickness iteration');
  assert.match(iterationStep.substitution, /16 thicknesses evaluated \(15 increments\)/);
  assert.equal(/0 iterations/.test(iterationStep.substitution), false);

  // No thickness satisfied every check, so none is adopted.
  assert.equal(result.adoptionCount, 0);
  assert.equal(result.adoptedThickness, null);
  assert.equal(result.adoptedThicknessLabel, NOT_ESTABLISHED);
  // The last evaluated thickness is never reported as the adopted thickness.
  assert.notEqual(result.adoptedThickness, result.lastEvaluatedThickness);
});

// --- 21-22: PDF and trace consume the same authoritative values ----------

test('21-22: the PDF and the trace render the same authoritative values as the result', async () => {
  const result = generateSlabDesign(slabInput);
  const report = slabReportData({ ...slabInput, result });
  const pdf = await generatePdfReport({ ...slabInput, result });
  const text = extractPdfText(pdf);

  // The PDF must use the corrected values, not the old Table 26 / collapsed-Ast ones.
  assert.ok(text.includes('IS 456:2000 Table 27'), 'PDF must name the selected coefficient table');
  assert.ok(text.includes(`Short span Lx: ${result.shortSpan} m`), 'PDF must carry the short span');
  assert.ok(text.includes(`Long span Ly: ${result.longSpan} m`), 'PDF must carry the long span');
  assert.ok(text.includes(`[CALCULATED] Mu-x (short direction): ${result.MuShort} kN·m/m`), 'PDF must carry Mx');
  assert.ok(text.includes(`[CALCULATED] Mu-y (long direction): ${result.MuLong} kN·m/m`), 'PDF must carry My');
  assert.ok(text.includes(`[CALCULATED] Short Ast flexural / minimum / governing / provided: ${result.AstFlexuralRequiredShort} / ${result.AstMinimumShort} / ${result.AstRequiredShort} / ${result.AstProvidedShort} mm²/m`), 'PDF must distinguish flexural, minimum, governing and provided steel');
  assert.ok(text.includes(`[CALCULATED] Long Ast flexural / minimum / governing / provided: ${result.AstFlexuralRequiredLong} / ${result.AstMinimumLong} / ${result.AstRequiredLong} / ${result.AstProvidedLong} mm²/m`), 'PDF must report each long-direction Ast basis separately');
  assert.ok(text.includes(`[CHECK] Final design status: ${result.finalStatus}`), 'PDF must carry the final status');
  assert.ok(text.includes('Thicknesses evaluated: 16'), 'PDF must report the real evaluation count');
  assert.ok(text.includes('SLAB DESIGN ITERATIONS'), 'PDF must include the structured iteration schedule');
  assert.equal(text.includes('Thickness | d short | d long'), false, 'PDF must not regress to pipe-separated iteration rows');
  assert.ok(text.includes('Adopted slab thickness: NOT ADOPTED'), 'PDF must distinguish a non-adopted thickness from an unknown value');
  assert.ok(text.includes('Modification factor: MANUAL VERIFICATION REQUIRED'), 'PDF must preserve the Fig. 4 verification without repeated placeholders');
  assert.ok(text.includes('Short direction / Lx = 3 m:'), 'PDF schematic must label the authoritative short axis');
  assert.ok(text.includes('Long direction / Ly = 5 m:'), 'PDF schematic must label the authoritative long axis');
  // The em dash is re-encoded by the PDF font, so match the ASCII portion only.
  assert.ok(/SCHEMATIC\s*.{0,3}\s*NOT TO SCALE/.test(text), 'PDF must carry the schematic disclosure');
  assert.equal(/\bundefined\b|\bNaN\b/.test(text), false, 'PDF leaked an invalid token');
  // The old "N of M checks passed" wording counted NOT REQUIRED as PASS.
  assert.equal(/of \d+ checks passed/.test(text), false, 'PDF must not report NOT REQUIRED as PASS');

  // The trace is generated from the same result object.
  assert.equal(report.calculationSteps.length, result.calculationSteps.length);
  assert.equal(report.checks.length, result.checks.length);
  const momentStep = result.calculationSteps.find((entry) => entry.title === 'Short-direction moment');
  approx(Number(momentStep.result), result.MuShort, 3);
  const providedStep = result.calculationSteps.find((entry) => entry.title === 'Provided Ast - short direction');
  approx(Number(providedStep.result), result.AstProvidedShort, 2);
});

// --- 23: no duplicated UI-side calculation ------------------------------

test('23: the calculation trace steps carry only authoritative, finite engineering values', () => {
  const result = generateSlabDesign(slabInput);
  const steps = result.calculationSteps;

  assert.ok(steps.length >= 30, 'the trace must remain complete');
  steps.forEach((entry, index) => {
    assert.equal(entry.step, index + 1, `step ${index + 1} must be numbered in order`);
    assert.ok(entry.title.length > 0);
    assert.ok(entry.formula.length > 0);
    assert.ok(entry.substitution.length > 0);
    assert.equal(entry.result === undefined || entry.result === null, false, `step ${entry.step} has no result`);
    assert.ok(entry.group && entry.groupLabel, `step ${entry.step} is not grouped for presentation`);
  });

  // Every numeric result the trace reports must match the authoritative result object.
  const flexuralShort = steps.find((entry) => entry.title === 'Flexural Ast - short direction');
  const minimumShort = steps.find((entry) => entry.title === 'Minimum Ast - short direction');
  const governingShort = steps.find((entry) => entry.title === 'Governing required Ast - short direction');
  approx(Number(flexuralShort.result), result.AstFlexuralRequiredShort, 2);
  approx(Number(minimumShort.result), result.AstMinimumShort, 2);
  approx(Number(governingShort.result), result.AstRequiredShort, 2);
});

// --- 24: one-way classification ----------------------------------------

test('24: classification follows the Table 27 and Table 26 design paths', () => {
  // Case A: Table 27 designs ly/lx = 2.0033 by interpolation from 2.0 to 2.5.
  const table27Interpolated = generateSlabDesign({ ...slabInput, length: 6.01, width: 3 });
  assert.equal(table27Interpolated.slabType, 'Two Way Slab');
  assert.equal(table27Interpolated.coefficientTableId, 'IS_456_TABLE_27');
  assert.equal(table27Interpolated.coefficientInterpolationLowerM, 2);
  assert.equal(table27Interpolated.coefficientInterpolationUpperM, 2.5);

  // Finite ratios above 2.5 must not be mistaken for the published infinity column.
  for (const length of [7.8, 9, 9.01]) {
    const unsupported = generateSlabDesign({ ...slabInput, length, width: 3 });
    assert.equal(unsupported.finalStatus, 'VERIFICATION REQUIRED');
    assert.equal(unsupported.coefficientStatus, 'VERIFICATION REQUIRED');
    assert.equal(unsupported.alphaX, null);
    assert.equal(unsupported.alphaY, null);
    assert.equal(unsupported.MuShort, null);
    assert.equal(unsupported.MuLong, null);
    assert.match(unsupported.coefficientNotEstablishedReason, /finite aspect ratio exceeds the largest finite published Table 27 row \(m = 2\.5\)/);
    assert.match(unsupported.coefficientNotEstablishedReason, /infinity column is not treated as a finite interpolation endpoint/);
  }

  // Case D: the restrained/Table 26 path remains one-way above 2.0.
  assert.throws(() => generateSlabDesign({ ...slabInput, cornerRestraint: 'RESTRAINED', length: 6.01, width: 3 }), /ONE-WAY SLAB DESIGN NOT IMPLEMENTED/);
});

test('24b: ly/lx exactly 2.0 is TWO-WAY per Annex D-1.11 and must not be rejected', () => {
  // The criterion is strictly greater than 2.0, so a ratio of exactly 2 is two-way.
  const exact = generateSlabDesign({ ...slabInput, length: 6, width: 3 });
  assert.equal(exact.aspectRatio, 2);
  assert.equal(exact.slabType, 'Two Way Slab');
  assert.equal(exact.coefficientTableId, 'IS_456_TABLE_27');
  // At exactly 2.0 the coefficient must be the published Table 27 row, not an interpolation.
  assert.equal(exact.coefficientInterpolationLowerM, 2);
  assert.equal(exact.coefficientInterpolationUpperM, 2);
  assert.equal(exact.alphaX, 0.118);
  assert.equal(exact.alphaY, 0.029);
  assert.equal(exact.checksByCategory.classification.status, 'PASS');

  // Finite Table 27 interpolation remains available above 2.0 through 2.5.
  assert.equal(generateSlabDesign({ ...slabInput, length: 5.9, width: 3 }).slabType, 'Two Way Slab');
  assert.equal(generateSlabDesign({ ...slabInput, length: 6.01, width: 3 }).slabType, 'Two Way Slab');
});

test('Table 27 exact rows and finite interpolation stop before the infinity column', () => {
  const table = resolveTwoWayCoefficientTable('Simply Supported', 'FREE_TO_LIFT');
  for (const [ratio, alphaX, alphaY] of [
    [1, 0.062, 0.062],
    [1.1, 0.074, 0.061],
    [1.2, 0.084, 0.059],
    [1.3, 0.093, 0.055],
    [1.4, 0.099, 0.051],
    [1.5, 0.104, 0.046],
    [1.75, 0.113, 0.037],
    [2, 0.118, 0.029],
    [2.5, 0.122, 0.020]
  ]) {
    const exact = getTwoWayCoefficients(ratio, table);
    assert.equal(exact.coefficientShort, alphaX, `alphaX at ${ratio}`);
    assert.equal(exact.coefficientLong, alphaY, `alphaY at ${ratio}`);
    assert.equal(exact.lowerM, ratio);
    assert.equal(exact.upperM, ratio);
    assert.match(exact.source, /exact published Table 27 row/);
  }
  assert.equal(getTwoWayCoefficients(Infinity, table).coefficientShort, 0.124);
  assert.equal(getTwoWayCoefficients(Infinity, table).coefficientLong, 0.014);
  for (const ratio of [2.6, 3.0]) {
    assert.throws(() => getTwoWayCoefficients(ratio, table), /Coefficient not established/);
  }
});

test('unsupported finite Table 27 ratio appears as verification required in the PDF without coefficients', async () => {
  const result = generateSlabDesign({ ...slabInput, length: 9, width: 3 });
  const pdf = await generatePdfReport({ ...slabInput, result });
  const text = extractPdfText(pdf);
  assert.match(text, /VERIFICATION REQUIRED/);
  assert.match(text, /Coefficient not established/);
  assert.match(text, /finite aspect ratio exceeds the largest finite published Table 27 row/);
  assert.match(text, /infinity column is not treated as a finite interpolation endpoint/);
  assert.match(text, /Alpha x: NOT ESTABLISHED/);
  assert.match(text, /Alpha y: NOT ESTABLISHED/);
  assert.doesNotMatch(text, /alpha x \/ y = 0\.124 \/ 0\.014/);
});

// --- 25: cover is not falsely code-verified ----------------------------

test('25: cover is never reported as code-verified without exposure and fire inputs', () => {
  const result = generateSlabDesign(slabInput);
  const coverCheck = result.checks.find((entry) => entry.id === 'cover');

  assert.equal(coverCheck.status, VERIFICATION_REQUIRED);
  assert.notEqual(coverCheck.status, 'PASS');
  assert.equal(coverCheck.verificationRequired, true);
  // The cover must not be "verified" by comparing it with the slab thickness.
  assert.notEqual(coverCheck.limitValue, result.slabThickness);
  assert.match(coverCheck.reason, /exposure condition, the required fire resistance/);

  assert.equal(result.coverVerification.status, VERIFICATION_REQUIRED);
  assert.equal(result.coverVerification.established, false);
  assert.equal(result.coverVerification.label, NOT_ESTABLISHED);
  assert.equal(result.coverVerification.providedClearCover, 25);
  assert.match(result.coverVerification.reason, /exposure condition, the required fire resistance/);
  // The geometric cover-vs-bar check is separate and passes for the reference case.
  assert.equal(result.checksByCategory.coverGeometric.status, 'PASS');
  assert.match(result.designOutput.coverVerificationStatus, /VERIFICATION REQUIRED/);
});

// --- status vocabulary -------------------------------------------------

test('every engineering check uses the canonical status vocabulary and a full field set', () => {
  const result = generateSlabDesign(slabInput);
  const allowed = new Set(['PASS', 'FAIL', 'VERIFICATION REQUIRED', 'NOT REQUIRED']);

  result.checks.forEach((check) => {
    assert.equal(allowed.has(check.status), true, `unexpected status ${check.status}`);
    assert.equal(check.statusCode, check.status.replaceAll(' ', '_'));
    assert.ok(check.id, 'every check needs a stable id');
    assert.ok(check.title, 'every check needs a title');
    assert.ok(check.reason, 'every check needs a reason');
    assert.ok(check.codeReference, 'every check needs a code reference');
    assert.equal('actualValue' in check, true);
    assert.equal('limitValue' in check, true);
    assert.equal(typeof check.unit, 'string');
    assert.equal(typeof check.verificationRequired, 'boolean');
  });

  assert.equal(normalizeCheckStatus('PASS'), 'PASS');
  assert.equal(normalizeCheckStatus('NOT REQUIRED'), 'NOT REQUIRED');
  assert.equal(normalizeCheckStatus('Pass'), 'FAIL');
  assert.equal(normalizeCheckStatus('Not required'), 'FAIL');

  // A restrained corner is unresolved, never auto-passed.
  const restrained = generateSlabDesign({ ...slabInput, cornerRestraint: 'RESTRAINED' });
  const corner = restrained.checks.find((entry) => entry.id === 'cornerTorsion');
  assert.equal(corner.status, 'VERIFICATION REQUIRED');
  assert.notEqual(corner.status, 'PASS');

// --- Annex D-2.1.1 bar extension / curtailment ----------------------------

test('Annex D-2.1.1 bar extension reports 50% continuation and the 0.1l curtailment allowance', () => {
  const result = generateSlabDesign(slabInput);

  assert.equal(result.barExtension.reference, 'IS 456:2000 Annex D-2.1.1');
  assert.equal(result.barExtension.short.minimumPercentCarriedToSupport, 50);
  assert.equal(result.barExtension.long.minimumPercentCarriedToSupport, 50);
  assert.match(result.barExtension.requirement, /50% of the tension reinforcement provided at midspan must be extended to the supports/);
  assert.match(result.barExtension.requirement, /curtailed to within 0\.1 lx/);

  // 0.1 lx = 0.300 m and 0.1 ly = 0.500 m for the reference panel.
  assert.equal(result.barExtension.short.terminationAllowanceM, 0.3);
  assert.equal(result.barExtension.long.terminationAllowanceM, 0.5);

  // The engine does not issue a bar schedule, so the actual curtailed bar count cannot be
  // confirmed and the item must be VERIFICATION REQUIRED, never claimed as satisfied.
  const check = result.checks.find((entry) => entry.id === 'barExtension');
  assert.equal(check.status, 'VERIFICATION REQUIRED');
  assert.notEqual(check.status, 'PASS');
  assert.equal(result.checksByCategory.barExtension.status, 'VERIFICATION REQUIRED');
});

// --- corner torsion basis: Annex D-2.1, not 26.5.2.1 ---------------------

test('corner torsion NOT REQUIRED cites Annex D-2.1 and does not credit Clause 26.5.2.1', () => {
  const result = generateSlabDesign(slabInput);
  const check = result.checks.find((entry) => entry.id === 'cornerTorsion');

  assert.equal(result.cornerTorsionStatus, NOT_REQUIRED);
  assert.equal(result.cornerTorsionBasis, 'IS 456:2000 Annex D-2.1');
  assert.equal(check.codeReference, 'IS 456:2000 Annex D-2.1');
  assert.match(check.reason, /Annex D-2\.1/);
  // Clause 26.5.2.1 REQUIRES corner torsion steel; it must not be cited as the reason
  // that corner torsion is NOT REQUIRED.
  assert.equal(/Clause 26\.5\.2\.1 corner torsion steel is not required/.test(check.reason), false);
  assert.equal(result.cornerTorsionReason.includes('Clause 26.5.2.1 is not used as the basis for the corner-torsion determination'), true);

  // A RESTRAINED corner remains unresolved under the applicable Annex D provisions.

// --- effective span: explicit Clause 22.2 min() comparison ---------------

test('effective span exposes the Clause 22.2 min(clear + d, centre-to-centre) comparison', () => {
  const result = generateSlabDesign(slabInput);

  assert.equal(result.effectiveShortSpan, 3);
  assert.equal(result.effectiveLongSpan, 5);
  assert.match(result.effectiveSpanMethod, /Leff = min\(clear span \+ effective depth, centre-to-centre support span\)/);
  assert.match(result.effectiveSpanMethod, /Length\/Width are the centre-to-centre support spans/);

  const step = result.calculationSteps.find((entry) => entry.title === 'Effective span');
  assert.match(step.formula, /Leff = min\(clear span \+ d, centre-to-centre support span\)/);
  assert.match(step.substitution, /Leff = min\(3\.119, 3\) = 3 m/);
  assert.match(step.substitution, /Leff = min\(5\.107, 5\) = 5 m/);
});

// --- shear basis: conservative one-metre strip, short direction ----------

test('shear is a conservative one-metre-strip check on the short direction', () => {
  const result = generateSlabDesign(slabInput);

  // The reference value must be preserved: 20.808 kN/m.
  assert.equal(result.Vu, 20.808);
  assert.equal(result.shearBasis.analysisWidth, 'One-metre strip (b = 1000 mm)');
  assert.equal(result.shearBasis.conservative, true);
  assert.match(result.shearBasis.conservatismNote, /no two-way tributary-width \(load-sharing\) reduction/);
  assert.match(result.shearBasis.conservatismNote, /upper bound/);
  assert.equal(result.shearBasis.governingDirection, 'Short direction (short span lx)');
  // A long-direction check is not performed and must be declared, not implied.
  assert.match(result.shearBasis.longDirectionCheck, /Not performed/);
  assert.equal(result.shearBasis.shearReinforcementDesigned, false);
  assert.match(result.shearBasis.criticalSectionBasis, /FACE of the support/);
  assert.equal(result.checksByCategory.shear.status, 'PASS');
});

// --- cover: geometric PASS, durability NOT ESTABLISHED ------------------

test('cover reports a geometric check and a separate durability verification', () => {
  const result = generateSlabDesign(slabInput);

  // Reference case: cover 25 mm vs 12 mm bar -> geometric PASS.
  assert.equal(result.checksByCategory.coverGeometric.status, 'PASS');
  assert.equal(result.checksByCategory.coverGeometric.actualValue, 25);
  assert.equal(result.checksByCategory.coverGeometric.limitValue, 12);

  // Durability / fire basis is NOT ESTABLISHED without exposure inputs.
  assert.equal(result.checksByCategory.cover.status, 'VERIFICATION REQUIRED');
  assert.equal(result.coverVerification.status, 'VERIFICATION REQUIRED');
  assert.equal(result.coverVerification.established, false);
  // The cover is never compared against the slab thickness.
  assert.notEqual(result.checksByCategory.cover.limitValue, result.slabThickness);
  assert.match(result.coverVerification.reason, /NOT ESTABLISHED/);
  assert.match(result.coverVerification.reason, /exposure condition, the required fire resistance/);
  assert.match(result.coverVerification.reason, /not compared with the slab thickness/);

  // A cover smaller than the bar diameter must FAIL the geometric check.
  const tight = generateSlabDesign({ ...slabInput, clearCover: 11, preferredBarDiameter: 20 });
  assert.equal(tight.checksByCategory.coverGeometric.status, 'FAIL');
});

// --- scenario matrix ---------------------------------------------------

test('scenario matrix: geometry, corner, thickness, bar, concrete and steel variations', () => {
  const design = (overrides) => generateSlabDesign({ ...slabInput, ...overrides });

  // 1-4: reference, square, ratio 1.5, ratio 1.9 all design as two-way on Table 27.
  const twoWay = [
    ['reference 5x3', {}, 1.667],
    ['square 3x3', { length: 3, width: 3 }, 1],
    ['ratio 1.5', { length: 4.5, width: 3 }, 1.5],
    ['ratio 1.9', { length: 5.7, width: 3 }, 1.9]
  ];
  for (const [label, overrides, expectedRatio] of twoWay) {
    const result = design(overrides);
    assert.equal(result.slabType, 'Two Way Slab', label);
    assert.equal(result.aspectRatio, expectedRatio, label);
    assert.equal(result.coefficientTableId, 'IS_456_TABLE_27', label);
  }

  // 8-9: corner restraint selects the coefficient table.
  assert.equal(design({ cornerRestraint: 'FREE_TO_LIFT' }).coefficientTableId, 'IS_456_TABLE_27');
  assert.equal(design({ cornerRestraint: 'RESTRAINED' }).coefficientTableId, 'IS_456_TABLE_26');

  // 10-11: thickness variations design without error. The evaluation count depends on
  // the search range, so a larger initial thickness evaluates fewer steps.
  for (const thickness of [200, 250]) {
    const result = design({ slabThickness: thickness });
    assert.ok(result.effectiveDepthShort > 0, `D=${thickness}`);
    assert.ok(result.AstProvidedShort > 0, `D=${thickness}`);
    const expectedEvaluations = Math.floor((300 - thickness) / 10) + 1;
    assert.equal(result.evaluatedThicknessCount, expectedEvaluations, `D=${thickness}`);
    assert.equal(result.incrementCount, expectedEvaluations - 1, `D=${thickness}`);
  }

  // 12-13: bar diameter variations change the selected arrangement.
  const bar8 = design({ preferredBarDiameter: 8 });
  const bar16 = design({ preferredBarDiameter: 16 });
  assert.ok(bar8.shortDirectionReinforcement.diameter > 0);
  assert.ok(bar16.shortDirectionReinforcement.diameter > 0);
  // The effective depth always follows the adopted bar size.
  for (const result of [bar8, bar16]) {
    approx(
      result.effectiveDepthShort,
      result.slabThickness - result.clearCover - result.shortDirectionReinforcement.diameter / 2,
      2
    );
  }

  // 14-18: material grades all design, and Fe250/Fe415 use the 0.15% minimum.
  for (const grade of ['M20', 'M25', 'M30', 'M35']) {
    assert.ok(design({ concreteGrade: grade }).momentCapacityShort > 0, grade);
  }
  for (const grade of ['Fe250', 'Fe415', 'Fe500']) {
    const result = design({ steelGrade: grade });
    const expectedPercent = grade === 'Fe500' ? 0.12 : 0.15;
    approx(100 * result.AstMinimumShort / (1000 * result.slabThickness), expectedPercent, 4);
  }
});


// --- deflection stays conservative, never FAIL ------------------------

test('deflection remains VERIFICATION REQUIRED and is never converted to FAIL', () => {
  const result = generateSlabDesign(slabInput);
  assert.equal(result.deflectionStatus, 'VERIFICATION REQUIRED');
  assert.notEqual(result.deflectionStatus, 'FAIL');
  assert.equal(result.modificationFactor, null);
  assert.equal(result.permissibleLd, null);
  // No clamping or extrapolation was applied.
  assert.equal(result.deflectionClampingApplied, false);
  assert.equal(result.deflectionPtClamped, false);
  assert.equal(result.deflectionFsClamped, false);
  // Both out-of-range inputs are named explicitly.
  assert.ok(result.deflectionOutOfRangeInputs.some((item) => /pt = 0\.1467% is below/.test(item)));
  assert.ok(result.deflectionOutOfRangeInputs.some((item) => /fs = 44\.73 N\/mm² is below/.test(item)));
});

  const restrained = generateSlabDesign({ ...slabInput, cornerRestraint: 'RESTRAINED' });
  const restrainedCheck = restrained.checks.find((entry) => entry.id === 'cornerTorsion');
  assert.match(restrained.cornerTorsionBasis, /IS 456:2000 Annex D provisions/);
  assert.equal(restrainedCheck.status, 'VERIFICATION REQUIRED');
  assert.match(restrainedCheck.reason, /Clause 26\.5\.2\.1 is not used as the basis/);
});

});

// --- PDF layout --------------------------------------------------------

test('the PDF uses the required sections and semantic classification labels', async () => {
  const result = generateSlabDesign(slabInput);
  const pdf = await generatePdfReport({ ...slabInput, result });
  const text = extractPdfText(pdf);

  for (const heading of [
    'DESIGN STATUS', 'DESIGN SUMMARY', 'LOADS', 'DESIGN FORCES',
    'REINFORCEMENT DESIGN', 'REINFORCEMENT LAYOUT', 'CORNER TORSION',
    'SHEAR & DEFLECTION', 'SCHEMATIC', 'ENGINEERING CHECKS',
    'DETAILED CALCULATION TRACE', 'FINAL VERIFICATION SUMMARY'
  ]) {
    assert.ok(text.includes(heading), `PDF is missing the ${heading} section.`);
  }
  for (const label of ['[INPUT]', '[CALCULATED]', '[DERIVED]', '[CHECK]', '[VERIFICATION REQUIRED]', '[NOT REQUIRED]']) {
    assert.ok(text.includes(label), `PDF is missing the ${label} semantic label.`);
  }
  // NOT REQUIRED must be counted separately from PASS.
  assert.match(text, /Checks: \d+ PASS, 1 NOT REQUIRED, \d+ VERIFICATION REQUIRED, 0 FAIL/);
  assert.equal(pdf.toString('latin1').slice(0, 4), '%PDF');
});

test('the PDF reports the audit corrections: span rule, corner basis, bar extension, cover split and shear basis', async () => {
  const result = generateSlabDesign(slabInput);
  const pdf = await generatePdfReport({ ...slabInput, result });
  const text = extractPdfText(pdf);

  // Part 2: centre-to-centre input semantics and the Clause 22.2 min() rule.
  assert.ok(text.includes('centre-to-centre'), 'PDF must state the span input semantics');
  assert.ok(text.includes('Leff = min(clear span + d, centre-to-centre support span)'), 'PDF must state the effective-span rule');
  // Part 1: Table 27 classification criterion.
  assert.ok(text.includes('Annex D-2.1 / Table 27'), 'PDF must state the classification criterion');
  assert.ok(text.includes('finite interpolation only through m = 2.5'), 'PDF must state the finite Table 27 interpolation boundary');
  // Part 3: corner torsion cites Annex D-2.1, not Clause 26.5.2.1.
  assert.ok(text.includes('Corner torsion basis: IS 456:2000 Annex D-2.1'), 'PDF must cite Annex D-2.1');
  assert.equal(/Clause 26\.5\.2\.1 corner torsion steel is not required/.test(text), false);
  // Part 4: Annex D-2.1.1 bar extension is reported.
  assert.ok(text.includes('BAR EXTENSION / CURTAILMENT (IS 456:2000 Annex D-2.1.1)'), 'PDF must report bar extension');
  assert.ok(/0\.1 x 3 m = 0\.3 m from the support face/.test(text), 'PDF must report the 0.1 lx allowance');
  assert.ok(/0\.1 x 5 m = 0\.5 m from the support face/.test(text), 'PDF must report the 0.1 ly allowance');
  // Part 5: the conservative shear basis is stated.
  assert.ok(text.includes('SHEAR BASIS'), 'PDF must state the shear basis');
  assert.ok(text.includes('upper bound'), 'PDF must state the shear conservatism');
  // Part 7: cover is split into a geometric check and a durability verification.
  assert.ok(text.includes('Cover vs bar diameter (geometric): PASS'), 'PDF must report the geometric cover check');
  assert.ok(text.includes('Cover durability / fire basis: VERIFICATION REQUIRED'), 'PDF must report the durability verification');
  assert.ok(text.includes('not a Clause 26.4 check'), 'PDF must state the cover is not compared with thickness');
  // Part 12: the stale wording must never reappear.
  assert.equal(/of 16 checks passed/.test(text), false);
});
