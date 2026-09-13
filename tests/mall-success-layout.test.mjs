import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const modalStart = html.indexOf('<section class="mall-success-modal"');
const modalEnd = html.indexOf('</section>', html.indexOf('mall-success-note', modalStart));
const modalMarkup = html.slice(modalStart, modalEnd);

function declarationsFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
    .map((match) => match[1])
    .join('\n');
}

test('商城记录弹层不在回执卡外渲染漂浮话术', () => {
  assert.ok(modalStart >= 0, '应保留商城记录弹层');
  assert.doesNotMatch(modalMarkup, /mall-static-barrage/);
  assert.match(html, /styles\.css\?v=[^"']*clinic-report-2/);
});

test('商城记录卡在手机内容区居中，并取消百分比下移', () => {
  const modalRules = declarationsFor('.mall-success-modal');
  const cardRules = declarationsFor('.mall-success-card');

  assert.match(modalRules, /place-items:\s*center/);
  assert.doesNotMatch(modalRules, /--mall-success-offset/);
  assert.match(cardRules, /margin:\s*0/);
  assert.match(cardRules, /max-height:\s*min\(620px,\s*100%\)/);
});

test('成功卡使用 Figma 喇叭徽章并保留背景动效与建议', () => {
  assert.match(modalMarkup, /mall-success-emblem[\s\S]*?mall-horn-poster.png/);
  assert.match(modalMarkup, /<details class="mall-success-advice"/);
  assert.match(modalMarkup, /id="mallConfettiGif"/);
});
