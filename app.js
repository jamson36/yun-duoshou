import { RoomIntro } from './intro-transition.js?v=20260826-intro-2';
import { PanoramaRoom } from './panorama.js?v=20260826-intro-2';
import { FEATURE_HOTSPOTS, SCENE_DEFAULT_VIEW, SCENE_GROUPS, SCENE_INTRO_VIEW, createPackageHotspots } from './scene-config.js?v=20260826-intro-2';
import { AXIS_META, buildDiagnosisRequest, calculateGoalProgress, scorePersonality } from './personality-scoring.js?v=20260826-privacy-1';

const STORAGE_KEY = 'rang-ni-hua-ge-shuang-room-v1';
const LEGACY_STORAGE_KEYS = ['yun-duoshou-room-v1'];

const PANEL_META = {
  new: {
    index: '02',
    speech: '手机只是模拟界面。先把想买的记下来，别急着真付款。',
  },
  orders: {
    index: '02B',
    speech: '手机里还有一些决定没做完，先看看哪些还在冷静中。',
  },
  clinic: {
    index: '01',
    speech: '健身屏看的不是体重，是最近的钱包习惯。结果只来自你的记录。',
  },
  goals: {
    index: '03',
    speech: '把真正想要的写到白板上，零散冲动才有一个比较对象。',
  },
};

const STATUS_LABELS = {
  cooling: '冷静中',
  saved: '幸好没买',
  purchased: '最终购买',
};

const app = document.querySelector('#app');
const sceneFrame = document.querySelector('#sceneFrame');
const focusPanel = document.querySelector('#focusPanel');
const panelClose = document.querySelector('#panelClose');
const panelIndex = document.querySelector('#panelIndex');
const mascotBubble = document.querySelector('#mascotBubble');
const mascotButton = document.querySelector('#mascotButton');
const toast = document.querySelector('#toast');
const orderForm = document.querySelector('#orderForm');
const goalForm = document.querySelector('#goalForm');
const orderList = document.querySelector('#orderList');
const analyzeButton = document.querySelector('#analyzeButton');
const posterButton = document.querySelector('#posterButton');
const posterPreview = document.querySelector('#posterPreview');
const aiConsentPanel = document.querySelector('#aiConsentPanel');
const aiConsentSummary = document.querySelector('#aiConsentSummary');
const allowAiButton = document.querySelector('#allowAiButton');
const localOnlyButton = document.querySelector('#localOnlyButton');
const revokeAiConsentButton = document.querySelector('#revokeAiConsentButton');
const sceneStatus = document.querySelector('#sceneStatus');
const roomIntroGate = document.querySelector('#roomIntroGate');
const roomEntryLockup = document.querySelector('#roomEntryLockup');
const enterRoomButton = document.querySelector('#enterRoomButton');

let activePanel = null;
let activeTrigger = null;
let activeFilter = 'all';
let activeClinicPeriod = 30;
let currentAssessment = null;
let aiRequestController = null;
let aiUiState = { status: 'idle', message: '' };
let toastTimer = null;
let state = loadState();
let roomEntered = false;
let pendingPanel = null;

const sceneHotspots = [...FEATURE_HOTSPOTS, ...createPackageHotspots()];
const panorama = new PanoramaRoom({
  stage: sceneFrame,
  canvas: document.querySelector('#panoramaCanvas'),
  hotspotLayer: document.querySelector('#hotspotLayer'),
  imageUrl: './assets/room-panorama-hd.webp',
  hotspots: sceneHotspots,
  defaultView: SCENE_DEFAULT_VIEW,
  initialView: SCENE_INTRO_VIEW,
  interactionEnabled: false,
  groups: SCENE_GROUPS,
  onActivate: (hotspot, trigger) => {
    panorama.focusHotspot(hotspot.id);
    openPanel(hotspot.panel, trigger);
  },
  onThought: (hotspot, _trigger, options = {}) => {
    if (!options.preview || window.matchMedia('(hover: hover)').matches) {
      setMascotSpeech(hotspot.thought);
    }
  },
});

const roomUiLayers = [...document.querySelectorAll('.topbar, .room-heading, .metric-strip, .hotspot-layer, .scene-mascot, .zone-nav, .mobile-dock')];

function setRoomUiInteractive(value) {
  roomUiLayers.forEach((element) => {
    element.inert = !value;
  });
  sceneFrame.tabIndex = value ? 0 : -1;
}

function completeRoomEntry() {
  roomEntered = true;
  setRoomUiInteractive(true);
  panorama.setInteractionEnabled(true);
  if (pendingPanel) {
    applyPanel(pendingPanel);
    return;
  }
  sceneStatus.textContent = panorama.ready ? '全景已就绪 · 拖动环视' : '静态房间已就绪 · 使用文字导航';
  sceneFrame.focus({ preventScroll: true });
}

setRoomUiInteractive(false);
focusPanel.inert = true;
focusPanel.setAttribute('aria-hidden', 'true');

const roomIntro = new RoomIntro({
  app,
  gate: roomIntroGate,
  canvas: document.querySelector('#introPixelCanvas'),
  status: document.querySelector('#introStatus'),
  lockup: roomEntryLockup,
  enterButton: enterRoomButton,
  duration: 3000,
  reducedMotion: state.settings.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  onEnter: () => panorama.animateToView(SCENE_DEFAULT_VIEW, { duration: 1300, updateIdle: true }),
  onComplete: completeRoomEntry,
});

