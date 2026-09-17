import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { scorePersonality } from '../personality-scoring.js';
import { resolvePersonaPresentation } from '../persona-presentations.js';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const now = new Date(2026, 8, 17, 12);
class ReportDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
}

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

function order(id, amount, status, { daysAgo = 1, ...extra } = {}) {
  const createdAt = new Date(2026, 8, 17 - daysAgo, 10).toISOString();
  return {
    id, name: id, amount, status, createdAt,
    decidedAt: status === 'cooling' ? null : createdAt,
    category: '数码家居', reason: '被种草', decisionSignals: ['creator'], demo: false,
    ...extra,
  };
}

function reportHarness(orders) {
  const scheduled = [];
  const results = [];
  const toasts = [];
  const context = {
    Date: ReportDate,
    state: { orders, dataRevision: 1, clinicDemoOrders: [order('旧的临时演示', 9999, 'purchased', { demo: true })] },
    activePanel: 'clinic', activeClinicPeriod: 30, currentAssessment: null,
    restoredTestHistory: { id: 'old-history' },
    localGachaponSpinSequence: 0, localGachaponSpinning: false, localGachaponSpinTimer: null,
    clockClinicAssessmentFingerprint: '', clinicRenderPending: false, aiUiState: {},
    analyzeButton: {},
    scorePersonality,
    assessmentReportFingerprint: (assessment) => JSON.stringify(assessment),
    clearPoster: () => {}, closeGachaponResult: () => {}, renderClinic: () => {},
    gachaponIsBusy: () => context.localGachaponSpinning,
    gachaponMachine: { classList: { remove: () => {} } },
    gachaponMotion: { setState: () => {} }, aiCard: { setAttribute: () => {} },
    document: { body: { classList: { contains: () => true } } },
    window: { setTimeout: (callback) => scheduled.push(callback) },
    openGachaponResult: () => { results.push(context.currentAssessment); return true; },
    showToast: (message) => toasts.push(message),
  };
  vm.runInNewContext(`
    ${functionSource('startClinicTest', 'exactCommerceProductForOrder')}
    ${functionSource('startLocalGachaponReveal', 'closeGachaponResult')}
    this.api = { startClinicTest, clinicPeriodOrders };
  `, context);
  return {
    context, results, toasts,
    start() {
      context.api.startClinicTest();
      scheduled.splice(0).forEach((callback) => callback());
    },
  };
}

test('测试从冷静单全部状态计算，重复测试不生成订单或改变人格', () => {
  const orders = [order('待冷静', 11, 'cooling'), order('回血', 22, 'saved'), order('已购', 33, 'purchased')];
  const before = JSON.stringify(orders);
  const harness = reportHarness(orders);
  harness.start();
  harness.start();
  assert.equal(harness.results.length, 2);
  const [first, second] = harness.results;
  assert.equal(first.source, 'personal');
  assert.equal(first.orderCount, 3);
  assert.equal(first.totals.recorded, 66);
  assert.equal(first.totals.saved, 22);
  assert.equal(first.totals.purchased, 33);
  assert.equal(first.totals.coolingCount, 1);
  assert.deepEqual(second, first);
  assert.deepEqual(resolvePersonaPresentation(second), resolvePersonaPresentation(first));
  assert.equal(JSON.stringify(orders), before);
  assert.equal(harness.context.restoredTestHistory, null);
  assert.ok(harness.toasts.every((message) => !message.includes('演示')));
});

test('空记录和不足三笔时不生成报告，也不用遗留演示数据补足', () => {
  for (const count of [0, 1, 2]) {
    const orders = Array.from({ length: count }, (_, i) => order(`商品${i}`, 20, 'purchased'));
    const harness = reportHarness(orders);
    harness.start();
    assert.equal(harness.context.currentAssessment.orderCount, count);
    assert.equal(harness.context.currentAssessment.eligible, false);
    assert.equal(harness.results.length, 0);
    assert.equal(orders.length, count);
  }
});

