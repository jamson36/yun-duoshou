export const SCORING_MODEL_VERSION = 'wallet-personality-rules-1.3.0';

const PRESENTATION_SMALL_SPEND_LIMIT = 50;

export const CONSUMPTION_CATEGORY_VALUES = Object.freeze([
  '餐饮饮品',
  '服饰美妆',
  '数码家居',
  '娱乐社交',
  '学习成长',
  '旅行交通',
  '其他',
]);

export const CONSUMPTION_REASON_VALUES = Object.freeze([
  '嘴馋',
  '无聊',
  '被种草',
  '情绪不好',
  '限时优惠',
  '社交需要',
  '自我提升',
  '其他',
]);

const CATEGORY_VALUE_SET = new Set(CONSUMPTION_CATEGORY_VALUES);
const REASON_VALUE_SET = new Set(CONSUMPTION_REASON_VALUES);

export const AXIS_META = Object.freeze({
  I: { label: '即时冲动', low: '愿意冷静', high: '快速行动' },
  P: { label: '价格敏感', low: '少看价格规则', high: '关注优惠差额' },
  R: { label: '研究验证', low: '偏直觉决定', high: '主动查证比较' },
  X: { label: '外部依赖', low: '主要自己判断', high: '依赖口碑与推荐' },
  E: { label: '情绪体验', low: '功能任务优先', high: '疗愈氛围优先' },
});

export const MOTIVE_META = Object.freeze({
  control: { label: '掌控', description: '为了确定性、耐用和秩序' },
  healing: { label: '疗愈', description: '为了舒适、放松和情绪修复' },
  achievement: { label: '成就', description: '为了技能、工具和完成感' },
  identity: { label: '认同', description: '为了价值、圈层和身份表达' },
});

const WALLET_THEME_BY_CATEGORY = Object.freeze({
  餐饮饮品: '奶茶股东型选手',
  服饰美妆: '种草收割机',
  数码家居: '参数上头研究员',
  娱乐社交: '快乐充值体验官',
  学习成长: '自我提升囤积者',
  旅行交通: '世界很大型选手',
  其他: '欲望观察员',
});

const ADVICE_BY_REASON = Object.freeze({
  嘴馋: '下一次嘴馋时，先喝一杯水，再给这笔欲望十分钟。',
  无聊: '把“想逛一下”换成一个五分钟的小任务，再回来决定。',
  被种草: '先保存商品，不保存付款冲动；明天同一时间再看一次。',
  情绪不好: '先照顾情绪，再决定商品是否真的能解决问题。',
  限时优惠: '限时的是优惠，不是你的决定时间。',
  社交需要: '先问自己：我需要的是这件东西，还是参与感？',
  自我提升: '写下购买后七天内的第一次使用时间，再决定是否付款。',
  其他: '给欲望留一个晚上，明天再决定它是否值得。',
});

const REASON_RULES = Object.freeze({
  嘴馋: { axes: { I: 0.6, E: 0.6 }, motives: { healing: 0.4 } },
  无聊: { axes: { I: 0.7, E: 0.8 }, motives: { healing: 0.7 } },
  被种草: { axes: { I: 0.6, R: -0.1, X: 0.8, E: 0.3 }, motives: { identity: 0.2 }, events: ['seeded', 'identity'] },
  情绪不好: { axes: { I: 0.5, E: 1 }, motives: { healing: 1 }, events: ['healing'] },
  限时优惠: { axes: { I: 0.5, P: 1, X: 0.2 }, motives: { control: 0.2 }, events: ['deal'] },
  社交需要: { axes: { I: 0.2, X: 1, E: 0.2 }, motives: { identity: 0.8 }, events: ['identity', 'social'] },
  自我提升: { axes: { R: 0.2 }, motives: { achievement: 1 }, events: ['achievement'] },
  其他: { axes: {}, motives: {} },
});

