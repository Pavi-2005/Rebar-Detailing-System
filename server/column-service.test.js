import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateArrangementSpacing, calculateInteractionAlpha, calculateTieDiameter, calculateTieRestraint, calculateUniaxialCapacity, createSymmetricBarLayout, generateColumnDesign } from './src/services/columnCalculationService.js';
import { generateColumnPdfReport } from './src/services/columnReportService.js';

const baseInput = {
  width: 300,
  depth: 300,
  unsupportedLength: 3000,
  effectiveLength: {
    x: { supportCondition: 'BOTH_ENDS_HELD_RESTRAINED' },
    y: { supportCondition: 'BOTH_ENDS_HELD_RESTRAINED' }
  },
  clearCover: 40,
  concreteGrade: 'M25',
  steelGrade: 'Fe415',
  factoredAxialLoad: 500,
  momentX: 20,
  momentY: 10
};

function design(overrides = {}) {
  return generateColumnDesign({ ...baseInput, ...overrides });
}

function extractPdfText(buffer) {
  const raw = buffer.toString('latin1');
  const runs = [];
  const pattern = /<([0-9a-fA-F]+)>\s*(?:TJ|Tj)|\[((?:\s*<[0-9a-fA-F]+>\s*(?:-?\d+\s*)?)+)\]\s*TJ|\(((?:\\.|[^()\\])*)\)\s*Tj/g;
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    if (match[1]) runs.push(Buffer.from(match[1], 'hex').toString('latin1'));
    else if (match[2]) {
      const hexRuns = match[2].match(/<([0-9a-fA-F]+)>/g) || [];
      runs.push(hexRuns.map((hex) => Buffer.from(hex.slice(1, -1), 'hex').toString('latin1')).join(''));
    } else if (match[3] !== undefined) runs.push(match[3]);
  }
  return runs.join('');
}

test('valid short axially loaded column calculates finite capacity and reinforcement', () => {
  const result = design({ momentX: 0, momentY: 0, allowZeroMomentDesignCase: true });

  assert.equal(result.classification.x, 'SHORT');
  assert.equal(result.classification.y, 'SHORT');
  assert.ok(result.axialCapacity.concreteContribution > 0);
  assert.ok(result.axialCapacity.steelContribution > 0);
  assert.ok(result.axialCapacity.capacity > result.inputs.factoredAxialLoad);
  assert.ok(result.reinforcement.selectedBarDiameter >= 12);
  assert.ok(result.reinforcement.numberOfBars >= 4);
  assert.equal(result.finalStatus, 'APPROVED');
});

test('supported default column case retains its authoritative design values', () => {
  const result = design();

  assert.equal(result.frameCondition, 'BRACED_NON_SWAY');
  assert.equal(result.finalStatus, 'APPROVED');
  assert.equal(result.axialCapacity.capacity, 1115.579);
  assert.equal(result.biaxialInteraction.Mux1, 61.194);
  assert.equal(result.biaxialInteraction.Muy1, 61.194);
  assert.equal(Number(result.biaxialInteraction.interactionValue.toFixed(3)), 0.315);
  assert.equal(result.reinforcement.AstProvided, 804.248);
  assert.equal(result.ties.tieDiameter, 6);
  assert.equal(result.ties.selectedSpacing, 255);
});

test('unsupported sway frame condition is rejected rather than substituted', () => {
  assert.throws(
    () => design({ frameCondition: 'UNBRACED_SWAY' }),
    /effectiveLengthX must be a finite value greater than zero/
  );
});

