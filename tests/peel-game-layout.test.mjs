import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { renderActivityHotspotMarkup } from '../panorama.js';
import { ACTIVITY_HOTSPOTS, FEATURE_HOTSPOTS } from '../scene-config.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const refinedCss = await readFile(new URL('../peel-game-refined.css', import.meta.url), 'utf8');
const gameStart = html.indexOf('<!-- PEEL_GAME_START -->');
const gameEnd = html.indexOf('<!-- PEEL_GAME_END -->');
const gameMarkup = gameStart >= 0 && gameEnd > gameStart
  ? html.slice(gameStart, gameEnd)
  : '';

test('欲望剥壳机是独立掌机 activity，不会变成第四个顶部核心入口', () => {
  assert.equal(FEATURE_HOTSPOTS.length, 3);
  assert.equal(ACTIVITY_HOTSPOTS.length, 1);

  const [activity] = ACTIVITY_HOTSPOTS;
  assert.equal(activity.id, 'desire-peel');
  assert.equal(activity.kind, 'activity');
  assert.equal(activity.activity, 'peel');
  assert.ok(activity.label.length > 0);
  assert.ok(activity.description.length > 0);
  assert.equal(FEATURE_HOTSPOTS.some((hotspot) => hotspot.id === activity.id), false);
});

test('掌机热点使用独立可读标记和视觉结构', () => {
  const markup = renderActivityHotspotMarkup(ACTIVITY_HOTSPOTS[0]);

  assert.match(markup, /activity-hotspot-device/);
  assert.match(markup, /activity-hotspot-screen/);
  assert.match(markup, /欲望剥壳机/);
  assert.match(markup, /小游戏/);
});

test('activity 样式保持至少 44px 命中区、可见焦点和减少动态回退', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(css, /\.scene-hotspot\.is-activity\s*\{[^}]*min-width:\s*44px/s);
  assert.match(css, /\.scene-hotspot\.is-activity:focus-visible/);
  assert.match(css, /reduce-motion[^}]*activity-hotspot-device/s);
});

test('游戏对话层同时提供普通开始、可选体感和明确本地隐私说明', () => {
  assert.ok(gameMarkup.length > 0, '应有可独立审查的游戏 DOM 区块');
  assert.match(gameMarkup, /id="peelGameDialog"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(gameMarkup, /id="peelStartButton"/);
  assert.match(gameMarkup, /id="peelGestureStartButton"/);
  assert.match(gameMarkup, /主动开启[^<]*本地识别/);
  assert.match(gameMarkup, /不保存、不发送/);
  assert.match(gameMarkup, /结算时[^<]*关闭摄像头/);
  assert.match(gameMarkup, /data-focus-return="desire-peel"/);
});

test('教程说明移除推动信号但保留商品，并能直接开始正式回合', () => {
  assert.match(gameMarkup, /划过信号膜，商品会完整保留/);
  assert.match(gameMarkup, /id="peelSkipTutorialButton"[^>]*>\s*直接开始/);
});

test('Canvas 只负责视觉，键盘和屏幕阅读器使用持久语义控制器', () => {
  assert.match(gameMarkup, /<canvas[^>]*id="peelGameCanvas"[^>]*aria-hidden="true"/);
  assert.match(gameMarkup, /方向键移动刀锋[^<]*Enter[^<]*Space/);
  assert.match(gameMarkup, /id="peelPreviousTargetButton"/);
  assert.match(gameMarkup, /id="peelCurrentTarget"[^>]*>当前空中目标/);
  assert.match(gameMarkup, /id="peelCurrentTargetButton"/);
  assert.match(gameMarkup, /id="peelNextTargetButton"/);
  assert.doesNotMatch(gameMarkup, /3×3|3x3|九宫格/i);
});

test('局内状态与结算选择具备可播报、无业务手势目标的完整结构', () => {
  assert.match(gameMarkup, /id="peelShellCount"/);
  assert.match(gameMarkup, /id="peelTimeLeft"/);
  assert.match(gameMarkup, /id="peelPauseNotice"[^>]*role="status"/);
  assert.match(gameMarkup, /id="peelLiveStatus"[^>]*aria-live="polite"/);
  assert.match(gameMarkup, /id="peelSummaryCopyChoices"/);
  assert.match(gameMarkup, /如果再遇到/);
  assert.match(gameMarkup, /id="peelReminderText"/);
  assert.match(gameMarkup, /id="peelCoolButton"[^>]*data-peel-intent="cool"/);
  assert.match(gameMarkup, /id="peelDismissButton"[^>]*data-peel-intent="dismiss"/);
  assert.match(gameMarkup, /id="peelReplayButton"[^>]*data-peel-intent="replay"/);
  assert.doesNotMatch(gameMarkup, /data-gesture-target/);
});

test('游戏区不包含水果、支付、抽奖、排行或在线模型文案', async () => {
  const manifest = await readFile(new URL('../assets/peel-game/ASSET-MANIFEST.md', import.meta.url), 'utf8');
  const catalog = await readFile(new URL('../peel-game.js', import.meta.url), 'utf8');
  const inspected = `${gameMarkup}\n${manifest}\n${catalog}`;

  assert.doesNotMatch(inspected, /水果|西瓜|苹果|香蕉|抽奖|排行榜|真实支付|OpenAI|DeepSeek|provider|api[_-]?key/i);
  assert.match(manifest, /程序化绘制/);
  assert.match(manifest, /CSS 文字降级/);
});

test('掌机入口以一次性局部扫描展开，并为慢帧与减少动态提供回退', () => {
  assert.match(refinedCss, /@keyframes\s+peel-portal-reveal/);
  assert.match(refinedCss, /\.peel-game-dialog:not\(\[hidden\]\)\s+\.peel-game-backdrop[^}]*animation:\s*peel-portal-reveal/s);
  assert.match(refinedCss, /@keyframes\s+peel-card-materialize/);
  assert.match(refinedCss, /\.peel-game-dialog\[data-effect-quality="essential"\]/);
  assert.match(refinedCss, /body\.reduce-motion[^}]*peel-game-backdrop[^}]*animation:\s*none/s);
  assert.match(refinedCss, /prefers-reduced-motion:\s*reduce[\s\S]*peel-game-backdrop[^}]*animation:\s*none/s);
});
