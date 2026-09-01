import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  constrainGoalNote,
  invertSurfacePoint,
  keyboardNotePosition,
  normalizeGoalNote,
  surfacePoint,
} from '../budget-whiteboard.js';

const whiteboardSource = await readFile(new URL('../budget-whiteboard.js', import.meta.url), 'utf8');

test('预算便签为旧目标补齐安全的默认视觉位置', () => {
  assert.deepEqual(normalizeGoalNote(), {
    x: 0.52,
    y: 0.48,
    color: 'yellow',
    rotation: -2,
  });
});

test('预算便签坐标、颜色和旋转会被约束到白板允许范围', () => {
  assert.deepEqual(normalizeGoalNote({ x: 8, y: -2, color: 'purple', rotation: 19 }), {
    x: 1,
    y: 0,
    color: 'yellow',
    rotation: 4,
  });
});

test('键盘方向键以小步或大步移动预算便签', () => {
  const start = { x: 0.5, y: 0.5, color: 'cyan', rotation: 1 };
  assert.deepEqual(keyboardNotePosition(start, 'ArrowRight'), { ...start, x: 0.52 });
  assert.deepEqual(keyboardNotePosition(start, 'ArrowUp', true), { ...start, y: 0.44 });
  assert.deepEqual(keyboardNotePosition({ ...start, x: 0.99 }, 'ArrowRight'), { ...start, x: 1 });
});

test('展示层会给便签留出边距，避免拖出真实白板', () => {
  assert.deepEqual(constrainGoalNote({ x: 0, y: 1, color: 'cyan', rotation: 1 }), {
    x: 0.12,
    y: 0.86,
    color: 'cyan',
    rotation: 1,
  });
});

test('全景白板表面坐标可以投影并反解为同一便签位置', () => {
  const surface = {
    topLeft: { yaw: -1.9, pitch: 0.5 },
    topRight: { yaw: -2.4, pitch: 0.54 },
    bottomRight: { yaw: -2.55, pitch: -0.8 },
    bottomLeft: { yaw: -1.85, pitch: -0.82 },
  };
  const expected = { x: 0.37, y: 0.61 };
  const spherical = surfacePoint(surface, expected.x, expected.y);
  const actual = invertSurfacePoint(surface, spherical);
  assert.ok(Math.abs(actual.x - expected.x) < 1e-6);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-6);
});

test('便签持久化失败时不会播报已经保存', () => {
  assert.match(whiteboardSource, /persisted === false[\s\S]*刷新后可能丢失/);
  assert.doesNotMatch(whiteboardSource, /onMove\?\.\([^\n]+\);\s*this\.announce\('便签在全景白板上的位置已保存/);
});
