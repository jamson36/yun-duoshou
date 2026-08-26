import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagnosisRequest, calculateGoalProgress, scorePersonality } from '../personality-scoring.js';

const NOW = new Date('2026-08-25T12:00:00+08:00');

function order(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    name: '不应发送的商品名',
    note: '不应发送的备注',
    amount: 100,
    category: '餐饮饮品',
    reason: '嘴馋',
    status: 'cooling',
    decisionSignals: [],
    createdAt: '2026-08-24T12:00:00+08:00',
    updatedAt: '2026-08-24T12:00:00+08:00',
    ...overrides,
  };
}

test('少于 3 笔时不生成消费人格', () => {
  const result = scorePersonality({ orders: [order(), order({ reason: '被种草' })], now: NOW });
  assert.equal(result.eligible, false);
  assert.equal(result.primaryPersona, null);
  assert.equal(result.confidence.level, 'insufficient');
});
test('行为证据生成五维评分、动机和人格候选', () => {
  const orders = [
    order({ id: '1', amount: 28, reason: '嘴馋', status: 'saved', decisionSignals: ['wait'], decidedAt: '2026-08-24T18:00:00+08:00' }),
    order({ id: '2', amount: 169, category: '服饰美妆', reason: '被种草', decisionSignals: ['creator', 'instant'] }),
    order({ id: '3', amount: 45, reason: '情绪不好', status: 'purchased', decisionSignals: ['comfort'], decidedAt: '2026-08-24T12:05:00+08:00' }),
    order({ id: '4', amount: 89, category: '数码家居', reason: '限时优惠', status: 'saved', decisionSignals: ['compare', 'deal'], decidedAt: '2026-08-25T08:00:00+08:00' }),
    order({ id: '5', amount: 199, category: '学习成长', reason: '自我提升', status: 'saved', decisionSignals: ['research', 'achievement'], decidedAt: '2026-08-25T10:00:00+08:00' }),
  ];
  const result = scorePersonality({ orders, now: NOW });
  assert.equal(result.eligible, true);
  assert.equal(result.orderCount, 5);
  for (const axis of Object.values(result.axes)) assert.notEqual(axis.score, null);
  assert.ok(result.primaryPersona);
  assert.equal(Object.values(result.motivations).reduce((total, motive) => total + motive.share, 0).toFixed(2), '1.00');
  assert.equal(result.outcomes.savedCount, 3);
});

test('没有研究或价格证据时返回证据不足而不是伪装为 50 分', () => {
  const result = scorePersonality({
    orders: [order({ id: '1' }), order({ id: '2' }), order({ id: '3' })],
    now: NOW,
  });
  assert.equal(result.axes.P.score, null);
  assert.equal(result.axes.R.score, null);
  assert.equal(result.axes.X.score, null);
});

test('7 天周期排除更早记录', () => {
  const recent = order({ id: 'recent', createdAt: '2026-08-24T12:00:00+08:00' });
  const old = order({ id: 'old', createdAt: '2026-08-10T12:00:00+08:00' });
  const result = scorePersonality({ orders: [recent, old], period: 7, now: NOW });
  assert.equal(result.orderCount, 1);
  assert.equal(result.totals.recorded, 100);
});

test('AI 请求只包含聚合数据，不包含商品名、备注或订单 ID', () => {
  const orders = [
    order({ id: 'secret-1', reason: '被种草' }),
    order({ id: 'secret-2', reason: '限时优惠' }),
    order({ id: 'secret-3', reason: '情绪不好' }),
  ];
  const assessment = scorePersonality({ orders, now: NOW });
  const payload = buildDiagnosisRequest({ assessment, orders, goal: { name: '去海边', amount: 3000, createdAt: '2026-08-01T00:00:00+08:00' } });
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes('不应发送的商品名'), false);
  assert.equal(serialized.includes('不应发送的备注'), false);
  assert.equal(serialized.includes('secret-1'), false);
  assert.equal(payload.goal.name, '去海边');
});

test('目标进度只统计目标创建后的确认省下', () => {
  const progress = calculateGoalProgress([
    order({ amount: 50, status: 'saved', updatedAt: '2026-07-01T12:00:00+08:00' }),
    order({ amount: 80, status: 'saved', updatedAt: '2026-08-24T12:00:00+08:00' }),
    order({ amount: 100, status: 'purchased', updatedAt: '2026-08-24T12:00:00+08:00' }),
  ], { name: '相机', amount: 1000, createdAt: '2026-08-01T00:00:00+08:00' });
  assert.equal(progress.progress, 80);
  assert.equal(progress.progressRate, 0.08);
});