function defaultState() {
  return {
    schemaVersion: 1,
    dataRevision: 0,
    orders: [],
    goal: null,
    diagnosis: null,
    settings: { reduceMotion: false, aiConsent: false },
  };
}

function loadState() {
  try {
    const sourceKey = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS].find((key) => localStorage.getItem(key));
    if (!sourceKey) return defaultState();
    const parsed = JSON.parse(localStorage.getItem(sourceKey));
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.orders)) return defaultState();
    const loaded = {
      ...defaultState(),
      ...parsed,
      settings: { ...defaultState().settings, ...(parsed.settings || {}) },
    };
    const hasLegacyDiagnosisMetadata = Boolean(loaded.diagnosis
      && (Object.hasOwn(loaded.diagnosis, 'provider') || Object.hasOwn(loaded.diagnosis, 'model')));
    if (hasLegacyDiagnosisMetadata) {
      loaded.diagnosis = { ...loaded.diagnosis };
      delete loaded.diagnosis.provider;
      delete loaded.diagnosis.model;
    }
    if (sourceKey !== STORAGE_KEY || hasLegacyDiagnosisMetadata) localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
    return loaded;
  } catch {
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    showToast('本地存储暂不可用，本次刷新后数据可能丢失。');
  }
}

function mutate(mutator) {
  if (aiRequestController) {
    aiRequestController.abort();
    aiRequestController = null;
  }
  aiUiState = { status: 'idle', message: '' };
  mutator(state);
  state.dataRevision += 1;
  saveState();
  renderAll();
}

function money(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}

function sameLocalDay(dateA, dateB = new Date()) {
  const a = new Date(dateA);
  return a.getFullYear() === dateB.getFullYear()
    && a.getMonth() === dateB.getMonth()
    && a.getDate() === dateB.getDate();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function totals() {
  const todayOrders = state.orders.filter((order) => sameLocalDay(order.createdAt));
  return {
    recordedToday: todayOrders.reduce((sum, order) => sum + order.amount, 0),
    savedToday: todayOrders.filter((order) => order.status === 'saved').reduce((sum, order) => sum + order.amount, 0),
    savedAll: state.orders.filter((order) => order.status === 'saved').reduce((sum, order) => sum + order.amount, 0),
    purchasedAll: state.orders.filter((order) => order.status === 'purchased').reduce((sum, order) => sum + order.amount, 0),
    cooling: state.orders.filter((order) => order.status === 'cooling').length,
  };
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2500);
}

function setMascotSpeech(message) {
  mascotBubble.textContent = message;
}

function applyPanel(panel, trigger = null) {
  const previousTrigger = activeTrigger;
  activePanel = PANEL_META[panel] ? panel : null;
  const triggerIsPersistent = trigger && !trigger.closest('.panel-view');
  activeTrigger = activePanel ? (triggerIsPersistent ? trigger : panorama.getTriggerForPanel(activePanel)) : previousTrigger;

  document.querySelectorAll('.scene-hotspot.is-feature').forEach((object) => {
    const hotspot = sceneHotspots.find((item) => item.id === object.dataset.hotspotId);
    object.classList.toggle('is-active', hotspot?.panel === activePanel || hotspot?.panels?.includes(activePanel));
  });
  document.querySelectorAll('.panel-view').forEach((view) => {
    view.classList.toggle('is-active', view.dataset.panel === activePanel);
  });

  if (!activePanel) {
    app.dataset.focus = 'none';
    app.classList.remove('is-focusing', 'is-focused');
    const returnTarget = activeTrigger;
    activeTrigger = null;
    if (returnTarget && document.contains(returnTarget)) returnTarget.focus({ preventScroll: true });
    else sceneFrame.focus({ preventScroll: true });
    focusPanel.inert = true;
    focusPanel.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    panorama.resetView();
    setMascotSpeech(idleSpeech());
    return;
  }

  app.dataset.focus = activePanel;
  app.classList.remove('is-focusing');
  void app.offsetWidth;
  app.classList.add('is-focusing', 'is-focused');
  focusPanel.inert = false;
  focusPanel.setAttribute('aria-hidden', 'false');
  panelIndex.textContent = PANEL_META[activePanel].index;
  panorama.focusPanel(activePanel);
  setMascotSpeech(PANEL_META[activePanel].speech);
  if (window.innerWidth <= 820) document.body.style.overflow = 'hidden';
  renderAll();

  window.setTimeout(() => {
    const heading = document.querySelector(`.panel-view[data-panel="${activePanel}"] h2`);
    heading?.focus({ preventScroll: true });
  }, document.body.classList.contains('reduce-motion') ? 20 : 680);
}

function openPanel(panel, trigger = null) {
  if (!roomEntered || !PANEL_META[panel]) return;
  history.pushState({ panel, openedByApp: true }, '', `#${panel}`);
  applyPanel(panel, trigger);
}

function closePanel() {
  if (!activePanel) return;
  if (history.state?.openedByApp) {
    history.back();
  } else {
    history.replaceState({ panel: null, openedByApp: false }, '', '#room');
    applyPanel(null);
  }
}

