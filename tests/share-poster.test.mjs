import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildShareCaption,
  buildSharePosterModel,
  copyShareCaption,
  downloadSharePoster,
  renderSharePoster,
} from '../share-poster.js';
import {
  CANONICAL_PERSONAS,
  FIGMA_PERSONA_CARD_IDS,
  FIGMA_PERSONA_CARDS,
  getAllowedPersonaCardIds,
  getPersonaCardFamily,
  isFigmaPersonaCardId,
  resolvePersonaPresentation,
} from '../persona-presentations.js';
import { scorePersonality } from '../personality-scoring.js';

const canonicalRows = [
  ['sovereign_researcher', '研究主权者', 'saving_dreamer'],
  ['deal_actuary', '优惠精算师', 'price_lover'],
  ['seeded_sprinter', '种草冲锋手', 'impulse_hunter'],
  ['sensory_healer', '氛围疗愈师', 'atmosphere'],
  ['social_resonator', '社交共鸣者', 'refined_player'],
  ['micro_achiever', '微观成就家', 'hobby'],
  ['minimal_buffer', '极简缓冲者', 'cart_stayer'],
  ['stock_collector', '收藏囤货派', 'stockpiler'],
  ['balanced_observer', '平衡洞察者', 'rollercoaster'],
  ['desire_observer', '欲望观察员', 'wallet_drifter'],
];

function readPngIhdr(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'IHDR');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

