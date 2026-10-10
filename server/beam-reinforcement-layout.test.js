import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateBeamDesign } from './src/services/beamCalculationService.js';
import { beamReportData, generateBeamPdfReport } from './src/services/beamReportService.js';

const commonInput = {
  length: 4.0,
  breadth: 300,
  overallDepth: 500,
  clearCover: 25,
  concreteGrade: 'M25',
  steelGrade: 'Fe415',
  liveLoad: 10,
  deadLoad: 3,
  unitWeightConcrete: 25,
  preferredBarDiameter: 16
};

test('Beam reinforcement layout is data-driven from the authoritative calculated cage', () => {
  const simply = generateBeamDesign({ ...commonInput, supportType: 'Simply Supported' });
  assert.equal(simply.reinforcement.bottomBars.label, '2-16 mm Ø');
  assert.equal(simply.reinforcement.topBars.label, '2-12 mm Ø');
  const simplyLayout = beamReportData(simply).reinforcementLayout;
  assert.equal(simplyLayout.supportType, 'Simply Supported');
  assert.equal(simplyLayout.mainTensionBars, '2-16 mm Ø');
  assert.equal(simplyLayout.bottomFaceBars, '2-16 mm Ø');
  assert.equal(simplyLayout.topFaceBars, '2-12 mm Ø');
  assert.equal(simplyLayout.stirrupLabel, '2-legged 8 mm dia @ 300 mm c/c');
  assert.equal(simplyLayout.stirrupDiameter, 8);
  assert.equal(simplyLayout.stirrupSpacing, 300);
  assert.equal(simplyLayout.stirrupMaximumSpacing, 300);
  assert.equal(simplyLayout.compressionReinforcementPresent, false);

  const continuous = generateBeamDesign({ ...commonInput, supportType: 'Continuous' });
  const continuousLayout = beamReportData(continuous).reinforcementLayout;
  assert.equal(continuousLayout.supportType, 'Continuous');
  assert.equal(continuousLayout.topFaceBars, continuous.reinforcement.topBars.label);
  assert.equal(continuousLayout.bottomFaceBars, continuous.reinforcement.bottomBars.label);

  const cantilever = generateBeamDesign({ ...commonInput, supportType: 'Cantilever' });
  const cantileverLayout = beamReportData(cantilever).reinforcementLayout;
  assert.equal(cantileverLayout.supportType, 'Cantilever');
  // The backend designs the cantilever flexural steel into bottomBars; the layout maps it to the physical top tension face.
  assert.equal(cantileverLayout.mainTensionBars, cantilever.reinforcement.bottomBars.label);
  assert.ok(cantileverLayout.topFaceBars.includes(cantilever.reinforcement.bottomBars.label));
  assert.ok(cantileverLayout.topFaceBars.includes('top face'));
  assert.ok(cantileverLayout.bottomFaceBars.includes(cantilever.reinforcement.topBars.label));
});

test('Physical face and structural role metadata state where each bar group actually sits', () => {
  const simply = generateBeamDesign({ ...commonInput, supportType: 'Simply Supported' });
  assert.equal(simply.reinforcement.bottomBars.face, 'bottom');
  assert.equal(simply.reinforcement.bottomBars.structuralRole, 'tension');
  assert.equal(simply.reinforcement.topBars.face, 'top');
  assert.equal(simply.reinforcement.topBars.structuralRole, 'hanger/detailing');
  assert.equal(simply.reinforcement.stirrups.label, '2-legged 8 mm dia @ 300 mm c/c');

  const continuous = generateBeamDesign({ ...commonInput, supportType: 'Continuous' });
  assert.equal(continuous.reinforcement.bottomBars.face, 'bottom');
  assert.equal(continuous.reinforcement.topBars.face, 'top');
  assert.equal(continuous.reinforcement.topBars.structuralRole, 'tension');

  const cantilever = generateBeamDesign({ ...commonInput, supportType: 'Cantilever' });
  // The cantilever flexural steel is stored in bottomBars but physically sits at the top face.
  assert.equal(cantilever.reinforcement.bottomBars.face, 'top');
  assert.equal(cantilever.reinforcement.bottomBars.structuralRole, 'tension');
  assert.equal(cantilever.reinforcement.topBars.face, 'bottom');
  assert.equal(cantilever.reinforcement.topBars.structuralRole, 'hanger/detailing');

  const layout = beamReportData(cantilever).reinforcementLayout;
  assert.equal(layout.mainFace, cantilever.reinforcement.bottomBars.face);
  assert.equal(layout.mainStructuralRole, cantilever.reinforcement.bottomBars.structuralRole);
  assert.equal(layout.secondaryFace, cantilever.reinforcement.topBars.face);
  assert.equal(layout.secondaryStructuralRole, cantilever.reinforcement.topBars.structuralRole);
  assert.equal(layout.groups[0].face, cantilever.reinforcement.bottomBars.face);
  assert.equal(layout.groups[1].face, cantilever.reinforcement.topBars.face);
  // The face metadata mirrors the legacy cantilever wording so both presentations agree.
  assert.ok(layout.topFaceBars.includes('top face'));
  assert.ok(layout.bottomFaceBars.includes('hanger/detailing'));
});

