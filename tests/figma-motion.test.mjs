import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

test('Make 可读的悬浮、扫描、轨道、弹出和淡入参数保持一致', () => {
  assert.ok(css.includes('@keyframes figma-floaty { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }'));
  assert.match(css, /figma-floaty 4s ease-in-out infinite/);
  assert.match(css, /@keyframes figma-scanline\s*\{\s*from\s*\{\s*top:\s*0;\s*\}\s*to\s*\{\s*top:\s*100%;\s*\}\s*\}/s);
  assert.match(css, /figma-scanline 1\.4s linear infinite/);
  assert.match(css, /animation:\s*hotspot-orbit 24s linear infinite/);
  assert.match(css, /figma-pop-in \.35s cubic-bezier\(\.34, 1\.56, \.64, 1\) both/);
  assert.match(css, /figma-fade-up \.4s ease both/);
});

test('系统或站内减少动态效果会停用本轮循环与进入动画', () => {
  assert.match(css, /body\.reduce-motion[\s\S]*?gachapon-machine[\s\S]*?animation:\s*none !important/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?gachapon-machine[\s\S]*?animation:\s*none !important/);
});

test('日期焦点与成功反馈使用可辨识的高对比样式', () => {
  assert.match(css, /\.goal-date-day:focus-visible\s*\{\s*outline:\s*3px solid var\(--ink\)/);
  assert.match(css, /\.mall-success-actions button:last-child\s*\{[^}]*background:\s*#a93818;[^}]*color:\s*#fff;/);
  assert.match(css, /\.gachapon-stage \.consent-summary span\s*\{\s*color:\s*#655b54;/);
  assert.match(css, /#aiConsentCheckbox:focus-visible\s*\{[\s\S]*?outline:\s*3px solid #171717;/);
  assert.match(css, /\.category-shortcuts button:focus-visible,[\s\S]*?outline:\s*3px solid #171717;/);
  assert.match(css, /\.commerce-search:focus-within\s*\{\s*outline:\s*3px solid #171717;/);
  assert.match(css, /\.ai-card-content button:focus-visible,[\s\S]*?\.gachapon-action:focus-visible,[\s\S]*?\.period-switch button:focus-visible\s*\{\s*outline:\s*3px solid #171717;/);
  assert.match(css, /\.ai-card-content \.ai-disclaimer,[\s\S]*?color:\s*#574f49;/);
  assert.match(css, /\.ai-fallback > span,[\s\S]*?background:\s*#812d1d;[\s\S]*?color:\s*#fff8f4;/);
});

test('移动端保留可达的演示数据入口', () => {
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?#loadDemoButton\s*\{[\s\S]*?display:\s*inline-flex;/);
});

test('复诊请求进行中仍保留可操作的撤回入口', () => {
  assert.match(html, /id="revokeAiConsentButton"/);
  assert.match(css, /\.ai-card\[data-gachapon-state="spinning"\] \.ai-card-content\s*\{\s*display:\s*block;/);
  assert.match(css, /\.ai-revoke:focus-visible[\s\S]*?outline:\s*3px solid #171717;/);
  assert.doesNotMatch(css, /data-gachapon-state="confirm"/);
});

test('回血计划三个页面使用同一切换动画且剁手清单不再继承手机放大', () => {
  assert.match(appSource, /function beginRecoverySwitch\(/);
  assert.match(appSource, /function switchRecoveryView\(/);
  assert.match(css, /\.app\.is-focusing \.panel-view\[data-panel="orders"\]\.phone-device\.is-active\s*\{\s*animation:\s*figma-route-in/);
  assert.match(css, /\.app\.is-recovery-switch \.panel-view\[data-panel="orders"\] \.wishlist-surface,[\s\S]*?\.goals-tab-view\.is-active\s*\{\s*animation:\s*recovery-page-in \.32s/);
  assert.doesNotMatch(css.slice(css.lastIndexOf('/* Recovery transitions')), /phone-device-expand/);
});

test('人格扭蛋接入真实碰撞控制器并完整处理生命周期', () => {
  assert.match(html, /class="gachapon-chamber"/);
  assert.equal((html.match(/class="gachapon-token\s+is-/g) || []).length, 6);
  for (const asset of ['shopping', 'food', 'drink', 'headphones', 'shoes', 'game']) {
    assert.match(html, new RegExp(`class="gachapon-token is-${asset}"><img src="\\.\\/assets\\/gachapon-ball-${asset}\\.png"`));
  }
  assert.match(appSource, /createGachaponMotion\(\{/);
  assert.match(appSource, /gachaponMotion\.setState\(machineState\)/);
  assert.match(appSource, /gachaponMotion\.setActive\(activePanel === 'clinic'\)/);
  assert.match(appSource, /gachaponMotion\.setReducedMotion\(shouldReduceMotion\)/);
  assert.match(appSource, /gachaponMotion\.destroy\(\)/);
  assert.match(appSource, /machineState === 'ready' \|\| machineState === 'locked' \|\| machineState === 'spinning'/);
  assert.match(css, /\.gachapon-machine\.is-physics-active \.gachapon-token\s*\{[\s\S]*?will-change:\s*left, top, transform;/);
  assert.doesNotMatch(css, /gachapon-machine\s*>\s*:not\(img\)[\s\S]*?display:\s*none\s*!important/);
  assert.match(css, /\.gachapon-machine\s*\{\s*aspect-ratio:\s*560\s*\/\s*684;/);
  assert.match(css, /\.panel-view\[data-panel="clinic"\]\[data-clinic-view="start"\] \.gachapon-chamber,[\s\S]*?\.gachapon-token\s*\{\s*visibility:\s*visible;/);
});
