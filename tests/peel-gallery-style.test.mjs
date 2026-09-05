import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const peelUiSource = readFileSync(new URL('../peel-game-ui.js', import.meta.url), 'utf8');

test('精品解构舱通过独立样式层加载，便于审查与回退', () => {
  const refinementCss = readFileSync(new URL('../peel-game-refined.css', import.meta.url), 'utf8');

  assert.match(indexSource, /peel-game-refined\.css\?v=20260903-warm-feedback-1/);
  assert.match(refinementCss, /\.peel-game-card/);
  assert.match(refinementCss, /\.peel-game-stage/);
  assert.match(refinementCss, /\.peel-intro-shell/);
  assert.match(refinementCss, /backdrop-filter/);
  assert.match(refinementCss, /--peel-gallery-ink:\s*#f4f0e7/);
  assert.match(
    refinementCss,
    /\.peel-intro-shell\.is-front\s*\{[\s\S]*?background:\s*rgba\(215, 255, 67, \.014\)/,
  );
  assert.doesNotMatch(refinementCss, /#ffb23f|#ff7b42|#7e5cff/i);
});

test('引导文案使用营销信号隐喻，不再称作贴纸或话术样本', () => {
  const start = indexSource.indexOf('<!-- PEEL_GAME_START -->');
  const end = indexSource.indexOf('<!-- PEEL_GAME_END -->', start);
  const peelMarkup = indexSource.slice(start, end);

  assert.match(peelMarkup, /把营销噪声留在玻璃外/);
  assert.match(peelMarkup, /信号膜/);
  assert.doesNotMatch(peelMarkup, /促销贴纸|话术样本/);
});

test('局内状态与辅助操作统一使用信号语言', () => {
  assert.match(peelUiSource, /single:\s*'单信号'/);
  assert.match(peelUiSource, /mixed:\s*'双信号'/);
  assert.doesNotMatch(peelUiSource, /当前空中目标[^\n]*外壳/);
});

test('入口与游戏控制器保留各自更新后的缓存版本', () => {
  assert.match(indexSource, /app\.js\?v=20260905-interaction-audit-1/);
  assert.match(appSource, /peel-game-ui\.js\?v=[^"']*warm-feedback-1/);
  assert.match(peelUiSource, /peel-product-visuals\.js\?v=20260902-gallery-glass-1/);
});
