import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { renderActivityHotspotMarkup } from '../panorama.js';
import { ACTIVITY_HOTSPOTS, FEATURE_HOTSPOTS } from '../scene-config.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const gameMarkup = html.slice(html.indexOf('<!-- PEEL_GAME_START -->'), html.indexOf('<!-- PEEL_GAME_END -->'));

test('欲望追踪任务沿用真实掌机 activity，三个主要入口保持独立', () => {
  assert.equal(FEATURE_HOTSPOTS.length, 3);
  assert.equal(ACTIVITY_HOTSPOTS.length, 1);
  const activity = ACTIVITY_HOTSPOTS[0];
  assert.equal(activity.id, 'desire-peel');
  assert.equal(activity.activity, 'peel');
  assert.equal(activity.label, '欲望追踪任务');
  assert.equal(FEATURE_HOTSPOTS.some((h) => h.id === activity.id), false);
  assert.match(renderActivityHotspotMarkup(activity), /欲望追踪任务/);
});

test('任务使用语义模态、可选手势和可访问的场景操作区', () => {
  assert.match(gameMarkup, /id="peelGameDialog"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(gameMarkup, /data-focus-return="desire-peel"/);
  assert.match(gameMarkup, /id="missionGesture"[^>]*aria-pressed="false"/);
  assert.match(gameMarkup, /<canvas[^>]*aria-hidden="true"/);
  assert.match(gameMarkup, /id="missionWorld"[^>]*role="group"[^>]*tabindex="0"/);
  assert.match(gameMarkup, /id="missionWaypoint"[^>]*type="button"/);
  assert.match(gameMarkup, /id="missionLiveStatus"[^>]*aria-live="polite"/);
  assert.match(gameMarkup, /不计时，不打分/);
  assert.doesNotMatch(gameMarkup, /data-gesture-target|observatoryPreviousProduct|observatorySignals/);
});

test('任务有明确输入替代、可见焦点和静态场景回退', async () => {
  const css = await readFile(new URL('../desire-mission.css', import.meta.url), 'utf8');
  const ui = await readFile(new URL('../desire-mission-ui.js', import.meta.url), 'utf8');
  assert.match(gameMarkup, /W\/S 前后 · A\/D 左右/);
  assert.match(gameMarkup, /点击自动前往/);
  assert.match(ui, /Tab \/ Enter/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /mission-fallback-city/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
