import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eraseStrokes } from '../annotations.js';
const stroke = {
  id: 's',
  width: 0.01,
  points: [
    { x: 0.1, y: 0.5 },
    { x: 0.9, y: 0.5 },
  ],
};
test('swept eraser catches intersections between pointer samples without touching other strokes', () => {
  const other = {
    ...stroke,
    id: 'other',
    points: [
      { x: 0.1, y: 0.9 },
      { x: 0.9, y: 0.9 },
    ],
  };
  assert.deepEqual(
    eraseStrokes([stroke, other], { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.8 }, 0.02, 1.414),
    [other],
  );
  assert.equal(stroke.points.length, 2);
});
test('eraser respects aspect ratio, stroke thickness, single dots and near misses', () => {
  const dot = { id: 'dot', width: 0.02, points: [{ x: 0.5, y: 0.5 }] };
  assert.equal(eraseStrokes([dot], { x: 0.5, y: 0.515 }, { x: 0.5, y: 0.515 }, 0.01, 2).length, 1);
  assert.equal(eraseStrokes([dot], { x: 0.5, y: 0.505 }, { x: 0.5, y: 0.505 }, 0.01, 2).length, 0);
  assert.equal(eraseStrokes([stroke], { x: 0, y: 0.1 }, { x: 0, y: 0.9 }, 0.01, 2).length, 1);
});