function panelFromHash() {
  const hash = location.hash.replace('#', '');
  return PANEL_META[hash] ? hash : null;
}

function idleSpeech() {
  const { cooling, savedAll } = totals();
  if (cooling > 0) return `电脑里还有 ${cooling} 张小票没决定。要不要去看一眼？`;
  if (savedAll > 0) return `目前确认省下 ${money(savedAll)}。别忘了，虚拟进度不等于真实存款。`;
  return '嗨，我先看数据，不乱贴标签。先从一张冷静小票开始吧。';
}

function renderMetrics() {
  const current = totals();
  const clinicAssessment = scorePersonality({ orders: state.orders, period: 30 });
  document.querySelector('#metricRecorded').textContent = money(current.recordedToday);
  document.querySelector('#metricSaved').textContent = money(current.savedToday);
  document.querySelector('#metricCooling').textContent = current.cooling;
  document.querySelector('#computerStatus').textContent = current.cooling ? `${current.cooling} 张订单等决定` : '手机收件箱是空的';
  document.querySelector('#clinicStatus').textContent = clinicAssessment.eligible
    ? `${clinicAssessment.primaryPersona?.name || '画像形成中'} · ${clinicAssessment.confidence.score}%`
    : `近 30 天还差 ${Math.max(0, 3 - clinicAssessment.orderCount)} 笔记录`;
  const badge = document.querySelector('#orderBadge');
  if (badge) {
    badge.hidden = current.cooling === 0;
    badge.textContent = current.cooling;
  }
  document.querySelector('#goalStatus').textContent = state.goal
    ? `${state.goal.name} · ${Math.min(100, Math.round((current.savedAll / state.goal.amount) * 100))}%`
    : '白板还是空的';
  if (!activePanel) setMascotSpeech(idleSpeech());
}

function renderOrders() {
  const filtered = state.orders
    .filter((order) => activeFilter === 'all' || order.status === activeFilter)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  document.querySelector('#orderCountSticker').textContent = `${state.orders.length} 张小票`;
  document.querySelector('#exportButton').disabled = state.orders.length === 0 && !state.goal;

  if (!filtered.length) {
    orderList.innerHTML = `
      <div class="empty-state">
        <b>${state.orders.length ? '这个筛选里暂时没有小票' : '订单电脑还是空的'}</b>
        <p>${state.orders.length ? '换一个状态看看。' : '去云下单打印机记录第一笔消费欲望。'}</p>
      </div>`;
    return;
  }

  orderList.innerHTML = filtered.map((order) => {
    const created = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(order.createdAt));
    return `
      <article class="order-ticket">
        <div>
          <h3>${escapeHtml(order.name)}</h3>
          <p>${escapeHtml(order.category)} · ${escapeHtml(order.reason)} · ${created}</p>
          <span class="order-state ${order.status}">${STATUS_LABELS[order.status]}</span>
        </div>
        <strong class="order-amount">${money(order.amount)}</strong>
        <div class="ticket-actions">
          ${order.status !== 'saved' ? `<button type="button" data-order-action="saved" data-order-id="${order.id}">幸好没买</button>` : ''}
          ${order.status !== 'purchased' ? `<button type="button" data-order-action="purchased" data-order-id="${order.id}">最终购买</button>` : ''}
          ${order.status !== 'cooling' ? `<button type="button" data-order-action="cooling" data-order-id="${order.id}">改回冷静中</button>` : ''}
        </div>
      </article>`;
  }).join('');
}

function confidenceLabel(confidence) {
  if (confidence.level === 'insufficient') return '记录不足';
  if (confidence.level === 'stable') return `相对稳定 · ${confidence.score}%`;
  return `正在形成 · ${confidence.score}%`;
}

function axisTendency(axis, score) {
  if (score === null) return '待补证据';
  if (score >= 65) return axis.high;
  if (score <= 35) return axis.low;
  return '两端相对均衡';
}