test('20 套 Figma 卡面资源唯一、字段完整且保留原始名称', () => {
  const cards = Object.values(FIGMA_PERSONA_CARDS);
  assert.equal(cards.length, 20);
  assert.equal(new Set(cards.map((item) => item.id)).size, 20);
  assert.equal(new Set(cards.map((item) => item.sourceName)).size, 20);
  assert.equal(new Set(cards.map((item) => item.art)).size, 20);
  cards.forEach((item) => {
    assert.match(item.art, /^assets\/persona-figma-[a-z-]+\.png$/);
    assert.equal(item.gradient.length, 2);
    assert.match(item.accent, /^#[0-9a-f]{6}$/i);
    assert.ok(item.quote.length > 8);
    assert.equal(item.tags.length, 2);
  });
  assert.deepEqual(cards.map((item) => item.art).sort(), [
    'assets/persona-figma-atmosphere.png',
    'assets/persona-figma-buy-crazy.png',
    'assets/persona-figma-cart-stayer.png',
    'assets/persona-figma-flip-flop.png',
    'assets/persona-figma-food-delivery.png',
    'assets/persona-figma-hobby.png',
    'assets/persona-figma-impulse-hunter.png',
    'assets/persona-figma-joy-wholesaler.png',
    'assets/persona-figma-limited-deal.png',
    'assets/persona-figma-milk-tea.png',
    'assets/persona-figma-night-shopper.png',
    'assets/persona-figma-price-lover.png',
    'assets/persona-figma-rational-survivor.png',
    'assets/persona-figma-refined-player.png',
    'assets/persona-figma-reward-spender.png',
    'assets/persona-figma-rollercoaster.png',
    'assets/persona-figma-saving-dreamer.png',
    'assets/persona-figma-small-spend.png',
    'assets/persona-figma-stockpiler.png',
    'assets/persona-figma-wallet-drifter.png',
  ]);
});

test('20 套 Figma 人格插图均为可用于高清卡面和海报的 4x PNG', async () => {
  const cards = Object.values(FIGMA_PERSONA_CARDS);
  const dimensions = await Promise.all(cards.map(async (item) => {
    const buffer = await readFile(new URL(`../${item.art}`, import.meta.url));
    return [item.id, readPngIhdr(buffer)];
  }));

  dimensions.forEach(([cardId, { width, height }]) => {
    assert.ok(
      Math.min(width, height) >= 850,
      `${cardId} 插图分辨率仅 ${width}x${height}，短边必须至少为 850px`,
    );
  });
});

test('带身份或羞辱风险的 Figma 原名只用于追溯，展示名已经安全改写', () => {
  const expected = {
    buy_crazy: ['买买买狂人', '心动采购官'],
    refined_player: ['精致穷玩家', '精致生活玩家'],
    joy_wholesaler: ['成年人快乐批发商', '快乐批发商'],
    wallet_drifter: ['钱包摆烂侠', '钱包随心侠'],
    night_shopper: ['深夜剁手怪', '夜间心动客'],
    hobby: ['兴趣氪金怪', '兴趣投入家'],
    rational_survivor: ['理智幸存者', '冷静幸存者'],
  };
  Object.entries(expected).forEach(([id, [sourceName, displayName]]) => {
    assert.equal(FIGMA_PERSONA_CARDS[id].sourceName, sourceName);
    assert.equal(FIGMA_PERSONA_CARDS[id].displayName, displayName);
  });
});

test('九类主人格与欲望观察员都稳定映射到 Figma 卡面，但不改变权威名称', () => {
  assert.equal(Object.keys(CANONICAL_PERSONAS).length, 10);
  canonicalRows.forEach(([id, name, expectedCard]) => {
    const presentation = resolvePersonaPresentation({
      primaryPersona: { id, name, fitScore: 77, rationale: `${name}的可追溯依据。` },
    });
    assert.deepEqual(presentation.canonical, {
      id,
      name,
      fitScore: 77,
      rationale: `${name}的可追溯依据。`,
    });
    assert.equal(presentation.card.id, expectedCard);
  });
});

test('分类和聚合结果只切换趣味卡面，不会改变主人格', () => {
  const cases = [
    [{ id: 'deal_actuary', name: '优惠精算师' }, { reasons: [{ reason: '限时优惠', count: 2 }] }, 'limited_deal'],
    [{ id: 'seeded_sprinter', name: '种草冲锋手' }, { outcomes: { purchaseRate: 0.8 } }, 'buy_crazy'],
    [{ id: 'sensory_healer', name: '氛围疗愈师' }, { reasons: [{ reason: '嘴馋', count: 2 }] }, 'milk_tea'],
    [{ id: 'sensory_healer', name: '氛围疗愈师' }, { categories: [{ category: '餐饮饮品', count: 2 }] }, 'food_delivery'],
    [{ id: 'sensory_healer', name: '氛围疗愈师' }, { reasons: [{ reason: '情绪不好', count: 2 }] }, 'reward_spender'],
    [{ id: 'social_resonator', name: '社交共鸣者' }, { categories: [{ category: '娱乐社交', count: 3 }] }, 'joy_wholesaler'],
    [{ id: 'minimal_buffer', name: '极简缓冲者' }, { outcomes: { savedCountRate: 0.8 } }, 'rational_survivor'],
    [{ id: 'balanced_observer', name: '平衡洞察者' }, { outcomes: { reversalRate: 0.25 } }, 'flip_flop'],
    [{ id: 'sovereign_researcher', name: '研究主权者' }, { outcomes: { medianDecisionHours: 36 } }, 'cart_stayer'],
  ];
  cases.forEach(([primaryPersona, facts, expectedCard]) => {
    const presentation = resolvePersonaPresentation({ primaryPersona, ...facts });
    assert.equal(presentation.canonical.id, primaryPersona.id);
    assert.equal(presentation.canonical.name, primaryPersona.name);
    assert.equal(presentation.card.id, expectedCard);
  });
});

test('已知 canonical id 时错误传入名称不能覆盖权威名称', () => {
  const presentation = resolvePersonaPresentation({
    primaryPersona: {
      id: 'deal_actuary',
      name: '错误的外部名称',
      fitScore: 81,
      rationale: '评分层提供的聚合依据。',
    },
  });
  assert.deepEqual(presentation.canonical, {
    id: 'deal_actuary',
    name: '优惠精算师',
    fitScore: 81,
    rationale: '评分层提供的聚合依据。',
  });
});

test('没有夜间或小额聚合证据时不会自动分配对应卡面', () => {
  const automaticallySelected = canonicalRows.map(([id, name]) => resolvePersonaPresentation({
    primaryPersona: { id, name },
  }).card.id);
  assert.ok(FIGMA_PERSONA_CARDS.night_shopper);
  assert.ok(FIGMA_PERSONA_CARDS.small_spend);
  assert.equal(automaticallySelected.includes('night_shopper'), false);
  assert.equal(automaticallySelected.includes('small_spend'), false);

  const belowThreshold = resolvePersonaPresentation({
    primaryPersona: { id: 'desire_observer', name: '欲望观察员' },
    presentationSignals: {
      source: 'aggregated_local_orders', purpose: 'presentation_only', orderCount: 4,
      nightCount: 2, nightRate: 0.5, smallSpendCount: 2, smallSpendRate: 0.5,
    },
  });
  assert.equal(belowThreshold.card.id, 'wallet_drifter');
});

test('夜间和小额聚合门槛只覆盖趣味卡面，规则人格保持不变', () => {
  const base = {
    primaryPersona: { id: 'sovereign_researcher', name: '任意错误名称', fitScore: 76, rationale: '本地评分依据。' },
  };
  const night = resolvePersonaPresentation({
    ...base,
    presentationSignals: {
      source: 'aggregated_local_orders', purpose: 'presentation_only', orderCount: 5,
      nightCount: 3, nightRate: 0.6, smallSpendCount: 0, smallSpendRate: 0,
    },
  });
  const small = resolvePersonaPresentation({
    ...base,
    presentationSignals: {
      source: 'aggregated_local_orders', purpose: 'presentation_only', orderCount: 5,
      nightCount: 0, nightRate: 0, smallSpendCount: 4, smallSpendRate: 0.8,
    },
  });

  assert.equal(night.canonical.id, 'sovereign_researcher');
  assert.equal(night.canonical.name, '研究主权者');
  assert.equal(night.card.id, 'night_shopper');
  assert.equal(small.canonical.id, 'sovereign_researcher');
  assert.equal(small.canonical.name, '研究主权者');
  assert.equal(small.card.id, 'small_spend');
});

test('原始订单经过本地评分后可确定性选中夜间与小额卡面', () => {
  const localNow = new Date(2026, 7, 25, 12);
  const rawOrder = (id, amount, createdAt) => ({
    id,
    name: `不进入聚合的商品 ${id}`,
    amount,
    category: '其他',
    reason: '其他',
    status: 'cooling',
    decisionSignals: [],
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
  });
  const nightAssessment = scorePersonality({
    orders: [
      rawOrder('night-1', 180, new Date(2026, 7, 24, 23)),
      rawOrder('night-2', 220, new Date(2026, 7, 24, 22)),
      rawOrder('night-3', 260, new Date(2026, 7, 23, 1)),
    ],
    now: localNow,
  });
  const smallAssessment = scorePersonality({
    orders: [
      rawOrder('small-1', 18, new Date(2026, 7, 24, 10)),
      rawOrder('small-2', 28, new Date(2026, 7, 23, 12)),
      rawOrder('small-3', 48, new Date(2026, 7, 22, 14)),
    ],
    now: localNow,
  });

  const nightPresentation = resolvePersonaPresentation(nightAssessment);
  const smallPresentation = resolvePersonaPresentation(smallAssessment);
  assert.equal(nightAssessment.primaryPersona.id, 'desire_observer');
  assert.equal(nightPresentation.card.id, 'night_shopper');
  assert.equal(smallAssessment.primaryPersona.id, 'desire_observer');
  assert.equal(smallPresentation.card.id, 'small_spend');
});

test('九类规则人格的结构化变体加两个聚合门槛可覆盖全部 20 张卡面', () => {
  const cases = [
    ['sovereign_researcher', {}, 'saving_dreamer'],
    ['sovereign_researcher', { outcomes: { medianDecisionHours: 24 } }, 'cart_stayer'],
    ['deal_actuary', {}, 'price_lover'],
    ['deal_actuary', { reasons: [{ reason: '限时优惠', count: 2 }] }, 'limited_deal'],
    ['seeded_sprinter', {}, 'impulse_hunter'],
    ['seeded_sprinter', { outcomes: { purchaseRate: 0.67 } }, 'buy_crazy'],
    ['sensory_healer', {}, 'atmosphere'],
    ['sensory_healer', { reasons: [{ reason: '嘴馋', count: 2 }] }, 'milk_tea'],
    ['sensory_healer', { categories: [{ category: '餐饮饮品', count: 2 }] }, 'food_delivery'],
    ['sensory_healer', { reasons: [{ reason: '情绪不好', count: 2 }] }, 'reward_spender'],
    ['social_resonator', {}, 'refined_player'],
    ['social_resonator', { categories: [{ category: '娱乐社交', count: 2 }] }, 'joy_wholesaler'],
    ['micro_achiever', {}, 'hobby'],
    ['minimal_buffer', { outcomes: { savedCountRate: 0.6 } }, 'rational_survivor'],
    ['stock_collector', {}, 'stockpiler'],
    ['balanced_observer', {}, 'rollercoaster'],
    ['balanced_observer', { outcomes: { reversalRate: 0.15 } }, 'flip_flop'],
    ['desire_observer', {}, 'wallet_drifter'],
    ['desire_observer', { presentationSignals: {
      source: 'aggregated_local_orders', purpose: 'presentation_only', orderCount: 3,
      nightCount: 3, nightRate: 1, smallSpendCount: 0, smallSpendRate: 0,
    } }, 'night_shopper'],
    ['desire_observer', { presentationSignals: {
      source: 'aggregated_local_orders', purpose: 'presentation_only', orderCount: 3,
      nightCount: 0, nightRate: 0, smallSpendCount: 3, smallSpendRate: 1,
    } }, 'small_spend'],
  ];
  const selected = cases.map(([id, facts, expected]) => {
    const presentation = resolvePersonaPresentation({
      primaryPersona: { id, name: '不可覆盖的名称' },
      ...facts,
    });
    assert.equal(presentation.card.id, expected);
    return presentation.card.id;
  });
  assert.equal(new Set(selected).size, 20);
});

test('未知或缺失主人格 id 必须安全回退到欲望观察员', () => {
  const unknown = resolvePersonaPresentation({
    primaryPersona: { id: 'online_invented', name: '网络发明人格', fitScore: 99, rationale: '不可信。' },
  });
  const missing = resolvePersonaPresentation({ primaryPersona: { name: '优惠精算师', fitScore: 88 } });
  [unknown, missing].forEach((presentation) => {
    assert.equal(presentation.canonical.id, 'desire_observer');
    assert.equal(presentation.canonical.name, '欲望观察员');
    assert.equal(presentation.canonical.fitScore, 0);
    assert.equal(presentation.card.id, 'wallet_drifter');
  });
});

test('混合人格只使用固定 20 卡枚举和规则人格卡族', () => {
  assert.equal(FIGMA_PERSONA_CARD_IDS.length, 20);
  assert.equal(new Set(FIGMA_PERSONA_CARD_IDS).size, 20);
  assert.equal(FIGMA_PERSONA_CARD_IDS.every((cardId) => isFigmaPersonaCardId(cardId)), true);
  assert.equal(isFigmaPersonaCardId('online_invented'), false);
  assert.deepEqual(getPersonaCardFamily('deal_actuary'), ['price_lover', 'limited_deal']);
  assert.deepEqual(getPersonaCardFamily('online_invented'), []);

  const assessment = {
    primaryPersona: { id: 'sovereign_researcher' },
    secondaryPersona: { id: 'deal_actuary' },
    personaCandidates: [
      { id: 'social_resonator' },
      { id: 'micro_achiever' },
      { id: 'balanced_observer' },
      { id: 'stock_collector' },
    ],
  };
  const allowed = getAllowedPersonaCardIds(assessment);
  assert.equal(allowed.includes('saving_dreamer'), true);
  assert.equal(allowed.includes('limited_deal'), true);
  assert.equal(allowed.includes('joy_wholesaler'), true);
  assert.equal(allowed.includes('hobby'), true);
  assert.equal(allowed.includes('flip_flop'), true);
  assert.equal(allowed.includes('stockpiler'), false, '只开放 personaCandidates 前三名的卡族');
});

test('非法卡、低置信度和不足两条独立证据都回退本地卡', () => {
  const assessment = {
    primaryPersona: { id: 'deal_actuary', fitScore: 78 },
  };
  const invalidCandidates = [
    { cardId: 'online_invented', confidence: 0.99, evidenceIds: ['top-axis', 'top-reason'] },
    { cardId: 'limited_deal', confidence: 0.54, evidenceIds: ['top-axis', 'top-reason'] },
    { cardId: 'limited_deal', confidence: 0.95, evidenceIds: ['top-axis', 'top-axis'] },
  ];

  invalidCandidates.forEach((candidate) => {
    const presentation = resolvePersonaPresentation(assessment, { candidates: [candidate] });
    assert.equal(presentation.card.id, 'price_lover');
    assert.equal(presentation.localCard.id, 'price_lover');
    assert.equal(presentation.decision, 'local');
    assert.equal(presentation.inference, null);
  });
});

test('模型候选按输入顺序选择首个本地允许卡，并只保留安全字段', () => {
  const assessment = {
    primaryPersona: { id: 'sovereign_researcher', fitScore: 81, rationale: '本地规则依据。' },
    secondaryPersona: { id: 'deal_actuary' },
  };
  const presentation = resolvePersonaPresentation(assessment, {
    persona: '网络发明人格',
    candidates: [
      { cardId: 'stockpiler', confidence: 0.98, rationale: '不属于允许家族。', evidenceIds: ['top-axis', 'top-reason'] },
      {
        cardId: 'limited_deal',
        confidence: 0.8764,
        rationale: '  优惠证据与规则人格一致。  ',
        evidenceIds: ['top-reason', 'record-count', 'top-reason'],
        displayName: '不可覆盖的网络名称',
      },
      { cardId: 'price_lover', confidence: 0.99, rationale: '不应越过更早的有效候选。', evidenceIds: ['top-axis', 'top-reason'] },
    ],
  });

  assert.equal(presentation.canonical.name, '研究主权者');
  assert.equal(presentation.localCard.id, 'saving_dreamer');
  assert.equal(presentation.card.id, 'limited_deal');
  assert.equal(presentation.decision, 'hybrid');
  assert.deepEqual(presentation.inference, {
    cardId: 'limited_deal',
    confidence: 0.876,
    rationale: '优惠证据与规则人格一致。',
    evidenceIds: ['top-reason', 'record-count'],
  });
  assert.equal('displayName' in presentation.inference, false);
});

test('夜间与小额模型卡仍必须先通过本地聚合硬门槛', () => {
  const base = {
    primaryPersona: { id: 'desire_observer' },
    presentationSignals: {
      source: 'aggregated_local_orders', purpose: 'presentation_only', orderCount: 5,
      nightCount: 3, nightRate: 0.6, smallSpendCount: 2, smallSpendRate: 0.4,
    },
  };
  const inference = {
    candidates: [
      { cardId: 'small_spend', confidence: 0.92, evidenceIds: ['record-count', 'small-spend-rate'] },
      { cardId: 'night_shopper', confidence: 0.84, evidenceIds: ['record-count', 'night-rate'] },
    ],
  };
  const presentation = resolvePersonaPresentation(base, inference);
  assert.deepEqual(getAllowedPersonaCardIds(base), ['wallet_drifter', 'night_shopper']);
  assert.equal(presentation.localCard.id, 'night_shopper');
  assert.equal(presentation.card.id, 'night_shopper');
  assert.equal(presentation.decision, 'hybrid');
  assert.equal(presentation.inference.cardId, 'night_shopper');
});

test('在线解释 result 不能覆盖本地权威人格与建议', () => {
  const model = buildSharePosterModel({
    assessment: {
      period: 7,
      primaryPersona: { id: 'deal_actuary', name: '优惠精算师', fitScore: 84, rationale: '会主动拆解价格。' },
      localAdvice: '限时的是优惠，不是你的决定时间。',
      orderCount: 5,
      confidence: { score: 67, level: 'forming' },
    },
    result: {
      persona: '网络发明人格',
      advice: '立即付款。',
      orders: [{ name: '不应出现的商品' }],
    },
  });
  assert.equal(model.personaId, 'deal_actuary');
  assert.equal(model.persona, '优惠精算师');
  assert.equal(model.fitScore, 84);
  assert.equal(model.advice, '限时的是优惠，不是你的决定时间。');
  assert.doesNotMatch(JSON.stringify(model), /网络发明人格|立即付款|不应出现的商品/);
});

test('分享海报接收已解析的综合人格，趣味人格为主标题且规则人格保持底座', () => {
  const assessment = {
    period: 30,
    source: 'personal',
    primaryPersona: {
      id: 'sovereign_researcher',
      name: '不可覆盖的规则名称',
      fitScore: 81,
      rationale: '本地记录显示会先研究再决定。',
    },
    secondaryPersona: { id: 'deal_actuary' },
    orderCount: 6,
    confidence: { score: 74, level: 'stable' },
  };
  const presentation = resolvePersonaPresentation(assessment, {
    candidates: [{
      cardId: 'limited_deal',
      confidence: 0.876,
      rationale: '优惠证据与研究倾向共同支持这张趣味卡。',
      evidenceIds: ['E1', 'E2'],
    }],
  });
  const model = buildSharePosterModel({ assessment, presentation });

  assert.equal(model.funPersona, '限时优惠上头客');
  assert.equal(model.visualTheme.cardId, 'limited_deal');
  assert.equal(model.persona, '研究主权者');
  assert.equal(model.canonicalPersona.name, '研究主权者');
  assert.equal(model.localVisualTheme.cardId, 'saving_dreamer');
  assert.equal(model.decision, 'hybrid');
  assert.equal(model.source, '本地规则 + 聚合推演');
  assert.match(model.inferenceNote, /综合得出/);
  assert.deepEqual(model.inference, {
    cardId: 'limited_deal',
    confidence: 0.876,
    rationale: '优惠证据与研究倾向共同支持这张趣味卡。',
    evidenceIds: ['E1', 'E2'],
  });
  assert.match(buildShareCaption(model), /消费人格是“限时优惠上头客”/);
  assert.match(buildShareCaption(model), /规则底座是“研究主权者”/);
  assert.doesNotMatch(JSON.stringify(model), /DeepSeek|deepseek|不可覆盖的规则名称/);
});

test('分享海报只按注册表读取综合卡面，未知卡或外部字段会回退本地映射', () => {
  const assessment = {
    period: 7,
    primaryPersona: { id: 'deal_actuary', name: '网络改名', fitScore: 80 },
  };
  const model = buildSharePosterModel({
    assessment,
    presentation: {
      canonical: { id: 'seeded_sprinter', name: '网络发明规则人格' },
      card: {
        id: 'online_invented',
        displayName: '网络发明趣味人格',
        art: 'https://example.invalid/evil.png',
      },
      localCard: {
        id: 'buy_crazy',
        displayName: '伪造的本地卡面',
        art: 'https://example.invalid/local.png',
      },
      decision: 'hybrid',
      inference: {
        cardId: 'online_invented',
        confidence: 1,
        rationale: '不可信推演。',
        evidenceIds: ['E1', 'E2'],
      },
    },
  });

  assert.equal(model.persona, '优惠精算师');
  assert.equal(model.funPersona, '价格真香党');
  assert.equal(model.visualTheme.cardId, 'price_lover');
  assert.equal(model.localVisualTheme.cardId, 'price_lover');
  assert.equal(model.decision, 'local');
  assert.equal(model.inference, null);
  assert.equal(model.source, '本地规则映射');
  assert.doesNotMatch(JSON.stringify(model), /网络发明|伪造|example\.invalid|不可信推演/);
});

test('分享海报使用画像当前周期与聚合事实，不把全期金额写成最近 7 天', () => {
  const model = buildSharePosterModel({
    assessment: {
      period: 7,
      source: 'personal',
      primaryPersona: {
        id: 'deal_actuary', name: '优惠精算师', fitScore: 82,
        rationale: '会主动拆解价格、优惠和满减规则。',
      },
      secondaryPersona: {
        id: 'sovereign_researcher', name: '研究主权者', fitScore: 74,
        rationale: '也会查证比较。',
      },
      localAdvice: '放进购物车等一天。',
      orderCount: 6,
      totals: { saved: 88 },
      outcomes: { savedCount: 2 },
      categories: [
        { category: '数码家居', count: 1, amount: 500 },
        { category: '餐饮饮品', count: 3, amount: 90 },
      ],
      reasons: [{ reason: '限时优惠', count: 3 }],
      motivations: {
        control: { label: '掌控', share: 0.4 },
        healing: { label: '疗愈', share: 0.2 },
        achievement: { label: '成就', share: 0.2 },
        identity: { label: '认同', share: 0.2 },
      },
      evidence: [{ id: 'saved-rate', metric: 'outcome', statement: '已做决定的 4 笔中，有 2 笔冷静后没有购买。' }],
      walletTheme: '参数上头研究员',
      confidence: { score: 72, level: 'stable' },
    },
    result: { persona: '欲望观察员', advice: '不采纳。' },
    totals: { savedAll: 288 },
    goal: { name: '去海边看日落', demo: false },
    generatedAt: new Date(2026, 7, 30, 12),
  });
  assert.equal(model.brand, '让你花个爽！');
  assert.equal(model.period, 7);
  assert.equal(model.periodLabel, '最近 7 天');
  assert.equal(model.savedLabel, '¥88');
  assert.equal(model.savedCountLabel, '2 次');
  assert.equal(model.topCategory, '餐饮饮品');
  assert.equal(model.generatedDate, '2026-08-30');
  assert.equal(model.goalName, '去海边看日落');
  assert.equal(model.stage, 'stable');
  assert.equal(model.stageLabel, '相对稳定');
  assert.equal(model.fitLabel, '82%');
  assert.equal(model.funPersona, '限时优惠上头客');
  assert.equal(model.visualTheme.cardId, 'limited_deal');
  assert.equal(model.visualTheme.art, 'assets/persona-figma-limited-deal.png');
  assert.match(model.visualTheme.accent, /^#[0-9a-f]{6}$/i);
  assert.equal(model.secondaryPersona.id, 'sovereign_researcher');
  assert.equal(model.walletTheme, '参数上头研究员');
  assert.equal(model.topMotivation.labelText, '掌控 40%');
  assert.match(model.evidence, /已做决定的 4 笔/);
  assert.match(buildShareCaption(model), /spree\.jamson\.top/);
});

test('分享海报按画像来源双向隐藏来源不一致的目标', () => {
  const personalModel = buildSharePosterModel({
    assessment: {
      source: 'personal', period: 30,
      primaryPersona: { id: 'desire_observer', name: '错误名称' },
    },
    goal: { name: '演示目标', demo: true },
  });
  const demoModel = buildSharePosterModel({
    assessment: {
      source: 'demo', period: 30,
      primaryPersona: { id: 'desire_observer', name: '错误名称' },
    },
    goal: { name: '个人目标', demo: false },
  });
  const matchingDemoModel = buildSharePosterModel({
    assessment: {
      source: 'demo', period: 30,
      primaryPersona: { id: 'desire_observer', name: '错误名称' },
    },
    goal: { name: '演示目标', demo: true },
  });

  assert.equal(personalModel.goalName, '');
  assert.equal(demoModel.goalName, '');
  assert.equal(matchingDemoModel.goalName, '演示目标');
});

test('周期只能来自 assessment，外部汇总不能自行制造时间范围', () => {
  const withoutAssessmentPeriod = buildSharePosterModel({
    assessment: {
      primaryPersona: { id: 'desire_observer', name: '欲望观察员' },
      totals: { saved: 999 },
      outcomes: { savedCount: 9 },
    },
    periodSummary: { period: 7, saved: 45, savedCount: 2, categories: [{ category: '餐饮饮品', count: 2 }] },
  });
  assert.equal(withoutAssessmentPeriod.period, null);
  assert.equal(withoutAssessmentPeriod.periodLabel, '统计周期未标注');
  assert.equal(withoutAssessmentPeriod.savedLabel, '数据不足');

  const matching = buildSharePosterModel({
    assessment: { period: 7, primaryPersona: { id: 'desire_observer', name: '欲望观察员' } },
    periodSummary: { period: 7, saved: 66, savedCount: 3, categories: [{ category: '学习成长', count: 3 }] },
  });
  const mismatching = buildSharePosterModel({
    assessment: { period: 7, primaryPersona: { id: 'desire_observer', name: '欲望观察员' } },
    periodSummary: { period: 30, saved: 666, savedCount: 9 },
  });
  assert.equal(matching.periodLabel, '最近 7 天');
  assert.equal(matching.savedLabel, '¥66');
  assert.equal(matching.savedCountLabel, '3 次');
  assert.equal(matching.topCategory, '学习成长');
  assert.equal(mismatching.savedLabel, '数据不足');
});

test('没有真实动机差异时不把中性先验伪装成最高动机', () => {
  const model = buildSharePosterModel({
    assessment: {
      period: 30,
      orderCount: 4,
      primaryPersona: { id: 'desire_observer', name: '欲望观察员' },
      motivations: {
        control: { label: '掌控', share: 0.25 },
        healing: { label: '疗愈', share: 0.25 },
        achievement: { label: '成就', share: 0.25 },
        identity: { label: '认同', share: 0.25 },
      },
      confidence: { score: 45, level: 'forming' },
    },
  });
  assert.equal(model.topMotivation, null);
  assert.equal(model.stageLabel, '初步倾向');
});

test('分享海报模型不接收或输出订单、商品和单笔时间明细', () => {
  const model = buildSharePosterModel({
    assessment: {
      period: 7,
      primaryPersona: { id: 'desire_observer', name: '欲望观察员' },
      totals: { saved: 0 },
      confidence: { score: 0 },
      orders: [{ name: '不应出现的商品', createdAt: '2026-08-30T01:23:45Z' }],
    },
    totals: {},
    goal: null,
    orders: [{ name: '另一个不应出现的商品' }],
  });
  const serialized = JSON.stringify(model);
  assert.doesNotMatch(serialized, /不应出现的商品|另一个不应出现的商品|2026-08-30T01:23:45Z/);
  assert.equal(Object.hasOwn(model, 'orders'), false);
});

test('文案复制降级路径会拒绝 execCommand false 并清理临时节点', async () => {
  let removed = false;
  const input = {
    style: {},
    select() {},
    remove() { removed = true; },
  };
  const environment = {
    navigator: {},
    document: {
      createElement: () => input,
      body: { appendChild() {} },
      execCommand: () => false,
    },
  };
  await assert.rejects(copyShareCaption('分享文案', environment), /未能复制/);
  assert.equal(removed, true);
});

test('下载请求返回可判断结果，移动端包含长按保存提示', () => {
  let clicked = false;
  let removed = false;
  let revoked = '';
  const link = {
    click() { clicked = true; },
    remove() { removed = true; },
  };
  const result = downloadSharePoster(new Blob(['png']), '测试.png', {
    document: {
      createElement: () => link,
      body: { appendChild() {} },
    },
    URL: {
      createObjectURL: () => 'blob:test',
      revokeObjectURL: (url) => { revoked = url; },
    },
    navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile' },
    setTimeout: (callback) => callback(),
  });
  assert.equal(clicked, true);
  assert.equal(removed, true);
  assert.equal(revoked, 'blob:test');
  assert.equal(result.status, 'download-requested-mobile');
  assert.match(result.mobileSaveHint, /长按/);
});

test('分享人格卡保持 1080×1538，横竖插图都完整 contain 且不裁切', async () => {
  const originalDocument = globalThis.document;
  const originalImage = globalThis.Image;
  const drawCalls = [];
  const canvases = [];
  const gradient = { addColorStop() {} };
  const context = {
    beginPath() {}, roundRect() {}, closePath() {}, fill() {}, stroke() {},
    save() {}, restore() {}, fillRect() {},
    createLinearGradient: () => gradient,
    measureText: (value) => ({ width: String(value).length * 12 }),
    fillText() {},
    drawImage: (image, x, y, width, height) => drawCalls.push({
      src: image.src, x, y, width, height,
    }),
  };
  class FakeImage {
    set src(value) {
      this._src = value;
      if (value.includes('persona-figma-hobby')) {
        this.width = 900;
        this.height = 1200;
      } else {
        this.width = 1200;
        this.height = 900;
      }
      queueMicrotask(() => this.onload?.());
    }

    get src() { return this._src; }
  }

  globalThis.document = {
    fonts: { ready: Promise.resolve() },
    createElement: () => {
      const canvas = {
        getContext: () => context,
        toBlob: (callback) => callback(new Blob(['poster'], { type: 'image/png' })),
      };
      canvases.push(canvas);
      return canvas;
    },
  };
  globalThis.Image = FakeImage;
  try {
    const wideModel = buildSharePosterModel({
      assessment: {
        period: 7,
        primaryPersona: { id: 'deal_actuary', fitScore: 70 },
        orderCount: 3,
        confidence: { score: 60, level: 'forming' },
      },
    });
    const portraitModel = buildSharePosterModel({
      assessment: {
        period: 7,
        primaryPersona: { id: 'micro_achiever', fitScore: 70 },
        orderCount: 3,
        confidence: { score: 60, level: 'forming' },
      },
    });
    await renderSharePoster(wideModel);
    await renderSharePoster(portraitModel);

    canvases.forEach((canvas) => {
      assert.equal(canvas.width, 1080);
      assert.equal(canvas.height, 1538);
    });
    assert.equal(drawCalls.length, 2);

    const [wide, portrait] = drawCalls;
    assert.match(wide.src, /persona-figma-price-lover\.png/);
    assert.ok(Math.abs(wide.x - 130) < 0.001);
    assert.ok(Math.abs(wide.y - 217.5) < 0.001);
    assert.ok(Math.abs(wide.width - 820) < 0.001);
    assert.ok(Math.abs(wide.height - 615) < 0.001);

    assert.match(portrait.src, /persona-figma-hobby\.png/);
    assert.ok(Math.abs(portrait.x - 297.75) < 0.001);
    assert.ok(Math.abs(portrait.y - 202) < 0.001);
    assert.ok(Math.abs(portrait.width - 484.5) < 0.001);
    assert.ok(Math.abs(portrait.height - 646) < 0.001);
  } finally {
    globalThis.document = originalDocument;
    globalThis.Image = originalImage;
  }
});

test('综合人格插图加载失败时海报会回退到小浣熊资源', async () => {
  const originalDocument = globalThis.document;
  const originalImage = globalThis.Image;
  const requestedSources = [];
  const drawnSources = [];
  const gradient = { addColorStop() {} };
  const context = {
    beginPath() {}, roundRect() {}, closePath() {}, fill() {}, stroke() {},
    save() {}, restore() {}, moveTo() {}, lineTo() {}, arc() {}, fillRect() {},
    createLinearGradient: () => gradient,
    measureText: (value) => ({ width: String(value).length * 12 }),
    fillText() {},
    drawImage: (image) => drawnSources.push(image.src),
  };
  const canvas = {
    getContext: () => context,
    toBlob: (callback) => callback(new Blob(['poster'], { type: 'image/png' })),
  };
  class FakeImage {
    width = 320;
    height = 320;

    set src(value) {
      this._src = value;
      requestedSources.push(value);
      queueMicrotask(() => {
        if (value.includes('persona-figma')) this.onerror?.(new Error('failed'));
        else this.onload?.();
      });
    }

    get src() { return this._src; }
  }

  globalThis.document = { fonts: { ready: Promise.resolve() }, createElement: () => canvas };
  globalThis.Image = FakeImage;
  try {
    const model = buildSharePosterModel({
      assessment: {
        period: 7,
        primaryPersona: { id: 'deal_actuary', fitScore: 70 },
        orderCount: 3,
        confidence: { score: 60, level: 'forming' },
      },
    });
    const blob = await renderSharePoster(model, { mascotUrl: './assets/raccoon-guide.webp' });
    assert.equal(blob.type, 'image/png');
    assert.deepEqual(requestedSources, [
      'assets/persona-figma-price-lover.png?v=20260831-persona-hd-1',
      './assets/raccoon-guide.webp',
    ]);
    assert.deepEqual(drawnSources, ['./assets/raccoon-guide.webp']);
  } finally {
    globalThis.document = originalDocument;
    globalThis.Image = originalImage;
  }
});
