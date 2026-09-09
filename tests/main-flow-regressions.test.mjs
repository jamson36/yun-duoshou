import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `应能读取 ${startMarker} 对应实现`);
  return appSource.slice(start, end);
}

test('商品详情不会让手机底部页签覆盖双操作按钮', () => {
  const interactionCss = css.slice(css.indexOf('/* Commerce interaction closure'));
  assert.match(
    interactionCss,
    /\.app\[data-focus="new"\]\[data-phone-view="detail"\] \.device-tabs\s*\{\s*display:\s*none;/,
  );
  assert.match(
    interactionCss,
    /\.app\[data-focus="new"\]\[data-phone-view="detail"\] \.commerce-detail-actions\s*\{[\s\S]*?position:\s*static;/,
  );
});

test('测试首页提供过往报告入口，并打开最近一份可恢复报告', () => {
  assert.match(html, /id="clinicHistoryButton"[^>]*hidden[^>]*>[\s\S]*?id="clinicHistoryCount"/);
  assert.match(css, /\.clinic-history-button\s*\{[\s\S]*?order:\s*5;/);
  const renderSource = sourceBetween('function renderTestHistory', 'function showToast');
  assert.match(renderSource, /const shortcutEntry = testHistory\.find\(\(item\) => restorableHistoryAssessment\(item\.assessment\)\) \|\| testHistory\[0\]/);
  assert.match(renderSource, /clinicHistoryButton\.hidden = !shortcutEntry/);
  assert.match(renderSource, /clinicHistoryButton\.dataset\.historyId = shortcutEntry\.id/);

  const listenerSource = sourceBetween(
    "clinicHistoryButton?.addEventListener('click'",
    "testHistoryList?.addEventListener('click'",
  );
  assert.match(listenerSource, /restoreTestHistoryResult\(clinicHistoryButton\.dataset\.historyId\)/);
});

test('面板进入焦点会跳过桌面端隐藏标题并落到可见内容', () => {
  const targetsSource = sourceBetween('function panelFocusTargets', 'function focusPanelEntry');
  assert.match(targetsSource, /panel === 'orders'[\s\S]*?ordersPanelTitle,[\s\S]*?recoveryOrdersTabOrders/);
  assert.match(targetsSource, /clinicView === 'report'[\s\S]*?clinicReportTitle,[\s\S]*?personalityProfile/);

  const clinicViewSource = sourceBetween('function setClinicView', 'function isAvailableFocusTarget');
  assert.match(clinicViewSource, /focusPanelEntry\('clinic'\)/);
  const applyPanelSource = sourceBetween('function applyPanel', 'function openPanel');
  assert.match(applyPanelSource, /focusPanelEntry\(activePanel\)/);
});
