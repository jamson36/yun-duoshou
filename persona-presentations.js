const ART_ROOT = 'assets';

const card = ({ id, sourceName, displayName = sourceName, art, gradient, accent, quote, tags }) => Object.freeze({
  id,
  sourceName,
  displayName,
  art: `${ART_ROOT}/${art}`,
  gradient: Object.freeze([...gradient]),
  accent,
  quote,
  tags: Object.freeze([...tags]),
});

// These names and art slots mirror the twenty large/small persona pairs in Figma.
// `sourceName` is kept for traceability; `displayName` is the product-safe label.
export const FIGMA_PERSONA_CARDS = Object.freeze({
  buy_crazy: card({
    id: 'buy_crazy', sourceName: '买买买狂人', displayName: '心动采购官',
    art: 'persona-figma-buy-crazy.png', gradient: ['#fff8dc', '#ffd7aa'], accent: '#f47b39',
    quote: '心动来得快，也值得给决定留一小段缓冲。', tags: ['心动雷达', '先记后买'],
  }),
  cart_stayer: card({
    id: 'cart_stayer', sourceName: '购物车钉子户',
    art: 'persona-figma-cart-stayer.png', gradient: ['#f5f2ff', '#dcd8ff'], accent: '#6f67c8',
    quote: '购物车不是终点，是你认真比较的候车厅。', tags: ['延迟决定', '认真比较'],
  }),
  refined_player: card({
    id: 'refined_player', sourceName: '精致穷玩家', displayName: '精致生活玩家',
    art: 'persona-figma-refined-player.png', gradient: ['#fff0f5', '#f4cfdd'], accent: '#b9587b',
    quote: '喜欢的不只是一件东西，也是它表达的生活态度。', tags: ['风格表达', '价值共鸣'],
  }),
  atmosphere: card({
    id: 'atmosphere', sourceName: '氛围感收割机',
    art: 'persona-figma-atmosphere.png', gradient: ['#fff5e8', '#f5d9c1'], accent: '#cc755d',
    quote: '你会为舒适和氛围买单，也愿意照顾当下感受。', tags: ['氛围体验', '情绪疗愈'],
  }),
  night_shopper: card({
    id: 'night_shopper', sourceName: '深夜剁手怪', displayName: '夜间心动客',
    art: 'persona-figma-night-shopper.png', gradient: ['#edf0ff', '#bdc7ef'], accent: '#596ab1',
    quote: '夜深时的心动更响亮，醒来后再听一次也不迟。', tags: ['夜间心动', '隔夜确认'],
  }),
  reward_spender: card({
    id: 'reward_spender', sourceName: '奖励性消费家',
    art: 'persona-figma-reward-spender.png', gradient: ['#fff4df', '#f6cf9b'], accent: '#d88430',
    quote: '你会用一份小礼物回应辛苦，也在寻找更合适的奖励。', tags: ['自我奖励', '温柔缓冲'],
  }),
  stockpiler: card({
    id: 'stockpiler', sourceName: '囤货型选手',
    art: 'persona-figma-stockpiler.png', gradient: ['#eef7e6', '#c8ddb0'], accent: '#6f8d4f',
    quote: '多一份备用会更安心，盘点存量能让安心更踏实。', tags: ['备用偏好', '先看库存'],
  }),
  joy_wholesaler: card({
    id: 'joy_wholesaler', sourceName: '成年人快乐批发商', displayName: '快乐批发商',
    art: 'persona-figma-joy-wholesaler.png', gradient: ['#fff3d9', '#ffd398'], accent: '#e47d2c',
    quote: '快乐和参与感都很重要，你在为体验留下位置。', tags: ['快乐体验', '共同参与'],
  }),
  food_delivery: card({
    id: 'food_delivery', sourceName: '快乐外卖党',
    art: 'persona-figma-food-delivery.png', gradient: ['#fff7d5', '#f2d68b'], accent: '#c98524',
    quote: '一顿省心的满足很真实，先分清饿了还是想被安慰。', tags: ['即时满足', '味蕾疗愈'],
  }),
  flip_flop: card({
    id: 'flip_flop', sourceName: '翻脸横跳派',
    art: 'persona-figma-flip-flop.png', gradient: ['#eef7ff', '#c8ddea'], accent: '#4d8098',
    quote: '改变决定并不丢脸，它说明你在用新信息重新判断。', tags: ['动态决策', '允许纠正'],
  }),
  milk_tea: card({
    id: 'milk_tea', sourceName: '奶茶续命人',
    art: 'persona-figma-milk-tea.png', gradient: ['#fff1e6', '#e8c4ab'], accent: '#a96647',
    quote: '一杯小快乐很具体，十分钟缓冲也能保留这份快乐。', tags: ['嘴馋时刻', '十分钟缓冲'],
  }),
  limited_deal: card({
    id: 'limited_deal', sourceName: '限时优惠上头客',
    art: 'persona-figma-limited-deal.png', gradient: ['#fff2d4', '#ffc984'], accent: '#e56c2f',
    quote: '限时的是优惠，不是你的决定时间。', tags: ['优惠雷达', '拆解规则'],
  }),
  impulse_hunter: card({
    id: 'impulse_hunter', sourceName: '冲动型猎人',
    art: 'persona-figma-impulse-hunter.png', gradient: ['#fff0e6', '#f5bda2'], accent: '#d65b3d',
    quote: '种草信号来得敏锐，留一步查证会让选择更像你。', tags: ['种草敏锐', '先查再定'],
  }),
  wallet_drifter: card({
    id: 'wallet_drifter', sourceName: '钱包摆烂侠', displayName: '钱包随心侠',
    art: 'persona-figma-wallet-drifter.png', gradient: ['#f3f1ff', '#d8d1ed'], accent: '#7568a6',
    quote: '现在还没有一种模式占上风，继续观察就会更清楚。', tags: ['证据形成中', '保持观察'],
  }),
  price_lover: card({
    id: 'price_lover', sourceName: '价格真香党',
    art: 'persona-figma-price-lover.png', gradient: ['#eff9e9', '#cde4bc'], accent: '#608c4a',
    quote: '你擅长看懂价格差，也会为“真的需要”再验一次。', tags: ['价格敏感', '理性拆解'],
  }),
  rollercoaster: card({
    id: 'rollercoaster', sourceName: '钱包过山车玩家',
    art: 'persona-figma-rollercoaster.png', gradient: ['#edf7ff', '#bedbec'], accent: '#3c82a6',
    quote: '不同场景会唤起不同策略，这也是你真实的消费节奏。', tags: ['策略切换', '平衡观察'],
  }),
  hobby: card({
    id: 'hobby', sourceName: '兴趣氪金怪', displayName: '兴趣投入家',
    art: 'persona-figma-hobby.png', gradient: ['#f3efff', '#d5c4ef'], accent: '#7557a8',
    quote: '你愿意为技能与作品投入，明确下一次使用会更踏实。', tags: ['兴趣投入', '目标驱动'],
  }),
  saving_dreamer: card({
    id: 'saving_dreamer', sourceName: '省钱幻想家',
    art: 'persona-figma-saving-dreamer.png', gradient: ['#edf8ef', '#c1dfc5'], accent: '#4f8b60',
    quote: '你在练习把心动放一晚，让省下逐渐变成可见结果。', tags: ['自主判断', '延迟满足'],
  }),
  small_spend: card({
    id: 'small_spend', sourceName: '小额无感王',
    art: 'persona-figma-small-spend.png', gradient: ['#fff6de', '#ead8a1'], accent: '#9a7a2f',
    quote: '小额也值得被看见，记录会帮你找回每一次决定感。', tags: ['小额观察', '积少成像'],
  }),
  rational_survivor: card({
    id: 'rational_survivor', sourceName: '理智幸存者', displayName: '冷静幸存者',
    art: 'persona-figma-rational-survivor.png', gradient: ['#ecf8f3', '#bcdccd'], accent: '#3d8167',
    quote: '你常给欲望留出时间，也能主动放下一部分购买。', tags: ['冷静决定', '主动放下'],
  }),
});

