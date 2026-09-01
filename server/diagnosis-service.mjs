import {
  CANONICAL_PERSONAS,
  FIGMA_PERSONA_CARDS,
  getAllowedPersonaCardIds,
  isFigmaPersonaCardId,
  resolvePersonaPresentation,
} from '../persona-presentations.js';

const DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const PERSONA_CANDIDATE_LIMIT = 3;
const PERSONA_EVIDENCE_LIMIT = 3;
const CANONICAL_PERSONA_IDS = new Set(Object.keys(CANONICAL_PERSONAS));
const ALLOWED_CATEGORIES = Object.freeze(new Set([
  '餐饮饮品', '服饰美妆', '数码家居', '娱乐社交', '学习成长', '旅行交通', '其他',
]));
const ALLOWED_REASONS = Object.freeze(new Set([
  '嘴馋', '无聊', '被种草', '情绪不好', '限时优惠', '社交需要', '自我提升', '其他',
]));
const CANONICAL_PERSONA_RATIONALES = Object.freeze({
  sovereign_researcher: '近期记录更常体现比较、研究和自主确认。',
  deal_actuary: '近期记录更常体现价格拆解和优惠核对。',
  seeded_sprinter: '近期记录更常体现种草触发后的快速行动。',
  sensory_healer: '近期记录更常体现对情绪和体验感受的回应。',
  social_resonator: '近期记录更常体现社交场景和外部共鸣。',
  micro_achiever: '近期记录更常体现对成长与阶段成果的投入。',
  minimal_buffer: '近期记录更常体现延迟决定和主动放下。',
  stock_collector: '近期记录更常体现备用、收藏和重复持有倾向。',
  balanced_observer: '近期记录中多种决策方式较为均衡。',
  desire_observer: '当前聚合证据还不足以形成稳定的规则人格。',
});
const AXIS_LABELS = Object.freeze({
  I: '即时冲动', P: '价格敏感', R: '研究验证', X: '外部依赖', E: '情绪体验',
});
const MOTIVATION_LABELS = Object.freeze({
  control: '掌控', healing: '疗愈', achievement: '成就', identity: '认同',
});
const PROVIDER_MODEL_PATTERN = /\bdeep[\s_-]*seek(?:(?:[-_.:/][a-z0-9]+)+|\s+(?:v?\d[\w.-]*|r\d[\w.-]*|chat|coder|reasoner|flash))?/gi;
const PROVIDER_MODEL_ZH_PATTERN = /深度求索(?:(?:[-_.:/][a-z0-9]+)+|\s+(?:v?\d[\w.-]*|r\d[\w.-]*|chat|coder|reasoner|flash|模型))?/gi;
const MODEL_ALIAS_PATTERN = /\b(?:r1(?:[-_.\s]*(?:distill|zero|reasoner|chat|coder))?|v3(?:\.\d+)?(?:[-_.\s]*(?:flash|chat|reasoner|coder|terminus))?|v4(?:[-_.\s]*(?:flash|chat|reasoner|coder))?)\b/gi;

export class ServiceError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.status = status;
  }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finiteNumber = (value, min = 0, max = 100_000_000) => Number.isFinite(value) && value >= min && value <= max;

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function escapedPattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanUserFacingText(value, maxLength, blockedModelNames = []) {
  let result = cleanText(value, maxLength)
    .replace(PROVIDER_MODEL_PATTERN, '复诊服务')
    .replace(PROVIDER_MODEL_ZH_PATTERN, '复诊服务')
    .replace(MODEL_ALIAS_PATTERN, '复诊服务');
  for (const modelName of blockedModelNames) {
    const token = cleanText(modelName, 120);
    if (token.length < 3) continue;
    result = result.replace(new RegExp(escapedPattern(token), 'gi'), '复诊服务');
  }
  return result
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function requiredText(value, maxLength, field, blockedModelNames = []) {
  const result = cleanUserFacingText(value, maxLength, blockedModelNames);
  if (!result) throw new ServiceError('invalid_ai_output', `复诊结果缺少${field}`, 502);
  return result;
}

function canonicalPersonaRationale(personaId) {
  return CANONICAL_PERSONA_RATIONALES[personaId] || CANONICAL_PERSONA_RATIONALES.desire_observer;
}

function validateBreakdown(items, key, maxItems) {
  if (!Array.isArray(items) || items.length > maxItems) throw new ServiceError('invalid_request', `${key} 格式不正确`, 400);
  return items.map((item) => {
    if (!isPlainObject(item)) throw new ServiceError('invalid_request', `${key} 包含无效项目`, 400);
    const labelKey = key === 'categories' ? 'category' : 'reason';
    const label = cleanText(item[labelKey], 20);
    const allowedLabels = key === 'categories' ? ALLOWED_CATEGORIES : ALLOWED_REASONS;
    if (!allowedLabels.has(label) || !Number.isInteger(item.count) || item.count < 0 || item.count > 10_000) {
      throw new ServiceError('invalid_request', `${key} 包含无效统计`, 400);
    }
    const result = { [labelKey]: label, count: item.count };
    if (key === 'categories') {
      if (!finiteNumber(item.amount)) throw new ServiceError('invalid_request', '分类金额无效', 400);
      result.amount = Number(item.amount.toFixed(2));
    }
    return result;
  });
}

function countValue(value, field, max = 10_000) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new ServiceError('invalid_request', `${field}无效`, 400);
  }
  return value;
}