const SIGNAL_RULES = Object.freeze({
  instant: { label: '没做功课就想下单', axes: { I: 1, R: -0.8, E: 0.2 } },
  wait: { label: '等一晚再决定', axes: { I: -0.8, R: 0.3 }, motives: { control: 0.3 }, events: ['wait', 'research'] },
  compare: { label: '比过价格', axes: { I: -0.2, P: 0.8, R: 0.7 }, motives: { control: 0.5 }, events: ['deal', 'research'] },
  research: { label: '查过参数或成分', axes: { I: -0.2, R: 1 }, motives: { control: 0.4 }, events: ['research'] },
  reviews: { label: '看过买家评价或差评', axes: { I: -0.1, R: 0.8, X: 0.5 }, motives: { control: 0.2 }, events: ['research', 'social'] },
  friends: { label: '问过朋友', axes: { R: 0.3, X: 1 }, motives: { identity: 0.2 }, events: ['identity', 'social'] },
  creator: { label: '看了达人或直播推荐', axes: { I: 0.4, X: 1, E: 0.2 }, motives: { identity: 0.3 }, events: ['seeded', 'identity', 'social'] },
  deal: { label: '找券或凑满减', axes: { I: 0.2, P: 1, R: 0.3 }, motives: { control: 0.3 }, events: ['deal'] },
  comfort: { label: '主要为了舒适或氛围', axes: { I: 0.2, E: 1 }, motives: { healing: 1 }, events: ['healing'] },
  achievement: { label: '为了学习或完成作品', axes: { R: 0.3 }, motives: { achievement: 1 }, events: ['achievement'] },
  identity: { label: '认同品牌故事或价值观', axes: { X: 0.3, E: 0.2 }, motives: { identity: 1 }, events: ['identity'] },
  stock: { label: '家里已有同类仍想囤', axes: { I: 0.5, P: 0.2, R: -0.2, E: 0.2 }, events: ['stock'] },
});

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const round = (value, digits = 0) => Number(value.toFixed(digits));
const sum = (values) => values.reduce((total, value) => total + value, 0);

function safeDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function dataSourceOfGoal(goal) {
  if (!goal) return null;
  if (goal.source === 'demo' || goal.source === 'personal') return goal.source;
  return goal.demo ? 'demo' : 'personal';
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function normalizedEntropy(shares) {
  const values = shares.filter((value) => value > 0);
  if (values.length <= 1) return 0;
  return -sum(values.map((value) => value * Math.log(value))) / Math.log(shares.length);
}

function latencyDirection(hours) {
  if (hours < (10 / 60)) return 1;
  if (hours < 2) return 0.6;
  if (hours < 24) return 0.2;
  if (hours < 72) return -0.4;
  return -0.8;
}

function addEvent(eventCounts, event) {
  eventCounts[event] = (eventCounts[event] || 0) + 1;
}

function buildAggregates(orders) {
  const categoryMap = new Map();
  const reasonMap = new Map();
  const statusCounts = { cooling: 0, saved: 0, purchased: 0 };
  for (const order of orders) {
    const current = categoryMap.get(order.category) || { category: order.category, count: 0, amount: 0, latestAt: 0 };
    current.count += 1;
    current.amount += order.amount;
    current.latestAt = Math.max(current.latestAt, order.createdAt.getTime());
    categoryMap.set(order.category, current);
    reasonMap.set(order.reason, (reasonMap.get(order.reason) || 0) + 1);
    if (statusCounts[order.status] !== undefined) statusCounts[order.status] += 1;
  }
  const categories = [...categoryMap.values()]
    .sort((a, b) => b.count - a.count || b.amount - a.amount || b.latestAt - a.latestAt)
    .map(({ latestAt: _latestAt, ...entry }) => ({ ...entry, amount: round(entry.amount, 2) }));
  const reasons = [...reasonMap.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, 'zh-CN'));
  return { categories, reasons, statusCounts };
}

function buildPresentationSignals(orders) {
  const nightCount = orders.filter((order) => {
    const hour = order.createdAt.getHours();
    return hour >= 22 || hour < 6;
  }).length;
  const smallSpendCount = orders.filter((order) => order.amount <= PRESENTATION_SMALL_SPEND_LIMIT).length;
  const orderCount = orders.length;
  return {
    source: 'aggregated_local_orders',
    purpose: 'presentation_only',
    orderCount,
    nightWindow: '22:00-05:59',
    nightCount,
    nightRate: orderCount ? round(nightCount / orderCount, 3) : 0,
    smallSpendLimit: PRESENTATION_SMALL_SPEND_LIMIT,
    smallSpendCount,
    smallSpendRate: orderCount ? round(smallSpendCount / orderCount, 3) : 0,
    medianAmount: orderCount ? round(median(orders.map((order) => order.amount)), 2) : null,
  };
}

