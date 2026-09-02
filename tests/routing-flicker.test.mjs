import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  buildClinicHash,
  buildNewHash,
  buildRoomHash,
  createRouteSyncScheduler,
  panelNameFromHash,
  parseClinicHashState,
  parseNewHashState,
  parseRoomHashState,
  routeSignature,
} from '../route-sync.js';
import { buildDiagnosisRequest, scorePersonality } from '../personality-scoring.js';
import { isFigmaPersonaCardId, resolvePersonaPresentation } from '../persona-presentations.js';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function functionSource(name, nextName) {
  const start = appSource.indexOf(`function ${name}(`);
  const end = appSource.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `应能读取 ${name} 的实际实现`);
  return appSource.slice(start, end);
}

function asyncFunctionSource(name, nextName) {
  const start = appSource.indexOf(`async function ${name}(`);
  const end = appSource.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `应能读取 ${name} 的异步实现`);
  return appSource.slice(start, end);
}

async function runDiagnosisRequestScenario({
  entryWindow,
  finalWindow = entryWindow,
  responseOk = true,
  mutateWhileRequesting = null,
}) {
  const source = asyncFunctionSource('requestAiDiagnosis', 'startAiDiagnosis');
  const requestBodies = [];
  const renderStates = [];
  const persistedDiagnoses = [];
  let resultCloseCount = 0;
  let posterClearCount = 0;
  const entryAssessment = {
    eligible: true,
    period: 30,
    modelVersion: 'wallet-personality-rules-test',
    window: entryWindow,
  };
  const diagnosisBusinessStateFingerprint = (snapshot) => JSON.stringify({
    dataRevision: snapshot.dataRevision,
    orders: snapshot.orders,
    goals: snapshot.goals.map((goal) => ({
      id: goal.id,
      amount: goal.amount,
      createdAt: goal.createdAt,
      demo: Boolean(goal.demo),
    })),
    activeGoalId: snapshot.activeGoalId,
  });
  const context = {
    aiUiState: { status: 'idle', message: '' },
    scorePersonality: () => entryAssessment,
    state: {
      schemaVersion: 2,
      dataRevision: 4,
      orders: [{ id: 'current-order' }],
      goals: [{
        id: 'goal-current',
        amount: 1000,
        createdAt: '2026-08-01T00:00:00.000Z',
        demo: false,
        note: { x: 0.4, y: 0.5, color: 'yellow', rotation: -2 },
      }],
      activeGoalId: 'goal-current',
      diagnosis: { requestFingerprint: 'old-result' },
      settings: { aiConsent: true },
    },
    activeClinicPeriod: 30,
    currentAssessment: { eligible: true, period: 30, window: 'stale-render' },
    clockClinicAssessmentFingerprint: 'stale-render',
    assessmentReportFingerprint: (assessment) => assessment.window,
    aiConsentIsCurrent: () => true,
    buildDiagnosisRequest: ({ assessment }) => ({ window: assessment.window }),
    goalForAssessment: () => null,
    diagnosisBusinessStateFingerprint,
    persistedDiagnosisBusinessStateFingerprint: () => `valid:${diagnosisBusinessStateFingerprint(context.state)}`,
    performance: { now: () => 0 },
    cancelAiRequest: () => false,
    aiRequestSequence: 0,
    aiRequestController: null,
    analysisStageController: {
      start: () => {},
      finish: async () => true,
      stop: () => {},
    },
    AbortController,
    window: {
      setTimeout: () => 1,
      clearTimeout: () => {},
    },
    setAiDiagnosisInvalidatedForSession: () => true,
    persistAiDiagnosis: (diagnosis) => { persistedDiagnoses.push(diagnosis); return true; },
    closeGachaponResult: () => { resultCloseCount += 1; },
    renderClinic: () => { renderStates.push(context.aiUiState.status); },
    posterBlob: null,
    clearPoster: () => { posterClearCount += 1; },
    setMascotSpeech: () => {},
    fetch: async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      mutateWhileRequesting?.(context);
      return {
        ok: responseOk,
        status: responseOk ? 200 : 503,
        json: async () => (responseOk ? { result: {} } : { code: 'unavailable', message: '暂时不可用' }),
      };
    },
    validateAiDiagnosis: () => true,
    latestAssessmentForDiagnosis: () => ({ ...entryAssessment, window: finalWindow }),
    diagnosisRequestFingerprint: (assessment) => JSON.stringify({ window: assessment.window }),
    document: { body: { classList: { contains: () => true } } },
    activePanel: 'clinic',
    gachaponMachine: { classList: { remove: () => {} } },
    gachaponMotion: { setState: () => {} },
    aiCard: { setAttribute: () => {} },
    personaPresentationFor: () => ({ card: { displayName: '测试卡' }, canonical: { name: '规则卡' } }),
    showToast: () => {},
    friendlyAiError: (error) => error.message,
    clinicRenderPending: false,
    openGachaponResult: () => false,
  };
  vm.runInNewContext(`${source}\nthis.requestAiDiagnosis = requestAiDiagnosis;`, context);
  await context.requestAiDiagnosis();
  return { context, requestBodies, renderStates, persistedDiagnoses, resultCloseCount, posterClearCount };
}