function rateValue(value, field) {
  const number = Number(value);
  if (!finiteNumber(number, 0, 1)) throw new ServiceError('invalid_request', `${field}无效`, 400);
  return Number(number.toFixed(3));
}

function validatePresentationSignals(value) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)
    || value.source !== 'aggregated_local_orders'
    || value.purpose !== 'presentation_only') {
    throw new ServiceError('invalid_request', '展示人格聚合信号无效', 400);
  }
  const orderCount = countValue(value.orderCount, '展示人格订单数');
  const nightCount = countValue(value.nightCount, '夜间记录数');
  const smallSpendCount = countValue(value.smallSpendCount, '小额记录数');
  if ((value.nightWindow !== undefined && value.nightWindow !== '22:00-05:59')
    || nightCount > orderCount
    || smallSpendCount > orderCount) {
    throw new ServiceError('invalid_request', '展示人格聚合数量不一致', 400);
  }
  const smallSpendLimit = value.smallSpendLimit === undefined ? 50 : Number(value.smallSpendLimit);
  if (!finiteNumber(smallSpendLimit, 0.01, 100_000)) {
    throw new ServiceError('invalid_request', '小额阈值无效', 400);
  }
  const medianAmount = value.medianAmount === null ? null : Number(value.medianAmount);
  if (medianAmount !== null && !finiteNumber(medianAmount)) {
    throw new ServiceError('invalid_request', '中位金额无效', 400);
  }
  const nightRate = rateValue(value.nightRate, '夜间记录占比');
  const smallSpendRate = rateValue(value.smallSpendRate, '小额记录占比');
  const expectedNightRate = orderCount ? Number((nightCount / orderCount).toFixed(3)) : 0;
  const expectedSmallSpendRate = orderCount ? Number((smallSpendCount / orderCount).toFixed(3)) : 0;
  if (Math.abs(nightRate - expectedNightRate) > 0.001 || Math.abs(smallSpendRate - expectedSmallSpendRate) > 0.001) {
    throw new ServiceError('invalid_request', '展示人格聚合占比不一致', 400);
  }
  return {
    source: 'aggregated_local_orders',
    purpose: 'presentation_only',
    orderCount,
    nightWindow: '22:00-05:59',
    nightCount,
    nightRate,
    smallSpendLimit: Number(smallSpendLimit.toFixed(2)),
    smallSpendCount,
    smallSpendRate,
    medianAmount: medianAmount === null ? null : Number(medianAmount.toFixed(2)),
  };
}

function validateLocalPersonaCandidates(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > PERSONA_CANDIDATE_LIMIT) {
    throw new ServiceError('invalid_request', '本地人格候选结构无效', 400);
  }
  const seen = new Set();
  return value.map((item) => {
    if (!isPlainObject(item) || !CANONICAL_PERSONA_IDS.has(item.id)) {
      throw new ServiceError('invalid_request', '本地人格候选包含无效项目', 400);
    }
    const fitScore = Number(item.fitScore);
    if (!finiteNumber(fitScore, 0, 100)) {
      throw new ServiceError('invalid_request', '本地人格候选匹配度无效', 400);
    }
    return {
      id: item.id,
      name: CANONICAL_PERSONAS[item.id].name,
      fitScore: Number(fitScore.toFixed(1)),
      rationale: canonicalPersonaRationale(item.id),
    };
  }).filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function normalizeStatuses(value) {
  if (!isPlainObject(value)) return { cooling: 0, saved: 0, purchased: 0 };
  return Object.fromEntries(['cooling', 'saved', 'purchased'].map((key) => [
    key,
    Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 10_000 ? value[key] : 0,
  ]));
}