test('Reported layout values never contain undefined, null or NaN', () => {
  for (const supportType of ['Simply Supported', 'Continuous', 'Cantilever']) {
    const result = generateBeamDesign({ ...commonInput, supportType });
    const layout = beamReportData(result).reinforcementLayout;
    for (const row of layout.rows) {
      const rendered = String(row.value === null || row.value === undefined ? 'NOT PROVIDED' : row.value);
      assert.ok(!/undefined/i.test(rendered), `${supportType} row ${row.name} leaked undefined`);
      assert.ok(!/NaN/.test(rendered), `${supportType} row ${row.name} leaked NaN`);
      assert.ok(!/\bnull\b/i.test(rendered), `${supportType} row ${row.name} leaked null`);
    }
    assert.equal(layout.stirrupLabel, result.reinforcement.stirrups.label);
  }
});

test('Anchorage values reach the layout as calculated, never as zero fallbacks', () => {
  const result = generateBeamDesign({ ...commonInput, supportType: 'Simply Supported' });
  const layout = beamReportData(result).reinforcementLayout;
  assert.equal(layout.developmentLengthRequired, result.developmentLength.ld);
  assert.equal(layout.anchorageStatus, result.developmentLength.status);
  if (result.developmentLength.availableAnchorage === null) {
    assert.equal(layout.availableAnchorage, null);
    const row = layout.rows.find((entry) => entry.name === 'Available anchorage');
    assert.equal(row.classification, 'NOT PROVIDED');
    assert.equal(row.value, null);
  } else {
    assert.equal(layout.availableAnchorage, result.developmentLength.availableAnchorage);
  }
  for (const name of ['Ld required', 'Available anchorage', 'Anchorage status']) {
    assert.ok(layout.rows.some((row) => row.name === name), `layout summary is missing the ${name} row`);
  }
});

