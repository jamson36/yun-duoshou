import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createAppServer } from '../server.mjs';
import { buildDiagnosisRequest, scorePersonality } from '../personality-scoring.js';
import {
  FIGMA_PERSONA_CARDS,
  getAllowedPersonaCardIds,
  resolvePersonaPresentation,
} from '../persona-presentations.js';
import { validateDiagnosisRequest } from '../server/diagnosis-service.mjs';

async function withServer(options, run) {
  const server = createAppServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function rawRequestStatus(baseUrl, path) {
  const origin = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: origin.hostname,
      port: origin.port,
      method: 'GET',
      path,
    }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
    request.end();
  });
}

function diagnosisFixture() {
  const now = new Date();
  const orders = Array.from({ length: 6 }, (_, index) => {
    const createdAt = new Date(now.getTime() - index * 86_400_000);
    return {
      id: `private-order-${index}`,
      name: `不应离开浏览器的商品 ${index}`,
      note: '不应发送的私密备注',
      amount: 80 + index,
      category: '数码家居',
      reason: '限时优惠',
      decisionSignals: ['compare', 'deal'],
      status: index < 4 ? 'saved' : 'purchased',
      createdAt: createdAt.toISOString(),
      decidedAt: new Date(createdAt.getTime() + 3_600_000).toISOString(),
      updatedAt: createdAt.toISOString(),
      statusHistory: [],
    };
  });
  const assessment = scorePersonality({ orders, now });
  return buildDiagnosisRequest({ assessment, orders });
}

function resolverAssessmentFromSummary(summary) {
  return {
    ...summary.localAssessment,
    categories: summary.categories,
    reasons: summary.reasons,
    statuses: summary.statuses,
    presentationSignals: summary.presentationSignals,
    personaCandidates: summary.personaCandidates,
  };
}

function aiOutput(personaCandidates, evidenceIds = ['E1', 'E2']) {
  return {
    personaCandidates,
    personaSummary: '本地规则人格保持不变，聚合证据只用来细化趣味卡面。',
    evidenceIds,
    pattern: '优惠触发和比较行为在本期反复一起出现。',
    action: { title: '先记下真实需求', steps: ['隔一晚再确认优惠是否真正有用。'] },
    goalLink: '少一次为优惠而买，就给当前目标多留一点空间。',
    suggestedQuestions: ['如果没有倒计时，我还会想买吗？'],
  };
}

function upstreamResponse(output) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('健康检查不暴露密钥并报告配置状态', async () => {
  await withServer({ apiKey: 'secret-test-key' }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.aiConfigured, true);
    assert.equal(Object.hasOwn(payload, 'model'), false);
    assert.equal(JSON.stringify(payload).includes('secret-test-key'), false);
  });
});

test('公开静态资源不暴露复诊服务商或模型名称', async () => {
  await withServer({}, async (baseUrl) => {
    const responses = await Promise.all([
      fetch(`${baseUrl}/`),
      fetch(`${baseUrl}/app.js`),
      fetch(`${baseUrl}/analysis-stages.js`),
      fetch(`${baseUrl}/budget-goals.js`),
      fetch(`${baseUrl}/gachapon-motion.js`),
      fetch(`${baseUrl}/budget-whiteboard.js`),
      fetch(`${baseUrl}/goal-date-picker.js`),
      fetch(`${baseUrl}/intro-transition.js`),
      fetch(`${baseUrl}/gesture-controls.js`),
      fetch(`${baseUrl}/gesture-ui.js`),
      fetch(`${baseUrl}/gesture-recognizer.worker.js`),
      fetch(`${baseUrl}/peel-copy-catalog.js`),
      fetch(`${baseUrl}/peel-game.js`),
      fetch(`${baseUrl}/peel-game-ui.js`),
      fetch(`${baseUrl}/peel-product-visuals.js`),
      fetch(`${baseUrl}/peel-gesture-controls.js`),
      fetch(`${baseUrl}/orientation-controls.js`),
      fetch(`${baseUrl}/orientation-ui.js`),
      fetch(`${baseUrl}/styles.css`),
      fetch(`${baseUrl}/peel-game-refined.css`),
      fetch(`${baseUrl}/persona-presentations.js`),
      fetch(`${baseUrl}/route-sync.js`),
      fetch(`${baseUrl}/share-poster.js`),
    ]);
    const publicSource = (await Promise.all(responses.map((response) => response.text()))).join('\n');
    assert.doesNotMatch(publicSource, /deepseek/i);
  });
});

