import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCORING_MODEL_VERSION,
  buildDiagnosisRequest,
  calculateGoalProgress,
  scorePersonality,
} from '../personality-scoring.js';

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
    order({ id: 'secret-1', reason: '被种草', decisionSignals: ['creator'] }),
    order({ id: 'secret-2', reason: '被种草', decisionSignals: ['creator'] }),
    order({ id: 'secret-3', reason: '被种草', decisionSignals: ['creator'] }),
    order({ id: 'secret-demo-1', name: '演示秘密商品', demo: true, amount: 9, decisionSignals: ['stock'] }),
    order({ id: 'secret-demo-2', demo: true, amount: 19, decisionSignals: ['stock'] }),
    order({ id: 'secret-demo-3', demo: true, amount: 29, decisionSignals: ['stock'] }),
  ];
  const assessment = scorePersonality({ orders, now: NOW });
  const payload = buildDiagnosisRequest({ assessment, orders, goal: { name: '去海边', amount: 3000, createdAt: '2026-08-01T00:00:00+08:00' } });
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes('不应发送的商品名'), false);
  assert.equal(serialized.includes('不应发送的备注'), false);
  assert.equal(serialized.includes('secret-1'), false);
  assert.equal(Object.hasOwn(payload.goal, 'name'), false);
  assert.equal(serialized.includes('去海边'), false);
  assert.equal(payload.scoringModelVersion, 'wallet-personality-rules-1.3.0');
  assert.equal(payload.source, 'personal');
  assert.equal(payload.excludedDemoCount, 3);
  assert.equal(payload.presentationSignals.orderCount, 3);
  assert.equal(payload.personaCandidates.some((candidate) => candidate.id === 'seeded_sprinter'), true);
  assert.equal(payload.personaCandidates.some((candidate) => candidate.id === 'stock_collector'), false);
  assert.equal(serialized.includes('演示秘密商品'), false);
});

test('AI 目标摘要只发送数值进度，污染的目标名不进入 JSON', () => {
  const privateGoalName = '私密商品名伪装目标';
  const orders = [
    order({ id: 'goal-private-1', goalId: 'private-goal', amount: 100, status: 'saved' }),
    order({ id: 'goal-private-2', goalId: 'private-goal', amount: 80, status: 'saved' }),
    order({ id: 'goal-private-3', goalId: 'private-goal', amount: 120, status: 'purchased' }),
  ];
  const assessment = scorePersonality({ orders, now: NOW });
  const payload = buildDiagnosisRequest({
    assessment,
    orders,
    goal: {
      id: 'private-goal',
      name: privateGoalName,
      note: '目标的私密备注',
      amount: 1000,
      createdAt: '2026-08-01T00:00:00+08:00',
    },
  });

  assert.deepEqual(payload.goal, {
    targetAmount: 1000,
    progress: 180,
    progressRate: 0.18,
  });
  assert.deepEqual(Object.keys(payload.goal), ['targetAmount', 'progress', 'progressRate']);
  assert.doesNotMatch(JSON.stringify(payload), /私密商品名伪装目标|目标的私密备注|private-goal/);
});

test('被污染的分类和原因归一为其他，不进入聚合请求或证据', () => {
  const privateCategory = '私密商品名伪装分类';
  const privateReason = '私密备注伪装原因';
  const orders = [
    order({ id: 'polluted-1', category: privateCategory, reason: privateReason }),
    order({ id: 'polluted-2', category: privateCategory, reason: privateReason }),
    order({ id: 'polluted-3', category: privateCategory, reason: privateReason }),
  ];

  const assessment = scorePersonality({ orders, now: NOW });
  const payload = buildDiagnosisRequest({ assessment, orders });
  const evidenceText = JSON.stringify(assessment.evidence);
  const serialized = JSON.stringify(payload);

  assert.deepEqual(assessment.categories, [{ category: '其他', count: 3, amount: 300 }]);
  assert.deepEqual(assessment.reasons, [{ reason: '其他', count: 3 }]);
  assert.deepEqual(payload.categories, [{ category: '其他', count: 3, amount: 300 }]);
  assert.deepEqual(payload.reasons, [{ reason: '其他', count: 3 }]);
  assert.match(evidenceText, /其他/);
  assert.doesNotMatch(evidenceText, /私密商品名伪装分类|私密备注伪装原因/);
  assert.doesNotMatch(serialized, /私密商品名伪装分类|私密备注伪装原因/);
});