export const CANONICAL_PERSONAS = Object.freeze({
  sovereign_researcher: Object.freeze({ id: 'sovereign_researcher', name: '研究主权者' }),
  deal_actuary: Object.freeze({ id: 'deal_actuary', name: '优惠精算师' }),
  seeded_sprinter: Object.freeze({ id: 'seeded_sprinter', name: '种草冲锋手' }),
  sensory_healer: Object.freeze({ id: 'sensory_healer', name: '氛围疗愈师' }),
  social_resonator: Object.freeze({ id: 'social_resonator', name: '社交共鸣者' }),
  micro_achiever: Object.freeze({ id: 'micro_achiever', name: '微观成就家' }),
  minimal_buffer: Object.freeze({ id: 'minimal_buffer', name: '极简缓冲者' }),
  stock_collector: Object.freeze({ id: 'stock_collector', name: '收藏囤货派' }),
  balanced_observer: Object.freeze({ id: 'balanced_observer', name: '平衡洞察者' }),
  desire_observer: Object.freeze({ id: 'desire_observer', name: '欲望观察员' }),
});

export const FIGMA_PERSONA_CARD_IDS = Object.freeze(Object.keys(FIGMA_PERSONA_CARDS));

const PERSONA_CARD_FAMILIES = Object.freeze({
  sovereign_researcher: Object.freeze(['saving_dreamer', 'cart_stayer']),
  deal_actuary: Object.freeze(['price_lover', 'limited_deal']),
  seeded_sprinter: Object.freeze(['impulse_hunter', 'buy_crazy']),
  sensory_healer: Object.freeze(['atmosphere', 'milk_tea', 'food_delivery', 'reward_spender']),
  social_resonator: Object.freeze(['refined_player', 'joy_wholesaler']),
  micro_achiever: Object.freeze(['hobby']),
  minimal_buffer: Object.freeze(['cart_stayer', 'rational_survivor']),
  stock_collector: Object.freeze(['stockpiler']),
  balanced_observer: Object.freeze(['rollercoaster', 'flip_flop']),
  desire_observer: Object.freeze(['wallet_drifter']),
});

