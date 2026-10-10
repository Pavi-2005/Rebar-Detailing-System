import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBeamDesign } from './src/services/beamCalculationService.js';
import { beamReportData, generateBeamPdfReport } from './src/services/beamReportService.js';
import { generateSlabDesign } from './src/services/slabCalculationService.js';
import { generatePdfReport, slabReportData } from './src/services/reportService.js';

const beamInput = {
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
};

test('Beam report contract maps calculated service fields without unavailable-value placeholders', async () => {
  const result = generateBeamDesign(beamInput);
  const data = beamReportData(result);
  const pdf = await generateBeamPdfReport({ projectName: 'Beam report regression', result });
  const text = pdf.toString('latin1');

  assert.equal(data.finalStatus, 'VERIFICATION REQUIRED');
  assert.deepEqual(data.missingRequired, []);
  assert.equal(data.loads.find((entry) => entry.name === 'Ultimate moment Mu').value, result.ultimateMoment);
  assert.equal(data.flexure.find((entry) => entry.name === 'Required Ast').value, result.requiredAreaSteel);
  assert.equal(data.flexure.find((entry) => entry.name === 'Moment capacity').value, result.momentCapacity.muProvided);
  assert.equal(data.shear.find((entry) => entry.name === 'τv').value, result.shearCalculation.tauv);
  assert.equal(data.shear.find((entry) => entry.name === 'Stirrup spacing').value, result.maximumStirrupSpacing.provided);
  assert.equal(data.deflection.find((entry) => entry.name === 'Actual L/d').value, result.deflectionCheck.actualLd);
  assert.equal(data.deflection.find((entry) => entry.name === 'Permissible L/d').value, result.deflectionCheck.permissibleLd);
  assert.equal(text.slice(0, 4), '%PDF');
  assert.ok(text.length > 1000);
  assert.equal(data.flexure.every((entry) => entry.classification !== 'NOT IMPLEMENTED'), true);
  assert.equal(data.shear.every((entry) => entry.classification !== 'NOT IMPLEMENTED'), true);
  assert.equal(data.development.find((entry) => entry.name === 'Ld available').value, 'NOT PROVIDED');
  assert.equal(data.development.find((entry) => entry.name === 'Available embedment').value, 'NOT PROVIDED');
  assert.equal(data.development.find((entry) => entry.name === 'Status').value, 'VERIFICATION REQUIRED');
  assert.doesNotMatch(text, /Available embedment: \[CALCULATED FROM SUPPORT GEOMETRY\]/);
});

test('Beam report contract marks missing required calculations incomplete', async () => {
  const result = generateBeamDesign(beamInput);
  delete result.shearCalculation.tauC;
  const data = beamReportData(result);
  const pdf = await generateBeamPdfReport({ result });

  assert.equal(data.finalStatus, 'FAIL');
  assert.ok(data.missingRequired.includes('shearCalculation.tauC'));
  assert.equal(pdf.toString('latin1').slice(0, 4), '%PDF');
});

test('Beam report contract rejects non-finite required calculations', () => {
  const result = generateBeamDesign(beamInput);
  result.momentCapacity.muProvided = Infinity;
  const data = beamReportData(result);

  assert.equal(data.finalStatus, 'FAIL');
  assert.ok(data.missingRequired.includes('momentCapacity.muProvided'));
});

test('under-reinforced report check follows xu and xuMax and matches final checks', () => {
  const cases = [
    [53.77, 220.32, 'PASS'],
    [220.32, 220.32, 'PASS'],
    [220.33, 220.32, 'FAIL']
  ];

  cases.forEach(([xu, xuMax, expected]) => {
    const result = generateBeamDesign(beamInput);
    result.momentCapacity.xu = xu;
    result.momentCapacity.xuMax = xuMax;
    const data = beamReportData(result);
    const detailed = data.flexure.find((entry) => entry.name === 'Under-reinforced check');
    const final = data.checks.find((check) => check.name === 'Under-reinforced section');

    assert.equal(detailed.value, expected);
    assert.equal(final.status, expected);
    assert.equal(data.finalStatus, expected === 'PASS' ? 'VERIFICATION REQUIRED' : 'FAIL');
  });
});