function sanitizeDiagnosisPresentationSignals(signals) {
  const nonNegativeInteger = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
  };
  const rate = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? round(clamp(numeric), 3) : 0;
  };
  const medianAmount = Number(signals?.medianAmount);
  return {
    source: 'aggregated_local_orders',
    purpose: 'presentation_only',
    orderCount: nonNegativeInteger(signals?.orderCount),
    nightCount: nonNegativeInteger(signals?.nightCount),
    nightRate: rate(signals?.nightRate),
    smallSpendCount: nonNegativeInteger(signals?.smallSpendCount),
    smallSpendRate: rate(signals?.smallSpendRate),
    medianAmount: Number.isFinite(medianAmount) && medianAmount >= 0 ? round(medianAmount, 2) : null,
  };
}

function sanitizeDiagnosisPersonaCandidates(candidates) {
  return (Array.isArray(candidates) ? candidates : [])
    .filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string')
    .slice(0, 3)
    .map((item) => {
      const fitScore = Number(item.fitScore);
      return {
        id: item.id.slice(0, 64),
        name: item.name.slice(0, 40),
        fitScore: Number.isFinite(fitScore) ? Math.round(clamp(fitScore, 0, 100)) : 0,
        rationale: typeof item.rationale === 'string' ? item.rationale.slice(0, 160) : '',
      };
    });
}

function normalizeOrders(rawOrders, period, now) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - (period - 1));
  cutoff.setHours(0, 0, 0, 0);
  return (Array.isArray(rawOrders) ? rawOrders : [])
    .filter((order) => !order?.deletedAt)
    .map((order) => ({
      ...order,
      amount: Number(order.amount),
      category: typeof order.category === 'string' && CATEGORY_VALUE_SET.has(order.category) ? order.category : '其他',
      reason: typeof order.reason === 'string' && REASON_VALUE_SET.has(order.reason) ? order.reason : '其他',
      status: ['cooling', 'saved', 'purchased'].includes(order.status) ? order.status : 'cooling',
      createdAt: safeDate(order.createdAt),
      decidedAt: safeDate(order.decidedAt),
      decisionSignals: Array.isArray(order.decisionSignals) ? order.decisionSignals.filter((signal) => SIGNAL_RULES[signal]) : [],
      statusHistory: Array.isArray(order.statusHistory) ? order.statusHistory : [],
    }))
    .filter((order) => order.createdAt && Number.isFinite(order.amount) && order.amount > 0 && order.createdAt >= cutoff && order.createdAt <= now)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function orderWeight(order, now, personalMedian, orderCount) {
  const ageDays = Math.max(0, (now - order.createdAt) / 86_400_000);
  const recency = 0.5 ** (ageDays / 14);
  const amountModifier = orderCount < 5 || !personalMedian
    ? 1
    : clamp(Math.sqrt(order.amount / personalMedian), 0.75, 1.5);
  return recency * amountModifier;
}

function makeEvidenceStore() {
  return Object.fromEntries(Object.keys(AXIS_META).map((axis) => [axis, []]));
}

function addAxisEvidence(store, axes, weight, source, label, orderId) {
  for (const [axis, direction] of Object.entries(axes || {})) {
    if (!direction || !store[axis]) continue;
    store[axis].push({ direction, weight, source, label, orderId });
  }
}

function addMotives(store, motives, weight) {
  for (const [motive, contribution] of Object.entries(motives || {})) {
    if (store[motive] !== undefined) store[motive] += weight * contribution;
  }
}

function axisResult(evidence) {
  if (!evidence.length) return { score: null, confidence: 0, evidenceCount: 0, evidence: [] };
  const totalWeight = sum(evidence.map((item) => item.weight));
  const raw = sum(evidence.map((item) => item.weight * item.direction)) / totalWeight;
  const ranked = [...evidence]
    .sort((a, b) => Math.abs(b.weight * b.direction) - Math.abs(a.weight * a.direction))
    .slice(0, 3)
    .map(({ label, source, direction }) => ({ label, source, direction }));
  return {
    score: Math.round(clamp(50 + 50 * raw, 0, 100)),
    confidence: round(clamp(totalWeight / 3), 2),
    evidenceCount: evidence.length,
    evidence: ranked,
  };
}

function high(score) {
  return score === null ? 0 : clamp((score - 50) / 50);
}

function low(score) {
  return score === null ? 0 : clamp((50 - score) / 50);
}

