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
  assert.match(html, /styles\.css\?v=[^"']*mall-receipt-stub-1/);
});

test('商城记录卡在手机内容区居中，并取消百分比下移', () => {
  const modalRules = declarationsFor('.mall-success-modal');
  const cardRules = declarationsFor('.mall-success-card');

  assert.match(modalRules, /place-items:\s*center/);
  assert.doesNotMatch(modalRules, /--mall-success-offset/);
  assert.match(cardRules, /margin:\s*0/);
  assert.match(cardRules, /max-height:\s*min\(620px,\s*100%\)/);
});

test('顶部反馈使用纯排版回执存根，不使用表情或图标', () => {
  assert.doesNotMatch(modalMarkup, /mall-mood-icon|mall-horn-art|😂|😭/);
  assert.match(modalMarkup, /class="mall-receipt-stub"[\s\S]*?COOLING NOTE[\s\S]*?已入冷静单/);

  const stubRules = declarationsFor('.mall-receipt-stub');
  assert.match(stubRules, /grid-template-columns:\s*auto\s+minmax\(18px,\s*1fr\)\s+auto/);
  assert.match(stubRules, /border-block:\s*1px\s+dashed/);

  const confettiRules = declarationsFor('.mall-confetti-gif,\n.mall-confetti-poster');
  assert.match(confettiRules, /height:\s*clamp\(120px,\s*24%,\s*190px\)/);
  assert.match(confettiRules, /mask-image:\s*linear-gradient/);
});