function renderPersonalityProfile(assessment) {
  const profile = document.querySelector('#personalityProfile');
  if (!assessment.eligible) {
    profile.innerHTML = `
      <div class="profile-empty">
        <span>NEED ${Math.max(0, 3 - assessment.orderCount)} MORE</span>
        <h3>钱包的性格<br />还没显影</h3>
        <p>近 ${assessment.period} 天已有 ${assessment.orderCount} 笔记录。至少 3 笔后才给初步人格，避免拿一两次消费给你硬贴标签。</p>
      </div>`;
    return;
  }

  const persona = assessment.primaryPersona;
  const secondary = assessment.secondaryPersona;
  const motivationEntries = Object.entries(assessment.motivations).sort((a, b) => b[1].share - a[1].share);
  const outcome = assessment.outcomes;
  profile.innerHTML = `
    <header class="profile-identity">
      <div><small>PRIMARY WALLET TYPE</small><h3>${escapeHtml(persona.name)}</h3><p>${escapeHtml(persona.rationale)}</p></div>
      <span class="confidence-seal"><b>${assessment.confidence.score}</b><small>可信度</small></span>
    </header>
    <div class="profile-tags">
      ${secondary ? `<span>副人格 · ${escapeHtml(secondary.name)}</span>` : '<span>单一倾向暂不明显</span>'}
      <span>钱包主题 · ${escapeHtml(assessment.walletTheme)}</span>
      ${assessment.dataMode !== 'personal' ? `<span class="demo-tag">${assessment.dataMode === 'demo' ? '演示数据' : '混合数据'}</span>` : ''}
    </div>
    <div class="axis-report" aria-label="五维消费评分">
      ${Object.entries(AXIS_META).map(([key, meta]) => {
        const axis = assessment.axes[key];
        const width = axis.score === null ? 0 : axis.score;
        return `<div class="axis-row ${axis.score === null ? 'is-missing' : ''}">
          <div><span>${escapeHtml(meta.label)}</span><small>${escapeHtml(axisTendency(meta, axis.score))}</small><b>${axis.score === null ? '—' : axis.score}</b></div>
          <div class="axis-track" role="meter" aria-label="${escapeHtml(meta.label)}" aria-valuemin="0" aria-valuemax="100" ${axis.score === null ? '' : `aria-valuenow="${axis.score}"`}><i style="--axis-score:${width}%"></i></div>
        </div>`;
      }).join('')}
    </div>
    <div class="motive-report">
      <div class="report-label"><span>为什么想买</span><small>MOTIVE MIX</small></div>
      <div class="motive-grid">${motivationEntries.map(([, motive], index) => `<div class="${index === 0 ? 'is-leading' : ''}"><b>${escapeHtml(motive.label)}</b><strong>${Math.round(motive.share * 100)}%</strong><small>${escapeHtml(motive.description)}</small></div>`).join('')}</div>
    </div>
    <div class="outcome-strip">
      <div><small>冷静单数率</small><strong>${outcome.decidedCount ? `${Math.round(outcome.savedCountRate * 100)}%` : '—'}</strong></div>
      <div><small>冷静金额率</small><strong>${outcome.decidedCount ? `${Math.round(outcome.savedAmountRate * 100)}%` : '—'}</strong></div>
      <div><small>中位决定时间</small><strong>${outcome.medianDecisionHours === null ? '—' : `${outcome.medianDecisionHours}h`}</strong></div>
    </div>
    <details class="profile-evidence">
      <summary>为什么这样判断 <span>${assessment.evidence.length} 条可核对证据</span></summary>
      <ul>${assessment.evidence.map((item) => `<li>${escapeHtml(item.statement)}</li>`).join('')}</ul>
    </details>
    <div class="local-prescription"><small>本地一步建议</small><p>${escapeHtml(assessment.localAdvice)}</p></div>`;
}

function diagnosisIsFresh() {
  return Boolean(state.diagnosis
    && state.diagnosis.sourceRevision === state.dataRevision
    && state.diagnosis.period === activeClinicPeriod
    && state.diagnosis.scoringModelVersion === currentAssessment?.modelVersion);
}

function renderConsentSummary(assessment) {
  const payload = buildDiagnosisRequest({ assessment, goal: state.goal, orders: state.orders });
  const topCategory = payload.categories[0];
  const topReason = payload.reasons[0];
  aiConsentSummary.innerHTML = `
    <div><span>周期</span><b>${payload.period} 天</b></div>
    <div><span>有效记录</span><b>${assessment.orderCount} 笔</b></div>
    <div><span>最高频分类</span><b>${escapeHtml(topCategory?.category || '暂无')}</b></div>
    <div><span>最高频诱因</span><b>${escapeHtml(topReason?.reason || '暂无')}</b></div>
    <div><span>本地人格</span><b>${escapeHtml(assessment.primaryPersona.name)}</b></div>
    <div><span>当前目标</span><b>${escapeHtml(payload.goal?.name || '未设置')}</b></div>`;
}