function candidate(id, name, eligible, fit, rationale) {
  return { id, name, eligible, fitScore: eligible ? Math.round(clamp(fit, 0, 1) * 100) : 0, rationale };
}

function matchPersonas({ axes, motives, outcomes, rates, orderCount, confidence, categories }) {
  const I = axes.I.score;
  const P = axes.P.score;
  const R = axes.R.score;
  const X = axes.X.score;
  const E = axes.E.score;
  const learningThemeShare = orderCount ? (categories.find((item) => item.category === '学习成长')?.count || 0) / orderCount : 0;
  const axisScores = Object.values(axes).map((axis) => axis.score).filter((score) => score !== null);
  const axisBalance = axisScores.length >= 4 ? 1 - ((Math.max(...axisScores) - Math.min(...axisScores)) / 100) : 0;
  const categoryShares = categories.map((item) => item.count / orderCount);
  const motivationShares = Object.values(motives).map((item) => item.share);
  const categoryDiversity = categoryShares.length > 1 ? normalizedEntropy(categoryShares) : 0;
  const motivationEntropy = normalizedEntropy(motivationShares);
  const decisionStability = 1 - outcomes.reversalRate;
  const candidates = [
    candidate('sovereign_researcher', '研究主权者', rates.researchCount >= 2,
      0.35 * high(R) + 0.20 * low(I) + 0.25 * motives.control.share + 0.10 * low(X) + 0.10 * rates.research,
      '研究与自主判断是最明显的决策方式。'),
    candidate('deal_actuary', '优惠精算师', rates.dealCount >= 2,
      0.40 * high(P) + 0.20 * high(R) + 0.25 * rates.deal + 0.15 * motives.control.share,
      '会主动拆解价格、优惠和满减规则。'),
    candidate('seeded_sprinter', '种草冲锋手', rates.seededCount >= 2,
      0.30 * high(I) + 0.25 * high(X) + 0.15 * high(E) + 0.30 * rates.seeded,
      '外部种草经常缩短你的决定时间。'),
    candidate('sensory_healer', '氛围疗愈师', rates.healingCount >= 2,
      0.30 * high(E) + 0.35 * motives.healing.share + 0.25 * rates.healing + 0.10 * high(I),
      '消费经常承担舒适、氛围和情绪修复功能。'),
    candidate('social_resonator', '社交共鸣者', rates.identityCount >= 2,
      0.30 * high(X) + 0.35 * motives.identity.share + 0.25 * rates.identity + 0.10 * high(E),
      '评价、朋友、圈层或品牌价值会明显参与决定。'),
    candidate('micro_achiever', '微观成就家', rates.achievementCount >= 2,
      0.45 * motives.achievement.share + 0.20 * high(R) + 0.25 * rates.achievement + 0.10 * learningThemeShare,
      '消费更多服务于技能、工具和具体进展。'),
    candidate('minimal_buffer', '极简缓冲者', outcomes.decidedCount >= 3 && outcomes.savedCount >= 2,
      0.20 * low(I) + 0.20 * rates.wait + 0.30 * outcomes.savedAmountRate + 0.15 * motives.control.share + 0.15 * low(E),
      '你经常给欲望留出时间，并主动放下一部分购买。'),
    candidate('stock_collector', '收藏囤货派', rates.stockCount >= 2,
      0.35 * rates.stock + 0.20 * rates.repeatPurchase + 0.15 * outcomes.purchaseRate + 0.15 * high(I) + 0.15 * high(P),
      '拥有、收集或备用的需求高于即时使用。'),
    candidate('balanced_observer', '平衡洞察者', orderCount >= 8 && confidence.score >= 60 && axisScores.length >= 4,
      0.40 * axisBalance + 0.30 * motivationEntropy + 0.20 * categoryDiversity + 0.10 * decisionStability,
      '不同情境下会切换策略，没有单一维度长期支配。'),
  ].filter((item) => item.eligible).sort((a, b) => b.fitScore - a.fitScore);

  const top = candidates[0];
  if (!top || top.fitScore < 60) {
    return {
      primary: { id: 'desire_observer', name: '欲望观察员', fitScore: top?.fitScore || 0, rationale: '目前还没有一种决策方式稳定占上风。' },
      secondary: null,
      candidates,
    };
  }
  const second = candidates[1];
  return {
    primary: top,
    secondary: second && second.fitScore >= 55 && top.fitScore - second.fitScore <= 12 ? second : null,
    candidates,
  };
}

