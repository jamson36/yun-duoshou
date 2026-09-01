import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FEATURE_HOTSPOTS } from '../scene-config.js';
import { renderFeatureHotspotMarkup } from '../panorama.js';

const cssUrl = new URL('../styles.css', import.meta.url);
const panoramaUrl = new URL('../panorama.js', import.meta.url);

const expectedAssets = Object.freeze({
  'gym-screen': Object.freeze({
    asset: Object.freeze({ nodeId: '32:3637', src: './assets/figma-room-hotspot-clinic-4x.png', width: 190, height: 69 }),
    pixels: Object.freeze({ width: 758, height: 276 }),
  }),
  'sofa-phone': Object.freeze({
    asset: Object.freeze({ nodeId: '32:3643', src: './assets/figma-room-hotspot-new-4x.png', width: 190, height: 79 }),
    pixels: Object.freeze({ width: 757, height: 315 }),
  }),
  whiteboard: Object.freeze({
    asset: Object.freeze({ nodeId: '32:3644', src: './assets/figma-room-hotspot-goals-4x.png', width: 170, height: 71 }),
    pixels: Object.freeze({ width: 679, height: 283 }),
  }),
});

function pngDimensions(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function cssRulesFor(css, selector) {
  const rules = [];
  const source = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;

  while ((match = rulePattern.exec(source))) {
    const selectors = match[1].split(',').map((value) => value.trim());
    if (selectors.includes(selector)) rules.push(match[2]);
  }

  return rules;
}

function cssProperty(css, selector, property) {
  for (const declarations of cssRulesFor(css, selector)) {
    const match = declarations.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
    if (match) return match[1].trim();
  }
  return null;
}

function cssLastProperty(css, selector, property) {
  let value = null;
  for (const declarations of cssRulesFor(css, selector)) {
    const match = declarations.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
    if (match) value = match[1].trim();
  }
  return value;
}

function cssNumericProperty(css, selector, property) {
  const value = cssProperty(css, selector, property);
  assert.notEqual(value, null, `${selector} 必须声明 ${property}`);
  const numericValue = Number(value);
  assert.ok(Number.isFinite(numericValue), `${selector} 的 ${property} 必须是数值`);
  return numericValue;
}

test('三个功能热点绑定对应 Figma 节点的 4x PNG 导出', async () => {
  assert.equal(FEATURE_HOTSPOTS.length, 3);

  for (const hotspot of FEATURE_HOTSPOTS) {
    const expected = expectedAssets[hotspot.id];
    assert.ok(expected, `未登记的热点 ${hotspot.id}`);
    assert.deepEqual(hotspot.asset, expected.asset);

    const assetUrl = new URL(`../${hotspot.asset.src.slice(2)}`, import.meta.url);
    const bytes = await readFile(assetUrl);
    assert.deepEqual(pngDimensions(bytes), expected.pixels);
    assert.ok(expected.pixels.width >= hotspot.asset.width * 3.9);
    assert.ok(expected.pixels.height >= hotspot.asset.height * 3.9);
  }
});

test('热点使用独立的气泡、图标与文字层，并保留语义和旧视觉回退', () => {
  for (const hotspot of FEATURE_HOTSPOTS) {
    const markup = renderFeatureHotspotMarkup(hotspot);
    assert.match(markup, new RegExp(`src="${hotspot.asset.src.replaceAll('.', '\\.')}`));
    assert.match(markup, /class="hotspot-asset" aria-hidden="true"/);
    assert.match(markup, /class="hotspot-asset-bubble"/);
    assert.match(markup, /class="hotspot-asset-icon"/);
    assert.match(markup, /class="hotspot-asset-label"/);
    assert.match(markup, new RegExp(`class="hotspot-asset-label">${hotspot.label}<\\/strong>`));
    assert.match(markup, /alt=""/);
    assert.match(markup, new RegExp(`width="${hotspot.asset.width}" height="${hotspot.asset.height}"`));
    assert.match(markup, /class="hotspot-fallback"/);
    assert.match(markup, /class="hotspot-orbit"/);
    assert.match(markup, /class="hotspot-card"/);
    assert.match(markup, new RegExp(`id="${hotspot.statusId}"`));
  }

  const orderMarkup = renderFeatureHotspotMarkup(FEATURE_HOTSPOTS.find(({ id }) => id === 'sofa-phone'));
  assert.match(orderMarkup, /id="orderBadge" hidden>0<\/b>/);
});

test('热点视觉层级为气泡低于图标和文字，数量徽标最高', async () => {
  const css = await readFile(cssUrl, 'utf8');
  const bubbleZIndex = cssNumericProperty(css, '.hotspot-asset-bubble', 'z-index');
  const iconZIndex = cssNumericProperty(css, '.hotspot-asset-icon', 'z-index');
  const labelZIndex = cssNumericProperty(css, '.hotspot-asset-label', 'z-index');
  const badgeZIndex = cssNumericProperty(css, '.hotspot-badge', 'z-index');
  assert.ok(bubbleZIndex < iconZIndex, '图标必须位于气泡背景之上');
  assert.ok(bubbleZIndex < labelZIndex, '文字必须位于气泡背景之上');
  assert.ok(iconZIndex < badgeZIndex, '数量徽标必须位于图标之上');
  assert.ok(labelZIndex < badgeZIndex, '数量徽标必须位于文字之上');
});

test('开始买吧图标有独立的居中校正，不依赖整张扁平资产的偏移', async () => {
  const css = await readFile(cssUrl, 'utf8');
  const sofaIconSelector = '.scene-hotspot[data-hotspot-id="sofa-phone"] .hotspot-asset-icon';
  const sofaImageSelector = '.scene-hotspot[data-hotspot-id="sofa-phone"] .hotspot-asset-icon img';

  assert.equal(cssLastProperty(css, sofaIconSelector, 'display'), 'grid');
  assert.equal(cssLastProperty(css, sofaIconSelector, 'place-items'), 'center');
  assert.match(
    cssLastProperty(css, sofaIconSelector, 'top') || '',
    /^calc\(.*var\(--hotspot-tail-height\).*var\(--hotspot-icon-size\).*\)$/,
    '沙发手机图标容器应相对气泡内容区垂直居中',
  );
  assert.match(
    cssLastProperty(css, sofaImageSelector, 'transform') || '',
    /translateY\(/,
    '扁平资产中的手机图标应有独立视觉偏移校正',
  );
});

test('热点图片 ready 与 failed 状态互斥，回退层只在图片不可用时显示', async () => {
  const [css, panoramaSource] = await Promise.all([
    readFile(cssUrl, 'utf8'),
    readFile(panoramaUrl, 'utf8'),
  ]);

  assert.equal(
    cssProperty(css, '.scene-hotspot.is-hotspot-asset-ready .hotspot-asset', 'opacity'),
    '1',
  );
  assert.equal(
    cssProperty(css, '.scene-hotspot.is-hotspot-asset-ready .hotspot-fallback', 'display'),
    'none',
  );
  assert.match(
    cssProperty(css, '.scene-hotspot.is-hotspot-asset-failed .hotspot-asset', 'display') || '',
    /none/,
  );
  assert.match(
    cssProperty(css, '.scene-hotspot.is-hotspot-asset-failed .hotspot-fallback', 'display') || '',
    /^(?:block|inline-block|grid|flex)$/,
  );

  assert.match(
    panoramaSource,
    /classList\.add\('is-hotspot-asset-ready'\);\s*button\.classList\.remove\('is-hotspot-asset-failed'\)/,
  );
  assert.match(
    panoramaSource,
    /classList\.remove\('is-hotspot-asset-ready'\);\s*button\.classList\.add\('is-hotspot-asset-failed'\)/,
  );
});

test('热点资产元数据无效时自动只渲染旧视觉回退', () => {
  const markup = renderFeatureHotspotMarkup({
    ...FEATURE_HOTSPOTS[0],
    asset: { src: '', width: 0, height: 0 },
  });

  assert.doesNotMatch(markup, /class="hotspot-asset"/);
  assert.match(markup, /class="hotspot-fallback"/);
  assert.match(markup, /class="hotspot-orbit"/);
});
