import test from 'node:test';
import assert from 'node:assert/strict';
import { pixelBoundary } from '../intro-transition.js';

test('像素瀑布边界在三段进度中持续向下显露房间', () => {
  const input = { column: 18, columns: 96, rows: 64 };
  const start = pixelBoundary({ ...input, progress: 0 });
  const middle = pixelBoundary({ ...input, progress: 0.5 });
  const end = pixelBoundary({ ...input, progress: 1 });

  assert.ok(start < middle);
  assert.ok(middle < end);
  assert.ok(end > input.rows);
});

test('同一列与进度得到确定性的像素边界', () => {
  const input = { column: 42, columns: 96, rows: 64, progress: 0.38 };
  assert.equal(pixelBoundary(input), pixelBoundary(input));
});