function resultFacts({ orderCount, aggregates, totals, axes, motives, outcomes, period }) {
  const topCategory = aggregates.categories[0];
  const topReason = aggregates.reasons[0];
  const topAxis = Object.entries(axes)
    .filter(([, axis]) => axis.score !== null)
    .sort((a, b) => Math.abs(b[1].score - 50) - Math.abs(a[1].score - 50))[0];
  const topMotive = Object.entries(motives).sort((a, b) => b[1].share - a[1].share)[0];
  return [
    topCategory && { id: 'top-category', metric: 'category', statement: `${period} 天内，${topCategory.category}共 ${topCategory.count} 笔，记录金额 ¥${topCategory.amount.toFixed(2)}。` },
    topReason && { id: 'top-reason', metric: 'reason', statement: `最常出现的触发原因是“${topReason.reason}”，共 ${topReason.count} 次。` },
    outcomes.decidedCount > 0 && { id: 'saved-rate', metric: 'outcome', statement: `已做决定的 ${outcomes.decidedCount} 笔中，有 ${outcomes.savedCount} 笔冷静后没有购买，冷静单数率 ${Math.round(outcomes.savedCountRate * 100)}%。` },
    topAxis && { id: 'top-axis', metric: 'axis', statement: `${AXIS_META[topAxis[0]].label}是目前最突出的维度，分数 ${topAxis[1].score}/100。` },
    topMotive && { id: 'top-motive', metric: 'motivation', statement: `近期最明显的购买动机是“${topMotive[1].label}”，占动机证据的 ${Math.round(topMotive[1].share * 100)}%。` },
    { id: 'record-count', metric: 'sample', statement: `本次画像使用 ${orderCount} 笔有效记录，记录金额合计 ¥${totals.recorded.toFixed(2)}。` },
  ].filter(Boolean);
}

