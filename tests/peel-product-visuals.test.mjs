import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PRODUCT_CATALOG } from '../peel-game.js';
import {
  drawPeelProductVisual,
  resolvePeelProductVisual,
} from '../peel-product-visuals.js';

const peelUiSource = readFileSync(new URL('../peel-game-ui.js', import.meta.url), 'utf8');

function recordingContext() {
  const calls = [];
  const methods = new Set([
    'arc', 'beginPath', 'closePath', 'fill', 'fillRect', 'fillText', 'lineTo',
    'moveTo', 'quadraticCurveTo', 'restore', 'rotate', 'save', 'scale', 'stroke',
    'strokeRect', 'translate',
  ]);
  const context = new Proxy({}, {
    get(target, key) {
      if (methods.has(key)) return (...args) => calls.push([key, ...args]);
      return target[key];
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  return { context, calls };
}

test('精品解构舱为商品选择可复现的矢量陈列类型而不是 Emoji 卡片', () => {
  const visuals = PRODUCT_CATALOG.map((item) => resolvePeelProductVisual(item));

  assert.ok(new Set(visuals.map((visual) => visual.kind)).size >= 8);
  assert.ok(visuals.every((visual) => visual.kind && visual.label === '商品本体'));
  assert.equal(resolvePeelProductVisual({ id: 'private-order', category: 'digital' }).kind, 'device');
  assert.equal(resolvePeelProductVisual({ id: 'private-order', category: 'unknown' }).kind, 'object');
});

test('商品陈列使用 Canvas 轮廓绘制且不会把 Emoji 当成商品图', () => {
  for (const item of PRODUCT_CATALOG) {
    const { context, calls } = recordingContext();
    const result = drawPeelProductVisual(context, item, { scale: 1.2, revealed: true });

    assert.equal(result.kind, resolvePeelProductVisual(item).kind);
    assert.ok(calls.some(([method]) => method === 'stroke'));
    assert.ok(calls.some(([method]) => method === 'fill'));
    assert.equal(calls.some(([method]) => method === 'fillText'), false);
  }
});

test('游戏舞台把短诱因绘制为环绕信号膜而不是带标签的实心纸牌', () => {
  const start = peelUiSource.indexOf('function drawProduct(');
  const end = peelUiSource.indexOf('function drawShellShard(', start);
  const productRenderer = peelUiSource.slice(start, end);

  assert.match(peelUiSource, /drawPeelProductVisual/);
  assert.match(productRenderer, /drawSignalFilm/);
  assert.match(productRenderer, /Math\.sin\(entity\.rotation\)\s*\*\s*0\.16/);
  assert.doesNotMatch(productRenderer, /entity\.item\.glyph/);
  assert.doesNotMatch(productRenderer, /话术样本/);
});

test('切开反馈使用玻璃碎光与无底板文字回声', () => {
  const shardStart = peelUiSource.indexOf('function drawShellShard(');
  const revealStart = peelUiSource.indexOf('function drawRevealCard(', shardStart);
  const drawStart = peelUiSource.indexOf('function draw()', revealStart);
  const shardRenderer = peelUiSource.slice(shardStart, revealStart);
  const revealRenderer = peelUiSource.slice(revealStart, drawStart);

  assert.doesNotMatch(shardRenderer, /fillRect|strokeRect/);
  assert.match(shardRenderer, /globalCompositeOperation\s*=\s*'screen'/);
  assert.doesNotMatch(revealRenderer, /drawRoundedRect/);
  assert.doesNotMatch(revealRenderer, /#302924/);
  assert.match(revealRenderer, /fillText/);
});
