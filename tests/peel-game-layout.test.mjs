import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { renderActivityHotspotMarkup } from '../panorama.js';
import { ACTIVITY_HOTSPOTS, FEATURE_HOTSPOTS } from '../scene-config.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const refinedCss = await readFile(new URL('../desire-observatory.css', import.meta.url), 'utf8');
const gameStart = html.indexOf('<!-- PEEL_GAME_START -->');
const gameEnd = html.indexOf('<!-- PEEL_GAME_END -->');
const gameMarkup = gameStart >= 0 && gameEnd > gameStart
  ? html.slice(gameStart, gameEnd)
  : '';

test('欲望观察舱是独立掌机 activity，不会变成第四个顶部核心入口', () => {
  assert.equal(FEATURE_HOTSPOTS.length, 3);
  assert.equal(ACTIVITY_HOTSPOTS.length, 1);

  const [activity] = ACTIVITY_HOTSPOTS;
  assert.equal(activity.id, 'desire-peel');
  assert.equal(activity.kind, 'activity');
  assert.equal(activity.activity, 'peel');
  assert.equal(activity.label, '欲望观察舱');
  assert.ok(activity.label.length > 0);
  assert.ok(activity.description.length > 0);
  assert.equal(FEATURE_HOTSPOTS.some((hotspot) => hotspot.id === activity.id), false);
});

test('掌机热点使用独立可读标记和视觉结构', () => {
  const markup = renderActivityHotspotMarkup(ACTIVITY_HOTSPOTS[0]);

  assert.match(markup, /activity-hotspot-device/);
  assert.match(markup, /activity-hotspot-screen/);
  assert.match(markup, /欲望观察舱/);
  assert.match(markup, /小游戏/);
});

test('activity 样式保持至少 44px 命中区、可见焦点和减少动态回退', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(css, /\.scene-hotspot\.is-activity\s*\{[^}]*min-width:\s*44px/s);
  assert.match(css, /\.scene-hotspot\.is-activity:focus-visible/);
  assert.match(css, /reduce-motion[^}]*activity-hotspot-device/s);
});

test('观察舱打开即提供稳定商品信息、可选手势和本地隐私说明', () => {
  assert.ok(gameMarkup.length > 0, '应有可独立审查的观察舱 DOM 区块');
  assert.match(gameMarkup, /id="peelGameDialog"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(gameMarkup, /id="observatoryProductName"/);
  assert.match(gameMarkup, /id="observatoryProductPrice"/);
  assert.match(gameMarkup, /id="observatoryGestureButton"[^>]*aria-pressed="false"/);
  assert.match(gameMarkup, /主动开启[^<]*本地识别/);
  assert.match(gameMarkup, /不保存、不发送/);
  assert.match(gameMarkup, /data-focus-return="desire-peel"/);
});

test('观察舱没有倒计时、分数或胜负，并让用户主动关闭催促信号', () => {
  assert.match(gameMarkup, /没有倒计时/);
  assert.match(gameMarkup, /id="observatorySignals"/);
  assert.doesNotMatch(gameMarkup, /剩余时间|本局识别|再来一局|得分|胜利|失败/);
});

test('Canvas 只负责 3D 视觉，键盘和屏幕阅读器使用持久语义控制器', () => {
  assert.match(gameMarkup, /<canvas[^>]*id="observatoryCanvas"[^>]*aria-hidden="true"/);
  assert.match(gameMarkup, /左右方向键切换商品，上下方向键调整镜头高度/);
  assert.match(gameMarkup, /直接点击画面中的信号塔/);
  assert.match(gameMarkup, /id="observatoryPreviousProduct"/);
  assert.match(gameMarkup, /id="observatoryNextProduct"/);
  assert.match(gameMarkup, /id="observatoryCoolButton"/);
  assert.doesNotMatch(gameMarkup, /3×3|3x3|九宫格/i);
});

test('镜头拖动不会吞掉左右商品按钮，明确滑动才切换展位', async () => {
  const observatory = await readFile(new URL('../desire-observatory.js', import.meta.url), 'utf8');

  assert.match(observatory, /event\.target\?\.closest\?\.\('button, a, input, select, textarea, \[role="button"\]'\)/);
  assert.match(observatory, /swipeDirectionForDistance/);
  assert.match(observatory, /renderer\?\.pickSignal/);
});

test('观察状态与业务交接具备可播报、无业务手势目标的完整结构', () => {
  assert.match(gameMarkup, /id="observatorySignalCount"/);
  assert.match(gameMarkup, /id="observatoryPauseNotice"[^>]*role="status"/);
  assert.match(gameMarkup, /id="observatoryLiveStatus"[^>]*aria-live="polite"/);
  assert.match(gameMarkup, /id="observatoryQuestion"/);
  assert.match(gameMarkup, /24 小时后/);
  assert.match(gameMarkup, /id="observatoryCoolButton"[^>]*data-peel-intent="cool"/);
  assert.match(gameMarkup, /id="observatoryDismissButton"[^>]*data-peel-intent="dismiss"/);
  assert.doesNotMatch(gameMarkup, /data-gesture-target/);
});

test('观察舱不包含水果、支付、抽奖、排行或在线模型文案', async () => {
  const [observatory, scene] = await Promise.all([
    readFile(new URL('../desire-observatory.js', import.meta.url), 'utf8'),
    readFile(new URL('../desire-observatory-scene.js', import.meta.url), 'utf8'),
  ]);
  const inspected = `${gameMarkup}\n${observatory}\n${scene}`;

  assert.doesNotMatch(inspected, /水果|西瓜|苹果|香蕉|抽奖|排行榜|真实支付|OpenAI|DeepSeek|provider|api[_-]?key/i);
  assert.match(scene, /TextureLoader/);
  assert.match(scene, /PerspectiveCamera/);
  assert.match(refinedCss, /observatory-fallback-object/);
});

test('掌机入口以一次性局部扫描展开，并为慢帧与减少动态提供回退', () => {
  assert.match(refinedCss, /@keyframes\s+observatory-portal-reveal/);
  assert.match(refinedCss, /\.observatory-dialog:not\(\[hidden\]\)\s+\.observatory-backdrop[^}]*animation:\s*observatory-portal-reveal/s);
  assert.match(refinedCss, /@keyframes\s+observatory-shell-enter/);
  assert.match(refinedCss, /\.observatory-dialog\[data-quality="essential"\]/);
  assert.match(refinedCss, /body\.reduce-motion[\s\S]*\.observatory-backdrop/);
  assert.match(refinedCss, /prefers-reduced-motion:\s*reduce[\s\S]*\.observatory-backdrop/);
});