test('同源服务能返回首页和安全响应头', async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /让你花个爽/);
    assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.match(response.headers.get('content-security-policy'), /img-src 'self' data: blob:/);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self' 'wasm-unsafe-eval'/);
    assert.match(response.headers.get('content-security-policy'), /worker-src 'self'/);
    assert.equal(
      response.headers.get('permissions-policy'),
      'camera=(self), accelerometer=(self), gyroscope=(self), magnetometer=(), microphone=(), geolocation=(), payment=()',
    );
  });
});

test('手势与体感控制模块、Worker 与本地模型只通过同源白名单提供', async () => {
  await withServer({}, async (baseUrl) => {
    const [controls, ui, worker, orientationControls, orientationUi, runtime, wasm, model] = await Promise.all([
      fetch(`${baseUrl}/gesture-controls.js`),
      fetch(`${baseUrl}/gesture-ui.js`),
      fetch(`${baseUrl}/gesture-recognizer.worker.js`),
      fetch(`${baseUrl}/orientation-controls.js`),
      fetch(`${baseUrl}/orientation-ui.js`),
      fetch(`${baseUrl}/assets/vendor/gesture-runtime/vision_bundle.js`),
      fetch(`${baseUrl}/assets/vendor/gesture-runtime/wasm/vision_wasm_internal.bin`, { method: 'HEAD' }),
      fetch(`${baseUrl}/assets/vendor/gesture-runtime/hand-gesture.bin`, { method: 'HEAD' }),
    ]);

    assert.deepEqual(
      [controls.status, ui.status, worker.status, orientationControls.status, orientationUi.status, runtime.status, wasm.status, model.status],
      [200, 200, 200, 200, 200, 200, 200, 200],
    );
    assert.match(controls.headers.get('content-type'), /text\/javascript/);
    assert.match(ui.headers.get('content-type'), /text\/javascript/);
    assert.match(worker.headers.get('content-type'), /text\/javascript/);
    assert.match(orientationControls.headers.get('content-type'), /text\/javascript/);
    assert.match(orientationUi.headers.get('content-type'), /text\/javascript/);
    assert.match(runtime.headers.get('content-type'), /text\/javascript/);
    assert.equal(wasm.headers.get('content-type'), 'application/wasm');
    assert.equal(model.headers.get('content-type'), 'application/octet-stream');
    assert.ok(Number(wasm.headers.get('content-length')) > 100_000);
    assert.ok(Number(model.headers.get('content-length')) > 1_000_000);
  });
});

test('欲望剥壳机运行模块只通过同源白名单提供', async () => {
  await withServer({}, async (baseUrl) => {
    const moduleNames = [
      'peel-copy-catalog.js',
      'peel-game.js',
      'peel-game-ui.js',
      'peel-product-visuals.js',
      'peel-gesture-controls.js',
    ];
    const responses = await Promise.all(moduleNames.map((name) => fetch(`${baseUrl}/${name}`)));

    assert.deepEqual(responses.map((response) => response.status), moduleNames.map(() => 200));
    assert.ok(responses.every((response) => /text\/javascript/.test(response.headers.get('content-type') || '')));
    assert.ok(responses.every((response) => response.headers.get('cache-control') === 'public, max-age=3600'));
  });
});