function normalizeMotivations(value) {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(['control', 'healing', 'achievement', 'identity']
    .filter((key) => finiteNumber(Number(value[key]), 0, 1))
    .map((key) => [key, Number(Number(value[key]).toFixed(3))]));
}

function normalizeOutcomes(value) {
  if (!isPlainObject(value)) return {};
  const normalized = {};
  for (const key of ['decidedCount', 'savedCount']) {
    if (Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 10_000) normalized[key] = value[key];
  }
  for (const key of ['savedCountRate', 'savedAmountRate', 'purchaseRate', 'reversalRate']) {
    if (finiteNumber(Number(value[key]), 0, 1)) normalized[key] = Number(Number(value[key]).toFixed(3));
  }
  if (value.medianDecisionHours === null) normalized.medianDecisionHours = null;
  else if (finiteNumber(Number(value.medianDecisionHours), 0, 24 * 365)) {
    normalized.medianDecisionHours = Number(Number(value.medianDecisionHours).toFixed(1));
  }
  return normalized;
}

function normalizeConfidence(value) {
  if (!isPlainObject(value)) return {};
  const score = finiteNumber(Number(value.score), 0, 100) ? Math.round(Number(value.score)) : 0;
  const effectiveN = finiteNumber(Number(value.effectiveN), 0, 10_000) ? Number(Number(value.effectiveN).toFixed(1)) : 0;
  const axisCoverage = finiteNumber(Number(value.axisCoverage), 0, 1) ? Number(Number(value.axisCoverage).toFixed(2)) : 0;
  return {
    score,
    level: ['insufficient', 'forming', 'stable'].includes(value.level) ? value.level : 'forming',
    effectiveN,
    axisCoverage,
  };
}