test('sway column checks consume external final moments and effective lengths without braced magnification', () => {
  const result = design({
    frameCondition: 'UNBRACED_SWAY',
    swayAnalysis: {
      effectiveLengthX: 3900,
      effectiveLengthY: 4200,
      analysisReference: 'Validated Frame Model v3; ULS combination 1.2G+1.5Q+1.5Wx'
    },
    momentX: 35,
    momentY: 28
  });

  assert.equal(result.finalStatus, 'APPROVED');
  assert.deepEqual([
    result.effectiveLengths.x.effectiveLength,
    result.effectiveLengths.y.effectiveLength
  ], [3900, 4200]);
  assert.equal(result.designMoments.x.designMoment, 35);
  assert.equal(result.designMoments.y.designMoment, 28);
  assert.equal(result.designMoments.x.additionalMoment, 'Included in externally supplied final design moment');
  assert.equal(result.inputs.swayAnalysis.analysisReference, 'Validated Frame Model v3; ULS combination 1.2G+1.5Q+1.5Wx');
  assert.ok(result.assumptions.some((assumption) => assumption.includes('not independently verified')));
  assert.ok(result.checks.every((check) => check.status === 'PASS'));
});

test('sway column requires a traceable analysis reference and moments including minimum eccentricity', () => {
  const swayInput = {
    frameCondition: 'UNBRACED_SWAY',
    swayAnalysis: { effectiveLengthX: 3900, effectiveLengthY: 4200, analysisReference: 'Frame analysis model A' }
  };
  assert.throws(() => design({
    ...swayInput,
    swayAnalysis: { ...swayInput.swayAnalysis, analysisReference: '   ' },
    momentX: 35,
    momentY: 28
  }), /swayAnalysis\.analysisReference is required/);
  assert.throws(() => design({ ...swayInput, momentX: 5, momentY: 5 }), /must include at least the Clause 25\.4 minimum-eccentricity moment/);
});

test('sway PDF identifies the external analysis source and unverified frame-model scope', async () => {
  const result = design({
    frameCondition: 'UNBRACED_SWAY',
    swayAnalysis: {
      effectiveLengthX: 3900,
      effectiveLengthY: 4200,
      analysisReference: 'Validated Frame Model v3; ULS combination 1.2G+1.5Q+1.5Wx'
    },
    momentX: 35,
    momentY: 28
  });
  const pdf = await generateColumnPdfReport({ projectName: 'Sway column report', result });
  const text = extractPdfText(pdf);

  assert.ok(text.includes('frame model not verified by this column check'));
  assert.ok(text.includes('External frame-analysis reference'));
  assert.ok(text.includes('Validated Frame Model v3'));
  assert.ok(text.includes('not independently verified'));
});

test('column PDF contains the vector reinforcement-detail section without invalid values', async () => {
  const result = design();
  const pdf = await generateColumnPdfReport({ projectName: 'Column PDF test', result });
  const raw = pdf.toString('latin1');
  const text = extractPdfText(pdf);
  assert.equal(raw.slice(0, 4), '%PDF');
  assert.equal(/undefined|NaN|Infinity/.test(raw), false);
  // PDFKit hex-encodes text, so assert the deterministic vector rectangles for the
  // calculated cross-section (210 x 210) and elevation (115 x 210).
  assert.ok(raw.includes('80 120 210 210 re'));
  assert.ok(raw.includes('390 120 115 210 re'));
  assert.ok(text.includes('300 mm'));
  assert.ok(text.includes('40 mm clear cover'));
  assert.ok(text.includes('6 mm tie'));
  assert.ok(text.includes('Unsupported length: 3000 mm'));
  assert.ok(text.includes('Ties: 6 mm @ 255 mm c/c (symbolic)'));
  assert.ok(text.includes('Longitudinal: 4'));
});

test('uniaxial moment applies minimum eccentricity and passes the X flexure check', () => {
  const result = design({ momentY: 0, allowZeroMomentDesignCase: true });

  assert.equal(result.designMoments.x.inputMoment, 20);
  assert.ok(result.designMoments.x.minimumEccentricityMoment > 0);
  assert.equal(result.designMoments.x.designMoment, 20);
  assert.equal(result.checks.find((check) => check.name === 'Flexure X').status, 'PASS');
});