function renderAiResult(assessment) {
  const result = document.querySelector('#aiResult');
  const status = document.querySelector('#aiCardStatus');
  const light = document.querySelector('#aiStatusLight');
  const fresh = diagnosisIsFresh();
  light.dataset.status = aiUiState.status;
  revokeAiConsentButton.hidden = !state.settings.aiConsent;

  if (aiUiState.status === 'requesting') {
    status.textContent = 'SUMMARY REVIEW IN PROGRESS';
    result.innerHTML = '<div class="ai-loading" role="status" aria-label="正在分析"><i></i><i></i><i></i><span>正在复核本地评分和聚合证据…</span></div>';
  } else if (aiUiState.status === 'error') {
    status.textContent = 'SERVICE UNAVAILABLE · LOCAL FALLBACK ACTIVE';
    result.innerHTML = `<div class="ai-fallback"><span>本地降级</span><h3>${escapeHtml(assessment.primaryPersona.name)}</h3><p>${escapeHtml(aiUiState.message)}</p><strong>本地建议仍然有效：</strong><p>${escapeHtml(assessment.localAdvice)}</p></div>`;
  } else if (fresh) {
    const diagnosis = state.diagnosis.result;
    const generated = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(state.diagnosis.generatedAt));
    status.textContent = `复诊完成 · ${generated}`;
    result.innerHTML = `
      <div class="ai-diagnosis-label">复诊结论</div>
      <h3>${escapeHtml(diagnosis.persona.title)}</h3>
      <p class="ai-summary">${escapeHtml(diagnosis.persona.summary)}</p>
      <div class="ai-evidence"><small>它引用了这些本地事实</small><ul>${diagnosis.evidence.map((item) => `<li>${escapeHtml(item.statement)}</li>`).join('')}</ul></div>
      <div class="ai-pattern"><small>模式解读</small><p>${escapeHtml(diagnosis.pattern)}</p></div>
      <div class="ai-prescription"><span>本周只做这一步</span><h4>${escapeHtml(diagnosis.action.title)}</h4><ol>${diagnosis.action.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol></div>
      <p class="ai-goal-link"><strong>和目标的关系：</strong>${escapeHtml(diagnosis.goalLink)}</p>
      <p class="ai-disclaimer">${escapeHtml(diagnosis.disclaimer)}</p>`;
  } else if (state.diagnosis) {
    const periodChanged = state.diagnosis.period !== activeClinicPeriod;
    const modelChanged = state.diagnosis.scoringModelVersion !== assessment.modelVersion;
    const staleLabel = periodChanged ? '统计周期已切换' : (modelChanged ? '评分规则已更新' : '数据已变化');
    status.textContent = 'SOURCE SCOPE CHANGED · RECHECK NEEDED';
    result.innerHTML = `<div class="ai-stale"><span>${staleLabel}</span><p>旧的解读已经盖上“待复诊”章。本地分数已按当前范围重算，重新分析后才会覆盖旧结果。</p></div>`;
  } else if (assessment.eligible) {
    status.textContent = 'LOCAL SCORE READY · CONSENT REQUIRED';
    result.innerHTML = `<p>本地已经判断你近期更像 <strong>${escapeHtml(assessment.primaryPersona.name)}</strong>。只有你主动确认后，才会发送右侧列出的聚合摘要并生成解读。</p>`;
  } else {
    status.textContent = 'WAITING FOR ENOUGH LOCAL EVIDENCE';
    result.innerHTML = `<p>近 ${assessment.period} 天至少留下 3 笔记录，才会生成本地人格并开放复诊。</p>`;
  }
}

function renderClinic() {
  currentAssessment = scorePersonality({ orders: state.orders, period: activeClinicPeriod });
  const topReason = currentAssessment.reasons[0]?.reason || '暂无';
  document.querySelector('#clinicLedger').innerHTML = `
    <div><small>${activeClinicPeriod} 天记录</small><strong>${currentAssessment.orderCount}</strong></div>
    <div><small>确认省下</small><strong>${money(currentAssessment.totals.saved)}</strong></div>
    <div><small>高频诱因</small><strong>${escapeHtml(topReason)}</strong></div>`;
  document.querySelector('#clinicConfidence').textContent = confidenceLabel(currentAssessment.confidence);
  document.querySelectorAll('[data-clinic-period]').forEach((button) => button.classList.toggle('is-active', Number(button.dataset.clinicPeriod) === activeClinicPeriod));
  renderPersonalityProfile(currentAssessment);
  renderAiResult(currentAssessment);
  if (aiUiState.status === 'consent') renderConsentSummary(currentAssessment);
  aiConsentPanel.hidden = aiUiState.status !== 'consent';
  analyzeButton.disabled = !currentAssessment.eligible || aiUiState.status === 'requesting';
  analyzeButton.querySelector('span').textContent = !currentAssessment.eligible
    ? `还差 ${Math.max(0, 3 - currentAssessment.orderCount)} 笔记录`
    : (aiUiState.status === 'requesting' ? '正在复诊' : (state.settings.aiConsent ? '重新复诊' : '开始复诊'));
  posterButton.disabled = !currentAssessment.eligible;
  if (!posterPreview.hidden && currentAssessment.eligible) renderPosterPreview();
}

function shareResult() {
  if (diagnosisIsFresh()) {
    return {
      persona: state.diagnosis.result.persona.title,
      advice: state.diagnosis.result.action.steps[0],
      source: '本地评分 + 汇总解读',
    };
  }
  return {
    persona: currentAssessment.primaryPersona.name,
    advice: currentAssessment.localAdvice,
    source: '本地消费行为评分',
  };
}

function renderPosterPreview() {
  const current = totals();
  const result = shareResult();
  posterPreview.innerHTML = `
    <div class="poster-kicker">MY WALLET TYPE / 让你花个爽！</div>
    <strong>${escapeHtml(result.persona)}</strong>
    <p>${escapeHtml(result.advice)}</p>
    <div><span>确认省下</span><b>${money(current.savedAll)}</b></div>
    <small>${escapeHtml(result.source)} · 不含具体商品名称</small>`;
}

function togglePosterPreview() {
  if (posterButton.disabled || !currentAssessment?.eligible) return;
  posterPreview.hidden = !posterPreview.hidden;
  if (!posterPreview.hidden) renderPosterPreview();
  posterButton.textContent = posterPreview.hidden ? '生成分享海报预览' : '收起分享海报预览';
}