export function validateDiagnosisRequest(input) {
  if (!isPlainObject(input) || input.schemaVersion !== 'wallet-summary-v1') {
    throw new ServiceError('invalid_request', '请求版本或结构不正确', 400);
  }
  const period = input.period === 7 ? 7 : (input.period === 30 ? 30 : null);
  if (!period) throw new ServiceError('invalid_request', '统计周期必须是 7 或 30 天', 400);
  if (!isPlainObject(input.totals)
    || !finiteNumber(input.totals.recorded)
    || !finiteNumber(input.totals.saved)
    || !finiteNumber(input.totals.purchased)
    || !Number.isInteger(input.totals.coolingCount)
    || input.totals.coolingCount < 0) {
    throw new ServiceError('invalid_request', '金额或订单状态汇总无效', 400);
  }
  const categories = validateBreakdown(input.categories, 'categories', 7);
  const reasons = validateBreakdown(input.reasons, 'reasons', 8);
  if (!isPlainObject(input.localAssessment) || !isPlainObject(input.localAssessment.primaryPersona)) {
    throw new ServiceError('invalid_request', '缺少本地评分结果', 400);
  }
  const primaryPersona = {
    id: cleanText(input.localAssessment.primaryPersona.id, 40),
    fitScore: Number(input.localAssessment.primaryPersona.fitScore),
    rationale: '',
  };
  if (!CANONICAL_PERSONA_IDS.has(primaryPersona.id) || !finiteNumber(primaryPersona.fitScore, 0, 100)) {
    throw new ServiceError('invalid_request', '本地主人格无效', 400);
  }
  primaryPersona.name = CANONICAL_PERSONAS[primaryPersona.id].name;
  primaryPersona.rationale = canonicalPersonaRationale(primaryPersona.id);
  const axes = {};
  for (const key of ['I', 'P', 'R', 'X', 'E']) {
    const source = input.localAssessment.axes?.[key];
    if (!isPlainObject(source)) throw new ServiceError('invalid_request', `缺少 ${key} 维度`, 400);
    const score = source.score === null ? null : Number(source.score);
    if (score !== null && !finiteNumber(score, 0, 100)) throw new ServiceError('invalid_request', `${key} 分数无效`, 400);
    axes[key] = {
      score,
      confidence: finiteNumber(Number(source.confidence), 0, 1) ? Number(source.confidence) : 0,
      evidenceCount: Number.isInteger(source.evidenceCount) ? source.evidenceCount : 0,
    };
  }
  const incomingEvidence = input.localAssessment.evidence;
  if (!Array.isArray(incomingEvidence)
    || incomingEvidence.length < 2
    || incomingEvidence.length > 8
    || incomingEvidence.some((item) => !isPlainObject(item))) {
    throw new ServiceError('invalid_request', '至少需要两条有效的本地聚合证据', 400);
  }
  const presentationSignals = validatePresentationSignals(input.presentationSignals);
  const personaCandidates = validateLocalPersonaCandidates(input.personaCandidates);
  let secondaryPersona = null;
  if (isPlainObject(input.localAssessment.secondaryPersona)) {
    const id = cleanText(input.localAssessment.secondaryPersona.id, 40);
    const fitScore = Number(input.localAssessment.secondaryPersona.fitScore);
    if (!CANONICAL_PERSONA_IDS.has(id) || !finiteNumber(fitScore, 0, 100)) {
      throw new ServiceError('invalid_request', '本地副人格无效', 400);
    }
    secondaryPersona = {
      id,
      name: CANONICAL_PERSONAS[id].name,
      fitScore: Number(fitScore.toFixed(1)),
    };
  }
  const normalized = {
    schemaVersion: 'wallet-summary-v1',
    scoringModelVersion: cleanText(input.scoringModelVersion, 80),
    period,
    totals: {
      recorded: Number(input.totals.recorded.toFixed(2)),
      saved: Number(input.totals.saved.toFixed(2)),
      purchased: Number(input.totals.purchased.toFixed(2)),
      coolingCount: input.totals.coolingCount,
    },
    categories,
    reasons,
    statuses: normalizeStatuses(input.statuses),
    dataMode: ['personal', 'demo', 'mixed'].includes(input.dataMode) ? input.dataMode : 'personal',
    presentationSignals,
    personaCandidates,
    localAssessment: {
      axes,
      motivations: normalizeMotivations(input.localAssessment.motivations),
      outcomes: normalizeOutcomes(input.localAssessment.outcomes),
      primaryPersona,
      secondaryPersona,
      walletTheme: categories[0] ? `${categories[0].category}近期主题` : '近期消费观察',
      confidence: normalizeConfidence(input.localAssessment.confidence),
      evidence: [],
      localAdvice: '先记录，再决定；需要时可以随时调整。',
    },
    goal: null,
  };
  if (input.goal !== null && input.goal !== undefined) {
    if (!isPlainObject(input.goal)
      || !finiteNumber(input.goal.targetAmount, 0.01)
      || !finiteNumber(input.goal.progress)
      || !finiteNumber(input.goal.progressRate, 0, 1)) {
      throw new ServiceError('invalid_request', '目标汇总无效', 400);
    }
    normalized.goal = {
      targetAmount: Number(input.goal.targetAmount.toFixed(2)),
      progress: Number(input.goal.progress.toFixed(2)),
      progressRate: Number(input.goal.progressRate.toFixed(3)),
    };
  }
  normalized.localAssessment.evidence = buildEvidenceCatalog(normalized);
  return normalized;
}