test('biaxial moment exposes the Clause 39.6 interaction calculation', () => {
  const result = design();
  const interaction = result.biaxialInteraction;

  assert.equal(interaction.formula, '(Mux/Mux1)^alpha + (Muy/Muy1)^alpha <= 1.0');
  assert.equal(interaction.Pu, 500);
  const exactAst = result.reinforcement.numberOfBars * Math.PI * result.reinforcement.selectedBarDiameter ** 2 / 4;
  const expectedPuz = (0.45 * 25 * (300 * 300 - exactAst) + 0.75 * 415 * exactAst) / 1000;
  const expectedRatio = 500 / expectedPuz;
  const expectedAlpha = expectedRatio <= 0.2 ? 1 : expectedRatio >= 0.8 ? 2 : 1 + (expectedRatio - 0.2) / 0.6;
  assert.ok(Math.abs(interaction.Puz - expectedPuz) < 0.001);
  assert.ok(Math.abs(interaction.PuOverPuz - expectedRatio) < 0.00001);
  assert.ok(Math.abs(interaction.exponent - expectedAlpha) < 0.01);
  assert.match(interaction.alphaMethod, /Linear interpolation/);
  assert.ok(interaction.Mux1 > 0);
  assert.ok(interaction.Muy1 > 0);
  assert.equal(interaction.status, 'PASS');
  assert.equal(result.checks.find((check) => check.name === 'Biaxial interaction').status, 'PASS');
});

test('section equilibrium converges independently about both axes at target Pu', () => {
  const result = design();
  const { xCapacity, yCapacity } = result.biaxialInteraction;

  for (const capacity of [xCapacity, yCapacity]) {
    assert.equal(capacity.targetPu, 500);
    assert.equal(capacity.converged, true);
    assert.ok(Math.abs(capacity.solvedPu - capacity.targetPu) <= capacity.tolerance);
    assert.ok(Math.abs(capacity.axialResidual) <= capacity.tolerance);
    assert.ok(capacity.iterations > 0);
    assert.ok(capacity.neutralAxisDepth > 0);
    assert.ok(Number.isFinite(capacity.equivalentBlockDepth));
    assert.ok(Number.isFinite(capacity.concreteForce));
    assert.ok(Number.isFinite(capacity.concreteCentroid));
    assert.ok(Number.isFinite(capacity.steelForce));
    assert.ok(capacity.steelStrain.every((value) => Number.isFinite(value)));
    assert.ok(capacity.steelStress.every((value) => Number.isFinite(value)));
    assert.ok(Number.isFinite(capacity.solvedPu));
    assert.ok(Number.isFinite(capacity.momentResistance));
  }
});

test('Clause 39.6 alpha boundary and interpolation values are exact', () => {
  const expected = [[0, 1], [0.2, 1], [0.3, 1.1666666667], [0.4, 1.3333333333], [0.5, 1.5], [0.6, 1.6666666667], [0.8, 2], [1, 2]];
  expected.forEach(([ratio, alpha]) => assert.ok(Math.abs(calculateInteractionAlpha(ratio).alpha - alpha) < 0.0000001));
  assert.equal(calculateInteractionAlpha(-1).alpha, 1);
  assert.equal(calculateInteractionAlpha(2).alpha, 2);
  assert.match(calculateInteractionAlpha(0.4).method, /Linear interpolation/);
});

test('public uniaxial capacity helper returns converged finite section analysis', () => {
  const result = calculateUniaxialCapacity({ ...baseInput }, 16, 4, 'x');

  assert.equal(result.converged, true);
  assert.equal(result.targetPu, baseInput.factoredAxialLoad);
  assert.ok(Number.isFinite(result.neutralAxisDepth));
  assert.ok(Number.isFinite(result.equivalentBlockDepth));
  assert.ok(Number.isFinite(result.concreteForce));
  assert.ok(Number.isFinite(result.steelForce));
  assert.ok(result.steelStrain.every((value) => Number.isFinite(value)));
  assert.ok(result.steelStress.every((value) => Number.isFinite(value)));
  assert.ok(Number.isFinite(result.solvedPu));
  assert.ok(Math.abs(result.axialResidual) <= result.tolerance);
  assert.ok(Number.isFinite(result.momentResistance));
});