test('精品解构舱样式只通过同源白名单提供', async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/peel-game-refined.css`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/css/);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
  });
});

test('手势 Worker 使用经典同源运行文件，避免模块版 WASM 初始化长时间阻塞', async () => {
  const [workerSource, uiSource] = await Promise.all([
    readFile(new URL('../gesture-recognizer.worker.js', import.meta.url), 'utf8'),
    readFile(new URL('../gesture-ui.js', import.meta.url), 'utf8'),
  ]);

  assert.match(workerSource, /importScripts\(/);
  assert.match(workerSource, /FilesetResolver\.forVisionTasks\(RUNTIME_ROOT, false\)/);
  assert.match(workerSource, /fileset\.wasmBinaryPath\s*=\s*RUNTIME_WASM_URL/);
  assert.match(workerSource, /vision_wasm_internal\.bin/);
  assert.match(workerSource, /hand-gesture\.bin/);
  assert.match(workerSource, /modelAssetBuffer/);
  assert.match(workerSource, /load-progress/);
  assert.match(workerSource, /runtime-loading/);
  assert.doesNotMatch(workerSource, /vision_bundle\.mjs/);
  assert.doesNotMatch(uiSource, /type:\s*['"]module['"]/);
  assert.match(uiSource, /90_000/);
});

test('生产镜像包含手势与体感控制的根级运行模块', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  const modules = [
    'gesture-controls.js',
    'gesture-recognizer.worker.js',
    'gesture-ui.js',
    'peel-copy-catalog.js',
    'peel-game.js',
    'peel-game-ui.js',
    'peel-product-visuals.js',
    'peel-gesture-controls.js',
    'peel-game-refined.css',
    'orientation-controls.js',
    'orientation-ui.js',
  ];

  modules.forEach((moduleName) => assert.match(dockerfile, new RegExp(`\\b${moduleName.replaceAll('.', '\\.') }\\b`)));
});

test('开屏逻辑与高清房间素材可由静态白名单访问', async () => {
  await withServer({}, async (baseUrl) => {
    const [script, panorama, openingVideo, entryVideo, openingPoster, entryPoster] = await Promise.all([
      fetch(`${baseUrl}/intro-transition.js`),
      fetch(`${baseUrl}/assets/room-panorama-hd.webp`, { method: 'HEAD' }),
      fetch(`${baseUrl}/assets/room-intro-hq.mp4`, { method: 'HEAD' }),
      fetch(`${baseUrl}/assets/room-entry-loop.mp4`, { method: 'HEAD' }),
      fetch(`${baseUrl}/assets/room-intro-poster-hq.webp`, { method: 'HEAD' }),
      fetch(`${baseUrl}/assets/room-entry-poster-hq.webp`, { method: 'HEAD' }),
    ]);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /text\/javascript/);
    assert.equal(panorama.status, 200);
    assert.equal(panorama.headers.get('content-type'), 'image/webp');
    assert.equal(openingVideo.status, 200);
    assert.equal(openingVideo.headers.get('content-type'), 'video/mp4');
    assert.equal(openingVideo.headers.get('cache-control'), 'public, max-age=3600');
    assert.ok(Number(openingVideo.headers.get('content-length')) > 0);
    assert.equal(entryVideo.status, 200);
    assert.equal(entryVideo.headers.get('content-type'), 'video/mp4');
    assert.equal(entryVideo.headers.get('cache-control'), 'public, max-age=3600');
    assert.ok(Number(entryVideo.headers.get('content-length')) > 0);
    assert.equal(openingPoster.status, 200);
    assert.equal(openingPoster.headers.get('content-type'), 'image/webp');
    assert.equal(entryPoster.status, 200);
    assert.equal(entryPoster.headers.get('content-type'), 'image/webp');
  });
});

test('欲望控制器四张 Figma 高清 IP 可由静态白名单访问', async () => {
  await withServer({}, async (baseUrl) => {
    const assets = await Promise.all([
      'controller-elegant.webp',
      'controller-worker.webp',
      'controller-side-hustle.webp',
      'controller-beggar.webp',
    ].map((name) => fetch(`${baseUrl}/assets/figma-controller-20260901/${name}`, { method: 'HEAD' })));

    assets.forEach((asset) => {
      assert.equal(asset.status, 200);
      assert.equal(asset.headers.get('content-type'), 'image/webp');
      assert.equal(asset.headers.get('cache-control'), 'public, max-age=3600');
      assert.ok(Number(asset.headers.get('content-length')) > 50_000);
    });
  });
});

test('复诊四阶段控制器可由静态白名单访问', async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/analysis-stages.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/javascript/);
  });
});

test('Figma 商城成功动效以 GIF 类型提供并保留静态回退图', async () => {
  await withServer({}, async (baseUrl) => {
    const [confetti, horn, poster] = await Promise.all([
      fetch(`${baseUrl}/assets/mall-confetti.gif`, { method: 'HEAD' }),
      fetch(`${baseUrl}/assets/mall-horn.gif`, { method: 'HEAD' }),
      fetch(`${baseUrl}/assets/mall-confetti-poster.png`, { method: 'HEAD' }),
    ]);
    assert.deepEqual([confetti.status, horn.status, poster.status], [200, 200, 200]);
    assert.equal(confetti.headers.get('content-type'), 'image/gif');
    assert.equal(horn.headers.get('content-type'), 'image/gif');
    assert.equal(poster.headers.get('content-type'), 'image/png');
  });
});

test('Figma 人格扭蛋机素材可访问且首页使用本地资源', async () => {
  await withServer({}, async (baseUrl) => {
    const [page, gachapon] = await Promise.all([
      fetch(`${baseUrl}/`),
      fetch(`${baseUrl}/assets/personality-gachapon-figma.png`, { method: 'HEAD' }),
    ]);
    const html = await page.text();
    assert.equal(gachapon.status, 200);
    assert.equal(gachapon.headers.get('content-type'), 'image/png');
    assert.match(html, /assets\/personality-gachapon-figma\.png/);
    assert.match(html, /PERSONALITY GACHAPON/);
    assert.ok(html.indexOf('id="aiCard"') < html.indexOf('class="clinic-period-bar"'), '人格扭蛋机应当先于详细评分出现');
  });
});

test('Figma 人格展示注册表与卡面资源可由静态白名单访问', async () => {
  await withServer({}, async (baseUrl) => {
    const [registry, routeSync, ...cards] = await Promise.all([
      fetch(`${baseUrl}/persona-presentations.js`),
      fetch(`${baseUrl}/route-sync.js`),
      ...Object.values(FIGMA_PERSONA_CARDS).map((card) => fetch(`${baseUrl}/${card.art}`, { method: 'HEAD' })),
    ]);
    assert.equal(registry.status, 200);
    assert.match(registry.headers.get('content-type'), /text\/javascript/);
    assert.match(await registry.text(), /FIGMA_PERSONA_CARDS/);
    assert.equal(routeSync.status, 200);
    assert.match(routeSync.headers.get('content-type'), /text\/javascript/);
    assert.equal(cards.length, 20);
    cards.forEach((card) => {
      assert.equal(card.status, 200);
      assert.equal(card.headers.get('content-type'), 'image/png');
    });
  });
});

test('商城商品图使用项目内的 Figma 原始素材', async () => {
  await withServer({}, async (baseUrl) => {
    const assetPaths = [
      'figma-commerce-20260901/shop-30-977/raw-image-12.jpeg',
      'figma-commerce-20260901/shop-30-977/raw-image-02.jpeg',
      'figma-commerce-20260901/food-30-1334/product-milk-tea.jpg',
      'figma-commerce-20260901/food-30-1334/product-fried-chicken.jpg',
      'figma-commerce-20260901/interest-30-1936/product-film-photography.jpeg',
      'figma-commerce-20260901/interest-30-1936/product-weekend-flower.png',
    ];
    const responses = await Promise.all(assetPaths.map((path) => fetch(`${baseUrl}/assets/${path}`, { method: 'HEAD' })));
    assert.deepEqual(responses.map((response) => response.status), assetPaths.map(() => 200));
    assert.ok(responses.every((response) => /^image\/(?:jpeg|png)$/.test(response.headers.get('content-type') || '')));

    const appSource = await (await fetch(`${baseUrl}/app.js`)).text();
    assert.match(appSource, /figma-commerce-20260901\/shop-30-977\/raw-image-12\.jpeg/);
    assert.match(appSource, /figma-commerce-20260901\/food-30-1334\/product-milk-tea\.jpg/);
    assert.match(appSource, /figma-commerce-20260901\/interest-30-1936\/product-film-photography\.jpeg/);
    assert.doesNotMatch(appSource, /image:\s*['"]https?:\/\//);
  });
});

test('预算白板交互模块可由静态白名单访问', async () => {
  await withServer({}, async (baseUrl) => {
    const script = await fetch(`${baseUrl}/budget-whiteboard.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /text\/javascript/);
    assert.match(await script.text(), /class SceneBudgetWhiteboard/);
  });
});

