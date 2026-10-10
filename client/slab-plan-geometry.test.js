import test from 'node:test';
import assert from 'node:assert/strict';
import { slabPlanAxes } from './src/components/slabPlanGeometry.js';

test('3 m by 5 m plan maps short Lx bars vertically and long Ly bars horizontally', () => {
  const plan = slabPlanAxes({ shortSpan: 3, longSpan: 5 });
  assert.equal(plan.shortAxis.name, 'Lx');
  assert.equal(plan.shortAxis.screenAxis, 'y');
  assert.equal(plan.shortAxis.barOrientation, 'vertical');
  assert.equal(plan.longAxis.name, 'Ly');
  assert.equal(plan.longAxis.screenAxis, 'x');
  assert.equal(plan.longAxis.barOrientation, 'horizontal');
});

test('reversed input dimensions remain correct after calculation normalization', () => {
  const plan = slabPlanAxes({ shortSpan: 3, longSpan: 5 });
  assert.deepEqual([plan.shortSpan, plan.longSpan], [3, 5]);
  assert.equal(plan.shortAxis.barOrientation, 'vertical');
  assert.equal(plan.longAxis.barOrientation, 'horizontal');
});

test('another valid two-way aspect ratio uses the same result-driven axis mapping', () => {
  const plan = slabPlanAxes({ effectiveShortSpan: 4, effectiveLongSpan: 6 });
  assert.equal(plan.shortAxis.barOrientation, 'vertical');
  assert.equal(plan.longAxis.barOrientation, 'horizontal');
});
