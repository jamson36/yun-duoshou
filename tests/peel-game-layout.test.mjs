import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { renderActivityHotspotMarkup } from '../panorama.js';
import { ACTIVITY_HOTSPOTS, FEATURE_HOTSPOTS } from '../scene-config.js';

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
