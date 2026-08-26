import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagnosisRequest, scorePersonality } from '../personality-scoring.js';
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
  const result = validateDiagnosisRequest(requestFixture());
  assert.equal(result.period, 30);
  assert.ok(result.localAssessment.evidence.length >= 2);
});

test('DeepSeek 输出不能更改本地主人格或编造证据', () => {
  const summary = validateDiagnosisRequest(requestFixture());
  const result = normalizeDeepSeekOutput({
    personaSummary: '你的决定很容易被外部推荐加速。',
    evidenceIds: ['不存在', 'E1'],
    pattern: '种草与快速决定在本期同时出现。',
    action: { title: '留一晚', steps: ['把链接保留到明天再决定。'] },
    goalLink: '少一次临时购买，就给去海边多留一点空间。',
    suggestedQuestions: ['我最常被什么渠道种草？'],
  }, summary);
  assert.equal(result.persona.title, summary.localAssessment.primaryPersona.name);
  assert.equal(result.evidence.length, 2);
  assert.equal(result.evidence.some((item) => item.id === '不存在'), false);
});

test('没有 API Key 时返回可识别错误', async () => {
  await assert.rejects(
    requestDeepSeekDiagnosis({ input: requestFixture(), apiKey: '' }),
    (error) => error instanceof ServiceError && error.code === 'missing_api_key' && error.status === 503,
  );
});

test('使用 JSON Output 调用 DeepSeek 并校验结果', async () => {
  let sentBody;
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
  const result = await requestDeepSeekDiagnosis({ input: requestFixture(), apiKey: 'test-key', fetchImpl });
  assert.equal(sentBody.model, 'deepseek-v4-flash');
  assert.deepEqual(sentBody.response_format, { type: 'json_object' });
  assert.deepEqual(sentBody.thinking, { type: 'disabled' });
  assert.equal(result.result.evidence.length, 2);
  assert.equal(Object.hasOwn(result, 'provider'), false);
  assert.equal(Object.hasOwn(result, 'model'), false);
});
