import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const observatorySource = readFileSync(new URL('../desire-observatory.js', import.meta.url), 'utf8');
const observatoryCss = readFileSync(new URL('../desire-observatory.css', import.meta.url), 'utf8');

test('欲望观察舱通过独立视觉与运行模块加载，便于审查与回退', () => {
  assert.match(indexSource, /desire-observatory\.css\?v=20260904-observatory-3/);
  assert.match(appSource, /desire-observatory\.js\?v=20260904-observatory-3/);
  assert.match(observatoryCss, /\.observatory-shell/);
  assert.match(observatoryCss, /\.observatory-stage/);
  assert.match(observatoryCss, /\.observatory-signal-list/);
  assert.match(observatoryCss, /backdrop-filter/);
  assert.match(observatoryCss, /--observatory-ink:\s*#f2eadb/);
});

test('顶层信息使用文字标识而非装饰 icon，商品信息保持静止可读', () => {
  const start = indexSource.indexOf('<!-- PEEL_GAME_START -->');
  const end = indexSource.indexOf('<!-- PEEL_GAME_END -->', start);
  const markup = indexSource.slice(start, end);

  assert.match(markup, /SPREE LAB/);
  assert.match(markup, /OBS \/ 01/);
  assert.match(markup, /OBJECT FILE/);
  assert.match(markup, /id="observatoryProductName"/);
  assert.match(markup, /id="observatoryProductPrice"/);
  assert.doesNotMatch(markup, /<img|<svg|😀|🎧|📦/);
});

test('催促信号保持短句，并以关闭信号而不是切割商品表达', () => {
  const signalLabels = [...observatorySource.matchAll(/label:\s*'([^']+)'/g)].map((match) => match[1]);

  assert.ok(signalLabels.length >= 6);
  assert.ok(signalLabels.every((label) => [...label].length <= 6));
  assert.match(indexSource, /催促信号/);
  assert.match(indexSource, /商品留下，催促信号一条条关掉/);
  assert.doesNotMatch(indexSource.slice(indexSource.indexOf('<!-- PEEL_GAME_START -->'), indexSource.indexOf('<!-- PEEL_GAME_END -->')), /切开|刀锋|剥壳|信号膜/);
});

test('视觉状态会随信号降噪，并为 WebGL、慢帧和减少动态提供回退', () => {
  assert.match(observatoryCss, /data-calm-level="2"/);
  assert.match(observatoryCss, /data-render-mode="fallback"/);
  assert.match(observatoryCss, /data-quality="essential"/);
  assert.match(observatoryCss, /prefers-reduced-motion:\s*reduce/);
  assert.match(observatorySource, /MAX_OBSERVATORY_DPR\s*=\s*1\.75/);
  assert.match(observatorySource, /slowFrameDebt/);
});

test('入口与观察舱控制器使用同一缓存版本', () => {
  assert.match(indexSource, /app\.js\?v=20260904-observatory-3-mall-receipt-stub-1/);
  assert.match(appSource, /desire-observatory\.js\?v=20260904-observatory-3/);
});