test('Web diagram consumes the authoritative cage metadata instead of re-deriving it', () => {
  const source = readFileSync(new URL('../client/src/components/BeamReinforcementDiagram.jsx', import.meta.url), 'utf8');
  // Face and role must be read from the calculated cage...
  assert.match(source, /designedGroup\.face/);
  assert.match(source, /secondaryGroup\.face/);
  assert.match(source, /designedGroup\.structuralRole/);
  assert.match(source, /secondaryGroup\.structuralRole/);
  // ...and the stirrup label must be used verbatim rather than rebuilt from diameter/spacing.
  assert.match(source, /const stirrupLabel = firstLabel\(stirrupCage\.label/);
  // Schematic draws must disclose their limitations.
  assert.match(source, /schematicDisclosure/);
  assert.match(source, /not a bar-bending schedule/);
  // Anchorage is disclosed in the drawing schedule.
  assert.match(source, /anchorage\.ldRequired/);
  assert.match(source, /anchorage\.available/);
});

test('Beam calculation steps use present fields, unique numbering and no undefined/null/NaN/Infinity', () => {
  const scenarios = [
    { name: 'baseline', overrides: {} },
    // Singly reinforced section is impossible for the demanded moment (discriminant < 0).
    { name: 'section inadequate for the moment', overrides: { liveLoad: 1000 } },
    // Out-of-range Fig. 4 input leaves permissible L/d undetermined.
    { name: 'deflection outside the Fig. 4 range', overrides: { length: 12, overallDepth: 300, liveLoad: 4, deadLoad: 2 } }
  ];
  for (const supportType of ['Simply Supported', 'Continuous', 'Cantilever']) {
    for (const scenario of scenarios) {
      const result = generateBeamDesign({ ...commonInput, ...scenario.overrides, supportType });
      const steps = result.calculationSteps;
      assert.ok(Array.isArray(steps) && steps.length > 0, `${supportType}/${scenario.name} returned no steps`);
      steps.forEach((step, index) => {
        const label = `${supportType}/${scenario.name} step ${step.step}`;
        assert.equal(step.step, index + 1, `${label} is out of sequence`);
        assert.ok(String(step.value).startsWith(`${step.step}.`), `${label} does not carry its own number exactly once`);
        for (const token of ['undefined', 'null', 'NaN', 'Infinity']) {
          assert.ok(!new RegExp(`\\b${token}\\b`).test(String(step.value)), `${label} leaked ${token}: ${step.value}`);
        }
      });
    }
  }
});

test('Beam calculation steps quote the formula actually used and authoritative field values', () => {
  const simply = generateBeamDesign({ ...commonInput, supportType: 'Simply Supported' });
  const continuous = generateBeamDesign({ ...commonInput, supportType: 'Continuous' });
  const cantilever = generateBeamDesign({ ...commonInput, supportType: 'Cantilever' });
  const stepOf = (result, step) => String(result.calculationSteps.find((entry) => entry.step === step)?.value ?? '');

  assert.match(stepOf(simply, 6), /wL²\/8/);
  assert.match(stepOf(cantilever, 6), /wL²\/2/);
  // The continuous span is designed with the coefficient method, so step 6 must not claim wL²/8.
  assert.match(stepOf(continuous, 6), /wL²\/12/);
  assert.match(stepOf(continuous, 6), new RegExp(String(continuous.continuousDesign.negative.mu)));
  assert.doesNotMatch(stepOf(continuous, 6), /wL²\/8/);

  // Step 14 reports xu/d and xu,max/d — the values that field actually holds.
  assert.match(stepOf(simply, 14), new RegExp(`xu/d = ${simply.momentCapacity.xuRatio}`));
  assert.match(stepOf(simply, 14), new RegExp(`xu,max/d = ${simply.momentCapacity.xuMaxRatio}`));
  // Step 18 quotes the percentage it interpolates at, not tau_c.
  assert.match(stepOf(simply, 18), new RegExp(`at pt = ${simply.shearCalculation.pt}%`));
  assert.match(stepOf(simply, 18), new RegExp(`tau_c = ${simply.shearCalculation.tauC} N/mm²`));

  // Undetermined values are stated, never printed as raw NaN/null.
  const inadequate = generateBeamDesign({ ...commonInput, supportType: 'Simply Supported', liveLoad: 1000 });
  assert.ok(!Number.isFinite(inadequate.requiredAreaSteel));
  assert.match(stepOf(inadequate, 9), /Not determined/);
  assert.match(stepOf(inadequate, 12), /Not determined/);
  assert.doesNotMatch(stepOf(inadequate, 13), /NaN/, 'provided steel is zero, not NaN');
  assert.match(stepOf(inadequate, 13), /Ast,provided/);
});

test('Anchorage is never replaced by zero and always mirrors the authoritative development length', () => {
  for (const supportType of ['Simply Supported', 'Continuous', 'Cantilever']) {
    const result = generateBeamDesign({ ...commonInput, supportType });
    const layout = beamReportData(result).reinforcementLayout;
    assert.equal(result.reinforcement.availableAnchorage, result.developmentLength.availableAnchorage, supportType);
    assert.equal(result.reinforcement.developmentLength, result.developmentLength.ldRequired, supportType);
    assert.equal(result.developmentStatus, result.developmentLength.status, supportType);
    assert.equal(layout.developmentLengthRequired, result.developmentLength.ldRequired, supportType);
    assert.equal(layout.anchorageStatus, result.developmentStatus, supportType);
    if (result.developmentLength.availableAnchorage === null) {
      assert.equal(layout.availableAnchorage, null, `${supportType} must stay undetermined, not zero`);
      assert.equal(result.anchorageRatio, null, `${supportType} anchorage ratio must stay null when availability is unknown`);
      assert.equal(result.developmentLength.status, 'VERIFICATION REQUIRED');
    } else {
      assert.ok(result.developmentLength.availableAnchorage > 0, `${supportType} available anchorage must be positive when established`);
    }
  }
});

// PDF text runs are emitted as hex TJ runs, so whitespace-free fingerprints are compared.
const pdfFingerprint = (pdf) => [...pdf.toString('latin1').matchAll(/<([0-9a-fA-F]+)>/g)]
  .map((match) => Buffer.from(match[1], 'hex').toString('latin1'))
  .join(' ')
  .replace(/\s+/g, '')
  .toUpperCase();

const pdfToken = (text) => text.replace(/\s+/g, '').toUpperCase();

test('PDF reinforcement names follow the physical face for every support type', async () => {
  const expectations = [
    {
      supportType: 'Simply Supported',
      required: ['Bottom flexural tension bars', 'Top detailing/hanger bars', 'Physical face = bottom'],
      forbidden: ['Top flexural tension bars']
    },
    {
      supportType: 'Continuous',
      required: ['Bottom flexural tension bars', 'Top negative-moment/support bars', 'Physical face = top'],
      forbidden: []
    },
    {
      supportType: 'Cantilever',
      required: ['Top flexural tension bars', 'Bottom detailing/hanger bars', 'Physical face = top'],
      forbidden: ['Bottom flexural bars']
    }
  ];
  for (const { supportType, required, forbidden } of expectations) {
    const result = generateBeamDesign({ ...commonInput, supportType });
    const fingerprint = pdfFingerprint(await generateBeamPdfReport({ result }));
    for (const text of required) {
      assert.ok(fingerprint.includes(pdfToken(text)), `${supportType} PDF is missing the physical-face label: ${text}`);
    }
    for (const text of forbidden) {
      assert.ok(!fingerprint.includes(pdfToken(text)), `${supportType} PDF still uses the misleading label: ${text}`);
    }
  }
});

test('Beam PDF shares the same authoritative reinforcement layout as the report data', async () => {
  const result = generateBeamDesign({ ...commonInput, supportType: 'Simply Supported' });
  const data = beamReportData(result);
  const pdf = await generateBeamPdfReport({ result });
  // pdfkit emits PDF content streams as hex-encoded TJ runs that may split mid-word for kerning,
  // so compare whitespace-insensitive fingerprints instead of raw substrings.
  const rawText = pdf.toString('latin1');
  const flattened = [...rawText.matchAll(/<([0-9a-fA-F]+)>/g)]
    .map((match) => Buffer.from(match[1], 'hex').toString('latin1'))
    .join(' ');
  const fingerprint = flattened.replace(/\s+/g, '').toUpperCase();
  for (const token of ['REINFORCEMENTLAYOUTSUMMARY', 'SHARESTHESAMEAUTHORITATIVECAGE', '2-16MM', '2-12MM', 'STIRRUPS', 'SIMPLYSUPPORTED']) {
    assert.ok(fingerprint.includes(token), `PDF report is missing authoritative layout token: ${token}`);
  }
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.equal(data.reinforcementLayout.stirrupLabel, result.reinforcement.stirrups.label);
  assert.equal(data.reinforcementLayout.mainTensionBars, result.reinforcement.bottomBars.label);
});

test('Beam PDF discloses the schematic reinforcement scope and the flexural model limitation', async () => {
  for (const supportType of ['Simply Supported', 'Continuous', 'Cantilever']) {
    const result = generateBeamDesign({ ...commonInput, supportType });
    const data = beamReportData(result);
    assert.ok(
      data.assumptions.some((assumption) => /bar lengths, curtailment locations and stirrup positions are not calculated/.test(assumption)),
      `${supportType} report must disclose that bar lengths, curtailment and stirrup positions are not calculated`
    );
    assert.ok(
      data.assumptions.some((assumption) => /Only singly reinforced flexural design is implemented/.test(assumption)),
      `${supportType} report must carry the flexural model limitation`
    );

    const fingerprint = pdfFingerprint(await generateBeamPdfReport({ result }));
    assert.ok(
      fingerprint.includes(pdfToken('bar lengths, curtailment locations and stirrup positions are not calculated')),
      `${supportType} PDF is missing the reinforcement scope disclosure`
    );
    assert.ok(
      fingerprint.includes(pdfToken('Only singly reinforced flexural design is implemented')),
      `${supportType} PDF is missing the flexural model limitation`
    );
    assert.ok(
      fingerprint.includes(pdfToken(`Final status: ${data.finalStatus}`)),
      `${supportType} PDF final status does not match the report data`
    );
  }
});

test('A secondary bar arrangement that could not be detailed is reported as verification required', () => {
  const compliant = generateBeamDesign({ ...commonInput, supportType: 'Simply Supported' });
  assert.equal(compliant.reinforcement.topBars.status, 'PASS');
  const compliantRow = beamReportData(compliant).reinforcement.find((row) => /detailing\/hanger bars$/.test(row.name));
  assert.equal(compliantRow.classification, 'DETAILING/HANGER');

  const undetailed = generateBeamDesign({ ...commonInput, supportType: 'Simply Supported' });
  undetailed.reinforcement.topBars = { ...undetailed.reinforcement.topBars, status: 'VERIFICATION REQUIRED' };
  const undetailedRow = beamReportData(undetailed).reinforcement.find((row) => /detailing\/hanger bars$/.test(row.name));
  assert.equal(undetailedRow.classification, 'VERIFICATION REQUIRED');
  assert.match(undetailedRow.clause, /engineering verification required/);
  // Surfacing the status must not change the engineering status computed by the design engine.
  assert.equal(beamReportData(undetailed).finalStatus, beamReportData(generateBeamDesign({ ...commonInput, supportType: 'Simply Supported' })).finalStatus);
});