test('报告与商品区按同一近 7 / 30 天筛选，排除删除、未来和过期记录', () => {
  const orders = [
    order('今天', 10, 'purchased', { daysAgo: 0 }),
    order('七天边界', 20, 'saved', { daysAgo: 6 }),
    order('八天前', 30, 'purchased', { daysAgo: 7 }),
    order('上月仍在三十天内', 40, 'purchased', { daysAgo: 17 }),
    order('三十天边界', 50, 'cooling', { daysAgo: 29 }),
    order('三十天外', 60, 'purchased', { daysAgo: 30 }),
    order('已删除', 70, 'purchased', { deletedAt: now.toISOString() }),
    order('未来', 80, 'purchased', { daysAgo: -1 }),
    order('无效日期', 90, 'purchased', { createdAt: 'invalid' }),
    order('无效金额', Infinity, 'purchased'),
  ];
  const harness = reportHarness(orders);
  for (const [period, names] of [[7, ['今天', '七天边界']], [30, ['今天', '七天边界', '八天前', '上月仍在三十天内', '三十天边界']]]) {
    const selected = harness.context.api.clinicPeriodOrders(period, 'personal', now);
    const assessment = scorePersonality({ orders, period, now });
    assert.deepEqual(Array.from(selected, ({ name }) => name), names);
    assert.equal(assessment.orderCount, selected.length);
    assert.equal(assessment.totals.recorded, selected.reduce((sum, item) => sum + item.amount, 0));
  }
});

test('明确导入的演示记录保留标记，有个人记录时不混入或补足', () => {
  const demo = [1, 2, 3].map((i) => order(`演示${i}`, i * 100, 'purchased', { demo: true }));
  const harness = reportHarness(demo);
  harness.start();
  assert.equal(harness.results[0].source, 'demo');
  assert.match(harness.toasts[0], /演示/);
  assert.equal(harness.context.api.clinicPeriodOrders(30, 'demo', now).length, 3);
  harness.context.state.orders = [...demo, order('个人', 10, 'purchased')];
  harness.start();
  assert.equal(harness.results.length, 1, '不能用演示样本补足三笔门槛');
  assert.equal(harness.context.currentAssessment.source, 'personal');
  assert.equal(harness.context.currentAssessment.orderCount, 1);
  assert.equal(harness.context.currentAssessment.excludedDemoCount, 3);
  assert.deepEqual(Array.from(harness.context.api.clinicPeriodOrders(30, 'personal', now), ({ name }) => name), ['个人']);
});

test('订单状态纠正和删除后重新测试使用最新记录', () => {
  const orders = [order('商品1', 100, 'purchased'), order('商品2', 50, 'saved'), order('商品3', 20, 'cooling'), order('商品4', 10, 'cooling')];
  const harness = reportHarness(orders);
  harness.start();
  orders[0].status = 'saved';
  orders[1].deletedAt = now.toISOString();
  harness.context.state.dataRevision += 1;
  harness.start();
  assert.equal(harness.results[1].totals.purchased, 0);
  assert.equal(harness.results[1].totals.saved, 100);
  assert.equal(harness.results[1].orderCount, 3);
  assert.equal(harness.results[0].totals.purchased, 100, '已生成的结果不被后来纠正的状态覆盖');
});

test('浏览历史报告时定时刷新和跨日不能用当前订单替换快照', () => {
  const clock = {};
  const context = {
    Date, Intl,
    activePanel: 'clinic', activeClinicPeriod: 30,
    clockDateSignature: '', clockClinicAssessmentFingerprint: 'historical-snapshot',
    state: { orders: [], diagnosis: null }, aiUiState: {},
    historicalReportContextFor: () => ({ id: 'saved-report' }),
    localDateKey: (value) => value.toISOString().slice(0, 10),
    document: { querySelector: () => clock, querySelectorAll: () => [] },
    scorePersonality: () => { assert.fail('历史报告不重新评分'); },
    renderClinic: () => { assert.fail('不能覆盖历史报告视图'); },
    cancelAiRequest: () => {}, setAiDiagnosisInvalidatedForSession: () => {},
    persistAiDiagnosis: () => {}, closeGachaponResult: () => {}, clearPoster: () => {},
  };
  vm.runInNewContext(`${functionSource('updateClock', 'syncReducedMotionPreference')}\nthis.updateClock = updateClock;`, context);
  context.updateClock(now);
  context.updateClock(new Date(now.getTime() + 31_000));
  context.updateClock(new Date(now.getTime() + 86_400_000));
  assert.equal(context.clockClinicAssessmentFingerprint, 'historical-snapshot');
  assert.ok(clock.textContent, '时钟仍正常刷新');
});
