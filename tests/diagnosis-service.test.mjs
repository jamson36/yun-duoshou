import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagnosisRequest, scorePersonality } from '../personality-scoring.js';
import { FIGMA_PERSONA_CARDS, getAllowedPersonaCardIds, resolvePersonaPresentation } from '../persona-presentations.js';
import { ServiceError, normalizeDeepSeekOutput, requestDeepSeekDiagnosis, validateDiagnosisRequest } from '../server/diagnosis-service.mjs';

function requestFixture() {
  const orders = [0, 1, 2, 3, 4].map((index) => ({
    id: `order-${index}`,
    name: `商品 ${index}`,
    note: '私密备注',
    amount: 30 + index * 20,
    category: index < 3 ? '餐饮饮品' : '数码家居',
    reason: index < 2 ? '被种草' : (index === 2 ? '情绪不好' : '限时优惠'),
    decisionSignals: index < 2 ? ['creator', 'instant'] : ['compare', 'deal'],
    status: index % 2 ? 'purchased' : 'saved',
    createdAt: new Date(Date.now() - index * 86_400_000).toISOString(),
    decidedAt: new Date(Date.now() - index * 86_400_000 + 3_600_000).toISOString(),
    updatedAt: new Date().toISOString(),
    statusHistory: [],
  }));
  const assessment = scorePersonality({ orders });
  return buildDiagnosisRequest({ assessment, orders, goal: { name: '去海边', amount: 3000, createdAt: new Date(0).toISOString() } });
}

test('服务端接受合法的最小汇总', () => {
  const request = requestFixture();
  request.goal.name = '不应发送的目标名称';
  request.goal.privateNote = '不应发送的目标备注';
  const result = validateDiagnosisRequest(request);
  assert.equal(result.period, 30);
  assert.ok(result.localAssessment.evidence.length >= 2);
  assert.equal(result.presentationSignals.source, 'aggregated_local_orders');
  assert.equal(result.presentationSignals.purpose, 'presentation_only');
  assert.equal(result.presentationSignals.nightWindow, '22:00-05:59');
  assert.equal(result.presentationSignals.smallSpendLimit, 50);
  assert.ok(result.personaCandidates.length <= 3);
  assert.equal(result.personaCandidates.every((candidate) => typeof candidate.id === 'string'), true);
  assert.deepEqual(Object.keys(result.goal).sort(), ['progress', 'progressRate', 'targetAmount']);
  assert.doesNotMatch(JSON.stringify(result.goal), /不应发送的目标名称|不应发送的目标备注/);
});

test('服务端用固定语义和聚合数值重建人格依据与证据目录', () => {
  const request = requestFixture();
  request.localAssessment.primaryPersona.rationale = 'SECRET_PRIMARY_RATIONALE';
  request.localAssessment.walletTheme = 'SECRET_WALLET_THEME';
  request.localAssessment.localAdvice = 'SECRET_LOCAL_ADVICE';
  request.personaCandidates.forEach((candidate, index) => {
    candidate.rationale = `SECRET_CANDIDATE_RATIONALE_${index}`;
  });
  request.localAssessment.evidence.forEach((item, index) => {
    item.id = `SECRET_EVIDENCE_ID_${index}`;
    item.metric = `SECRET_EVIDENCE_METRIC_${index}`;
    item.statement = `SECRET_EVIDENCE_STATEMENT_${index}`;
  });

  const result = validateDiagnosisRequest(request);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /SECRET_/);
  assert.match(result.localAssessment.primaryPersona.rationale, /近期记录|当前聚合证据/);
  assert.equal(result.personaCandidates.every((candidate) => /近期记录|当前聚合证据/.test(candidate.rationale)), true);
  assert.ok(result.localAssessment.evidence.length >= 2);
  assert.equal(result.localAssessment.evidence.every((item) => /^E\d+$/.test(item.id) && item.statement.length > 0), true);
});