test('AI 请求对展示信号和本地人格候选执行字段白名单与最多三条裁剪', () => {
  const assessment = scorePersonality({
    orders: [
      order({ id: 'candidate-1', reason: '被种草', decisionSignals: ['creator'] }),
      order({ id: 'candidate-2', reason: '被种草', decisionSignals: ['creator'] }),
      order({ id: 'candidate-3', reason: '被种草', decisionSignals: ['creator'] }),
    ],
    now: NOW,
  });
  assessment.presentationSignals = {
    ...assessment.presentationSignals,
    nightWindow: 'secret-window',
    smallSpendLimit: 999,
    orderId: 'private-order-id',
    createdAt: '2026-08-24T23:00:00+08:00',
  };
  assessment.personaCandidates = [
    { id: 'one', name: '候选一', fitScore: 91, rationale: '理由一', eligible: true, orderId: 'private-1' },
    { id: 'two', name: '候选二', fitScore: 82, rationale: '理由二', secret: '不应发送' },
    { id: 'three', name: '候选三', fitScore: 73, rationale: '理由三', evidence: [{ orderId: 'private-3' }] },
    { id: 'four', name: '候选四', fitScore: 64, rationale: '理由四' },
  ];

  const payload = buildDiagnosisRequest({ assessment });

  assert.deepEqual(Object.keys(payload.presentationSignals), [
    'source',
    'purpose',
    'orderCount',
    'nightCount',
    'nightRate',
    'smallSpendCount',
    'smallSpendRate',
    'medianAmount',
  ]);
  assert.equal(payload.presentationSignals.source, 'aggregated_local_orders');
  assert.equal(payload.presentationSignals.purpose, 'presentation_only');
  assert.equal(payload.personaCandidates.length, 3);
  assert.deepEqual(payload.personaCandidates.map((candidate) => Object.keys(candidate)), [
    ['id', 'name', 'fitScore', 'rationale'],
    ['id', 'name', 'fitScore', 'rationale'],
    ['id', 'name', 'fitScore', 'rationale'],
  ]);
  assert.deepEqual(payload.personaCandidates.map((candidate) => candidate.id), ['one', 'two', 'three']);
  assert.doesNotMatch(JSON.stringify(payload), /secret-window|private-order-id|private-[123]|不应发送|候选四/);
});