export function scorePersonality({ orders = [], period = 30, now = new Date() } = {}) {
  const normalizedPeriod = period === 7 ? 7 : 30;
  const currentTime = safeDate(now) || new Date();
  const periodOrders = normalizeOrders(orders, normalizedPeriod, currentTime);
  const personalOrders = periodOrders.filter((order) => !order.demo);
  const source = personalOrders.length > 0 ? 'personal' : (periodOrders.length > 0 ? 'demo' : 'personal');
  const validOrders = source === 'personal' ? personalOrders : periodOrders;
  const excludedDemoCount = source === 'personal' ? periodOrders.length - personalOrders.length : 0;
  const orderCount = validOrders.length;
  const personalMedian = median(validOrders.map((order) => order.amount));
  const axisEvidence = makeEvidenceStore();
  const motiveScores = Object.fromEntries(Object.keys(MOTIVE_META).map((key) => [key, 0.5]));
  const eventCounts = {};
  const perOrderWeights = [];

  for (const order of validOrders) {
    const baseWeight = orderWeight(order, currentTime, personalMedian, orderCount);
    perOrderWeights.push(baseWeight);
    const reasonRule = REASON_RULES[order.reason] || REASON_RULES.其他;
    const orderEvents = new Set(reasonRule.events || []);
    addAxisEvidence(axisEvidence, reasonRule.axes, baseWeight * 0.9, 'reason', order.reason, order.id);
    addMotives(motiveScores, reasonRule.motives, baseWeight * 0.9);

    for (const signal of order.decisionSignals) {
      const signalRule = SIGNAL_RULES[signal];
      addAxisEvidence(axisEvidence, signalRule.axes, baseWeight, 'decision_signal', signalRule.label, order.id);
      addMotives(motiveScores, signalRule.motives, baseWeight);
      for (const event of signalRule.events || []) orderEvents.add(event);
    }

    for (const event of orderEvents) addEvent(eventCounts, event);

    if (order.decidedAt && order.decidedAt >= order.createdAt) {
      const hours = (order.decidedAt - order.createdAt) / 3_600_000;
      addAxisEvidence(axisEvidence, { I: latencyDirection(hours) }, baseWeight, 'decision_time', `${round(hours, 1)} 小时后决定`, order.id);
    }
  }

  const axes = Object.fromEntries(Object.entries(axisEvidence).map(([key, evidence]) => [key, axisResult(evidence)]));
  const motiveTotal = sum(Object.values(motiveScores));
  const motives = Object.fromEntries(Object.entries(motiveScores).map(([key, value]) => [key, {
    ...MOTIVE_META[key],
    share: round(value / motiveTotal, 3),
  }]));
  const aggregates = buildAggregates(validOrders);
  const totals = {
    recorded: round(sum(validOrders.map((order) => order.amount)), 2),
    saved: round(sum(validOrders.filter((order) => order.status === 'saved').map((order) => order.amount)), 2),
    purchased: round(sum(validOrders.filter((order) => order.status === 'purchased').map((order) => order.amount)), 2),
    coolingCount: aggregates.statusCounts.cooling,
  };
  const decidedOrders = validOrders.filter((order) => order.status === 'saved' || order.status === 'purchased');
  const savedOrders = decidedOrders.filter((order) => order.status === 'saved');
  const decidedAmount = sum(decidedOrders.map((order) => order.amount));
  const decisionHours = decidedOrders
    .filter((order) => order.decidedAt && order.decidedAt >= order.createdAt)
    .map((order) => (order.decidedAt - order.createdAt) / 3_600_000);
  const reversedOrders = decidedOrders.filter((order) => order.statusHistory.length > 1);
  const outcomes = {
    decidedCount: decidedOrders.length,
    savedCount: savedOrders.length,
    savedCountRate: decidedOrders.length ? round(savedOrders.length / decidedOrders.length, 3) : 0,
    savedAmountRate: decidedAmount ? round(sum(savedOrders.map((order) => order.amount)) / decidedAmount, 3) : 0,
    purchaseRate: decidedOrders.length ? round(aggregates.statusCounts.purchased / decidedOrders.length, 3) : 0,
    medianDecisionHours: decisionHours.length ? round(median(decisionHours), 1) : null,
    reversalRate: decidedOrders.length ? round(reversedOrders.length / decidedOrders.length, 3) : 0,
  };
  const totalOrderWeight = sum(perOrderWeights);
  const effectiveN = perOrderWeights.length ? (totalOrderWeight ** 2) / sum(perOrderWeights.map((weight) => weight ** 2)) : 0;
  const axisCoverage = Object.values(axes).filter((axis) => axis.score !== null).length / 5;
  const activeDays = orderCount > 1 ? Math.max(1, (validOrders.at(-1).createdAt - validOrders[0].createdAt) / 86_400_000) : 0;
  const confidenceScore = Math.round(100 * (
    0.40 * Math.min(effectiveN / 12, 1)
    + 0.25 * (orderCount ? 1 : 0)
    + 0.20 * axisCoverage
    + 0.15 * Math.min(activeDays / 14, 1)
  ));
  const confidence = {
    score: confidenceScore,
    level: orderCount < 3 ? 'insufficient' : (effectiveN >= 12 && confidenceScore >= 70 ? 'stable' : 'forming'),
    effectiveN: round(effectiveN, 1),
    axisCoverage: round(axisCoverage, 2),
  };
  const eventRate = (event) => orderCount ? clamp((eventCounts[event] || 0) / orderCount) : 0;
  const repeatedCategoryCount = aggregates.categories.filter((category) => category.count >= 2).reduce((count, category) => count + category.count - 1, 0);
  const rates = {
    research: eventRate('research'), researchCount: eventCounts.research || 0,
    deal: eventRate('deal'), dealCount: eventCounts.deal || 0,
    seeded: eventRate('seeded'), seededCount: eventCounts.seeded || 0,
    healing: eventRate('healing'), healingCount: eventCounts.healing || 0,
    identity: eventRate('identity'), identityCount: eventCounts.identity || 0,
    achievement: eventRate('achievement'), achievementCount: eventCounts.achievement || 0,
    wait: eventRate('wait'), waitCount: eventCounts.wait || 0,
    stock: eventRate('stock'), stockCount: eventCounts.stock || 0,
    repeatPurchase: orderCount ? repeatedCategoryCount / orderCount : 0,
  };
  const personaMatches = orderCount >= 3
    ? matchPersonas({ axes, motives, outcomes, rates, orderCount, confidence, categories: aggregates.categories })
    : { primary: null, secondary: null, candidates: [] };
  const topCategory = aggregates.categories[0]?.category || '其他';
  const topReason = aggregates.reasons[0]?.reason || '其他';

  const assessment = {
    schemaVersion: 'consumption-personality-v1',
    modelVersion: SCORING_MODEL_VERSION,
    period: normalizedPeriod,
    eligible: orderCount >= 3,
    orderCount,
    dataMode: source,
    source,
    excludedDemoCount,
    presentationSignals: buildPresentationSignals(validOrders),
    totals,
    categories: aggregates.categories,
    reasons: aggregates.reasons,
    statuses: aggregates.statusCounts,
    axes,
    motivations: motives,
    outcomes,
    primaryPersona: personaMatches.primary,
    secondaryPersona: personaMatches.secondary,
    personaCandidates: personaMatches.candidates,
    walletTheme: WALLET_THEME_BY_CATEGORY[topCategory] || WALLET_THEME_BY_CATEGORY.其他,
    confidence,
    localAdvice: ADVICE_BY_REASON[topReason] || ADVICE_BY_REASON.其他,
  };
  assessment.evidence = resultFacts({ orderCount, aggregates, totals, axes, motives, outcomes, period: normalizedPeriod });
  return assessment;
}

