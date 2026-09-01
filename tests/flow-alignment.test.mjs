import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [html, css, appSource] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
]);

function sourceBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `应能读取 ${startMarker} 对应实现`);
  return appSource.slice(start, end);
}

function buttonById(id) {
  return html.match(new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?<\\/button>`))?.[0] || '';
}

test('开屏只有一个开始入口，导入与帮助不会叠进开始页面', () => {
  const gateStart = html.indexOf('<section class="room-intro-gate"');
  const gateEnd = html.indexOf('</section>', gateStart);
  assert.ok(gateStart >= 0 && gateEnd > gateStart, '应保留房间开屏门禁');
  const gate = html.slice(gateStart, gateEnd);

  assert.equal((gate.match(/<button\b/g) || []).length, 1);
  assert.match(gate, /id="enterRoomButton"[\s\S]*?<span>点击开始<\/span>/);
  assert.doesNotMatch(gate, /loadDemoButton|roomHelpButton|motionButton/);
});

test('房间顶部只保留三个核心入口且不再作为底部 dock 展示', () => {
  const nav = html.match(/<nav\b[^>]*class="[^"]*\broom-primary-nav\b[^"]*"[^>]*>[\s\S]*?<\/nav>/)?.[0] || '';
  assert.equal((nav.match(/<button\b/g) || []).length, 3);
  assert.deepEqual(
    [...nav.matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]),
    ['消费测试', '开始买吧', '回血计划'],
  );
  const navigationCss = css.slice(css.indexOf('/* 2026-09-01 confirmed navigation hierarchy'));
  assert.match(css, /\.mobile-dock\s*\{[\s\S]*?position:\s*fixed;/);
  assert.match(navigationCss, /\.room-entry-cluster\.room-primary-nav\s*\{[\s\S]*?top:[\s\S]*?bottom:\s*auto;/);
  assert.match(navigationCss, /\.app\.is-focused \.room-entry-cluster\.room-primary-nav\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?pointer-events:\s*none/);
});

test('双阶段视频无半透明叠化，业务页退出动画不拦截下一次点击', () => {
  assert.match(
    css,
    /\.intro-background-video,\s*\n\.entry-background-video\s*\{[\s\S]*?transition:\s*none;/,
  );
  assert.match(
    css,
    /\.focus-panel,\s*\n\.app:is\(\[data-focus="new"\], \[data-focus="orders"\]\) \.focus-panel\s*\{[\s\S]*?pointer-events:\s*none;/,
  );
  assert.match(
    css,
    /\.app\.is-focused \.focus-panel\s*\{[\s\S]*?pointer-events:\s*auto;/,
  );
  assert.match(
    css,
    /\.entry-loop-stage\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?visibility:\s*hidden;[\s\S]*?transition:\s*none;/,
  );
  assert.match(
    css,
    /\.panorama-app\[data-room-phase="entry"\] \.entry-loop-stage,[\s\S]*?\.panorama-app\[data-room-phase="entering"\] \.entry-loop-stage\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?visibility:\s*visible;/,
  );
  assert.match(
    css,
    /\.panorama-app\[data-room-phase="entry"\] \.room-entry-lockup\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?transition:\s*none;/,
  );
});

test('商城购物车按钮就是订单入口，不建立独立 cart 页面状态', () => {
  const handler = sourceBetween(
    "commerceOrdersButton.addEventListener('click'",
    "commerceSearchInput.addEventListener('input'",
  );
  assert.match(buttonById('commerceOrdersButton'), /aria-label="查看已下单的订单"/);
  assert.match(handler, /history\.replaceState\(\{\s*panel:\s*'orders'/);
  assert.match(handler, /'',\s*'#orders'/);
  assert.match(handler, /applyPanel\('orders'/);
  assert.doesNotMatch(handler, /['"]cart['"]|cartState|shoppingCart/i);
});

test('购买成功弹窗有可滚动建议区域，返回与分享沿用统一返回结构', () => {
  assert.match(html, /<section class="mall-success-advice"[^>]*aria-labelledby="mallSuccessAdviceTitle">[\s\S]*?<ul id="mallSuccessAdviceList" aria-live="polite">/);
  assert.match(css, /\.mall-success-card\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /\.mall-success-advice\s*\{/);

  ['panelClose', 'commerceBackButton', 'clinicReportBackButton'].forEach((id) => {
    const button = buttonById(id);
    assert.match(button, /\bapp-back\b/, `${id} 应使用标题栏返回样式`);
    assert.match(button, /\bapp-back-icon\b[\s\S]*?figma-chevron-left\.svg/, `${id} 应使用同一左箭头`);
  });
  ['mallSuccessBackButton', 'posterReturnButton'].forEach((id) => {
    const button = buttonById(id);
    assert.match(button, /\bapp-back-action\b/, `${id} 应使用内容区返回样式`);
    assert.match(button, /\bapp-back-action-icon\b/, `${id} 应保留统一箭头结构`);
  });
});

test('成功返回回到可见手机首页入口，不再聚焦隐藏小票', () => {
  const handler = sourceBetween(
    "mallSuccessBackButton.addEventListener('click'",
    "mallSuccessContinueButton.addEventListener('click'",
  );
  assert.match(handler, /phoneView:\s*'home'/);
  assert.match(handler, /showPhoneView\('home'/);
  assert.match(handler, /openMallButton\.focus/);
  assert.doesNotMatch(handler, /orderReceipt\.scrollIntoView|viewOrdersButton\.focus/);
});

test('测试结果刷新标记只消费一次并直接跳过开屏', () => {
  const boot = appSource.slice(appSource.indexOf('let returnToRoomOnLoad = false;'));
  assert.match(boot, /sessionStorage\.getItem\(RETURN_TO_ROOM_ON_LOAD_KEY\)\s*===\s*'1'/);
  assert.match(boot, /sessionStorage\.removeItem\(RETURN_TO_ROOM_ON_LOAD_KEY\)/);
  assert.match(boot, /returnToRoomOnLoad[\s\S]*?roomIntro\.skipToRoom\(\)[\s\S]*?(?:else|:)[\s\S]*?roomIntro\.start\(\)/);
});

test('演示数据至少包含三件已剁手商品并继续按金额只取最贵三件', () => {
  const loadDemoSource = sourceBetween('function daysAgo(', 'function localDateStamp');
  const reportHelpers = sourceBetween('const REPORT_IMPULSE_SIGNAL_LABELS', 'function localReportSuggestion');
  const context = {
    Date,
    Map,
    Math,
    Set,
    state: { orders: [], goals: [] },
    defaultState: () => ({ orders: [], goals: [], settings: {} }),
    window: { confirm: () => true },
    selectedGoalId: null,
    goalFormMode: 'new',
    renderedGoalId: null,
    saveState: () => true,
    renderAll: () => {},
    setMascotSpeech: () => {},
    showToast: () => {},
    localDateKey: () => '2026-09-01',
  };
  vm.runInNewContext(`${loadDemoSource}\n${reportHelpers}\nthis.api = { loadDemo, reportProductGroups };`, context);
  context.api.loadDemo();

  const purchased = context.state.orders.filter((order) => order.status === 'purchased');
  assert.ok(purchased.length >= 3, 'Demo 应保证报告至少有三件已剁手商品');
  const reportProducts = context.api.reportProductGroups(context.state.orders);
  assert.equal(reportProducts.length, 3);
  assert.ok(reportProducts.every((product, index, list) => index === 0 || list[index - 1].amount >= product.amount));
  assert.ok(reportProducts.every((product) => product.latestOrder.status === 'purchased'));
});

test('订单记录派生商城“我的商品”，分类、去重和商品事实保持同源', () => {
  const commerceSource = appSource.slice(
    appSource.indexOf('const COMMERCE_CATALOGS'),
    appSource.indexOf('function commerceTypeForOrder'),
  ) + appSource.slice(
    appSource.indexOf('function commerceTypeForOrder'),
    appSource.indexOf('const ORDER_FALLBACK_PRODUCT_BY_CATEGORY'),
  ) + appSource.slice(
    appSource.indexOf('const ORDER_FALLBACK_PRODUCT_BY_CATEGORY'),
    appSource.indexOf('const app ='),
  );
  const context = { Date, Map, Math, Object, String };
  vm.runInNewContext(`${commerceSource}\nthis.api = { commerceTypeForOrder, derivedCommerceProducts };`, context);

  assert.equal(context.api.commerceTypeForOrder({ category: '餐饮饮品' }), 'food');
  assert.equal(context.api.commerceTypeForOrder({ category: '学习成长' }), 'interest');
  assert.equal(context.api.commerceTypeForOrder({ category: '数码家居' }), 'shop');

  const orders = [
    { id: 'old', name: ' 自定义耳机 ', amount: 399, category: '数码家居', reason: '被种草', status: 'cooling', updatedAt: '2026-08-30T08:00:00.000Z' },
    { id: 'latest', name: '自定义耳机', amount: 459, category: '数码家居', reason: '限时优惠', status: 'purchased', updatedAt: '2026-09-01T08:00:00.000Z' },
    { id: 'food', name: '深夜烧烤', amount: 88, category: '餐饮饮品', reason: '嘴馋', status: 'purchased', updatedAt: '2026-09-01T09:00:00.000Z' },
  ];
  const first = context.api.derivedCommerceProducts('shop', orders);
  const second = context.api.derivedCommerceProducts('shop', structuredClone(orders));
  assert.equal(first.length, 1, '同名订单在我的商品中只能出现一次');
  assert.equal(first[0].name, '自定义耳机');
  assert.equal(first[0].price, 459);
  assert.equal(first[0].category, '数码家居');
  assert.equal(first[0].reason, '限时优惠');
  assert.equal(first[0].latestOrderId, 'latest');
  assert.equal(first[0].orderCount, 2);
  assert.equal(first[0].isOwned, true);
  assert.match(first[0].badge, /我的商品/);
  assert.equal(first[0].id, second[0].id, '同一订单商品应得到稳定 id');
  assert.equal(context.api.derivedCommerceProducts('food', orders)[0].latestOrderId, 'food');
});

test('购买成功建议默认确定性生成三条，只有新鲜且已同意的报告可增强文字', () => {
  const adviceSource = sourceBetween('function mallSuccessAdviceItems', 'function showMallSuccess');
  const context = {
    Set,
    state: { orders: [], diagnosis: { result: { action: { steps: ['报告建议 A', '报告建议 B'] } } } },
    activeClinicPeriod: 30,
    scorePersonality: () => ({ eligible: true }),
    aiConsentIsCurrent: () => false,
    diagnosisIsFreshFor: () => true,
  };
  vm.runInNewContext(`${adviceSource}\nthis.mallSuccessAdviceItems = mallSuccessAdviceItems;`, context);
  const product = { name: '相机' };
  const order = { name: '相机', amount: 2380, category: '数码家居', reason: '被种草' };
  const localFirst = context.mallSuccessAdviceItems(product, order, { eligible: true });
  const localSecond = context.mallSuccessAdviceItems(product, order, { eligible: true });
  assert.deepEqual([...localFirst], [...localSecond]);
  assert.equal(localFirst.length, 3);
  assert.doesNotMatch(localFirst.join(''), /报告建议/);

  context.aiConsentIsCurrent = () => true;
  const enriched = context.mallSuccessAdviceItems(product, order, { eligible: true });
  assert.deepEqual([...enriched.slice(0, 2)], ['报告建议 A', '报告建议 B']);
  context.diagnosisIsFreshFor = () => false;
  assert.doesNotMatch(context.mallSuccessAdviceItems(product, order, { eligible: true }).join(''), /报告建议/);
});

test('历史记录恢复使用当次快照并切换到可分享的报告视图', () => {
  const assessment = {
    eligible: true,
    period: 7,
    primaryPersona: { id: 'persona' },
    totals: {},
    axes: {},
    motivations: {},
    confidence: {},
    categories: [],
    reasons: [],
    evidence: [],
  };
  const calls = [];
  const context = {
    testHistory: [{ id: 'history-1', assessment }],
    activeClinicPeriod: 30,
    activePanel: 'clinic',
    clinicView: 'report',
    restoredTestHistory: null,
    currentAssessment: null,
    personalityProfileRenderSignature: 'stale',
    aiUiState: { status: 'success' },
    cancelAiRequest: (reason) => calls.push(['cancel', reason]),
    closeGachaponResult: (options) => calls.push(['close', options]),
    clearPoster: () => calls.push(['poster']),
    renderClinic: (snapshot) => calls.push(['render', snapshot]),
    pushClinicView: (view, options) => calls.push(['view', view, options]),
    showToast: (message) => calls.push(['toast', message]),
  };
  const snapshotHelpers = sourceBetween('function restorableHistoryAssessment', 'function serializeReportProductGroups');
  const restoreSource = sourceBetween('function restoreTestHistoryResult', 'function renderTestHistory');
  vm.runInNewContext(`${snapshotHelpers}\n${restoreSource}\nthis.restoreTestHistoryResult = restoreTestHistoryResult;`, context);

  assert.equal(context.restoreTestHistoryResult('history-1'), true);
  assert.equal(context.activeClinicPeriod, 7);
  assert.notEqual(context.currentAssessment, assessment, '恢复时应复制快照，避免历史内容被当前报告改写');
  assert.deepEqual(
    JSON.parse(JSON.stringify(calls.find(([name]) => name === 'view'))),
    ['view', 'report', { replaceCurrent: true }],
  );
  assert.deepEqual(calls.find(([name]) => name === 'render')[1], context.currentAssessment);

  const historyListener = sourceBetween(
    "testHistoryList?.addEventListener('click'",
    "orderForm.querySelectorAll('input[name=\"decisionSignals\"]')",
  );
  assert.match(historyListener, /closest\('\[data-history-id\]'\)/);
  assert.match(historyListener, /restoreTestHistoryResult\(button\.dataset\.historyId\)/);
});

test('报告页恢复历史时替换同路由记录，Esc 不会被重复报告页拦住', () => {
  const pushSource = sourceBetween('function pushClinicView', 'function navigateBackWithinClinic');
  assert.match(pushSource, /replaceCurrent\s*=\s*false/);
  assert.match(pushSource, /replaceCurrent\s*\?\s*'replaceState'\s*:\s*'pushState'/);
  assert.match(pushSource, /openedByApp:\s*replaceCurrent\s*\?\s*Boolean\(history\.state\?\.openedByApp\)\s*:\s*true/);

  const restoreSource = sourceBetween('function restoreTestHistoryResult', 'function renderTestHistory');
  assert.match(restoreSource, /replaceCurrent:\s*activePanel\s*===\s*'clinic'\s*&&\s*clinicView\s*===\s*'report'/);
});

test('新建当前目标会替换同范围旧目标、保留演示目标并清理旧订单关联', () => {
  const replaceSource = sourceBetween('function replaceGoalForScope', 'function setGoal');
  const context = { Set };
  vm.runInNewContext(`${replaceSource}\nthis.replaceGoalForScope = replaceGoalForScope;`, context);
  const draft = {
    goals: [
      { id: 'personal-old', name: '旧个人目标', demo: false },
      { id: 'demo-goal', name: '演示目标', demo: true },
    ],
    activeGoalId: 'personal-old',
    orders: [
      { id: 'personal-order', goalId: 'personal-old' },
      { id: 'demo-order', goalId: 'demo-goal', demo: true },
    ],
  };
  context.replaceGoalForScope(draft, { id: 'personal-new', name: '新个人目标', demo: false });

  assert.deepEqual(JSON.parse(JSON.stringify(draft.goals.map(({ id }) => id))), ['demo-goal', 'personal-new']);
  assert.equal(draft.activeGoalId, 'personal-new');
  assert.equal(draft.orders[0].goalId, undefined);
  assert.equal(draft.orders[1].goalId, 'demo-goal');
  assert.match(sourceBetween('function setGoal', 'function setMonthlyGoalPreset'), /replaceGoalForScope\(draft, savedGoal\)/);
  assert.match(sourceBetween('function setMonthlyGoalPreset', 'function focusGoalForm'), /replaceGoalForScope\(draft, savedGoal\)/);
});
