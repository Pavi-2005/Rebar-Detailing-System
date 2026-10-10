import test from 'node:test';
import assert from 'node:assert/strict';
import { columnDrawingData } from './src/components/columnDrawingData.js';

test('column drawing consumes authoritative calculated cage coordinates and dimensions', () => {
  const drawing = columnDrawingData({
    geometry: { width: 300, depth: 300, unsupportedLength: 3000, clearCover: 40 },
    reinforcement: { selectedBarDiameter: 16, numberOfBars: 4, centerSpacingX: 192, centerSpacingY: 192, clearSpacingX: 176, clearSpacingY: 176, bars: [{ x: -96, y: -96 }, { x: 96, y: -96 }, { x: -96, y: 96 }, { x: 96, y: 96 }] },
    ties: { tieDiameter: 6, selectedSpacing: 255 }
  });
  assert.deepEqual([drawing.width, drawing.depth, drawing.unsupportedLength], [300, 300, 3000]);
  assert.equal(drawing.bars.length, 4);
  assert.equal(drawing.diameter, 16);
  assert.equal(drawing.tieDiameter, 6);
  assert.equal(drawing.tieSpacing, 255);
  assert.deepEqual([drawing.clearX, drawing.clearY], [176, 176]);
});