test('section solver remains converged for low, medium, high Pu and different arrangements', () => {
  const values = { ...baseInput };
  for (const pu of [100, 500, 900]) {
    const result = calculateUniaxialCapacity({ ...values, factoredAxialLoad: pu }, 16, 4, 'x', pu);
    assert.equal(result.converged, true);
    assert.ok(Math.abs(result.axialResidual) <= result.tolerance);
    assert.ok(Number.isFinite(result.momentResistance));
  }
  for (const [diameter, count] of [[16, 4], [20, 4], [16, 6]]) {
    const result = calculateUniaxialCapacity(values, diameter, count, 'y');
    assert.equal(result.converged, true);
    assert.ok(Math.abs(result.axialResidual) <= result.tolerance);
    assert.ok(Number.isFinite(result.neutralAxisDepth));
  }
});

test('corrected uniaxial capacities govern reinforcement selection', () => {
  const result = design();
  const { xCapacity, yCapacity } = result.biaxialInteraction;
  const barArea = Math.PI * result.reinforcement.selectedBarDiameter ** 2 / 4;

  assert.ok(Math.abs(result.reinforcement.AstProvided - result.reinforcement.numberOfBars * barArea) < 0.001);
  assert.equal(result.reinforcement.AstRequired, result.reinforcement.AstProvided);
  assert.ok(xCapacity.momentResistance >= result.designMoments.x.designMoment);
  assert.ok(yCapacity.momentResistance >= result.designMoments.y.designMoment);
  assert.ok(result.reinforcement.AstProvided >= result.reinforcement.AstMinimum);
  assert.ok(result.reinforcement.AstProvided <= result.reinforcement.maximumSteel);
});

test('slender column calculates additional moment in both axes', () => {
  const result = design({
    unsupportedLength: 12000,
    effectiveLength: {
      x: { supportCondition: 'BOTH_ENDS_HELD_RESTRAINED' },
      y: { supportCondition: 'BOTH_ENDS_HELD_RESTRAINED' }
    },
    momentX: 30,
    momentY: 15
  });

  assert.equal(result.classification.x, 'SLENDER');
  assert.equal(result.classification.y, 'SLENDER');
  assert.ok(result.designMoments.x.additionalMoment > 0);
  assert.ok(result.designMoments.y.additionalMoment > 0);
  assert.equal(result.designMoments.x.clause, 'IS 456:2000 Clauses 25.4 and 39.7');
  assert.equal(result.designMoments.x.relevantDimension, 300);
  assert.equal(result.designMoments.y.relevantDimension, 300);
});

test('one-axis slenderness applies additional moment only to the slender axis', () => {
  const result = design({
    width: 600,
    depth: 600,
    unsupportedLength: 4000,
    effectiveLength: {
      x: { supportCondition: 'ONE_END_FREE' },
      y: { supportCondition: 'BOTH_ENDS_HELD_RESTRAINED' }
    },
    factoredAxialLoad: 300,
    momentX: 5,
    momentY: 5
  });

  assert.equal(result.classification.x, 'SLENDER');
  assert.equal(result.classification.y, 'SHORT');
  assert.ok(result.designMoments.x.additionalMoment > 0);
  assert.equal(result.designMoments.y.additionalMoment, 0);
  assert.equal(result.checks.find((check) => check.name === 'Slenderness X').status, 'PASS');
});

test('both-axis slenderness uses both Clause 39.7 additional moments', () => {
  const result = design({
    width: 600,
    depth: 600,
    unsupportedLength: 12000,
    factoredAxialLoad: 300,
    momentX: 5,
    momentY: 5
  });

  assert.equal(result.classification.x, 'SLENDER');
  assert.equal(result.classification.y, 'SLENDER');
  assert.ok(result.designMoments.x.additionalMoment > 0);
  assert.ok(result.designMoments.y.additionalMoment > 0);
});