test('路由同步把同一帧的 popstate 与 hashchange 合并为最后一次状态', () => {
  const scheduled = [];
  const applied = [];
  let currentSignature = routeSignature({ panel: null });
  const coordinator = createRouteSyncScheduler({
    readRoute: (state) => state,
    applyRoute: (route) => {
      applied.push(route);
      currentSignature = routeSignature(route);
    },
    getCurrentSignature: () => currentSignature,
    schedule: (callback) => scheduled.push(callback),
  });

  coordinator.request({ panel: 'orders' });
  coordinator.request({ panel: 'goals', goalsView: 'controller' });
  assert.equal(scheduled.length, 1);
  scheduled.shift()();
  assert.deepEqual(applied, [{ panel: 'goals', goalsView: 'controller' }]);

  coordinator.request({ panel: 'goals', goalsView: 'controller' });
  scheduled.shift()();
  assert.equal(applied.length, 1, '界面与签名都未变化时不应再次应用路由');

  currentSignature = routeSignature({ panel: null });
  coordinator.request({ panel: 'goals', goalsView: 'controller' });
  scheduled.shift()();
  assert.equal(applied.length, 2, '直接交互改变界面后，相同历史签名仍应重新应用');
});

test('路由签名只包含当前页面真正可见的子状态', () => {
  assert.equal(
    routeSignature({ panel: 'orders', phoneView: 'detail', productId: 'ignored' }),
    routeSignature({ panel: 'orders' }),
  );
  assert.notEqual(
    routeSignature({ panel: 'new', phoneView: 'catalog', commerceType: 'food' }),
    routeSignature({ panel: 'new', phoneView: 'detail', commerceType: 'food', productId: 'coffee' }),
  );
});

test('房间 activity 可由 hash 往返，但不把局中状态写入地址', () => {
  assert.equal(buildRoomHash(), '#room');
  assert.equal(buildRoomHash({ activity: 'peel' }), '#room?activity=peel');
  assert.equal(buildRoomHash({ activity: 'unknown' }), '#room');
  assert.deepEqual(parseRoomHashState('#room'), { activity: null });
  assert.deepEqual(parseRoomHashState('#room?activity=peel'), { activity: 'peel' });
  assert.deepEqual(
    parseRoomHashState('#room?activity=peel&phase=playing&elapsed=32000'),
    { activity: 'peel' },
    '刷新只恢复游戏准备页，不恢复半局',
  );
  assert.deepEqual(parseRoomHashState('#room?activity=unknown'), { activity: null });
});

test('activity 仍属于房间且进入、退出会产生不同路由签名', () => {
  assert.equal(panelNameFromHash('#room?activity=peel'), 'room');
  assert.notEqual(
    routeSignature({ panel: 'room', activity: 'peel' }),
    routeSignature({ panel: 'room', activity: null }),
  );
  assert.equal(
    routeSignature({ panel: 'orders', activity: 'peel' }),
    routeSignature({ panel: 'orders' }),
    '业务面板不应携带房间小游戏状态',
  );
});

test('模拟商城目录与详情可由 hash 完整往返并在刷新后恢复', () => {
  const catalogHash = buildNewHash({ phoneView: 'catalog', commerceType: 'food' });
  const detailHash = buildNewHash({ phoneView: 'detail', commerceType: 'food', productId: 'food-coffee' });

  assert.equal(catalogHash, '#new?view=catalog&type=food');
  assert.equal(detailHash, '#new?view=detail&type=food&product=food-coffee');
  assert.deepEqual(parseNewHashState(catalogHash), {
    phoneView: 'catalog', commerceType: 'food', productId: null,
  });
  assert.deepEqual(parseNewHashState(detailHash), {
    phoneView: 'detail', commerceType: 'food', productId: 'food-coffee',
  });
  assert.equal(panelNameFromHash(detailHash), 'new');
});