test('服务端拒绝不一致聚合信号、未登记人格和伪装为标签的明细', () => {
  const invalidSignals = requestFixture();
  invalidSignals.presentationSignals.nightCount = invalidSignals.presentationSignals.orderCount + 1;
  assert.throws(
    () => validateDiagnosisRequest(invalidSignals),
    (error) => error instanceof ServiceError && error.code === 'invalid_request' && error.status === 400,
  );

  const invalidPersona = requestFixture();
  invalidPersona.personaCandidates = [{
    id: 'invented_persona',
    name: '自创人格',
    fitScore: 99,
    rationale: '不应通过。',
  }];
  assert.throws(
    () => validateDiagnosisRequest(invalidPersona),
    (error) => error instanceof ServiceError && error.code === 'invalid_request' && error.status === 400,
  );

  const disguisedCategory = requestFixture();
  disguisedCategory.categories[0].category = '私密商品名';
  assert.throws(
    () => validateDiagnosisRequest(disguisedCategory),
    (error) => error instanceof ServiceError && error.code === 'invalid_request' && error.status === 400,
  );

  const disguisedReason = requestFixture();
  disguisedReason.reasons[0].reason = '私密备注';
  assert.throws(
    () => validateDiagnosisRequest(disguisedReason),
    (error) => error instanceof ServiceError && error.code === 'invalid_request' && error.status === 400,
  );
});

test('DeepSeek 旧输出不能更改本地规则人格或编造证据', () => {
  const summary = validateDiagnosisRequest(requestFixture());
  const result = normalizeDeepSeekOutput({
    personaSummary: '你的决定很容易被外部推荐加速。',
    evidenceIds: ['不存在', 'E1'],
    pattern: '种草与快速决定在本期同时出现。',
    action: { title: '留一晚', steps: ['把链接保留到明天再决定。'] },
    goalLink: '少一次临时购买，就给去海边多留一点空间。',
    suggestedQuestions: ['我最常被什么渠道种草？'],
  }, summary);
  assert.equal(result.persona.canonicalTitle, summary.localAssessment.primaryPersona.name);
  assert.equal(result.persona.title, FIGMA_PERSONA_CARDS[result.persona.cardId].displayName);
  assert.equal(result.persona.cardId, result.persona.localCardId);
  assert.equal(result.persona.decision, 'local');
  assert.deepEqual(result.persona.candidates, []);
  assert.notEqual(result.persona.summary, '你的决定很容易被外部推荐加速。');
  assert.match(result.persona.summary, new RegExp(summary.localAssessment.primaryPersona.name));
  assert.match(result.persona.summary, new RegExp(result.persona.title));
  assert.equal(result.evidence.length, 2);
  assert.equal(result.evidence.some((item) => item.id === '不存在'), false);
});

test('DeepSeek 合法展示候选由本地硬门槛融合且不改规则人格', () => {
  const summary = validateDiagnosisRequest(requestFixture());
  const assessment = {
    ...summary.localAssessment,
    categories: summary.categories,
    reasons: summary.reasons,
    statuses: summary.statuses,
    presentationSignals: summary.presentationSignals,
    personaCandidates: summary.personaCandidates,
  };
  const local = resolvePersonaPresentation(assessment);
  const candidateCardId = getAllowedPersonaCardIds(assessment).find((cardId) => cardId !== local.card.id);
  assert.ok(candidateCardId);
  const result = normalizeDeepSeekOutput({
    personaCandidates: [{
      cardId: candidateCardId,
      confidence: 0.8,
      rationale: '聚合行为证据支持这张展示卡。',
      evidenceIds: ['E2', 'E3'],
    }],
    personaSummary: '规则人格不变，展示卡进一步表达近期特征。',
    evidenceIds: ['E1', 'E4'],
    pattern: '近期的决策信号有明确聚集。',
    action: { title: '留一晚', steps: ['把链接保留到明天再决定。'] },
    goalLink: '减少一次临时购买，给目标多留一点空间。',
  }, summary);
  assert.equal(result.persona.decision, 'hybrid');
  assert.equal(result.persona.cardId, candidateCardId);
  assert.equal(result.persona.localCardId, local.card.id);
  assert.equal(result.persona.canonicalTitle, summary.localAssessment.primaryPersona.name);
  assert.equal(result.persona.confidence, 0.8);
  assert.deepEqual(result.persona.evidenceIds, ['E2', 'E3']);
  assert.deepEqual(result.evidence.map((item) => item.id), ['E2', 'E3']);
});