test('insufficient reinforcement demand is rejected without fabricated bars', () => {
  const result = design({ width: 250, depth: 250, factoredAxialLoad: 900, momentX: 180, momentY: 160 });

  assert.equal(result.reinforcement.selectedBarDiameter, 'NOT CALCULATED — REQUIRED INPUT/METHOD NOT IMPLEMENTED');
  assert.equal(result.finalStatus, 'NOT APPROVED');
  assert.equal(result.checks.find((check) => check.name === 'Longitudinal steel').status, 'FAIL');
});

test('excessive reinforcement demand cannot exceed the IS 456 maximum', () => {
  const result = design({ width: 250, depth: 250, factoredAxialLoad: 1200, momentX: 300, momentY: 250 });

  assert.equal(result.finalStatus, 'NOT APPROVED');
  assert.equal(result.reinforcement.AstProvided, 'NOT CALCULATED — REQUIRED INPUT/METHOD NOT IMPLEMENTED');
  assert.equal(result.reinforcement.maximumSteel, 3750);
});

test('invalid engineering input is rejected early', () => {
  assert.throws(() => design({ width: 0 }), /width must be a finite value greater than zero/i);
  assert.throws(() => design({ concreteGrade: 'M60' }), /unsupported concrete grade/i);
  assert.throws(() => design({ factoredAxialLoad: -1 }), /factoredAxialLoad must be/i);
  assert.throws(() => design({ momentX: 0, momentY: 0 }), /allowZeroMomentDesignCase/i);
  assert.throws(() => design({ effectiveLength: { x: { factor: 1e308 }, y: { supportCondition: 'BOTH_ENDS_HELD_RESTRAINED' } } }), /effectiveLength\.x\.supportCondition is required/i);
  assert.throws(() => design({ effectiveLength: { x: { supportCondition: 'BOTH_ENDS_HELD_RESTRAINED', factor: 1e308 }, y: { supportCondition: 'BOTH_ENDS_HELD_RESTRAINED' } } }), /effectiveLength\.x\.factor/i);
});

test('detailing failure is reported when cover leaves no physical bar arrangement', () => {
  const result = design({ width: 100, depth: 100, clearCover: 49 });

  assert.equal(result.finalStatus, 'NOT APPROVED');
  assert.equal(result.detailing.status, 'FAIL');
  assert.equal(result.ties.status, 'FAIL');
});

test('minimum rectangular arrangement has four symmetric corner bars', () => {
  const arrangement = createSymmetricBarLayout(300, 400, 40, 6, 12, 2, 2);

  assert.equal(arrangement.totalBars, 4);
  assert.equal(arrangement.cornerBars, 4);
  assert.equal(arrangement.intermediateBars, 0);
  assert.equal(arrangement.symmetry, true);
  assert.equal(new Set(arrangement.bars.map((bar) => `${bar.x},${bar.y}`)).size, 4);
});

test('six, eight, ten, and twelve bar arrangements remain symmetric', () => {
  const arrangements = [[3, 2], [3, 3], [4, 3], [4, 4]].map(([widthFaces, depthFaces]) => createSymmetricBarLayout(400, 500, 40, 8, 16, widthFaces, depthFaces));

  assert.deepEqual(arrangements.map((arrangement) => arrangement.totalBars), [6, 8, 10, 12]);
  assert.ok(arrangements.every((arrangement) => arrangement.symmetry && arrangement.cornerBars === 4));
});

test('seven-bar asymmetric arrangements are not generated', () => {
  const possibleTotals = [];
  for (let widthFaces = 2; widthFaces <= 6; widthFaces += 1) {
    for (let depthFaces = 2; depthFaces <= 6; depthFaces += 1) {
      possibleTotals.push(createSymmetricBarLayout(400, 500, 40, 8, 16, widthFaces, depthFaces).totalBars);
    }
  }

  assert.equal(possibleTotals.includes(7), false);
});

