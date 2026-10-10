import test from 'node:test';
import assert from 'node:assert/strict';
import {
  columnResultState,
  formatColumnInteger,
  formatColumnLength,
  formatColumnNumber,
  isColumnDesignInput
} from './src/utils/columnPresentation.js';

const currentInputs = {
  width: 300,
  depth: 300,
  unsupportedLength: 3000,
  clearCover: 40,
  frameCondition: 'BRACED_NON_SWAY',
  concreteGrade: 'M25',
  steelGrade: 'Fe415',
  factoredAxialLoad: 500,
  momentX: 20,
  momentY: 10,
  effectiveLength: {
    x: { supportCondition: 'BOTH_ENDS_HELD_RESTRAINED' },
    y: { supportCondition: 'BOTH_ENDS_HELD_RESTRAINED' }
  },
  allowZeroMomentDesignCase: false
};

const currentResult = {
  frameCondition: 'BRACED_NON_SWAY',
  finalStatus: 'APPROVED',
  inputs: { ...currentInputs }
};

test('column result is current only for a matching supported frame and input snapshot', () => {
  assert.equal(columnResultState(currentResult, currentInputs), 'current');
  assert.equal(columnResultState(currentResult, { ...currentInputs, frameCondition: 'UNBRACED_SWAY' }), 'stale');
  const changedInputs = [
    { width: '350' },
    { depth: '350' },
    { unsupportedLength: '3100' },
    { clearCover: '45' },
    { concreteGrade: 'M30' },
    { steelGrade: 'Fe500' },
    { factoredAxialLoad: '550' },
    { momentX: '21' },
    { momentY: '11' },
    { effectiveLength: { ...currentInputs.effectiveLength, x: { supportCondition: 'ONE_END_FREE' } } },
    { effectiveLength: { ...currentInputs.effectiveLength, y: { supportCondition: 'ONE_END_FREE' } } }
  ];
  changedInputs.forEach((change) => {
    assert.equal(columnResultState(currentResult, { ...currentInputs, ...change }), 'stale');
  });
});

test('external sway analysis results are snapshot-checked and become stale when edited', () => {
  const swayInputs = {
    ...currentInputs,
    frameCondition: 'UNBRACED_SWAY',
    swayAnalysis: {
      effectiveLengthX: 3900,
      effectiveLengthY: 4200,
      analysisReference: 'Frame model A; ULS combo 1'
    }
  };
  const swayResult = { frameCondition: 'UNBRACED_SWAY', finalStatus: 'APPROVED', inputs: swayInputs };

  assert.equal(columnResultState(swayResult, swayInputs), 'current');
  assert.equal(columnResultState(swayResult, {
    ...swayInputs,
    swayAnalysis: { ...swayInputs.swayAnalysis, effectiveLengthX: '4000' }
  }), 'stale');
  assert.equal(columnResultState(swayResult, {
    ...swayInputs,
    swayAnalysis: { ...swayInputs.swayAnalysis, analysisReference: 'Frame model B; ULS combo 1' }
  }), 'stale');
  assert.equal(columnResultState(swayResult, { ...swayInputs, momentX: '40' }), 'stale');
});

test('all design-critical form inputs are recognized for result invalidation', () => {
  for (const name of [
    'width', 'depth', 'unsupportedLength', 'clearCover', 'frameCondition',
    'concreteGrade', 'steelGrade', 'factoredAxialLoad', 'momentX', 'momentY',
    'effectiveLength.x.supportCondition', 'effectiveLength.y.supportCondition'
  ]) assert.equal(isColumnDesignInput(name), true, name);
  for (const name of ['swayAnalysis.effectiveLengthX', 'swayAnalysis.effectiveLengthY', 'swayAnalysis.analysisReference']) {
    assert.equal(isColumnDesignInput(name), true, name);
  }
  assert.equal(isColumnDesignInput('projectName'), false);
});

test('column presentation uses report precision without changing integer detailing values', () => {
  assert.equal(formatColumnNumber(0.3152986475369778), '0.315');
  assert.equal(formatColumnNumber(804.247719318987), '804.248');
  assert.equal(formatColumnInteger(4.0), '4');
  assert.equal(formatColumnLength(1950), '1950');
  assert.equal(formatColumnLength(192.1254), '192.125');
});