export function buildEvidenceCatalog(summary) {
  const facts = [];
  const topCategory = [...summary.categories]
    .sort((left, right) => right.count - left.count || right.amount - left.amount)[0];
  const topReason = [...summary.reasons]
    .sort((left, right) => right.count - left.count)[0];
  const outcomes = summary.localAssessment.outcomes;
  const topAxis = Object.entries(summary.localAssessment.axes)
    .filter(([, axis]) => axis.score !== null)
    .sort((left, right) => Math.abs(right[1].score - 50) - Math.abs(left[1].score - 50))[0];
  const topMotivation = Object.entries(summary.localAssessment.motivations)
    .sort((left, right) => right[1] - left[1])[0];
  if (topCategory) {
    facts.push({
      metric: 'category',
      statement: `${summary.period} 天内，${topCategory.category}共 ${topCategory.count} 笔，聚合金额 ¥${topCategory.amount.toFixed(2)}。`,
    });
  }
  if (topReason) {
    facts.push({
      metric: 'reason',
      statement: `最常出现的触发原因是“${topReason.reason}”，共 ${topReason.count} 次。`,
    });
  }
  if (Number.isInteger(outcomes.decidedCount) && outcomes.decidedCount > 0) {
    facts.push({
      metric: 'outcome',
      statement: `已做决定的 ${outcomes.decidedCount} 笔中，有 ${outcomes.savedCount || 0} 笔确认未买，冷静单数率 ${Math.round((outcomes.savedCountRate || 0) * 100)}%。`,
    });
  }
  if (topAxis) {
    facts.push({
      metric: 'axis',
      statement: `${AXIS_LABELS[topAxis[0]]}是目前最突出的维度，分数 ${topAxis[1].score}/100。`,
    });
  }
  if (topMotivation) {
    facts.push({
      metric: 'motivation',
      statement: `近期占比最高的购买动机是“${MOTIVATION_LABELS[topMotivation[0]]}”，占 ${Math.round(topMotivation[1] * 100)}%。`,
    });
  }
  const orderCount = summary.presentationSignals?.orderCount
    ?? Object.values(summary.statuses).reduce((total, count) => total + count, 0);
  facts.push({
    metric: 'sample',
    statement: `本次画像使用 ${orderCount} 笔聚合记录，记录金额合计 ¥${summary.totals.recorded.toFixed(2)}。`,
  });
  if (facts.length < 2) {
    facts.push({
      metric: 'status',
      statement: `状态汇总为冷静中 ${summary.statuses.cooling} 笔、确认未买 ${summary.statuses.saved} 笔、最终购买 ${summary.statuses.purchased} 笔。`,
    });
  }
  return facts.slice(0, 8).map((item, index) => ({ id: `E${index + 1}`, ...item }));
}

function resolverAssessment(summary) {
  return {
    ...summary.localAssessment,
    categories: summary.categories,
    reasons: summary.reasons,
    statuses: summary.statuses,
    presentationSignals: summary.presentationSignals,
    personaCandidates: summary.personaCandidates,
  };
}

function figmaPersonaDirectory() {
  return Object.values(FIGMA_PERSONA_CARDS).map((card) => ({
    cardId: card.id,
    displayName: card.displayName,
    quote: card.quote,
    tags: [...card.tags],
  }));
}

function promptFor(summary, evidenceCatalog) {
  const assessment = resolverAssessment(summary);
  const compatibleCardIds = getAllowedPersonaCardIds(assessment);
  const responseShape = {
    personaCandidates: [{
      cardId: '20 个卡面 ID 之一',
      confidence: '0 到 1 的数字',
      rationale: '不超过 120 字，解释聚合证据为何支持该展示人格',
      evidenceIds: ['E1', 'E2'],
    }],
    personaSummary: '不超过 80 个中文字符，解释本地规则人格与展示人格的组合含义',
    evidenceIds: ['E1', 'E2'],
    pattern: '不超过 160 个中文字符，只解释已给事实之间的关系',
    action: { title: '不超过 30 个中文字符', steps: ['1 到 3 个可执行步骤，每步不超过 60 字'] },
    goalLink: '不超过 100 个中文字符；没有目标时引导创建',
    suggestedQuestions: ['2 到 3 个后续自我观察问题，每个不超过 40 字'],
  };
  return [
    '你是“让你花个爽！”的钱包行为解读员。',
    '只解释输入中的聚合数据和本地评分。你可以推演展示人格卡面，但不能重新计算或修改分数、金额、次数、五维分数或本地规则人格。',
    '不能推断年龄、性别、收入、疾病、成瘾或任何未提供信息。不能提供投资、信贷、医疗或心理诊断。',
    '语气清醒、具体、轻松，不羞辱用户；只给一个本周动作。',
    '任何用户可见自由文本都不得出现服务商、模型、模型版本或接口名称；不要输出 DeepSeek、深度求索、R1、V3、V4 Flash 等标识。',
    '必须输出一个 JSON 对象，不要 Markdown，不要代码围栏。',
    `JSON 结构示例：${JSON.stringify(responseShape)}`,
    '展示人格候选按优先级输出 0 到 3 个；每个候选必须使用目录中的 cardId、0 到 1 的 confidence、非空 rationale，并引用 2 到 3 条不同证据。证据不足时返回空数组。',
    '不得自创 cardId 或人格名称；confidence 表示现有聚合证据对该卡面的支持度，不是修改本地置信度。',
    `20 个 Figma 展示人格严格目录：${JSON.stringify(figmaPersonaDirectory())}`,
    `根据本地规则与硬门槛，本次优先考虑这些兼容 cardId：${JSON.stringify(compatibleCardIds)}`,
    `本地主人格（必须保持其含义和标题）：${JSON.stringify(summary.localAssessment.primaryPersona)}`,
    `本地候选人格：${JSON.stringify(summary.personaCandidates)}`,
    `本地五维与动机：${JSON.stringify({ axes: summary.localAssessment.axes, motivations: summary.localAssessment.motivations, confidence: summary.localAssessment.confidence })}`,
    `聚合统计：${JSON.stringify({ period: summary.period, totals: summary.totals, categories: summary.categories, reasons: summary.reasons, outcomes: summary.localAssessment.outcomes, presentationSignals: summary.presentationSignals, dataMode: summary.dataMode })}`,
    `目标汇总：${JSON.stringify(summary.goal)}`,
    `可引用证据目录：${JSON.stringify(evidenceCatalog)}`,
    'evidenceIds 必须从证据目录选择 2 到 3 个不同 ID，禁止自己写新的数据依据。',
  ].join('\n');
}