test('开始买吧先进入 5:25 介绍页，再进入可刷新的模拟手机首页', () => {
  assert.equal(buildNewHash({ phoneView: 'intro' }), '#new');
  assert.equal(buildNewHash({ phoneView: 'home' }), '#new?view=home');
  assert.deepEqual(parseNewHashState('#new'), {
    phoneView: 'intro', commerceType: 'shop', productId: null,
  });
  assert.deepEqual(parseNewHashState('#new', {
    panel: 'new', phoneView: 'detail', commerceType: 'interest', productId: 'interest-guitar',
  }), {
    phoneView: 'intro', commerceType: 'shop', productId: null,
  });
  assert.deepEqual(parseNewHashState('#new?view=home'), {
    phoneView: 'home', commerceType: 'shop', productId: null,
  });
});

test('消费测试起始页与历史报告可由 clinic hash 往返恢复', () => {
  assert.equal(buildClinicHash({ clinicView: 'start' }), '#clinic');
  assert.equal(buildClinicHash({ clinicView: 'report' }), '#clinic?view=report');
  assert.deepEqual(parseClinicHashState('#clinic'), { clinicView: 'start' });
  assert.deepEqual(parseClinicHashState('#clinic?view=report'), { clinicView: 'report' });
  assert.deepEqual(parseClinicHashState('#clinic?view=unknown'), { clinicView: 'start' });
  assert.notEqual(
    routeSignature({ panel: 'clinic', clinicView: 'start' }),
    routeSignature({ panel: 'clinic', clinicView: 'report' }),
  );
});

test('显式商城 hash 优先于旧历史状态，非法参数安全回退', () => {
  assert.deepEqual(
    parseNewHashState('#new?view=catalog&type=interest', {
      panel: 'new', phoneView: 'detail', commerceType: 'shop', productId: 'shop-camera',
    }),
    { phoneView: 'catalog', commerceType: 'interest', productId: null },
  );
  assert.deepEqual(parseNewHashState('#new?view=detail&type=unknown'), {
    phoneView: 'catalog', commerceType: 'shop', productId: null,
  });
  assert.equal(buildNewHash({ phoneView: 'detail', commerceType: 'unknown' }), '#new?view=catalog&type=shop');
});

