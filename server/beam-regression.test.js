import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBeamDesign } from './src/services/beamCalculationService.js';
import { beamReportData, generateBeamPdfReport } from './src/services/beamReportService.js';

const common = { unitWeightConcrete: 25 };
const cases = [
  { length: 4, breadth: 300, overallDepth: 500, supportType: 'Simply Supported', concreteGrade: 'M25', steelGrade: 'Fe415', deadLoad: 3, liveLoad: 10, clearCover: 25, preferredBarDiameter: 16 },
  { length: 3, breadth: 250, overallDepth: 450, supportType: 'Simply Supported', concreteGrade: 'M20', steelGrade: 'Fe415', deadLoad: 2, liveLoad: 5, clearCover: 25, preferredBarDiameter: 16 },
  { length: 5, breadth: 300, overallDepth: 550, supportType: 'Simply Supported', concreteGrade: 'M30', steelGrade: 'Fe415', deadLoad: 5, liveLoad: 15, clearCover: 30, preferredBarDiameter: 20 },
  { length: 4, breadth: 300, overallDepth: 500, supportType: 'Continuous', concreteGrade: 'M25', steelGrade: 'Fe415', deadLoad: 3, liveLoad: 10, clearCover: 25, preferredBarDiameter: 16 },
  { length: 4, clearSpan: 3.8, supportWidth: 200, breadth: 300, overallDepth: 500, supportType: 'Simply Supported', concreteGrade: 'M25', steelGrade: 'Fe415', deadLoad: 3, liveLoad: 10, clearCover: 25, preferredBarDiameter: 16, terminationSetbackFromSupportFace: 100, availableEmbedmentLength: 300 }
];

test('Beam validated regression cases retain the required statuses and values', () => {
  const [one, two, three, four, five] = cases.map((input) => generateBeamDesign({ ...common, ...input }));
  assert.equal(one.developmentStatus, 'VERIFICATION REQUIRED');
  assert.equal(one.finalStatus, 'VERIFICATION REQUIRED');
  assert.equal(two.providedAreaSteel >= two.minimumReinforcement, true);
  assert.equal(two.finalStatus, 'VERIFICATION REQUIRED');
  assert.ok(Math.abs(three.ultimateShear - 90.47) < 0.02);
  assert.ok(Math.abs(three.shearCalculation.vc / 1000 - 82.12) < 0.02);
  assert.ok(Math.abs(three.shearCalculation.vusRequired / 1000 - 8.35) < 0.02);
  assert.equal(three.shearCalculation.concreteShearStatus, 'REINFORCEMENT REQUIRED');
  assert.equal(three.shearCalculation.shearReinforcementStatus, 'PASS');
  assert.equal(three.shearCalculation.maxStressPass, true);
  assert.equal(three.shearCalculation.overallShearStatus, 'PASS');
  assert.equal(three.finalStatus, 'VERIFICATION REQUIRED');
  assert.ok(four.continuousDesign.positive.mu > 0);
  assert.ok(four.continuousDesign.negative.mu > 0);
  assert.notEqual(four.continuousDesign.positive.mu, four.continuousDesign.negative.mu);
  assert.match(four.reinforcement.topBars.role, /negative-moment\/support/i);
  assert.equal(four.finalStatus, 'VERIFICATION REQUIRED');
  assert.equal(five.designSpan, 4);
  assert.equal(five.developmentLengthRequired, 644.73);
  assert.equal(five.developmentLengthAvailable, 288);
  assert.equal(five.developmentLength.grossEmbedment, 300);
  assert.equal(five.developmentLength.anchorageDeduction, 12);
  assert.match(five.developmentLength.availableAnchorageCalculation, /300 mm gross embedment - 12 mm deduction = 288 mm/);
  assert.equal(five.developmentStatus, 'FAIL');
  assert.equal(five.finalStatus, 'FAIL');
});

test('Beam report and PDF use the authoritative Beam statuses', async () => {
  for (const input of cases) {
    const result = generateBeamDesign({ ...common, ...input });
    const report = beamReportData(result);
    const pdf = await generateBeamPdfReport({ result });
    assert.equal(report.finalStatus, result.finalStatus);
    assert.equal(report.shear.find((entry) => entry.name === 'Maximum shear stress status').value, result.shearCalculation.maximumShearStressStatus);
    assert.equal(report.checks.find((check) => check.name === 'Maximum shear stress').status, result.shearCalculation.maximumShearStressStatus);
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  }
  const continuous = beamReportData(generateBeamDesign({ ...common, ...cases[3] }));
  const anchorageFailure = beamReportData(generateBeamDesign({ ...common, ...cases[4] }));
  assert.equal(continuous.inputs.find((entry) => entry.name === 'Superimposed dead load').value, 3);
  assert.ok(continuous.flexure.some((entry) => entry.name === 'Negative/support moment Mu-'));
  assert.equal(anchorageFailure.development.find((entry) => entry.name === 'Gross embedment').value, 300);
  assert.equal(anchorageFailure.development.find((entry) => entry.name === 'Anchorage deduction').value, 12);
  assert.equal(anchorageFailure.development.find((entry) => entry.name === 'Ld available').value, 288);
});