test('预算日期选择模块可由静态白名单访问', async () => {
  await withServer({}, async (baseUrl) => {
    const script = await fetch(`${baseUrl}/goal-date-picker.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /text\/javascript/);
    assert.match(await script.text(), /class GoalDatePicker/);
  });
});

test('多目标和分享海报模块可由静态白名单访问', async () => {
  await withServer({}, async (baseUrl) => {
    const [goals, poster] = await Promise.all([
      fetch(`${baseUrl}/budget-goals.js`),
      fetch(`${baseUrl}/share-poster.js`),
    ]);
    assert.equal(goals.status, 200);
    assert.equal(poster.status, 200);
    assert.match(await goals.text(), /migrateBudgetState/);
    assert.match(await poster.text(), /renderSharePoster/);
  });
});

test('拒绝访问服务器源码目录', async () => {
  await withServer({}, async (baseUrl) => {
    const responses = await Promise.all([
      fetch(`${baseUrl}/server/diagnosis-service.mjs`),
      fetch(`${baseUrl}/server.mjs`),
      fetch(`${baseUrl}/.env.example`),
    ]);
    assert.deepEqual(responses.map((response) => response.status), [404, 404, 404]);
  });
});

test('assets 静态白名单拒绝编码分隔符、反斜杠和点段穿越', async () => {
  const traversalPaths = [
    '/assets/..%2Fserver%2Fdiagnosis-service.mjs',
    '/assets/%2e%2e%2fserver%2fdiagnosis-service.mjs',
    '/assets%2F..%2Fserver%2Fdiagnosis-service.mjs',
    '/assets/%252e%252e%252fserver%252fdiagnosis-service.mjs',
    '/assets/../server/diagnosis-service.mjs',
    '/assets/./room-panorama-hd.webp',
    '/assets//room-panorama-hd.webp',
    '/assets\\..\\server\\diagnosis-service.mjs',
    '/assets/%5c..%5cserver%5cdiagnosis-service.mjs',
  ];
  await withServer({}, async (baseUrl) => {
    const statuses = await Promise.all(traversalPaths.map((path) => rawRequestStatus(baseUrl, path)));
    assert.deepEqual(statuses, traversalPaths.map(() => 404));
    assert.equal(await rawRequestStatus(baseUrl, '/assets/room-panorama-hd.webp'), 200);
  });
});

test('DeepSeek 合法候选可在本地硬门槛内切换 Figma 展示卡', async () => {
  const request = diagnosisFixture();
  request.presentationSignals.privateProduct = '不应进入模型的商品名';
  request.localAssessment.outcomes.privateNote = '不应进入模型的备注';
  request.goal = {
    name: '不应进入模型的目标名称',
    privateNote: '不应进入模型的目标备注',
    targetAmount: 3000,
    progress: 600,
    progressRate: 0.2,
  };
  request.localAssessment.primaryPersona.rationale = 'SECRET_PRIMARY_RATIONALE';
  request.personaCandidates.forEach((candidate) => {
    candidate.rationale = 'SECRET_CANDIDATE_RATIONALE';
  });
  request.localAssessment.evidence.forEach((item, index) => {
    item.id = `SECRET_EVIDENCE_ID_${index}`;
    item.metric = `SECRET_EVIDENCE_METRIC_${index}`;
    item.statement = `SECRET_EVIDENCE_STATEMENT_${index}`;
  });
  request.localAssessment.walletTheme = 'SECRET_WALLET_THEME';
  request.localAssessment.localAdvice = 'SECRET_LOCAL_ADVICE';
  const summary = validateDiagnosisRequest(request);
  const assessment = resolverAssessmentFromSummary(summary);
  const localPresentation = resolvePersonaPresentation(assessment);
  const alternativeCardId = getAllowedPersonaCardIds(assessment)
    .find((cardId) => cardId !== localPresentation.card.id);
  assert.ok(alternativeCardId, '测试数据应至少有一张兼容的替代卡面');

  let upstreamBody;
  const fetchImpl = async (_url, options) => {
    upstreamBody = JSON.parse(options.body);
    return upstreamResponse(aiOutput([{
      cardId: alternativeCardId,
      confidence: 0.82,
      rationale: '多条聚合证据同时支持这张趣味卡面。',
      evidenceIds: ['E2', 'E3', 'E3', 'UNKNOWN'],
    }], ['E1', 'E4']));
  };

  await withServer({ apiKey: 'test-key', fetchImpl }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ai/diagnosis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(payload.result.persona).sort(), [
      'canonicalTitle', 'candidates', 'cardId', 'confidence', 'decision',
      'evidenceIds', 'localCardId', 'rationale', 'summary', 'title',
    ].sort());
    assert.equal(payload.result.persona.cardId, alternativeCardId);
    assert.equal(payload.result.persona.localCardId, localPresentation.card.id);
    assert.equal(payload.result.persona.title, FIGMA_PERSONA_CARDS[alternativeCardId].displayName);
    assert.equal(payload.result.persona.canonicalTitle, summary.localAssessment.primaryPersona.name);
    assert.equal(payload.result.persona.decision, 'hybrid');
    assert.equal(payload.result.persona.confidence, 0.82);
    assert.deepEqual(payload.result.persona.evidenceIds, ['E2', 'E3']);
    assert.deepEqual(payload.result.persona.candidates[0].evidenceIds, ['E2', 'E3']);
    assert.deepEqual(payload.result.evidence.map((item) => item.id), ['E2', 'E3']);
    assert.doesNotMatch(JSON.stringify(payload), /SECRET_/);
    assert.equal(Object.hasOwn(payload, 'provider'), false);
    assert.equal(Object.hasOwn(payload, 'model'), false);
  });

  const prompt = upstreamBody.messages.map((message) => message.content).join('\n');
  assert.equal(Object.values(FIGMA_PERSONA_CARDS).every((card) => prompt.includes(card.id)), true);
  assert.match(prompt, /presentationSignals/);
  assert.match(prompt, /不得出现服务商、模型、模型版本或接口名称/);
  assert.match(prompt, /"targetAmount":3000,"progress":600,"progressRate":0.2/);
  assert.doesNotMatch(prompt, /不应进入模型的商品名|不应进入模型的备注|不应进入模型的目标名称|不应进入模型的目标备注|private-order-/);
  assert.doesNotMatch(prompt, /SECRET_/);
});

test('DeepSeek 非法、无证据或不兼容候选均回退到本地卡面', async () => {
  const request = diagnosisFixture();
  const summary = validateDiagnosisRequest(request);
  const assessment = resolverAssessmentFromSummary(summary);
  const localPresentation = resolvePersonaPresentation(assessment);
  const allowed = new Set(getAllowedPersonaCardIds(assessment));
  const compatibleCardId = [...allowed][0];
  const incompatibleCardId = Object.keys(FIGMA_PERSONA_CARDS).find((cardId) => !allowed.has(cardId));
  assert.ok(incompatibleCardId);
  const output = aiOutput([
    { cardId: 'invented_persona', confidence: 0.99, rationale: '自创卡面', evidenceIds: ['E1', 'E2'] },
    { cardId: compatibleCardId, confidence: 0.99, rationale: '缺少可验证证据', evidenceIds: ['UNKNOWN'] },
    { cardId: incompatibleCardId, confidence: 0.99, rationale: '与本地规则人格不兼容', evidenceIds: ['E1', 'E2'] },
  ]);
  output.personaSummary = '你就是被拒绝的不兼容人格。';

  await withServer({ apiKey: 'test-key', fetchImpl: async () => upstreamResponse(output) }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ai/diagnosis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.result.persona.decision, 'local');
    assert.equal(payload.result.persona.cardId, localPresentation.card.id);
    assert.equal(payload.result.persona.localCardId, localPresentation.card.id);
    assert.equal(payload.result.persona.canonicalTitle, summary.localAssessment.primaryPersona.name);
    assert.deepEqual(payload.result.persona.candidates.map((candidate) => candidate.cardId), [incompatibleCardId]);
    assert.doesNotMatch(payload.result.persona.summary, /被拒绝的不兼容人格/);
    assert.match(payload.result.persona.summary, new RegExp(summary.localAssessment.primaryPersona.name));
    assert.match(payload.result.persona.summary, new RegExp(localPresentation.card.displayName));
  });
});

test('DeepSeek 旧输出没有展示人格候选时保持本地兼容响应', async () => {
  const request = diagnosisFixture();
  const summary = validateDiagnosisRequest(request);
  const localPresentation = resolvePersonaPresentation(resolverAssessmentFromSummary(summary));
  const output = aiOutput(undefined);
  delete output.personaCandidates;
  output.personaSummary = 'DeepSeek-v4-flash 认为你是另一种人格。';
  output.pattern = 'wallet-inference-private-2026 和独立别名 R1 认为这些聚合信号相互呼应。';
  output.action = { title: '跟随 V4 Flash', steps: ['不要把 V3 或 deep_seek-coder 的说法当作事实。'] };
  output.goalLink = '深度求索 V3 认为这与目标相关。';
  output.suggestedQuestions = ['DeepSeek-R1 还会如何判断？'];

  await withServer({
    apiKey: 'test-key',
    model: 'wallet-inference-private-2026',
    fetchImpl: async () => upstreamResponse(output),
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ai/diagnosis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.result.persona.decision, 'local');
    assert.equal(payload.result.persona.cardId, localPresentation.card.id);
    assert.equal(payload.result.persona.title, localPresentation.card.displayName);
    assert.deepEqual(payload.result.persona.candidates, []);
    assert.equal(payload.result.evidence.length, 2);
    assert.doesNotMatch(JSON.stringify(payload), /deep[\s_-]*seek|深度求索|wallet-inference-private-2026|\bR1\b|\bV3\b|\bV4\s*Flash\b/i);
    assert.match(JSON.stringify(payload), /复诊服务/);
  });
});

test('诊断 API 拒绝把商品名伪装成聚合分类且不调用上游', async () => {
  const request = diagnosisFixture();
  request.categories[0].category = '私密商品名';
  let upstreamCalled = false;
  const fetchImpl = async () => {
    upstreamCalled = true;
    return upstreamResponse(aiOutput([]));
  };

  await withServer({ apiKey: 'test-key', fetchImpl }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ai/diagnosis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.code, 'invalid_request');
    assert.equal(upstreamCalled, false);
  });
});