test('AI 请求按画像来源双向隔离个人目标与演示目标', () => {
  const personalOrders = [
    order({ id: 'personal-1', goalId: 'personal-goal' }),
    order({ id: 'personal-2', goalId: 'personal-goal' }),
    order({ id: 'personal-3', goalId: 'personal-goal' }),
  ];
  const demoOrders = [
    order({ id: 'demo-1', demo: true, goalId: 'demo-goal' }),
    order({ id: 'demo-2', demo: true, goalId: 'demo-goal' }),
    order({ id: 'demo-3', demo: true, goalId: 'demo-goal' }),
  ];
  const personalAssessment = scorePersonality({ orders: personalOrders, now: NOW });
  const demoAssessment = scorePersonality({ orders: demoOrders, now: NOW });

  const personalWithDemoGoal = buildDiagnosisRequest({
    assessment: personalAssessment,
    orders: [...personalOrders, ...demoOrders],
    goal: { id: 'demo-goal', name: '演示目标', amount: 1000, demo: true },
  });
  const demoWithPersonalGoal = buildDiagnosisRequest({
    assessment: demoAssessment,
    orders: [...personalOrders, ...demoOrders],
    goal: { id: 'personal-goal', name: '个人目标', amount: 1000, demo: false },
  });

  assert.equal(personalAssessment.source, 'personal');
  assert.equal(demoAssessment.source, 'demo');
  assert.equal(personalWithDemoGoal.goal, null);
  assert.equal(demoWithPersonalGoal.goal, null);
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

test('多目标进度只统计明确分配给当前目标的确认省下', () => {
  const progress = calculateGoalProgress([
    order({ id: 'a', amount: 50, status: 'saved', goalId: 'goal-a', updatedAt: '2026-08-24T12:00:00+08:00' }),
    order({ id: 'b', amount: 80, status: 'saved', goalId: 'goal-b', updatedAt: '2026-08-24T12:00:00+08:00' }),
    order({ id: 'c', amount: 20, status: 'saved', updatedAt: '2026-08-24T12:00:00+08:00' }),
  ], { id: 'goal-a', name: '相机', amount: 1000, createdAt: '2026-08-01T00:00:00+08:00' });
  assert.equal(progress.progress, 50);
  assert.equal(progress.progressRate, 0.05);
});

test('演示目标与个人目标的进度互不混入', () => {
  const orders = [
    order({ id: 'personal', amount: 50, status: 'saved', goalId: 'goal-a', demo: false }),
    order({ id: 'demo', amount: 80, status: 'saved', goalId: 'goal-a', demo: true }),
  ];
  const personal = calculateGoalProgress(orders, { id: 'goal-a', name: '个人目标', amount: 1000, demo: false });
  const demo = calculateGoalProgress(orders, { id: 'goal-a', name: '演示目标', amount: 1000, demo: true });
  assert.equal(personal.progress, 50);
  assert.equal(demo.progress, 80);

  const explicitDemoSource = calculateGoalProgress(orders, {
    id: 'goal-a', name: '显式演示目标', amount: 1000, source: 'demo', demo: false,
  });
  assert.equal(explicitDemoSource.progress, 80);
});

test('演示记录可独立画像，但同周期存在个人记录时必须排除演示记录', () => {
  const demoOrders = [
    order({ id: 'demo-1', demo: true, amount: 25, status: 'saved' }),
    order({ id: 'demo-2', demo: true, amount: 35, status: 'purchased', reason: '被种草' }),
    order({ id: 'demo-3', demo: true, amount: 45, status: 'saved', reason: '限时优惠' }),
  ];
  const demoAssessment = scorePersonality({ orders: demoOrders, now: NOW });

  assert.equal(demoAssessment.eligible, true);
  assert.ok(demoAssessment.primaryPersona);
  assert.equal(demoAssessment.dataMode, 'demo');
  assert.equal(demoAssessment.source, 'demo');
  assert.equal(demoAssessment.excludedDemoCount, 0);

  const personalAssessment = scorePersonality({
    orders: [...demoOrders, order({ id: 'personal-1', demo: false, amount: 80, category: '学习成长' })],
    now: NOW,
  });

  assert.equal(personalAssessment.eligible, false);
  assert.equal(personalAssessment.orderCount, 1);
  assert.equal(personalAssessment.totals.recorded, 80);
  assert.equal(personalAssessment.categories[0].category, '学习成长');
  assert.equal(personalAssessment.dataMode, 'personal');
  assert.equal(personalAssessment.source, 'personal');
  assert.equal(personalAssessment.excludedDemoCount, 3);
  assert.notEqual(personalAssessment.dataMode, 'mixed');
});

test('同一订单重复命中同一事件时硬门槛只计一次，证据贡献仍分别累积', () => {
  const result = scorePersonality({
    orders: [
      order({ id: 'deal-overlap', reason: '限时优惠', decisionSignals: ['compare', 'deal'] }),
      order({ id: 'neutral-1', reason: '其他' }),
      order({ id: 'neutral-2', reason: '其他' }),
    ],
    now: NOW,
  });

  assert.equal(result.axes.P.evidenceCount, 3);
  assert.equal(result.personaCandidates.some((persona) => persona.id === 'deal_actuary'), false);
});

test('钱包主题优先采用笔数最高的品类，金额只用于同笔数排序', () => {
  const result = scorePersonality({
    orders: [
      order({ id: 'food-1', amount: 10, category: '餐饮饮品' }),
      order({ id: 'food-2', amount: 12, category: '餐饮饮品' }),
      order({ id: 'food-3', amount: 15, category: '餐饮饮品' }),
      order({ id: 'digital-1', amount: 1000, category: '数码家居' }),
    ],
    now: NOW,
  });

  assert.equal(result.categories[0].category, '餐饮饮品');
  assert.equal(result.categories[0].count, 3);
  assert.equal(result.walletTheme, '奶茶股东型选手');

  const tiedByCount = scorePersonality({
    orders: [
      order({ id: 'food-tie-1', amount: 10, category: '餐饮饮品' }),
      order({ id: 'food-tie-2', amount: 12, category: '餐饮饮品' }),
      order({ id: 'digital-tie-1', amount: 300, category: '数码家居' }),
      order({ id: 'digital-tie-2', amount: 500, category: '数码家居' }),
    ],
    now: NOW,
  });

  assert.equal(tiedByCount.categories[0].category, '数码家居');
  assert.equal(tiedByCount.walletTheme, '参数上头研究员');
});

test('同一版本与同一输入可确定性复算', () => {
  const orders = [
    order({ id: 'stable-1', amount: 49, reason: '被种草', decisionSignals: ['creator'], createdAt: '2026-08-22T12:00:00+08:00' }),
    order({ id: 'stable-2', amount: 89, reason: '限时优惠', decisionSignals: ['compare'], createdAt: '2026-08-23T12:00:00+08:00' }),
    order({ id: 'stable-3', amount: 129, reason: '自我提升', decisionSignals: ['research'], createdAt: '2026-08-24T12:00:00+08:00' }),
    order({ id: 'demo-excluded', demo: true, amount: 999, createdAt: '2026-08-25T08:00:00+08:00' }),
  ];

  const first = scorePersonality({ orders, now: NOW });
  const second = scorePersonality({ orders: structuredClone(orders), now: new Date(NOW), period: 30 });

  assert.equal(SCORING_MODEL_VERSION, 'wallet-personality-rules-1.3.0');
  assert.deepEqual(second, first);
});

test('趣味卡面信号仅输出本地聚合计数、占比和中位金额', () => {
  const localNow = new Date(2026, 7, 25, 12);
  const result = scorePersonality({
    orders: [
      order({ id: 'signal-1', name: '秘密商品一', amount: 18, createdAt: new Date(2026, 7, 24, 23).toISOString() }),
      order({ id: 'signal-2', name: '秘密商品二', amount: 28, createdAt: new Date(2026, 7, 24, 22).toISOString() }),
      order({ id: 'signal-3', name: '秘密商品三', amount: 48, createdAt: new Date(2026, 7, 23, 1).toISOString() }),
    ],
    now: localNow,
  });

  assert.deepEqual(result.presentationSignals, {
    source: 'aggregated_local_orders',
    purpose: 'presentation_only',
    orderCount: 3,
    nightWindow: '22:00-05:59',
    nightCount: 3,
    nightRate: 1,
    smallSpendLimit: 50,
    smallSpendCount: 3,
    smallSpendRate: 1,
    medianAmount: 28,
  });
  assert.doesNotMatch(JSON.stringify(result.presentationSignals), /秘密商品|signal-|2026-/);
});
