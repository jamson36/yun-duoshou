import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const html = read('index.html');
const css = read('peel-game-refined.css');

test('切一刀使用独立暖色样式、房间背景和购物篮', () => {
  assert.match(html, /peel-game-refined\.css\?v=20260909-slice-2/);
  assert.match(css, /warm-room\.png/);
  assert.match(css, /basket\.svg/);
  assert.match(html, /sticker-preview\.svg/);
  for (const asset of ['warm-room.png', 'basket.svg', 'sticker-preview.svg']) {
    assert.ok(readFileSync(new URL(`../assets/peel-game/${asset}`, import.meta.url)).length > 100);
  }
});

test('引导说明分类商品切割并保留摄像头选择', () => {
  const markup = html.slice(html.indexOf('<!-- PEEL_GAME_START -->'), html.indexOf('<!-- PEEL_GAME_END -->'));
  assert.match(markup, />切一刀</);
  assert.match(markup, /外卖、购物、兴趣/);
  assert.match(markup, /切成两半/);
  assert.match(markup, /主动开启体感/);
  assert.doesNotMatch(markup, /欲望剥壳|信号膜|完整保留/);
});

test('入口、手势和游戏视觉加载更新版本', () => {
  assert.match(html, /app\.js\?v=20260909-slice-2/);
  assert.match(read('app.js'), /peel-game-ui\.js\?v=20260909-slice-2/);
  assert.match(read('app.js'), /gesture-ui\.js\?v=20260909-slice-2/);
  assert.match(read('peel-game-ui.js'), /peel-product-visuals\.js\?v=20260909-slice-2/);
});