const PERSONA_CANDIDATE_FAMILY_LIMIT = 3;

const safeText = (value, maxLength = 80) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
const finiteNumber = (value) => {
  if (value === null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const clampPercent = (value) => Math.min(100, Math.max(0, Math.round(finiteNumber(value) || 0)));

export function isFigmaPersonaCardId(value) {
  return typeof value === 'string' && Object.hasOwn(FIGMA_PERSONA_CARDS, value);
}

export function getPersonaCardFamily(personaId) {
  return PERSONA_CARD_FAMILIES[personaId] || Object.freeze([]);
}

function rankedLabel(entries, key, maxLength = 18) {
  if (!Array.isArray(entries)) return '';
  return [...entries]
    .filter((entry) => safeText(entry?.[key], maxLength))
    .sort((left, right) => (finiteNumber(right?.count) || 0) - (finiteNumber(left?.count) || 0))
    .map((entry) => safeText(entry[key], maxLength))[0] || '';
}

function getEligibleSignalCardIds(assessment) {
  const signals = assessment?.presentationSignals;
  if (signals?.source !== 'aggregated_local_orders' || signals?.purpose !== 'presentation_only') return [];
  const orderCount = finiteNumber(signals.orderCount) || 0;
  const nightCount = finiteNumber(signals.nightCount) || 0;
  const nightRate = finiteNumber(signals.nightRate) || 0;
  const smallSpendCount = finiteNumber(signals.smallSpendCount) || 0;
  const smallSpendRate = finiteNumber(signals.smallSpendRate) || 0;
  const nightEligible = orderCount >= 3 && nightCount >= 3 && nightRate >= 0.6;
  const smallSpendEligible = orderCount >= 3 && smallSpendCount >= 3 && smallSpendRate >= 0.6;
  return [nightEligible && 'night_shopper', smallSpendEligible && 'small_spend'].filter(Boolean);
}

function chooseSignalCardId(assessment) {
  const eligibleCardIds = getEligibleSignalCardIds(assessment);
  const nightEligible = eligibleCardIds.includes('night_shopper');
  const smallSpendEligible = eligibleCardIds.includes('small_spend');
  if (!nightEligible && !smallSpendEligible) return '';
  if (nightEligible && !smallSpendEligible) return 'night_shopper';
  if (smallSpendEligible && !nightEligible) return 'small_spend';
  const signals = assessment.presentationSignals;
  const nightRate = finiteNumber(signals.nightRate) || 0;
  const smallSpendRate = finiteNumber(signals.smallSpendRate) || 0;
  const nightCount = finiteNumber(signals.nightCount) || 0;
  const smallSpendCount = finiteNumber(signals.smallSpendCount) || 0;
  if (nightRate !== smallSpendRate) return nightRate > smallSpendRate ? 'night_shopper' : 'small_spend';
  if (nightCount !== smallSpendCount) return nightCount > smallSpendCount ? 'night_shopper' : 'small_spend';
  return 'night_shopper';
}

function chooseCardId(personaId, assessment) {
  const signalCardId = chooseSignalCardId(assessment);
  if (signalCardId) return signalCardId;
  const topCategory = rankedLabel(assessment?.categories, 'category');
  const topReason = rankedLabel(assessment?.reasons, 'reason');
  const outcomes = assessment?.outcomes || {};
  switch (personaId) {
    case 'sovereign_researcher':
      return (finiteNumber(outcomes.medianDecisionHours) || 0) >= 24 ? 'cart_stayer' : 'saving_dreamer';
    case 'deal_actuary':
      return topReason === '限时优惠' ? 'limited_deal' : 'price_lover';
    case 'seeded_sprinter':
      return (finiteNumber(outcomes.purchaseRate) || 0) >= 0.67 ? 'buy_crazy' : 'impulse_hunter';
    case 'sensory_healer':
      if (topReason === '嘴馋') return 'milk_tea';
      if (topCategory === '餐饮饮品') return 'food_delivery';
      if (topReason === '情绪不好') return 'reward_spender';
      return 'atmosphere';
    case 'social_resonator':
      return topCategory === '娱乐社交' ? 'joy_wholesaler' : 'refined_player';
    case 'micro_achiever':
      return 'hobby';
    case 'minimal_buffer':
      return (finiteNumber(outcomes.savedCountRate) || 0) >= 0.6 ? 'rational_survivor' : 'cart_stayer';
    case 'stock_collector':
      return 'stockpiler';
    case 'balanced_observer':
      return (finiteNumber(outcomes.reversalRate) || 0) >= 0.15 ? 'flip_flop' : 'rollercoaster';
    default:
      return 'wallet_drifter';
  }
}

export function getAllowedPersonaCardIds(assessment = {}) {
  const incomingPrimaryId = assessment?.primaryPersona?.id;
  const primaryId = Object.hasOwn(CANONICAL_PERSONAS, incomingPrimaryId)
    ? incomingPrimaryId
    : 'desire_observer';
  const personaIds = [
    primaryId,
    assessment?.secondaryPersona?.id,
    ...(Array.isArray(assessment?.personaCandidates)
      ? assessment.personaCandidates.slice(0, PERSONA_CANDIDATE_FAMILY_LIMIT).map((candidate) => candidate?.id)
      : []),
  ];
  const allowed = new Set();
  personaIds.forEach((personaId) => {
    if (!Object.hasOwn(CANONICAL_PERSONAS, personaId)) return;
    getPersonaCardFamily(personaId).forEach((cardId) => allowed.add(cardId));
  });
  getEligibleSignalCardIds(assessment).forEach((cardId) => allowed.add(cardId));
  allowed.add(chooseCardId(primaryId, assessment));
  return Object.freeze([...allowed]);
}

function cleanEvidenceIds(value) {
  if (!Array.isArray(value)) return [];
  const unique = [];
  value.forEach((item) => {
    const evidenceId = safeText(item, 64);
    if (!/^[a-z0-9][a-z0-9:_-]{0,63}$/i.test(evidenceId) || unique.includes(evidenceId)) return;
    unique.push(evidenceId);
  });
  return unique;
}

function selectInferenceCandidate(inference, allowedCardIds) {
  if (!Array.isArray(inference?.candidates)) return null;
  const allowed = new Set(allowedCardIds);
  for (const candidate of inference.candidates) {
    const cardId = safeText(candidate?.cardId, 40);
    const confidence = finiteNumber(candidate?.confidence);
    const evidenceIds = cleanEvidenceIds(candidate?.evidenceIds);
    if (!isFigmaPersonaCardId(cardId)) continue;
    if (confidence === null || confidence < 0.55 || confidence > 1) continue;
    if (evidenceIds.length < 2 || !allowed.has(cardId)) continue;
    return Object.freeze({
      cardId,
      confidence: Math.round(confidence * 1000) / 1000,
      rationale: safeText(candidate?.rationale, 160),
      evidenceIds: Object.freeze(evidenceIds),
    });
  }
  return null;
}

export function resolvePersonaPresentation(assessment = {}, inference = null) {
  const incoming = assessment?.primaryPersona;
  const canonical = CANONICAL_PERSONAS[incoming?.id] || CANONICAL_PERSONAS.desire_observer;
  const isFallback = canonical.id === 'desire_observer' && incoming?.id !== 'desire_observer';
  const rationale = isFallback
    ? '目前还没有一种决策方式稳定占上风。'
    : (safeText(incoming?.rationale, 96) || '这是近期聚合记录呈现出的主要决策方式。');
  const fitScore = isFallback ? 0 : clampPercent(incoming?.fitScore);
  const localCard = FIGMA_PERSONA_CARDS[chooseCardId(canonical.id, assessment)];
  const selectedInference = selectInferenceCandidate(inference, getAllowedPersonaCardIds(assessment));
  const selectedCard = selectedInference ? FIGMA_PERSONA_CARDS[selectedInference.cardId] : localCard;
  return Object.freeze({
    canonical: Object.freeze({ id: canonical.id, name: canonical.name, rationale, fitScore }),
    card: selectedCard,
    localCard,
    decision: selectedInference ? 'hybrid' : 'local',
    inference: selectedInference,
  });
}