test('模型自由文本中的服务商和具体模型标识不会进入 API 响应', () => {
  const summary = validateDiagnosisRequest(requestFixture());
  const assessment = {
    ...summary.localAssessment,
    categories: summary.categories,
    reasons: summary.reasons,
    statuses: summary.statuses,
    presentationSignals: summary.presentationSignals,
    personaCandidates: summary.personaCandidates,
  };
  const local = resolvePersonaPresentation(assessment);
  const candidateCardId = getAllowedPersonaCardIds(assessment).find((cardId) => cardId !== local.card.id);
  const result = normalizeDeepSeekOutput({
    personaCandidates: [{
      cardId: candidateCardId,
      confidence: 0.9,
      rationale: 'DeepSeek-v4-flash 与独立别名 R1、V4 Flash 都这样判断。',
      evidenceIds: ['E1', 'E2'],
    }],
    personaSummary: 'wallet-inference-private-2026 与 DeepSeek-chat 推演出这张展示卡。',
    evidenceIds: ['E3', 'E4'],
    pattern: '深度求索模型和 R1 认为聚合信号很明显。',
    action: {
      title: '跟随 V4 Flash 的建议',
      steps: ['先让 V3 和 deep_seek-coder 继续分析。'],
    },
    goalLink: '深度求索 V3 认为这会帮助目标。',
    suggestedQuestions: ['DeepSeek-R1 还会怎么说？'],
  }, summary, undefined, { modelNames: ['wallet-inference-private-2026'] });
  assert.equal(result.persona.decision, 'hybrid');
  assert.doesNotMatch(JSON.stringify(result), /deep[\s_-]*seek|深度求索|wallet-inference-private-2026|\bR1\b|\bV3\b|\bV4\s*Flash\b/i);
  assert.match(result.persona.summary, /复诊服务/);
  assert.match(result.persona.rationale, /复诊服务/);
});

test('没有 API Key 时返回可识别错误', async () => {
  await assert.rejects(
    requestDeepSeekDiagnosis({ input: requestFixture(), apiKey: '' }),
    (error) => error instanceof ServiceError && error.code === 'missing_api_key' && error.status === 503,
  );
});

test('使用 JSON Output 调用 DeepSeek 并校验结果', async () => {
  let sentBody;
  const request = requestFixture();
  request.goal.name = '绝密旅行目标';
  request.goal.privateNote = '目标自由文本不得外发';
  request.localAssessment.primaryPersona.rationale = 'SECRET_PRIMARY_RATIONALE';
  request.personaCandidates.forEach((candidate) => {
    candidate.rationale = 'SECRET_CANDIDATE_RATIONALE';
  });
  request.localAssessment.evidence.forEach((item) => {
    item.metric = 'SECRET_EVIDENCE_METRIC';
    item.statement = 'SECRET_EVIDENCE_STATEMENT';
  });
  const fetchImpl = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      personaSummary: '外部推荐正在缩短你的决定时间。',
      evidenceIds: ['E1', 'E2'],
      pattern: '高频分类与种草诱因在本期重合。',
      action: { title: '设置种草冷静期', steps: ['保留链接 24 小时，不立即付款。'] },
      goalLink: '把一次未购买金额留给当前目标。',
      suggestedQuestions: ['哪种推荐最容易让我行动？'],
    }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const result = await requestDeepSeekDiagnosis({ input: request, apiKey: 'test-key', fetchImpl });
  assert.equal(sentBody.model, 'deepseek-v4-flash');
  assert.deepEqual(sentBody.response_format, { type: 'json_object' });
  assert.deepEqual(sentBody.thinking, { type: 'disabled' });
  assert.match(sentBody.messages[1].content, /不得出现服务商、模型、模型版本或接口名称/);
  assert.doesNotMatch(sentBody.messages[1].content, /绝密旅行目标|目标自由文本不得外发/);
  assert.doesNotMatch(sentBody.messages[1].content, /SECRET_/);
  assert.match(sentBody.messages[1].content, /可引用证据目录/);
  assert.equal(result.result.evidence.length, 2);
  assert.equal(Object.hasOwn(result, 'provider'), false);
  assert.equal(Object.hasOwn(result, 'model'), false);
});
