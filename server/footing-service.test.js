import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFootingDesign } from './src/services/footingCalculationService.js';
import { generateFootingPdfReport } from './src/services/footingReportService.js';
import { footingBarCountPresentation } from '../client/src/utils/reinforcementDetailingPresentation.js';

const base = { columnWidth: 300, columnDepth: 300, footingLength: 1800, footingWidth: 1800, footingThickness: 450, clearCover: 50, preferredBarDiameter: 12, serviceAxialLoad: 500, factoredAxialLoad: 750, serviceMomentX: 0, serviceMomentY: 0, factoredMomentX: 0, factoredMomentY: 0, safeBearingCapacity: 200, concreteGrade: 'M25', steelGrade: 'Fe415', includeFootingSelfWeight: true };
const design = (overrides = {}) => generateFootingDesign({ ...base, ...overrides });
function allFinite(value) { if (typeof value === 'number') return Number.isFinite(value); if (Array.isArray(value)) return value.every(allFinite); return !value || typeof value !== 'object' || Object.values(value).every(allFinite); }
function extractPdfText(buffer) {
 const raw = buffer.toString('latin1'); const chunks = [];
 const pattern = /<([0-9a-fA-F]+)>\s*(?:TJ|Tj)|\[((?:\s*<[0-9a-fA-F]+>\s*(?:-?\d+\s*)?)+)\]\s*TJ|\(((?:\\.|[^()\\])*)\)\s*Tj/g;
 let match;
 while ((match = pattern.exec(raw)) !== null) {
  if (match[1]) chunks.push(Buffer.from(match[1], 'hex').toString('latin1'));
  else if (match[2]) chunks.push((match[2].match(/<[0-9a-fA-F]+>/g) || []).map((hex) => Buffer.from(hex.slice(1, -1), 'hex').toString('latin1')).join(''));
  else if (match[3] !== undefined) chunks.push(match[3]);
 }
 return chunks.join('');
}