export function calculateGoalProgress(orders = [], goal = null) {
  if (!goal || !Number.isFinite(Number(goal.amount)) || Number(goal.amount) <= 0) return null;
  const createdAt = safeDate(goal.createdAt) || new Date(0);
  const goalIsDemo = dataSourceOfGoal(goal) === 'demo';
  const saved = (Array.isArray(orders) ? orders : [])
    .filter((order) => order.status === 'saved' && !order.deletedAt)
    .filter((order) => Boolean(order.demo) === goalIsDemo)
    .filter((order) => !goal.id || order.goalId === goal.id)
    .filter((order) => (safeDate(order.updatedAt) || safeDate(order.createdAt)) >= createdAt)
    .reduce((total, order) => total + (Number(order.amount) || 0), 0);
  return {
    name: String(goal.name || '').slice(0, 20),
    targetAmount: round(Number(goal.amount), 2),
    progress: round(saved, 2),
    progressRate: round(clamp(saved / Number(goal.amount)), 3),
  };
}

export function buildDiagnosisRequest({ assessment, goal = null, orders = [] }) {
  if (!assessment?.eligible) throw new Error('至少需要 3 笔有效记录');
  const assessmentSource = ['personal', 'demo'].includes(assessment?.source) ? assessment.source : null;
  const goalSource = dataSourceOfGoal(goal);
  const goalProgress = assessmentSource && goalSource === assessmentSource
    ? calculateGoalProgress(orders, goal)
    : null;
  const goalSummary = goalProgress ? {
    targetAmount: goalProgress.targetAmount,
    progress: goalProgress.progress,
    progressRate: goalProgress.progressRate,
  } : null;
  return {
    schemaVersion: 'wallet-summary-v1',
    scoringModelVersion: assessment.modelVersion,
    period: assessment.period,
    totals: assessment.totals,
    categories: assessment.categories.map(({ category, count, amount }) => ({ category, count, amount })),
    reasons: assessment.reasons.map(({ reason, count }) => ({ reason, count })),
    statuses: assessment.statuses,
    goal: goalSummary,
    dataMode: assessment.dataMode,
    source: assessment.source || assessment.dataMode,
    excludedDemoCount: Number(assessment.excludedDemoCount) || 0,
    presentationSignals: sanitizeDiagnosisPresentationSignals(assessment.presentationSignals),
    personaCandidates: sanitizeDiagnosisPersonaCandidates(assessment.personaCandidates),
    localAssessment: {
      axes: Object.fromEntries(Object.entries(assessment.axes).map(([key, value]) => [key, {
        score: value.score,
        confidence: value.confidence,
        evidenceCount: value.evidenceCount,
      }])),
      motivations: Object.fromEntries(Object.entries(assessment.motivations).map(([key, value]) => [key, value.share])),
      outcomes: assessment.outcomes,
      primaryPersona: assessment.primaryPersona,
      secondaryPersona: assessment.secondaryPersona,
      walletTheme: assessment.walletTheme,
      confidence: assessment.confidence,
      evidence: assessment.evidence,
      localAdvice: assessment.localAdvice,
    },
  };
}

export const DECISION_SIGNAL_OPTIONS = Object.freeze(Object.entries(SIGNAL_RULES).map(([value, rule]) => ({ value, label: rule.label })));