test('Beam report shows calculated anchorage values for valid support geometry', () => {
  const result = generateBeamDesign({
    ...beamInput,
    clearSpan: 4,
    supportWidth: 850,
    terminationSetbackFromSupportFace: 0,
    supportCondition: 'Simply Supported'
  });
  const data = beamReportData(result);

  assert.equal(data.development.find((entry) => entry.name === 'Ld available').value, result.developmentLength.availableAnchorage);
  assert.equal(data.development.find((entry) => entry.name === 'Anchorage ratio Ld available / Ld required').value, result.developmentLength.anchorageRatio);
  assert.equal(data.development.find((entry) => entry.name === 'Status').value, result.developmentLength.developmentStatus);
  assert.equal(result.developmentLength.developmentStatus, 'PASS');
});

test('Beam anchorage values remain identical from calculation result through report and PDF generation', async () => {
  const result = generateBeamDesign({
    ...beamInput,
    clearSpan: 4,
    supportWidth: 850,
    supportCondition: 'Simply Supported',
    terminationSetbackFromSupportFace: 0
  });
  const report = beamReportData(result);
  const pdf = await generateBeamPdfReport({ result });
  const development = report.development;

  assert.equal(result.developmentLengthRequired, result.developmentLength.ldRequired);
  assert.equal(result.developmentLengthAvailable, result.developmentLength.availableAnchorage);
  assert.equal(result.anchorageRatio, result.developmentLength.anchorageRatio);
  assert.equal(result.developmentStatus, result.developmentLength.developmentStatus);
  assert.equal(development.find((entry) => entry.name === 'Development length Ld required').value, result.developmentLengthRequired);
  assert.equal(development.find((entry) => entry.name === 'Ld available').value, result.developmentLengthAvailable);
  assert.equal(development.find((entry) => entry.name === 'Anchorage ratio Ld available / Ld required').value, result.anchorageRatio);
  assert.equal(development.find((entry) => entry.name === 'Status').value, result.developmentStatus);
  assert.equal(pdf.toString('latin1').slice(0, 4), '%PDF');
});

test('missing or non-finite xu values make the Beam report incomplete', () => {
  for (const xu of [undefined, NaN, Infinity]) {
    const result = generateBeamDesign(beamInput);
    result.momentCapacity.xu = xu;
    const data = beamReportData(result);
    const detailed = data.flexure.find((entry) => entry.name === 'Under-reinforced check');
    const final = data.checks.find((check) => check.name === 'Under-reinforced section');

    assert.equal(detailed.value, 'NOT PROVIDED');
    assert.equal(final.status, 'NOT PROVIDED');
    assert.equal(data.finalStatus, 'FAIL');
  }
});

test('Beam report cannot approve when an authoritative check is missing', () => {
  const result = generateBeamDesign(beamInput);
  result.checks = result.checks.filter((check) => check.name !== 'Maximum shear stress');
  const data = beamReportData(result);

  assert.notEqual(data.finalStatus, 'PASS');
  assert.equal(data.finalStatus, 'FAIL');
});

test('slab report consumes the adopted final design and executed iterations', async () => {
  const input = {
    projectName: 'Slab report regression',
    designerName: 'Engineer',
    date: '2026-09-18',
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
  const result = generateSlabDesign(input);
  const report = slabReportData({ ...input, result });
  const pdf = await generatePdfReport({ ...input, result });

  assert.equal(report.initialThickness, 150);
  assert.equal(report.adoptedThickness, null);
  assert.equal(report.selfWeight, result.selfWeight);
  assert.equal(report.effectiveDepthLong, result.finalDesign.effectiveDepthY);
  assert.equal(report.actualLd, result.finalDesign.actualLd);
  assert.equal(report.designIterations.length, result.designIterations.length);
  assert.equal(report.designIterations.at(-1).thickness, 300);
  assert.equal(pdf.toString('latin1').slice(0, 4), '%PDF');
});