test('basic square footing returns internally consistent finite authoritative results', () => {
  const result = design();
  assert.equal(result.designType, 'Footing'); assert.equal(result.finalStatus, 'VERIFICATION REQUIRED'); assert.equal(result.bearingPressure.service.contact, 'FULL_COMPRESSION');
  assert.ok(result.bearingPressure.service.qmax <= result.soil.safeBearingCapacity); assert.ok(result.reinforcement.x.AstProvided >= result.reinforcement.x.AstGoverning); assert.ok(allFinite(result));
});
test('audited square footing uses per-metre flexural reinforcement, full d/2 punching area and column-base transfer action', () => {
  const result = design();
  for (const r of [result.reinforcement.x, result.reinforcement.y]) {
    const barArea = Math.PI * r.diameter ** 2 / 4;
    const actualSpacing = (r.barCenters.at(-1) - r.barCenters[0]) / (r.bars - 1);
    const arrangementDensity = barArea * 1000 / actualSpacing;
    const capacity = 0.87 * 415 * arrangementDensity * r.effectiveDepth * (1 - 415 * arrangementDensity / (25 * 1000 * r.effectiveDepth)) / 1e6;
    assert.ok(Math.abs(r.AstRequired - 919.466) < 0.01); assert.equal(r.AstMinimum, 540); assert.ok(r.AstProvided >= r.AstRequired); assert.equal(r.diameter, 12); assert.equal(r.bars, 15);
    assert.equal(r.usableWidth, 1688); assert.equal(r.barCenters.length, r.bars); assert.ok(Math.abs(r.spacing - actualSpacing) < 0.001); assert.ok(Math.abs(r.AstProvided - arrangementDensity) < 0.001); assert.ok(Math.abs(r.momentCapacity - capacity) < 0.001);
    assert.ok(r.barCenters[0] - r.diameter / 2 >= base.clearCover); assert.ok(r.barCenters.at(-1) + r.diameter / 2 <= r.distributionWidth - base.clearCover); assert.equal(r.spacingStatus, 'PASS'); assert.equal(r.fitStatus, 'PASS'); assert.ok(r.momentCapacity >= r.Mu);
  }
  assert.ok(Math.abs(result.moments.alongX - 125.73) < 0.01); assert.ok(Math.abs(result.bearingPressure.service.qmax - 165.571) < 0.001); assert.ok(Math.abs(result.oneWayShear.x.tauv - 0.224) < 0.002); assert.ok(Math.abs(result.punchingShear.tauv - 0.626) < 0.002); assert.ok(Math.abs(result.developmentLength.x.ldRequired - 483.55) < 0.02);
  assert.equal(result.punchingShear.status, 'PASS'); assert.equal(result.loadTransfer.columnBaseAction, 750); assert.ok(Math.abs(result.loadTransfer.transferStress - 8.3333) < 0.001); assert.equal(result.loadTransfer.reinforcementTransferStatus, 'VERIFICATION REQUIRED');
});
test('rectangular footing calculates directional moments and Clause 34.3 central band distribution', () => {
  const result = design({ footingLength: 2400, footingWidth: 1800, footingThickness: 500 });
  assert.notEqual(result.moments.alongX, result.moments.alongY); assert.equal(result.reinforcement.distribution.centralBandWidth, 1800); assert.ok(result.reinforcement.distribution.centralBandFraction < 1); assert.equal(result.reinforcement.distribution.status, 'PASS');
});
test('biaxial loading exposes eccentricities and pressure extremes', () => {
  const result = design({ footingLength: 2600, footingWidth: 2200, serviceMomentX: 30, serviceMomentY: 20, factoredMomentX: 45, factoredMomentY: 30 });
  assert.equal(result.bearingPressure.service.ex, 20 / result.loads.serviceDesignLoad); assert.equal(result.bearingPressure.service.ey, 30 / result.loads.serviceDesignLoad); assert.notEqual(result.bearingPressure.service.qmax, result.bearingPressure.service.qmin);
});
test('negative qmin is explicitly verification-required, never silently approved', () => {
  const result = design({ serviceMomentX: 260, factoredMomentX: 390 });
  assert.equal(result.bearingPressure.service.contact, 'PARTIAL_CONTACT_NOT_IMPLEMENTED'); assert.equal(result.finalStatus, 'VERIFICATION REQUIRED');
});
test('small footing reports bearing failure', () => {
  const result = design({ footingLength: 1200, footingWidth: 1200 });
  assert.equal(result.checks.find((entry) => entry.name === 'Soil bearing pressure').status, 'FAIL');
});
test('inadequate thickness reports punching failure', () => {
  const result = design({ footingThickness: 220, clearCover: 50 });
  assert.equal(result.punchingShear.status, 'FAIL');
});
test('inadequate thickness reports one-way shear failure', () => {
  const result = design({ footingThickness: 240, clearCover: 40 });
  assert.equal(result.oneWayShear.x.status, 'FAIL');
  assert.ok(result.oneWayShear.x.tauv > result.oneWayShear.x.tauc || result.oneWayShear.y.tauv > result.oneWayShear.y.tauc);
});
test('discrete bar arrangement is selected and detailing checks are exposed', () => {
  const result = design({ footingLength: 2200, footingWidth: 1800, footingThickness: 450 });
  for (const reinforcement of [result.reinforcement.x, result.reinforcement.y]) { assert.ok(Number.isInteger(reinforcement.bars)); assert.ok(reinforcement.clearSpacing >= reinforcement.minClearSpacing); assert.ok(reinforcement.spacing <= reinforcement.maxSpacing); }
});
test('inadequate discrete reinforcement fit is reported as FAIL rather than accepted', () => {
  const result = design({ factoredAxialLoad: 3000 });
  assert.equal(result.reinforcement.x.status, 'FAIL'); assert.ok(result.reinforcement.x.clearSpacing < result.reinforcement.x.minClearSpacing);
});
test('invalid footing inputs are rejected before calculations', () => {
  assert.throws(() => design({ safeBearingCapacity: 0 }), /safeBearingCapacity/); assert.throws(() => design({ columnWidth: 1900 }), /Column dimensions/); assert.throws(() => design({ preferredBarDiameter: 14 }), /preferredBarDiameter/);
});
test('footing PDF is valid, vector-based and free of invalid engineering values', async () => {
  const result = design(); const pdf = await generateFootingPdfReport({ projectName: 'Footing PDF test', result }); const raw = pdf.toString('latin1');
  assert.equal(raw.slice(0, 4), '%PDF'); assert.equal(/undefined|NaN|Infinity/.test(raw), false); assert.ok(raw.includes('48 125 325 260 re')); assert.ok(raw.includes('400 140 128 205 re'));
});
test('footing UI and PDF show the authoritative X and Y bar counts', async () => {
 const result = design({ footingLength: 2200, footingWidth: 1800 });
 const uiBarCounts = footingBarCountPresentation(result.reinforcement);
 assert.equal(uiBarCounts.x, result.reinforcement.x.bars);
 assert.equal(uiBarCounts.y, result.reinforcement.y.bars);

 const pdf = await generateFootingPdfReport({ projectName: 'Footing count parity test', result });
 const text = extractPdfText(pdf);
 assert.match(text, new RegExp(`X DIRECTION[\\s\\S]*?${result.reinforcement.x.bars} bars`));
 assert.match(text, new RegExp(`Y DIRECTION[\\s\\S]*?${result.reinforcement.y.bars} bars`));
 assert.ok(text.includes(`X: ${result.reinforcement.x.bars}`));
 assert.ok(text.includes(`Y: ${result.reinforcement.y.bars}`));
});