function cleanPersonaCandidates(rawCandidates, evidenceCatalog, blockedModelNames = []) {
  if (!Array.isArray(rawCandidates)) return [];
  const validEvidenceIds = new Set(evidenceCatalog.map((item) => item.id));
  const seenCardIds = new Set();
  const result = [];
  for (const item of rawCandidates) {
    if (result.length >= PERSONA_CANDIDATE_LIMIT) break;
    if (!isPlainObject(item)) continue;
    const cardId = cleanText(item.cardId, 40);
    if (!isFigmaPersonaCardId(cardId) || seenCardIds.has(cardId)) continue;
    const confidence = Number(item.confidence);
    const rationale = cleanUserFacingText(item.rationale, 160, blockedModelNames);
    if (!finiteNumber(confidence, 0, 1) || !rationale) continue;
    const evidenceIds = Array.isArray(item.evidenceIds)
      ? [...new Set(item.evidenceIds
        .map((id) => cleanText(id, 12))
        .filter((id) => validEvidenceIds.has(id)))].slice(0, PERSONA_EVIDENCE_LIMIT)
      : [];
    if (evidenceIds.length < 2) continue;
    seenCardIds.add(cardId);
    result.push({
      cardId,
      confidence: Number(confidence.toFixed(3)),
      rationale,
      evidenceIds,
    });
  }
  return result;
}

function localPersonaSummary(presentation) {
  const localCard = presentation.localCard || presentation.card;
  return `近期聚合记录仍以“${presentation.canonical.name}”作为规则底座，趣味卡面采用“${localCard.displayName}”。`;
}