test('应用启动与历史同步保留商城深链且规范化当前地址', () => {
  assert.match(appSource, /const initialRoute = routeSnapshot\(history\.state \|\| \{\}\)/);
  assert.match(appSource, /initialPanel === 'new'[\s\S]*?buildNewHash\(initialRoute\)/);
  assert.match(appSource, /function syncRouteFromLocation\([\s\S]*?history\.replaceState\([\s\S]*?buildNewHash\(normalizedRoute\)/);
  assert.match(appSource, /function navigateBackWithinPhone\([\s\S]*?openedByApp[\s\S]*?phoneView === 'detail'[\s\S]*?'catalog'/);
});

test('从商品页主动回到手机首页后，统一返回不会重新落回商品详情', () => {
  assert.match(appSource, /trigger\.closest\('\.device-tabs'\)[\s\S]*?history\.replaceState\(\{ panel: 'new', \.\.\.route, openedByApp: false \}[\s\S]*?showPhoneView\('home'[\s\S]*?activePanel !== 'new'[\s\S]*?applyPanel\('new', trigger\)/);
  assert.match(appSource, /hotspot\.panel === 'new' && activePanel === 'orders'[\s\S]*?phoneView: 'home'[\s\S]*?showPhoneView\('home'[\s\S]*?applyPanel\('new', trigger\)/);
  assert.match(appSource, /mallSuccessBackButton\.addEventListener\('click',[\s\S]*?phoneView: 'home', openedByApp: false/);
  assert.match(appSource, /function editOrder\([\s\S]*?phoneView: 'home', openedByApp: false/);
  assert.match(appSource, /activePanel = nextPanel;[\s\S]*?activePanel !== 'new'[\s\S]*?panelClose\.setAttribute\('aria-label', '回房间'\)[\s\S]*?panelCloseLabel\.textContent = '回房间'/);
});

test('面板切换只有一个镜头入口，重复页面不重启全量渲染与聚焦动画', () => {
  const applyPanelSource = functionSource('applyPanel', 'openPanel');
  const panoramaActivation = appSource.slice(
    appSource.indexOf('onActivate: (hotspot, trigger)'),
    appSource.indexOf('onThought:', appSource.indexOf('onActivate: (hotspot, trigger)')),
  );
  assert.doesNotMatch(panoramaActivation, /focusHotspot/);
  assert.match(applyPanelSource, /if \(nextPanel === previousPanel\)/);
  assert.doesNotMatch(applyPanelSource, /renderAll\(\)/);
  assert.doesNotMatch(applyPanelSource, /void app\.offsetWidth/);
  assert.match(applyPanelSource, /panorama\.focusPanel\(activePanel\)/);
});

test('回血页切换状态保持到离开页面，避免默认进入动画再次启动', () => {
  const beginSource = functionSource('beginRecoverySwitch', 'setGoalsView');
  assert.match(beginSource, /classList\.add\('is-recovery-switch'\)/);
  assert.doesNotMatch(beginSource, /setTimeout/);
  assert.match(functionSource('applyPanel', 'openPanel'), /!\['orders', 'goals'\]\.includes\(nextPanel\)/);
});

test('旧复诊请求以序号和上下文双重门禁退出，不落降级提示或结果弹窗', () => {
  const requestSource = functionSource('requestAiDiagnosis', 'startAiDiagnosis');
  assert.match(requestSource, /const requestToken = \+\+aiRequestSequence/);
  assert.match(requestSource, /if \(!requestIsCurrent\(\)\) return/g);
  assert.match(requestSource, /requestContextIsCurrent = activePanel === 'clinic'/);
  assert.match(requestSource, /clinicRenderPending = true/);
  assert.doesNotMatch(requestSource, /renderClinic\(\);\s*if \(shouldRevealResult/);
  assert.match(appSource, /popstate'[\s\S]*routeSyncCoordinator\.request/);
  assert.match(appSource, /hashchange'[\s\S]*routeSyncCoordinator\.request/);
});

test('跨午夜定时器尚未触发时，直接再测也只发送实时重算后的新窗口聚合', async () => {
  const result = await runDiagnosisRequestScenario({ entryWindow: 'new-window' });
  assert.deepEqual(result.requestBodies, [{ window: 'new-window' }]);
  assert.deepEqual(result.renderStates, ['requesting', 'success']);
  assert.equal(result.context.state.diagnosis.requestFingerprint, JSON.stringify({ window: 'new-window' }));
});

test('请求期间画像时间指纹漂移时丢弃回包并立即退出转圈状态', async () => {
  const result = await runDiagnosisRequestScenario({ entryWindow: 'window-a', finalWindow: 'window-b' });
  assert.deepEqual(result.requestBodies, [{ window: 'window-a' }]);
  assert.deepEqual(result.renderStates, ['requesting', 'idle']);
  assert.equal(result.context.state.diagnosis, null);
  assert.ok(result.resultCloseCount >= 2, '请求开始和过期收尾都应关闭旧结果层');
  assert.ok(result.posterClearCount >= 1, '过期收尾应清除旧海报');
});

test('请求期间只拖动或换色预算便签不会丢弃综合推演响应', async () => {
  const result = await runDiagnosisRequestScenario({
    entryWindow: 'same-window',
    mutateWhileRequesting: (context) => {
      context.state.goals[0].note = { x: 0.72, y: 0.18, color: 'coral', rotation: 4 };
    },
  });
  assert.deepEqual(result.requestBodies, [{ window: 'same-window' }]);
  assert.deepEqual(result.renderStates, ['requesting', 'success']);
  assert.equal(result.context.state.goals[0].note.color, 'coral');
  assert.equal(result.context.state.diagnosis.requestFingerprint, JSON.stringify({ window: 'same-window' }));
});

test('重试失败会同时清除内存与独立持久化诊断，旧综合卡不会复活', async () => {
  const result = await runDiagnosisRequestScenario({ entryWindow: 'current-window', responseOk: false });
  assert.deepEqual(result.renderStates, ['requesting', 'error']);
  assert.equal(result.context.state.diagnosis, null);
  assert.ok(result.persistedDiagnoses.length >= 2);
  assert.ok(result.persistedDiagnoses.every((diagnosis) => diagnosis === null));
});

test('请求前发现主存储已被另一标签更新时先同步并拒绝发送旧聚合', async () => {
  const source = asyncFunctionSource('requestAiDiagnosis', 'startAiDiagnosis');
  let syncCalls = 0;
  const context = {
    aiUiState: { status: 'idle', message: '' },
    scorePersonality: () => ({ eligible: true, period: 30, modelVersion: 'rules', window: 'old-window' }),
    state: { dataRevision: 2, orders: [{ id: 'old' }], goals: [], settings: { aiConsent: true } },
    activeClinicPeriod: 30,
    currentAssessment: null,
    clockClinicAssessmentFingerprint: '',
    assessmentReportFingerprint: (assessment) => assessment.window,
    aiConsentIsCurrent: () => true,
    buildDiagnosisRequest: ({ assessment }) => ({ window: assessment.window }),
    goalForAssessment: () => null,
    diagnosisBusinessStateFingerprint: () => 'old-business',
    persistedDiagnosisBusinessStateFingerprint: () => 'valid:new-business',
    STORAGE_KEY: 'business',
    localStorage: { getItem: () => '{"dataRevision":3}' },
    applyExternalBusinessState: () => { syncCalls += 1; return true; },
  };
  vm.runInNewContext(`${source}\nthis.requestAiDiagnosis = requestAiDiagnosis;`, context);
  await context.requestAiDiagnosis();
  assert.equal(syncCalls, 1);
  assert.equal(context.state.diagnosis, undefined);
});

test('主存储保存失败后再测仍使用内存最新聚合且不会回灌旧订单', async () => {
  const source = asyncFunctionSource('requestAiDiagnosis', 'startAiDiagnosis');
  const requestBodies = [];
  let syncCalls = 0;
  const currentAssessment = {
    eligible: true,
    period: 30,
    modelVersion: 'rules',
    window: 'memory-current-window',
  };
  const context = {
    aiUiState: { status: 'idle', message: '' },
    scorePersonality: () => currentAssessment,
    state: {
      dataRevision: 3,
      orders: [{ id: 'memory-only-new-order' }],
      goals: [],
      activeGoalId: null,
      settings: { aiConsent: true },
      diagnosis: null,
    },
    activeClinicPeriod: 30,
    currentAssessment: null,
    clockClinicAssessmentFingerprint: '',
    assessmentReportFingerprint: (assessment) => assessment.window,
    aiConsentIsCurrent: () => true,
    buildDiagnosisRequest: ({ assessment }) => ({ window: assessment.window }),
    goalForAssessment: () => null,
    diagnosisBusinessStateFingerprint: () => 'memory-dirty-business',
    persistedDiagnosisBusinessStateFingerprint: () => 'unavailable',
    STORAGE_KEY: 'business',
    localStorage: { getItem: () => '{"dataRevision":2,"orders":[{"id":"old-persisted-order"}]}' },
    applyExternalBusinessState: () => { syncCalls += 1; return true; },
    performance: { now: () => 0 },
    cancelAiRequest: () => false,
    aiRequestSequence: 0,
    aiRequestController: null,
    analysisStageController: {
      start: () => {},
      finish: async () => true,
      stop: () => {},
    },
    AbortController,
    window: { setTimeout: () => 1, clearTimeout: () => {} },
    setAiDiagnosisInvalidatedForSession: () => true,
    persistAiDiagnosis: () => true,
    closeGachaponResult: () => {},
    renderClinic: () => {},
    posterBlob: null,
    clearPoster: () => {},
    setMascotSpeech: () => {},
    fetch: async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ result: {} }) };
    },
    validateAiDiagnosis: () => true,
    latestAssessmentForDiagnosis: () => currentAssessment,
    diagnosisRequestFingerprint: (assessment) => JSON.stringify({ window: assessment.window }),
    document: { body: { classList: { contains: () => true } } },
    activePanel: 'clinic',
    gachaponMachine: { classList: { remove: () => {} } },
    gachaponMotion: { setState: () => {} },
    aiCard: { setAttribute: () => {} },
    personaPresentationFor: () => ({ card: { displayName: '测试卡' }, canonical: { name: '规则卡' } }),
    showToast: () => {},
    friendlyAiError: (error) => error.message,
    clinicRenderPending: false,
    openGachaponResult: () => false,
  };
  vm.runInNewContext(`${source}\nthis.requestAiDiagnosis = requestAiDiagnosis;`, context);
  await context.requestAiDiagnosis();
  assert.equal(syncCalls, 0);
  assert.deepEqual(requestBodies, [{ window: 'memory-current-window' }]);
  assert.equal(context.state.orders[0].id, 'memory-only-new-order');
  assert.equal(context.state.diagnosis.requestFingerprint, JSON.stringify({ window: 'memory-current-window' }));
});

test('复诊新鲜度同时受当前同意、严格请求指纹与实时重算约束', () => {
  const matchSource = functionSource('diagnosisMatchesAssessmentContext', 'diagnosisIsFreshFor');
  const freshSource = functionSource('diagnosisIsFreshFor', 'diagnosisIsFresh');
  const requestSource = functionSource('requestAiDiagnosis', 'startAiDiagnosis');
  assert.match(freshSource, /if \(!aiConsentIsCurrent\(\)\) return false/);
  assert.match(matchSource, /requestFingerprint/);
  assert.match(matchSource, /savedFingerprint === renderedFingerprint/);
  assert.match(matchSource, /savedFingerprint === latestFingerprint/);
  assert.match(freshSource, /latestAssessmentForDiagnosis\(assessment\)/);
  assert.match(requestSource, /requestFingerprint: requestFingerprint|requestFingerprint,/);
  assert.match(requestSource, /requestFingerprint !== diagnosisRequestFingerprint\(latestRequestAssessment\)/);
});

test('自然跨出七天窗口会改变复诊请求指纹，即使数据修订号没有变化', () => {
  const makeOrder = (id, createdAt) => ({
    id,
    name: `记录${id}`,
    amount: 100,
    category: '餐饮饮品',
    reason: '嘴馋',
    status: 'cooling',
    decisionSignals: ['instant'],
    createdAt,
    updatedAt: createdAt,
  });
  const orders = [
    makeOrder('boundary', '2026-08-19T12:00:00+08:00'),
    makeOrder('stable-1', '2026-08-20T12:00:00+08:00'),
    makeOrder('stable-2', '2026-08-21T12:00:00+08:00'),
    makeOrder('stable-3', '2026-08-22T12:00:00+08:00'),
  ];
  const before = scorePersonality({ orders, period: 7, now: new Date('2026-08-25T12:00:00+08:00') });
  const after = scorePersonality({ orders, period: 7, now: new Date('2026-08-26T12:00:00+08:00') });
  const beforeFingerprint = JSON.stringify(buildDiagnosisRequest({ assessment: before, orders }));
  const afterFingerprint = JSON.stringify(buildDiagnosisRequest({ assessment: after, orders }));
  assert.equal(before.orderCount, 4);
  assert.equal(after.orderCount, 3);
  assert.notEqual(afterFingerprint, beforeFingerprint);

  const fingerprintSource = functionSource('assessmentReportFingerprint', 'personalityProfileSignature');
  const signatureSource = functionSource('personalityProfileSignature', 'shouldRenderPersonalityProfile');
  const signatureContext = { historicalReportContextFor: () => null };
  vm.runInNewContext(`${fingerprintSource}\n${signatureSource}\nthis.personalityProfileSignature = personalityProfileSignature;`, signatureContext);
  const unchangedPresentation = {
    canonical: { id: 'same-canonical' },
    card: { id: 'same-card' },
    localCard: { id: 'same-card' },
    decision: 'local',
    inference: null,
  };
  const afterWithSamePersona = { ...after, primaryPersona: before.primaryPersona };
  assert.notEqual(
    signatureContext.personalityProfileSignature({ assessment: before, presentation: unchangedPresentation, dataRevision: 8 }),
    signatureContext.personalityProfileSignature({ assessment: afterWithSamePersona, presentation: unchangedPresentation, dataRevision: 8 }),
    '同一数据修订号、人格和卡面下，窗口事实变化仍必须重建报告',
  );
});

test('页面停留病历页跨本地午夜时只刷新一次并立即作废旧海报', () => {
  const source = functionSource('updateClock', 'syncReducedMotionPreference');
  const renderedTimes = [];
  const phoneClockTimes = [];
  let clinicRenderCount = 0;
  let posterClearCount = 0;
  let resultCloseCount = 0;
  let posterBlob = { stale: true };
  const context = {
    clockDateSignature: '',
    clockClinicAssessmentFingerprint: 'window-a',
    activePanel: 'clinic',
    activeClinicPeriod: 30,
    state: { orders: [] , diagnosis: { requestFingerprint: 'stale' } },
    localDateKey: (now) => now.dateSignature,
    scorePersonality: ({ now }) => ({ period: 30, fingerprint: now.assessmentFingerprint }),
    assessmentReportFingerprint: (assessment) => assessment.fingerprint,
    Intl: { DateTimeFormat: function DateTimeFormat() { return { format: (now) => now.timeLabel }; } },
    document: {
      querySelector: () => ({ set textContent(value) { renderedTimes.push(value); } }),
      querySelectorAll: () => [{ set textContent(value) { phoneClockTimes.push(value); } }],
    },
    clearPoster: () => {
      posterClearCount += 1;
      posterBlob = null;
    },
    cancelAiRequest: () => true,
    setAiDiagnosisInvalidatedForSession: () => true,
    persistAiDiagnosis: () => true,
    aiUiState: { status: 'requesting', message: '' },
    closeGachaponResult: () => { resultCloseCount += 1; },
    renderClinic: () => { clinicRenderCount += 1; },
  };
  vm.runInNewContext(`${source}\nthis.updateClock = updateClock;`, context);
  context.updateClock({ dateSignature: '2026-08-30', timeLabel: '23:59', assessmentFingerprint: 'window-a' });
  context.updateClock({ dateSignature: '2026-08-30', timeLabel: '23:59', assessmentFingerprint: 'window-a' });
  context.updateClock({ dateSignature: '2026-08-31', timeLabel: '00:00', assessmentFingerprint: 'window-b' });
  context.updateClock({ dateSignature: '2026-08-31', timeLabel: '00:01', assessmentFingerprint: 'window-b' });
  assert.equal(clinicRenderCount, 1);
  assert.equal(posterClearCount, 1);
  assert.equal(resultCloseCount, 1);
  assert.equal(posterBlob, null);
  assert.deepEqual(renderedTimes, ['23:59', '23:59', '00:00', '00:01']);
  assert.deepEqual(phoneClockTimes, renderedTimes);
  assert.match(functionSource('currentPosterFingerprint', 'openPosterShare'), /localDateKey\(new Date\(\)\)/);
});

test('页面停留病历页时同日半衰期变化只刷新一次，稳定时钟不重绘', () => {
  const source = functionSource('updateClock', 'syncReducedMotionPreference');
  let clinicRenderCount = 0;
  let posterClearCount = 0;
  let resultCloseCount = 0;
  const context = {
    clockDateSignature: '2026-08-30',
    clockClinicAssessmentFingerprint: 'score-50',
    activePanel: 'clinic',
    activeClinicPeriod: 30,
    state: { orders: [], diagnosis: { requestFingerprint: 'old' } },
    localDateKey: (now) => now.dateSignature,
    scorePersonality: ({ now }) => ({ period: 30, fingerprint: now.assessmentFingerprint }),
    assessmentReportFingerprint: (assessment) => assessment.fingerprint,
    Intl: { DateTimeFormat: function DateTimeFormat() { return { format: (now) => now.timeLabel }; } },
    document: {
      querySelector: () => ({ textContent: '' }),
      querySelectorAll: () => [],
    },
    cancelAiRequest: () => true,
    setAiDiagnosisInvalidatedForSession: () => true,
    persistAiDiagnosis: () => true,
    aiUiState: { status: 'requesting', message: '' },
    closeGachaponResult: () => { resultCloseCount += 1; },
    clearPoster: () => { posterClearCount += 1; },
    renderClinic: () => { clinicRenderCount += 1; },
  };
  vm.runInNewContext(`${source}\nthis.updateClock = updateClock;`, context);
  context.updateClock({ dateSignature: '2026-08-30', timeLabel: '10:00', assessmentFingerprint: 'score-50' });
  context.updateClock({ dateSignature: '2026-08-30', timeLabel: '10:01', assessmentFingerprint: 'score-51' });
  context.updateClock({ dateSignature: '2026-08-30', timeLabel: '10:02', assessmentFingerprint: 'score-51' });
  assert.equal(clinicRenderCount, 1);
  assert.equal(posterClearCount, 1);
  assert.equal(resultCloseCount, 1);
  assert.equal(context.aiUiState.status, 'idle');
});

test('复诊响应的证据编号只能来自当前画像目录，采纳人格与最终证据一致时可通过', () => {
  const orders = ['2026-08-20', '2026-08-21', '2026-08-22'].map((day, index) => ({
    id: `evidence-${index}`,
    name: `记录${index}`,
    amount: 30 + index,
    category: '餐饮饮品',
    reason: '嘴馋',
    status: 'cooling',
    decisionSignals: ['instant'],
    createdAt: `${day}T12:00:00+08:00`,
    updatedAt: `${day}T12:00:00+08:00`,
  }));
  const assessment = scorePersonality({ orders, period: 30, now: new Date('2026-08-25T12:00:00+08:00') });
  const local = resolvePersonaPresentation(assessment);
  const candidate = {
    cardId: local.localCard.id,
    confidence: 0.9,
    rationale: '当前聚合证据支持这一趣味卡面。',
    evidenceIds: ['E1', 'E2'],
  };
  const resolved = resolvePersonaPresentation(assessment, { candidates: [candidate] });
  const payload = {
    result: {
      persona: {
        title: resolved.card.displayName,
        canonicalTitle: resolved.canonical.name,
        cardId: resolved.card.id,
        localCardId: resolved.localCard.id,
        decision: 'hybrid',
        confidence: candidate.confidence,
        rationale: candidate.rationale,
        evidenceIds: [...candidate.evidenceIds],
        candidates: [candidate],
        summary: '本地规则与聚合推演共同形成当前趣味人格。',
      },
      evidence: assessment.evidence.slice(0, 2).map((item, index) => ({ id: `E${index + 1}`, statement: item.statement })),
      pattern: '近期记录呈现出稳定的相似触发方式。',
      action: { title: '先等十分钟', steps: ['把想买的东西先放进冷静单。'] },
      goalLink: '可以与当前目标做一次低压力比较。',
      disclaimer: '结果只基于本次聚合数据，不是专业意见。',
    },
  };
  const validatorSource = functionSource('validateAiDiagnosis', 'friendlyAiError');
  const context = { resolvePersonaPresentation, isFigmaPersonaCardId };
  vm.runInNewContext(`${validatorSource}\nthis.validateAiDiagnosis = validateAiDiagnosis;`, context);
  assert.equal(context.validateAiDiagnosis(payload, assessment), true);
  const escaped = structuredClone(payload);
  escaped.result.evidence[1].id = 'E99';
  assert.equal(context.validateAiDiagnosis(escaped, assessment), false);
});

test('重试开始与失败都会清除旧诊断，且请求阶段不重复重绘结果', () => {
  const requestSource = functionSource('requestAiDiagnosis', 'startAiDiagnosis');
  assert.ok((requestSource.match(/state\.diagnosis = null;/g) || []).length >= 2);
  assert.match(requestSource, /setAiDiagnosisInvalidatedForSession\(true\)/);
  assert.match(requestSource, /persistAiDiagnosis\(state\.diagnosis\)/);
  assert.doesNotMatch(requestSource, /saveState\(\)/);
  assert.match(requestSource, /requestPersistedFingerprint !== expectedPersistedFingerprint/);
  assert.match(requestSource, /diagnosisBusinessStateFingerprint\(state\)/);
  assert.match(requestSource, /persistedDiagnosisBusinessStateFingerprint\(\)/);
  assert.match(requestSource, /requestBusinessContextIsCurrent\(\)/);
  assert.doesNotMatch(requestSource, /renderClinic\(\);\s*renderClinic\(\)/);
  assert.equal((requestSource.match(/openGachaponResult\(\)/g) || []).length, 1);
});

test('诊疗大报告按数据画像签名缓存，AI 局部状态变化不重复重建', () => {
  const fingerprintSource = functionSource('assessmentReportFingerprint', 'personalityProfileSignature');
  const signatureSource = functionSource('personalityProfileSignature', 'shouldRenderPersonalityProfile');
  const cacheSource = functionSource('shouldRenderPersonalityProfile', 'renderPersonalityProfile');
  const renderSource = functionSource('renderPersonalityProfile', 'diagnosisIsFresh');
  const context = { historicalReportContextFor: () => null };
  vm.runInNewContext(`
    let personalityProfileRenderSignature = '';
    ${fingerprintSource}
    ${signatureSource}
    ${cacheSource}
    this.profileCache = { personalityProfileSignature, shouldRenderPersonalityProfile };
  `, context);
  const assessment = {
    period: 30,
    modelVersion: 'wallet-personality-rules-1.1.0',
    source: 'personal',
    eligible: true,
    primaryPersona: { id: 'deal_actuary' },
  };
  const presentation = { canonical: { id: 'deal_actuary' }, card: { id: 'price-lover' } };

  assert.equal(context.profileCache.shouldRenderPersonalityProfile(assessment, presentation, 8), true);
  assert.equal(context.profileCache.shouldRenderPersonalityProfile(assessment, presentation, 8), false);
  assert.equal(context.profileCache.shouldRenderPersonalityProfile({ ...assessment, period: 7 }, presentation, 8), true);
  assert.notEqual(
    context.profileCache.personalityProfileSignature({ assessment, presentation, dataRevision: 8 }),
    context.profileCache.personalityProfileSignature({ assessment, presentation: { ...presentation, card: { id: 'limited-deal' } }, dataRevision: 8 }),
  );
  assert.ok(
    renderSource.indexOf('shouldRenderPersonalityProfile') < renderSource.indexOf("document.querySelector('#personalityProfile')"),
    '应在读取和重建大报告 DOM 之前命中缓存退出',
  );
});

test('人格报告容器保持可聚焦，但不把整份报告作为 aria-live 重复播报', () => {
  const tag = indexSource.match(/<section class="personality-profile"[^>]*>/)?.[0] || '';
  assert.match(tag, /id="personalityProfile"/);
  assert.match(tag, /tabindex="-1"/);
  assert.doesNotMatch(tag, /aria-live/);
});
