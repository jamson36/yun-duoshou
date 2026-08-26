const DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_BASE_URL = 'https://api.deepseek.com';

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

function requiredText(value, maxLength, field) {
  const result = cleanText(value, maxLength);
  if (!result) throw new ServiceError('invalid_ai_output', `复诊结果缺少${field}`, 502);
  return result;
}

function validateBreakdown(items, key, maxItems) {
  if (!Array.isArray(items) || items.length > maxItems) throw new ServiceError('invalid_request', `${key} 格式不正确`, 400);
  return items.map((item) => {
    if (!isPlainObject(item)) throw new ServiceError('invalid_request', `${key} 包含无效项目`, 400);
    const labelKey = key === 'categories' ? 'category' : 'reason';
    const label = cleanText(item[labelKey], 20);
    if (!label || !Number.isInteger(item.count) || item.count < 0 || item.count > 10_000) {
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
    name: cleanText(input.localAssessment.primaryPersona.name, 30),
    fitScore: Number(input.localAssessment.primaryPersona.fitScore),
    rationale: cleanText(input.localAssessment.primaryPersona.rationale, 120),
  };
  if (!primaryPersona.id || !primaryPersona.name || !finiteNumber(primaryPersona.fitScore, 0, 100)) {
    throw new ServiceError('invalid_request', '本地主人格无效', 400);
  }
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
  const evidence = Array.isArray(input.localAssessment.evidence)
    ? input.localAssessment.evidence.slice(0, 8).map((item, index) => ({
      id: cleanText(item?.id, 40) || `evidence-${index + 1}`,
      metric: cleanText(item?.metric, 20) || 'fact',
      statement: cleanText(item?.statement, 180),
    })).filter((item) => item.statement)
    : [];
  if (evidence.length < 2) throw new ServiceError('invalid_request', '至少需要两条本地证据', 400);
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
    statuses: isPlainObject(input.statuses) ? input.statuses : {},
    dataMode: ['personal', 'demo', 'mixed'].includes(input.dataMode) ? input.dataMode : 'personal',
    localAssessment: {
      axes,
      motivations: isPlainObject(input.localAssessment.motivations) ? input.localAssessment.motivations : {},
      outcomes: isPlainObject(input.localAssessment.outcomes) ? input.localAssessment.outcomes : {},
      primaryPersona,
      secondaryPersona: isPlainObject(input.localAssessment.secondaryPersona) ? {
        id: cleanText(input.localAssessment.secondaryPersona.id, 40),
        name: cleanText(input.localAssessment.secondaryPersona.name, 30),
        fitScore: Number(input.localAssessment.secondaryPersona.fitScore) || 0,
      } : null,
      walletTheme: cleanText(input.localAssessment.walletTheme, 30),
      confidence: isPlainObject(input.localAssessment.confidence) ? input.localAssessment.confidence : {},
      evidence,
      localAdvice: cleanText(input.localAssessment.localAdvice, 160),
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
      name: cleanText(input.goal.name, 20) || '当前目标',
      targetAmount: Number(input.goal.targetAmount.toFixed(2)),
      progress: Number(input.goal.progress.toFixed(2)),
      progressRate: Number(input.goal.progressRate.toFixed(3)),
    };
  }
  return normalized;
}

export function buildEvidenceCatalog(summary) {
  return summary.localAssessment.evidence.map((item, index) => ({
    id: `E${index + 1}`,
    metric: item.metric,
    statement: item.statement,
  }));
}

function promptFor(summary, evidenceCatalog) {
  const responseShape = {
    personaSummary: '不超过 80 个中文字符，只解释本地人格，不更名',
    evidenceIds: ['E1', 'E2'],
    pattern: '不超过 160 个中文字符，只解释已给事实之间的关系',
    action: { title: '不超过 30 个中文字符', steps: ['1 到 3 个可执行步骤，每步不超过 60 字'] },
    goalLink: '不超过 100 个中文字符；没有目标时引导创建',
    suggestedQuestions: ['2 到 3 个后续自我观察问题，每个不超过 40 字'],
  };
  return [
    '你是“让你花个爽！”的钱包行为解读员。',
    '只解释输入中的聚合数据和本地评分，不能重新计算或修改分数、金额、次数、人格名称。',
    '不能推断年龄、性别、收入、疾病、成瘾或任何未提供信息。不能提供投资、信贷、医疗或心理诊断。',
    '语气清醒、具体、轻松，不羞辱用户；只给一个本周动作。',
    '必须输出一个 JSON 对象，不要 Markdown，不要代码围栏。',
    `JSON 结构示例：${JSON.stringify(responseShape)}`,
    `本地主人格（必须原样使用其含义，不要更名）：${JSON.stringify(summary.localAssessment.primaryPersona)}`,
    `本地五维与动机：${JSON.stringify({ axes: summary.localAssessment.axes, motivations: summary.localAssessment.motivations, confidence: summary.localAssessment.confidence })}`,
    `聚合统计：${JSON.stringify({ period: summary.period, totals: summary.totals, categories: summary.categories, reasons: summary.reasons, outcomes: summary.localAssessment.outcomes, dataMode: summary.dataMode })}`,
    `目标汇总：${JSON.stringify(summary.goal)}`,
    `可引用证据目录：${JSON.stringify(evidenceCatalog)}`,
    'evidenceIds 必须从证据目录选择 2 到 3 个不同 ID，禁止自己写新的数据依据。',
  ].join('\n');
}

export function normalizeDeepSeekOutput(rawOutput, summary, evidenceCatalog = buildEvidenceCatalog(summary)) {
  if (!isPlainObject(rawOutput)) throw new ServiceError('invalid_ai_output', '复诊结果格式无效', 502);
  const catalog = new Map(evidenceCatalog.map((item) => [item.id, item]));
  const selectedIds = Array.isArray(rawOutput.evidenceIds)
    ? [...new Set(rawOutput.evidenceIds.map((id) => cleanText(id, 12)).filter((id) => catalog.has(id)))].slice(0, 3)
    : [];
  for (const item of evidenceCatalog) {
    if (selectedIds.length >= 2) break;
    if (!selectedIds.includes(item.id)) selectedIds.push(item.id);
  }
  const steps = Array.isArray(rawOutput.action?.steps)
    ? rawOutput.action.steps.map((step) => cleanText(step, 80)).filter(Boolean).slice(0, 3)
    : [];
  if (!steps.length) throw new ServiceError('invalid_ai_output', '复诊结果缺少行动步骤', 502);
  const suggestedQuestions = Array.isArray(rawOutput.suggestedQuestions)
    ? rawOutput.suggestedQuestions.map((question) => cleanText(question, 50)).filter(Boolean).slice(0, 3)
    : [];
  return {
    persona: {
      title: summary.localAssessment.primaryPersona.name,
      summary: requiredText(rawOutput.personaSummary, 120, '人格解释'),
    },
    evidence: selectedIds.map((id) => catalog.get(id)),
    pattern: requiredText(rawOutput.pattern, 220, '模式解读'),
    action: {
      title: requiredText(rawOutput.action?.title, 50, '行动标题'),
      steps,
    },
    goalLink: requiredText(rawOutput.goalLink, 140, '目标关联'),
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
    result: normalizeDeepSeekOutput(rawOutput, summary, evidenceCatalog),
  };
}

export const DEEPSEEK_DEFAULTS = Object.freeze({ model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL });
