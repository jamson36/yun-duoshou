import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { ACTIVITY_HOTSPOTS } from '../scene-config.js';

const radiansToDegrees = (value) => (value * 180) / Math.PI;

test('欲望观察舱入口锚定在全景原图的书桌掌机上', () => {
  const [activity] = ACTIVITY_HOTSPOTS;
  const sourceU = 0.5 - (activity.yaw / (Math.PI * 2));
  const sourceV = 0.5 - (activity.pitch / Math.PI);

  assert.equal(activity.eyebrow, '书桌 · 掌机');
  assert.ok(Math.abs((sourceU * 8192) - 6124) < 12, '横向锚点应落在书桌掌机中心');
  assert.ok(Math.abs((sourceV * 4096) - 2226) < 12, '纵向锚点应落在书桌掌机中心');
  assert.ok(Math.abs(radiansToDegrees(activity.focus.yaw) + 89.1) < 0.5);
  assert.ok(Math.abs(radiansToDegrees(activity.focus.pitch) + 7.8) < 0.5);
});

test('书桌入口复用场景中的真实掌机，不再叠加 CSS 假掌机', async () => {
  const css = await readFile(new URL('../desire-observatory.css', import.meta.url), 'utf8');

  assert.match(css, /\.activity-hotspot-screen,[\s\S]*?\.activity-hotspot-controls\s*\{\s*display:\s*none;/);
  assert.match(css, /\.activity-hotspot-device\s*\{[\s\S]*?background:[\s\S]*?linear-gradient/);
});