function renderGoal() {
  const progress = calculateGoalProgress(state.orders, state.goal);
  const amount = progress?.targetAmount || 0;
  const saved = progress?.progress || 0;
  const percent = progress ? Math.min(100, Math.round(progress.progressRate * 100)) : 0;
  document.querySelector('#goalPercent').textContent = `${percent}%`;
  document.querySelector('#goalRing').style.setProperty('--progress', `${percent * 3.6}deg`);
  document.querySelector('#goalSaved').textContent = money(saved);
  document.querySelector('#goalSummary').textContent = state.goal
    ? `目标：${state.goal.name}，还差 ${money(Math.max(0, amount - saved))}。`
    : '还没有设定目标。';
  if (state.goal) {
    goalForm.elements.goalName.value = state.goal.name;
    goalForm.elements.goalAmount.value = state.goal.amount;
  }
}

function renderAll() {
  renderMetrics();
  renderOrders();
  renderClinic();
  renderGoal();
}

function createOrder(formData) {
  const amount = Number(formData.get('amount'));
  const order = {
    id: crypto.randomUUID ? crypto.randomUUID() : `order-${Date.now()}`,
    name: String(formData.get('name')).trim(),
    amount,
    category: String(formData.get('category')),
    reason: String(formData.get('reason')),
    decisionSignals: formData.getAll('decisionSignals').map(String).slice(0, 2),
    status: 'cooling',
    decidedAt: null,
    statusHistory: [],
    demo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (!order.name || !Number.isFinite(amount) || amount <= 0 || !order.category || !order.reason) return;

  mutate((draft) => draft.orders.push(order));
  orderForm.reset();
  setMascotSpeech(`收到！${money(amount)} 先进入冷静中，还不能算成省下。`);
  const phone = panorama.getTriggerForPanel('new');
  phone?.classList.add('is-pulsing');
  showToast('模拟订单已创建，进入“冷静中”。');
  window.setTimeout(() => {
    phone?.classList.remove('is-pulsing');
    history.replaceState({ panel: 'orders', openedByApp: true }, '', '#orders');
    applyPanel('orders', phone);
  }, document.body.classList.contains('reduce-motion') ? 30 : 820);
}

function updateOrderStatus(id, status) {
  mutate((draft) => {
    const order = draft.orders.find((item) => item.id === id);
    if (!order) return;
    const previousStatus = order.status;
    const changedAt = new Date().toISOString();
    order.status = status;
    order.updatedAt = changedAt;
    order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    if (previousStatus !== status) order.statusHistory.push({ from: previousStatus, to: status, at: changedAt });
    if ((status === 'saved' || status === 'purchased') && !order.decidedAt) order.decidedAt = changedAt;
  });
  const messages = {
    saved: '这次确认没买。目标罐听见了一声清脆的回血。',
    purchased: '记录为最终购买。这里不评判，只帮你看清决定。',
    cooling: '已经改回冷静中，继续给它一点时间。',
  };
  setMascotSpeech(messages[status]);
  showToast(`订单已更新为“${STATUS_LABELS[status]}”。`);
}

function validateAiDiagnosis(payload) {
  const result = payload?.result;
  if (!result || typeof result !== 'object') return false;
  if (typeof result.persona?.title !== 'string' || typeof result.persona?.summary !== 'string') return false;
  if (!Array.isArray(result.evidence) || result.evidence.length < 2 || result.evidence.length > 4) return false;
  if (result.evidence.some((item) => typeof item?.statement !== 'string')) return false;
  if (typeof result.pattern !== 'string' || typeof result.action?.title !== 'string') return false;
  if (!Array.isArray(result.action?.steps) || result.action.steps.length < 1 || result.action.steps.length > 3) return false;
  if (typeof result.goalLink !== 'string' || typeof result.disclaimer !== 'string') return false;
  return true;
}

function friendlyAiError(error) {
  if (error?.name === 'AbortError') return '本次分析已取消，本地评分没有受到影响。';
  if (error?.code === 'missing_api_key') return '复诊服务尚未配置，已保留本地评分。';
  if (error?.code === 'rate_limited') return '今天的复诊有点拥挤，请稍后再试；本地评分仍然可用。';
  if (error?.code === 'upstream_timeout') return '这次等待时间较长，先使用本地建议。';
  return error?.message || '暂时没有完成复诊，先使用本地评分和建议。';
}

async function requestAiDiagnosis() {
  if (!currentAssessment?.eligible || aiUiState.status === 'requesting') return;
  const requestRevision = state.dataRevision;
  const requestPeriod = activeClinicPeriod;
  const requestAssessment = currentAssessment;
  const requestPayload = buildDiagnosisRequest({ assessment: requestAssessment, goal: state.goal, orders: state.orders });
  aiRequestController?.abort();
  aiRequestController = new AbortController();
  const timeout = window.setTimeout(() => aiRequestController?.abort(), 12_000);
  aiUiState = { status: 'requesting', message: '' };
  renderClinic();
  setMascotSpeech('本地分数已经算好。正在复核去掉商品名和备注后的汇总。');

  try {
    const response = await fetch('/api/ai/diagnosis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(requestPayload),
      signal: aiRequestController.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || `复诊服务返回 ${response.status}`);
      error.code = payload.code;
      throw error;
    }
    if (!validateAiDiagnosis(payload)) throw new Error('返回结构不完整，已切换为本地结果。');
    if (requestRevision !== state.dataRevision || requestPeriod !== activeClinicPeriod) {
      throw new Error('分析期间数据或周期发生变化，请重新发起。');
    }
    state.diagnosis = {
      sourceRevision: requestRevision,
      period: requestPeriod,
      scoringModelVersion: requestAssessment.modelVersion,
      generatedAt: new Date().toISOString(),
      result: payload.result,
    };
    saveState();
    aiUiState = { status: 'success', message: '' };
    setMascotSpeech(`复诊完成：本地人格是“${requestAssessment.primaryPersona.name}”，行动建议已经补上。`);
    showToast('复诊已完成。');
  } catch (error) {
    aiUiState = { status: 'error', message: friendlyAiError(error) };
    setMascotSpeech('这次没接上，但本地评分和订单都好好的。');
    showToast('已切换到本地评分结果。');
  } finally {
    window.clearTimeout(timeout);
    aiRequestController = null;
    renderClinic();
  }
}