export function normalizeDeepSeekOutput(rawOutput, summary, evidenceCatalog = buildEvidenceCatalog(summary), options = {}) {
  if (!isPlainObject(rawOutput)) throw new ServiceError('invalid_ai_output', '复诊结果格式无效', 502);
  const blockedModelNames = [...new Set([
    DEFAULT_MODEL,
    ...(Array.isArray(options.modelNames) ? options.modelNames : []),
  ].filter((item) => typeof item === 'string' && item.trim()))];
  const catalog = new Map(evidenceCatalog.map((item) => [item.id, item]));
  const selectedIds = Array.isArray(rawOutput.evidenceIds)
    ? [...new Set(rawOutput.evidenceIds.map((id) => cleanText(id, 12)).filter((id) => catalog.has(id)))].slice(0, 3)
    : [];
  for (const item of evidenceCatalog) {
    if (selectedIds.length >= 2) break;
    if (!selectedIds.includes(item.id)) selectedIds.push(item.id);
  }
  const steps = Array.isArray(rawOutput.action?.steps)
    ? rawOutput.action.steps.map((step) => cleanUserFacingText(step, 80, blockedModelNames)).filter(Boolean).slice(0, 3)
    : [];
  if (!steps.length) throw new ServiceError('invalid_ai_output', '复诊结果缺少行动步骤', 502);
  const suggestedQuestions = Array.isArray(rawOutput.suggestedQuestions)
    ? rawOutput.suggestedQuestions.map((question) => cleanUserFacingText(question, 50, blockedModelNames)).filter(Boolean).slice(0, 3)
    : [];
  const candidates = cleanPersonaCandidates(rawOutput.personaCandidates, evidenceCatalog, blockedModelNames);
  const assessment = resolverAssessment(summary);
  const localPresentation = resolvePersonaPresentation(assessment);
  const presentation = resolvePersonaPresentation(assessment, { candidates });
  const decision = presentation.decision === 'hybrid' ? 'hybrid' : 'local';
  const acceptedInference = decision === 'hybrid'
    ? (presentation.inference || candidates.find((candidate) => candidate.cardId === presentation.card?.id) || null)
    : null;
  const personaSummary = decision === 'hybrid'
    ? requiredText(rawOutput.personaSummary, 120, '人格解释', blockedModelNames)
    : localPersonaSummary(presentation);
  const localConfidence = Math.min(1, Math.max(0, Number(summary.localAssessment.primaryPersona.fitScore) / 100));
  const acceptedConfidence = finiteNumber(Number(acceptedInference?.confidence), 0, 1)
    ? Number(acceptedInference.confidence)
    : localConfidence;
  const personaEvidenceIds = decision === 'hybrid' && Array.isArray(acceptedInference?.evidenceIds)
    ? acceptedInference.evidenceIds.slice(0, PERSONA_EVIDENCE_LIMIT)
    : selectedIds.slice(0, PERSONA_EVIDENCE_LIMIT);
  const resultEvidenceIds = decision === 'hybrid' ? personaEvidenceIds : selectedIds;
  return {
    persona: {
      title: presentation.card.displayName,
      canonicalTitle: presentation.canonical.name,
      cardId: presentation.card.id,
      localCardId: (presentation.localCard || localPresentation.card).id,
      decision,
      confidence: Number((decision === 'hybrid' ? acceptedConfidence : localConfidence).toFixed(3)),
      rationale: decision === 'hybrid'
        ? cleanUserFacingText(acceptedInference?.rationale, 160, blockedModelNames)
        : cleanText(presentation.canonical.rationale, 160),
      evidenceIds: personaEvidenceIds,
      candidates,
      summary: personaSummary,
    },
    evidence: resultEvidenceIds.map((id) => {
      const item = catalog.get(id);
      return {
        ...item,
        metric: cleanUserFacingText(item.metric, 20, blockedModelNames) || 'fact',
        statement: cleanUserFacingText(item.statement, 180, blockedModelNames),
      };
    }),
    pattern: requiredText(rawOutput.pattern, 220, '模式解读', blockedModelNames),
    action: {
      title: requiredText(rawOutput.action?.title, 50, '行动标题', blockedModelNames),
      steps,
    },
    goalLink: requiredText(rawOutput.goalLink, 140, '目标关联', blockedModelNames),
    disclaimer: '结果只基于你本次确认发送的消费汇总与本地评分，不是专业财务、医疗或心理意见。',
    suggestedQuestions,
  };
}

function mapUpstreamStatus(status) {
  if (status === 429) return new ServiceError('rate_limited', '复诊请求过于频繁，请稍后重试', 429);
  if (status === 401 || status === 403) return new ServiceError('upstream_auth_error', '复诊服务凭证无效', 502);
  return new ServiceError('upstream_error', '复诊服务暂时不可用', 502);
}

export async function requestDeepSeekDiagnosis({
  input,
  apiKey,
  model = DEFAULT_MODEL,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_500,
} = {}) {
  const summary = validateDiagnosisRequest(input);
  if (!apiKey) throw new ServiceError('missing_api_key', '复诊服务尚未配置', 503);
  if (typeof fetchImpl !== 'function') throw new ServiceError('server_error', '当前 Node 运行时不支持 fetch', 500);
  const evidenceCatalog = buildEvidenceCatalog(summary);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '输出必须是符合用户指定结构的 JSON。' },
          { role: 'user', content: promptFor(summary, evidenceCatalog) },
        ],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        temperature: 0.4,
        max_tokens: 1200,
        stream: false,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new ServiceError('upstream_timeout', '复诊请求超时', 504);
    throw new ServiceError('upstream_unreachable', '无法连接复诊服务', 502);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw mapUpstreamStatus(response.status);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ServiceError('invalid_ai_output', '复诊结果无法解析', 502);
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') throw new ServiceError('empty_ai_output', '复诊结果内容为空', 502);
  let rawOutput;
  try {
    rawOutput = JSON.parse(content);
  } catch {
    throw new ServiceError('invalid_ai_output', '复诊结果内容无效', 502);
  }
  return {
    result: normalizeDeepSeekOutput(rawOutput, summary, evidenceCatalog, { modelNames: [model] }),
  };
}

export const DEEPSEEK_DEFAULTS = Object.freeze({ model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL });
