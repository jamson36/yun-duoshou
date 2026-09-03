import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const markup = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

function sourceBetween(startNeedle, endNeedle) {
  const start = appSource.indexOf(startNeedle);
  const end = appSource.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, `missing source start: ${startNeedle}`);
  assert.ok(end > start, `missing source end: ${endNeedle}`);
  return appSource.slice(start, end);
}

test('业务确认不再调用浏览器原生提示框', () => {
  assert.doesNotMatch(appSource, /window\.(?:confirm|alert|prompt)\s*\(/);
});

test('站内确认票据提供语义、动态文案与安全默认操作', () => {
  assert.match(markup, /id="siteConfirmDialog"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(markup, /aria-labelledby="siteConfirmTitle"/);
  assert.match(markup, /aria-describedby="siteConfirmDescription"/);
  assert.match(markup, /id="siteConfirmEyebrow"/);
  assert.match(markup, /id="siteConfirmTitle"/);
  assert.match(markup, /id="siteConfirmDescription"/);
  assert.match(markup, /id="siteConfirmNote"[^>]*role="note"/);
  assert.match(markup, /id="siteConfirmCancelButton"[^>]*autofocus/);
  assert.match(markup, /id="siteConfirmAcceptButton"/);
});

test('确认票据支持安全取消、遮罩取消、焦点恢复和内容纯文本写入', () => {
  const controller = sourceBetween('function finishSiteConfirmation(', 'function setAiConsentRevocationFallback(');
  assert.match(controller, /siteConfirmTitle\.textContent\s*=/);
  assert.match(controller, /siteConfirmDescription\.textContent\s*=/);
  assert.match(controller, /siteConfirmDialog\.showModal\(\)/);
  assert.match(controller, /siteConfirmCancelButton\.focus\(/);
  assert.match(controller, /returnFocus\.focus\(/);

  const listeners = sourceBetween("analyzeButton.addEventListener('click'", "resetRoomViewButton.addEventListener('click'");
  assert.match(listeners, /siteConfirmCancelButton\.addEventListener\('click'/);
  assert.match(listeners, /siteConfirmDialog\.addEventListener\('cancel'/);
  assert.match(listeners, /event\.target\s*===\s*siteConfirmDialog/);
});

test('删除小票、撕掉目标和替换演示数据复用站内确认票据', () => {
  const deleteOrder = sourceBetween('async function deleteOrder(', 'function updateOrderStatus(');
  const removeGoal = sourceBetween('async function removeGoalNote(', 'function setActiveGoal(');
  const loadDemo = sourceBetween('async function loadDemo(', 'function localDateStamp(');

  for (const source of [deleteOrder, removeGoal, loadDemo]) {
    assert.match(source, /await requestSiteConfirmation\(/);
  }
  assert.match(deleteOrder, /tone:\s*'danger'/);
  assert.match(removeGoal, /tone:\s*'danger'/);
  assert.match(loadDemo, /tone:\s*'warning'/);
  assert.match(appSource, /deleteOrder\(button\.dataset\.orderId,\s*button\)/);
  assert.match(appSource, /removeGoalNote\(deleteGoalButton\)/);
});

test('确认票据有危险与提醒变体、移动端安全边距和减少动态效果', () => {
  assert.match(styles, /\.site-confirm-dialog\s*\{/);
  assert.match(styles, /\.site-confirm-card\[data-tone="danger"\]/);
  assert.match(styles, /\.site-confirm-card\[data-tone="warning"\]/);
  assert.match(styles, /@media \(max-width:\s*520px\)[\s\S]*?\.site-confirm-dialog/);
  assert.match(styles, /body\.reduce-motion[\s\S]*?\.site-confirm-card/);
});