function startAiDiagnosis() {
  if (!currentAssessment?.eligible) return;
  if (!state.settings.aiConsent) {
    aiUiState = { status: 'consent', message: '' };
    renderClinic();
    window.setTimeout(() => document.querySelector('#aiConsentTitle')?.focus({ preventScroll: true }), 20);
    return;
  }
  requestAiDiagnosis();
}

function setGoal(formData) {
  const name = String(formData.get('goalName')).trim();
  const amount = Number(formData.get('goalAmount'));
  if (!name || !Number.isFinite(amount) || amount <= 0) return;
  mutate((draft) => {
    draft.goal = { name, amount, createdAt: draft.goal?.createdAt || new Date().toISOString() };
  });
  setMascotSpeech(`预算计划“${name}”贴好了。以后确认没买的金额会映射到这里。`);
  showToast('预算计划已更新。');
}

function daysAgo(days, hour = 14, minute = 10) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function loadDemo() {
  if (state.orders.length && !window.confirm('载入演示数据会替换当前浏览器中的原型数据，继续吗？')) return;
  state = {
    ...defaultState(),
    dataRevision: 1,
    goal: { name: '去海边看日落', amount: 3000, createdAt: daysAgo(30) },
    orders: [
      { id: 'demo-1', name: '超大杯珍珠奶茶', amount: 28, category: '餐饮饮品', reason: '嘴馋', decisionSignals: ['wait'], status: 'saved', decidedAt: daysAgo(0, 16), statusHistory: [{ from: 'cooling', to: 'saved', at: daysAgo(0, 16) }], demo: true, createdAt: daysAgo(0, 15), updatedAt: daysAgo(0, 16) },
      { id: 'demo-2', name: '联名帆布包', amount: 169, category: '服饰美妆', reason: '被种草', decisionSignals: ['creator', 'instant'], status: 'cooling', decidedAt: null, statusHistory: [], demo: true, createdAt: daysAgo(1, 22), updatedAt: daysAgo(1, 22) },
      { id: 'demo-3', name: '深夜炸鸡套餐', amount: 45, category: '餐饮饮品', reason: '情绪不好', decisionSignals: ['comfort'], status: 'purchased', decidedAt: daysAgo(3, 23, 20), statusHistory: [{ from: 'cooling', to: 'purchased', at: daysAgo(3, 23, 20) }], demo: true, createdAt: daysAgo(3, 23), updatedAt: daysAgo(3, 23, 20) },
      { id: 'demo-4', name: '桌面氛围灯', amount: 89, category: '数码家居', reason: '限时优惠', decisionSignals: ['compare', 'deal'], status: 'saved', decidedAt: daysAgo(5, 21), statusHistory: [{ from: 'cooling', to: 'saved', at: daysAgo(5, 21) }], demo: true, createdAt: daysAgo(5, 20), updatedAt: daysAgo(5, 21) },
      { id: 'demo-5', name: '线上摄影课', amount: 199, category: '学习成长', reason: '自我提升', decisionSignals: ['research', 'achievement'], status: 'saved', decidedAt: daysAgo(8, 13), statusHistory: [{ from: 'cooling', to: 'saved', at: daysAgo(8, 13) }], demo: true, createdAt: daysAgo(8, 12), updatedAt: daysAgo(8, 13) },
    ],
  };
  saveState();
  renderAll();
  setMascotSpeech('演示记录已经放进房间。健身屏、手机和白板都会显示新的状态。');
  showToast('已载入 5 笔演示数据。');
}