test('clear spacing equals centre spacing minus longitudinal bar diameter', () => {
  const arrangement = createSymmetricBarLayout(300, 300, 40, 6, 16, 2, 2);
  const spacing = calculateArrangementSpacing(arrangement, 16);

  assert.equal(spacing.centerSpacingX, 192);
  assert.equal(spacing.centerSpacingY, 192);
  assert.equal(spacing.clearSpacingX, 176);
  assert.equal(spacing.clearSpacingY, 176);
  assert.equal(spacing.clearSpacingX, spacing.centerSpacingX - 16);
});

test('tie diameter changes with the largest longitudinal bar diameter', () => {
  assert.equal(calculateTieDiameter(12), 6);
  assert.equal(calculateTieDiameter(16), 6);
  assert.equal(calculateTieDiameter(20), 6);
  assert.equal(calculateTieDiameter(25), 8);
  assert.equal(calculateTieDiameter(32), 8);
});

test('selected tie diameter propagates into the bar centreline envelope', () => {
  const arrangement = createSymmetricBarLayout(300, 300, 40, calculateTieDiameter(16), 16, 2, 2);

  assert.equal(arrangement.edgeX, 96);
  assert.equal(arrangement.edgeY, 96);
  assert.ok(arrangement.bars.every((bar) => Math.abs(bar.x) === 96 && Math.abs(bar.y) === 96));
});

test('intermediate bars receive supplementary cross-tie restraint legs', () => {
  const arrangement = createSymmetricBarLayout(400, 500, 40, 8, 16, 3, 2);
  const restraint = calculateTieRestraint(arrangement, 8, 250);

  assert.equal(arrangement.intermediateBars, 2);
  assert.equal(restraint.mainTieLegs, 4);
  assert.equal(restraint.crossTieLegs, 1);
  assert.equal(restraint.restrainedBars.length, 6);
  assert.deepEqual(restraint.unrestrainedBars, []);
  assert.equal(restraint.restraintStatus, 'PASS');
});

test('insufficient width or depth rejects the physical bar envelope', () => {
  assert.equal(createSymmetricBarLayout(100, 300, 40, 8, 32, 2, 2), null);
  assert.equal(createSymmetricBarLayout(300, 100, 40, 8, 32, 2, 2), null);
});

test('reinforcement limits are numerically enforced', () => {
  const minimumSteel = 0.008 * 300 * 300;
  const fourTwelve = 4 * Math.PI * 12 ** 2 / 4;
  const fourSixteen = 4 * Math.PI * 16 ** 2 / 4;
  const maximumSteel = 0.06 * 250 * 250;

  assert.equal(minimumSteel, 720);
  assert.ok(fourTwelve < minimumSteel);
  assert.ok(fourSixteen >= minimumSteel);
  assert.equal(maximumSteel, 3750);
  assert.ok(4 * Math.PI * 32 ** 2 / 4 <= maximumSteel);
});

test('biaxial capacities use the final selected symmetric arrangement', () => {
  const result = design();
  const arrangement = result.reinforcement;

  assert.deepEqual(result.biaxialInteraction.reinforcementArrangement.barsPerFace, arrangement.barsPerFace);
  assert.equal(result.biaxialInteraction.reinforcementArrangement.totalBars, arrangement.totalBars);
  assert.equal(result.biaxialInteraction.reinforcementArrangement.symmetry, true);
  assert.equal(result.biaxialInteraction.Mux1, Number(result.biaxialInteraction.xCapacity.momentResistance.toFixed(3)));
  assert.equal(result.biaxialInteraction.Muy1, Number(result.biaxialInteraction.yCapacity.momentResistance.toFixed(3)));
});

test('all returned engineering numbers are finite', () => {
  const result = design();
  const numbers = [];
  const visit = (value) => {
    if (typeof value === 'number') numbers.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(result);
  assert.ok(numbers.length > 40);
  assert.ok(numbers.every((value) => Number.isFinite(value)));
});