function exportData() {
  if (!state.orders.length && !state.goal) return;
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    currency: 'CNY',
    orders: state.orders.filter((order) => !order.demo),
    currentGoal: state.goal,
    settings: {},
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `让你花个爽！数据-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('JSON 已在本地生成，没有上传数据。');
}

function toggleMotion() {
  state.settings.reduceMotion = !state.settings.reduceMotion;
  document.body.classList.toggle('reduce-motion', state.settings.reduceMotion);
  panorama.setReducedMotion(state.settings.reduceMotion);
  roomIntro.setReducedMotion(state.settings.reduceMotion);
  document.querySelector('#motionButton').setAttribute('aria-pressed', String(state.settings.reduceMotion));
  saveState();
  showToast(state.settings.reduceMotion ? '已减少房间动态效果。' : '已恢复房间动态效果。');
}

document.querySelectorAll('[data-open]:not(.scene-hotspot)').forEach((trigger) => {
  trigger.addEventListener('click', () => openPanel(trigger.dataset.open, trigger));
});

document.querySelectorAll('[data-scene-target]').forEach((trigger) => {
  trigger.addEventListener('click', () => {
    const hotspot = sceneHotspots.find((item) => item.id === trigger.dataset.sceneTarget);
    if (!hotspot) return;
    panorama.focusHotspot(hotspot.id);
    if (hotspot.panel) openPanel(hotspot.panel, trigger);
  });
});

document.querySelectorAll('[data-scene-group]').forEach((trigger) => {
  trigger.addEventListener('click', () => {
    panorama.focusGroup(trigger.dataset.sceneGroup);
    setMascotSpeech('这堆快递里藏着几句真心话。把鼠标移到发光的小箱子上看看。');
  });
});

panelClose.addEventListener('click', closePanel);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && activePanel) closePanel();
});

orderForm.addEventListener('submit', (event) => {
  event.preventDefault();
  createOrder(new FormData(orderForm));
});

goalForm.addEventListener('submit', (event) => {
  event.preventDefault();
  setGoal(new FormData(goalForm));
});

orderList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-order-action]');
  if (!button) return;
  updateOrderStatus(button.dataset.orderId, button.dataset.orderAction);
});

document.querySelectorAll('[data-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('is-active', item === button));
    renderOrders();
  });
});

document.querySelectorAll('[data-clinic-period]').forEach((button) => {
  button.addEventListener('click', () => {
    const nextPeriod = Number(button.dataset.clinicPeriod) === 7 ? 7 : 30;
    if (nextPeriod === activeClinicPeriod) return;
    aiRequestController?.abort();
    activeClinicPeriod = nextPeriod;
    aiUiState = { status: 'idle', message: '' };
    posterPreview.hidden = true;
    renderClinic();
  });
});

orderForm.querySelectorAll('input[name="decisionSignals"]').forEach((checkbox) => {
  checkbox.addEventListener('change', () => {
    const selected = [...orderForm.querySelectorAll('input[name="decisionSignals"]:checked')];
    if (selected.length <= 2) return;
    checkbox.checked = false;
    showToast('决策动作最多选择 2 项。');
  });
});

analyzeButton.addEventListener('click', startAiDiagnosis);
allowAiButton.addEventListener('click', () => {
  state.settings.aiConsent = true;
  saveState();
  aiUiState = { status: 'idle', message: '' };
  requestAiDiagnosis();
});
localOnlyButton.addEventListener('click', () => {
  aiUiState = { status: 'idle', message: '' };
  renderClinic();
  showToast('没有发送数据，本地评分会继续保留。');
});
revokeAiConsentButton.addEventListener('click', () => {
  state.settings.aiConsent = false;
  saveState();
  aiUiState = { status: 'idle', message: '' };
  renderClinic();
  showToast('已撤回 AI 数据发送同意，下次会重新确认。');
});
posterButton.addEventListener('click', togglePosterPreview);
document.querySelector('#loadDemoButton').addEventListener('click', loadDemo);
document.querySelector('#exportButton').addEventListener('click', exportData);
document.querySelector('#motionButton').addEventListener('click', toggleMotion);

const mascotLines = [
  '健身屏、茶几手机和白板都能点。拖动房间还能发现快递的内心话。',
  '我不会替你付款，也不会替你决定。',
  '小额消费最会假装自己没来过。',
  '点击物件时，镜头会把房间的注意力一起推过去。',
];
let mascotLineIndex = 0;
mascotButton.addEventListener('click', () => {
  setMascotSpeech(mascotLines[mascotLineIndex % mascotLines.length]);
  mascotLineIndex += 1;
});

sceneFrame.addEventListener('panoramaready', () => {
  sceneStatus.textContent = '全景已就绪 · 拖动环视';
});

sceneFrame.addEventListener('panoramaerror', (event) => {
  sceneStatus.textContent = event.detail;
});

window.addEventListener('popstate', (event) => {
  const nextPanel = event.state?.panel || panelFromHash();
  if (!roomEntered) {
    pendingPanel = nextPanel;
    return;
  }
  applyPanel(nextPanel);
});

window.addEventListener('hashchange', () => {
  const nextPanel = panelFromHash();
  if (!roomEntered) {
    pendingPanel = nextPanel;
    return;
  }
  if (nextPanel !== activePanel) applyPanel(nextPanel);
});

function updateClock() {
  document.querySelector('#clock').textContent = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}

document.body.classList.toggle('reduce-motion', state.settings.reduceMotion);
const shouldReduceMotion = state.settings.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
panorama.setReducedMotion(shouldReduceMotion);
roomIntro.setReducedMotion(shouldReduceMotion);
document.querySelector('#motionButton').setAttribute('aria-pressed', String(state.settings.reduceMotion));
updateClock();
window.setInterval(updateClock, 30_000);
renderAll();

const initialPanel = panelFromHash();
pendingPanel = initialPanel;
history.replaceState({ panel: initialPanel, openedByApp: false }, '', initialPanel ? `#${initialPanel}` : '#room');
panorama.whenReady().then((result) => {
  if (result.fallback) sceneStatus.textContent = result.message;
  roomIntro.start();
});
