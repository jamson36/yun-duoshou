const STORAGE_KEY = 'yun-duoshou-room-v1';

const PANEL_META = {
  new: {
    index: '01',
    speech: '先记下来，别急着真付款。打印机只吐冷静小票。',
  },
  orders: {
    index: '02',
    speech: '小票不会自己做决定。来看看哪些还在冷静中。',
  },
  clinic: {
    index: '03',
    speech: '我先看数据，不乱贴标签。这里才是钱包房间的核心。',
  },
  goals: {
    index: '04',
    speech: '每一次确认没买，都可以给真正想要的东西让一点位置。',
  },
};

const PERSONA_BY_CATEGORY = {
  餐饮饮品: '即时快乐补给员',
  服饰美妆: '灵感衣橱观察员',
  数码家居: '参数宇宙研究员',
  娱乐社交: '快乐体验充值官',
  学习成长: '未来装备收藏家',
  旅行交通: '远方路线规划员',
  其他: '欲望信号观察员',
};

const ADVICE_BY_REASON = {
  嘴馋: '下一次嘴馋时，先喝一杯水，再给这笔欲望十分钟。',
  无聊: '把“想逛一下”换成一个五分钟的小任务，再回来决定。',
  被种草: '先保存商品，不保存付款冲动；明天同一时间再看一次。',
  情绪不好: '先照顾情绪，再决定商品是否真的能解决问题。',
  限时优惠: '限时的是优惠，不是你的决定时间。',
  社交需要: '先问自己：我需要的是这件东西，还是参与感？',
  自我提升: '写下购买后七天内的第一次使用时间，再决定是否付款。',
  其他: '给欲望留一个晚上，明天再决定它是否值得。',
};

const STATUS_LABELS = {
  cooling: '冷静中',
  saved: '幸好没买',
  purchased: '最终购买',
};

const app = document.querySelector('#app');
const sceneFrame = document.querySelector('#sceneFrame');
const sceneCamera = document.querySelector('#sceneCamera');
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

let activePanel = null;
let activeTrigger = null;
let activeFilter = 'all';
let toastTimer = null;
let state = loadState();

function defaultState() {
  return {
    schemaVersion: 1,
    dataRevision: 0,
    orders: [],
    goal: null,
    diagnosis: null,
    settings: { reduceMotion: false },
  };
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.orders)) return defaultState();
    return {
      ...defaultState(),
      ...parsed,
      settings: { ...defaultState().settings, ...(parsed.settings || {}) },
    };
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

function summaryForDiagnosis() {
  const categoryMap = new Map();
  const reasonMap = new Map();
  for (const order of state.orders) {
    const category = categoryMap.get(order.category) || { count: 0, amount: 0 };
    category.count += 1;
    category.amount += order.amount;
    categoryMap.set(order.category, category);
    reasonMap.set(order.reason, (reasonMap.get(order.reason) || 0) + 1);
  }

  const topCategory = [...categoryMap.entries()].sort((a, b) => b[1].amount - a[1].amount)[0] || ['暂无', { count: 0, amount: 0 }];
  const topReason = [...reasonMap.entries()].sort((a, b) => b[1] - a[1])[0] || ['暂无', 0];
  return { topCategory, topReason };
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

function focusOriginFor(trigger) {
  if (!trigger || !sceneFrame.contains(trigger)) {
    sceneCamera.style.setProperty('--origin-x', '55%');
    sceneCamera.style.setProperty('--origin-y', '50%');
    return;
  }
  const frameRect = sceneFrame.getBoundingClientRect();
  const triggerRect = trigger.getBoundingClientRect();
  const x = ((triggerRect.left + triggerRect.width / 2 - frameRect.left) / frameRect.width) * 100;
  const y = ((triggerRect.top + triggerRect.height / 2 - frameRect.top) / frameRect.height) * 100;
  sceneCamera.style.setProperty('--origin-x', `${Math.max(8, Math.min(92, x))}%`);
  sceneCamera.style.setProperty('--origin-y', `${Math.max(8, Math.min(92, y))}%`);
}

function applyPanel(panel, trigger = null) {
  const previousTrigger = activeTrigger;
  activePanel = PANEL_META[panel] ? panel : null;
  activeTrigger = activePanel
    ? trigger || document.querySelector(`.room-object[data-open="${activePanel}"]`)
    : previousTrigger;

  document.querySelectorAll('.room-object').forEach((object) => {
    object.classList.toggle('is-active', object.dataset.open === activePanel);
  });
  document.querySelectorAll('.panel-view').forEach((view) => {
    view.classList.toggle('is-active', view.dataset.panel === activePanel);
  });

  if (!activePanel) {
    app.dataset.focus = 'none';
    app.classList.remove('is-focusing', 'is-focused');
    focusPanel.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    setMascotSpeech(idleSpeech());
    const returnTarget = activeTrigger;
    activeTrigger = null;
    if (returnTarget && document.contains(returnTarget)) window.setTimeout(() => returnTarget.focus(), 80);
    return;
  }

  app.dataset.focus = activePanel;
  app.classList.remove('is-focusing');
  void app.offsetWidth;
  app.classList.add('is-focusing', 'is-focused');
  focusPanel.setAttribute('aria-hidden', 'false');
  panelIndex.textContent = PANEL_META[activePanel].index;
  focusOriginFor(activeTrigger);
  setMascotSpeech(PANEL_META[activePanel].speech);
  if (window.innerWidth <= 820) document.body.style.overflow = 'hidden';
  renderAll();

  window.setTimeout(() => {
    const heading = document.querySelector(`.panel-view[data-panel="${activePanel}"] h2`);
    heading?.focus({ preventScroll: true });
  }, document.body.classList.contains('reduce-motion') ? 20 : 680);
}

function openPanel(panel, trigger = null) {
  if (!PANEL_META[panel]) return;
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
  document.querySelector('#metricRecorded').textContent = money(current.recordedToday);
  document.querySelector('#metricSaved').textContent = money(current.savedToday);
  document.querySelector('#metricCooling').textContent = current.cooling;
  document.querySelector('#computerStatus').textContent = current.cooling ? `${current.cooling} 张小票等决定` : '没有待处理小票';
  document.querySelector('#printerStatus').textContent = state.orders.length ? `已经记录 ${state.orders.length} 次欲望` : '随时可以演一下';
  document.querySelector('#clinicStatus').textContent = state.orders.length >= 3 ? '数据够了，可以问诊' : `还差 ${Math.max(0, 3 - state.orders.length)} 笔记录`;
  const badge = document.querySelector('#orderBadge');
  badge.hidden = current.cooling === 0;
  badge.textContent = current.cooling;
  document.querySelector('#goalStatus').textContent = state.goal
    ? `${state.goal.name} · ${Math.min(100, Math.round((current.savedAll / state.goal.amount) * 100))}%`
    : '还没有目标';
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

function renderClinic() {
  const current = totals();
  const { topCategory, topReason } = summaryForDiagnosis();
  document.querySelector('#clinicLedger').innerHTML = `
    <div><small>记录次数</small><strong>${state.orders.length}</strong></div>
    <div><small>确认省下</small><strong>${money(current.savedAll)}</strong></div>
    <div><small>高频诱因</small><strong>${escapeHtml(topReason[0])}</strong></div>`;

  analyzeButton.disabled = state.orders.length < 3;
  const result = document.querySelector('#aiResult');
  const diagnosisIsFresh = state.diagnosis && state.diagnosis.sourceRevision === state.dataRevision;

  if (diagnosisIsFresh) {
    const diagnosis = state.diagnosis.result;
    result.innerHTML = `
      <h3>${escapeHtml(diagnosis.persona)}</h3>
      <p>${escapeHtml(diagnosis.summary)}</p>
      <ul>
        <li><strong>数据：</strong>${escapeHtml(diagnosis.evidence[0])}</li>
        <li><strong>诱因：</strong>${escapeHtml(diagnosis.evidence[1])}</li>
        <li><strong>这周一步：</strong>${escapeHtml(diagnosis.advice)}</li>
      </ul>`;
  } else if (state.orders.length < 3) {
    result.innerHTML = '<p>至少留下 3 笔记录，我才能从数据里看出一点模式。</p>';
  } else if (state.diagnosis) {
    result.innerHTML = '<p><strong>数据已经变化。</strong>旧诊断先放回档案柜，建议重新看看。</p>';
  } else {
    result.innerHTML = `<p>数据够了。我会根据 <strong>${escapeHtml(topCategory[0])}</strong> 和 <strong>${escapeHtml(topReason[0])}</strong> 等本地汇总给出一条可核对的观察。</p>`;
  }
}

function renderGoal() {
  const current = totals();
  const amount = state.goal?.amount || 0;
  const percent = amount > 0 ? Math.min(100, Math.round((current.savedAll / amount) * 100)) : 0;
  document.querySelector('#goalPercent').textContent = `${percent}%`;
  document.querySelector('#goalRing').style.setProperty('--progress', `${percent * 3.6}deg`);
  document.querySelector('#goalSaved').textContent = money(current.savedAll);
  document.querySelector('#goalSummary').textContent = state.goal
    ? `目标：${state.goal.name}，还差 ${money(Math.max(0, amount - current.savedAll))}。`
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
    status: 'cooling',
    demo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (!order.name || !Number.isFinite(amount) || amount <= 0 || !order.category || !order.reason) return;

  mutate((draft) => draft.orders.push(order));
  orderForm.reset();
  setMascotSpeech(`收到！${money(amount)} 先进入冷静中，还不能算成省下。`);
  const printer = document.querySelector('.object-printer');
  printer.classList.add('is-printing');
  showToast('冷静小票已打印，订单进入“冷静中”。');
  window.setTimeout(() => {
    printer.classList.remove('is-printing');
    history.replaceState({ panel: 'orders', openedByApp: true }, '', '#orders');
    applyPanel('orders', document.querySelector('.object-computer'));
  }, document.body.classList.contains('reduce-motion') ? 30 : 820);
}

function updateOrderStatus(id, status) {
  mutate((draft) => {
    const order = draft.orders.find((item) => item.id === id);
    if (!order) return;
    order.status = status;
    order.updatedAt = new Date().toISOString();
  });
  const messages = {
    saved: '这次确认没买。目标罐听见了一声清脆的回血。',
    purchased: '记录为最终购买。这里不评判，只帮你看清决定。',
    cooling: '已经改回冷静中，继续给它一点时间。',
  };
  setMascotSpeech(messages[status]);
  showToast(`订单已更新为“${STATUS_LABELS[status]}”。`);
}

function analyzeLocally() {
  if (state.orders.length < 3) return;
  analyzeButton.disabled = true;
  document.querySelector('#aiResult').innerHTML = '<div class="ai-loading" aria-label="钱包兽正在分析"><i></i><i></i><i></i></div>';
  setMascotSpeech('我在数小票。放心，我不会偷看不存在的数据。');

  window.setTimeout(() => {
    const current = totals();
    const { topCategory, topReason } = summaryForDiagnosis();
    const persona = PERSONA_BY_CATEGORY[topCategory[0]] || PERSONA_BY_CATEGORY.其他;
    const advice = ADVICE_BY_REASON[topReason[0]] || ADVICE_BY_REASON.其他;
    const result = {
      persona,
      summary: `最近的记录里，${topCategory[0]}占据了最明显的位置。这只是近期消费倾向，不是心理诊断。`,
      evidence: [
        `${topCategory[0]}共 ${topCategory[1].count} 笔，记录金额 ${money(topCategory[1].amount)}。`,
        `最常出现的触发原因是“${topReason[0]}”，共 ${topReason[1]} 次；目前确认省下 ${money(current.savedAll)}。`,
      ],
      advice,
    };
    state.diagnosis = { sourceRevision: state.dataRevision, generatedAt: new Date().toISOString(), result };
    saveState();
    renderClinic();
    setMascotSpeech(`看完了：你最近比较像“${persona}”。先做一个小动作就够。`);
    showToast('本地诊断体验已生成。');
  }, document.body.classList.contains('reduce-motion') ? 40 : 1250);
}

function setGoal(formData) {
  const name = String(formData.get('goalName')).trim();
  const amount = Number(formData.get('goalAmount'));
  if (!name || !Number.isFinite(amount) || amount <= 0) return;
  mutate((draft) => {
    draft.goal = { name, amount, createdAt: draft.goal?.createdAt || new Date().toISOString() };
  });
  setMascotSpeech(`目标“${name}”贴好了。以后确认没买的金额会映射到这里。`);
  showToast('回血目标已更新。');
}

function daysAgo(days, hour = 14) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 10, 0, 0);
  return date.toISOString();
}

function loadDemo() {
  if (state.orders.length && !window.confirm('载入演示数据会替换当前浏览器中的原型数据，继续吗？')) return;
  state = {
    ...defaultState(),
    dataRevision: 1,
    goal: { name: '去海边看日落', amount: 3000, createdAt: daysAgo(30) },
    orders: [
      { id: 'demo-1', name: '超大杯珍珠奶茶', amount: 28, category: '餐饮饮品', reason: '嘴馋', status: 'saved', demo: true, createdAt: daysAgo(0, 15), updatedAt: daysAgo(0, 16) },
      { id: 'demo-2', name: '联名帆布包', amount: 169, category: '服饰美妆', reason: '被种草', status: 'cooling', demo: true, createdAt: daysAgo(1, 22), updatedAt: daysAgo(1, 22) },
      { id: 'demo-3', name: '深夜炸鸡套餐', amount: 45, category: '餐饮饮品', reason: '情绪不好', status: 'purchased', demo: true, createdAt: daysAgo(3, 23), updatedAt: daysAgo(3, 23) },
      { id: 'demo-4', name: '桌面氛围灯', amount: 89, category: '数码家居', reason: '限时优惠', status: 'saved', demo: true, createdAt: daysAgo(5, 20), updatedAt: daysAgo(5, 21) },
      { id: 'demo-5', name: '线上摄影课', amount: 199, category: '学习成长', reason: '自我提升', status: 'saved', demo: true, createdAt: daysAgo(8, 12), updatedAt: daysAgo(8, 13) },
    ],
  };
  saveState();
  renderAll();
  setMascotSpeech('演示小票已经装进房间。现在四件东西都会有反应。');
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
  link.download = `云剁手数据-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('JSON 已在本地生成，没有上传数据。');
}

function toggleMotion() {
  state.settings.reduceMotion = !state.settings.reduceMotion;
  document.body.classList.toggle('reduce-motion', state.settings.reduceMotion);
  document.querySelector('#motionButton').setAttribute('aria-pressed', String(state.settings.reduceMotion));
  saveState();
  showToast(state.settings.reduceMotion ? '已减少房间动态效果。' : '已恢复房间动态效果。');
}

document.querySelectorAll('[data-open]').forEach((trigger) => {
  trigger.addEventListener('click', () => openPanel(trigger.dataset.open, trigger));
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

analyzeButton.addEventListener('click', analyzeLocally);
document.querySelector('#loadDemoButton').addEventListener('click', loadDemo);
document.querySelector('#exportButton').addEventListener('click', exportData);
document.querySelector('#motionButton').addEventListener('click', toggleMotion);

const mascotLines = [
  '四件东西都能点。病历柜是我的主场。',
  '我不会替你付款，也不会替你决定。',
  '小额消费最会假装自己没来过。',
  '点击物件时，房间会把注意力一起推过去。',
];
let mascotLineIndex = 0;
mascotButton.addEventListener('click', () => {
  setMascotSpeech(mascotLines[mascotLineIndex % mascotLines.length]);
  mascotLineIndex += 1;
});

sceneFrame.addEventListener('pointermove', (event) => {
  if (activePanel || state.settings.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rect = sceneFrame.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - 0.5;
  const y = (event.clientY - rect.top) / rect.height - 0.5;
  sceneCamera.style.setProperty('--scene-ry', `${x * 2.2}deg`);
  sceneCamera.style.setProperty('--scene-rx', `${y * -1.5}deg`);
});

sceneFrame.addEventListener('pointerleave', () => {
  sceneCamera.style.setProperty('--scene-ry', '0deg');
  sceneCamera.style.setProperty('--scene-rx', '0deg');
});

window.addEventListener('popstate', (event) => {
  applyPanel(event.state?.panel || panelFromHash());
});

window.addEventListener('hashchange', () => {
  const nextPanel = panelFromHash();
  if (nextPanel !== activePanel) applyPanel(nextPanel);
});

function updateClock() {
  document.querySelector('#clock').textContent = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}

document.body.classList.toggle('reduce-motion', state.settings.reduceMotion);
document.querySelector('#motionButton').setAttribute('aria-pressed', String(state.settings.reduceMotion));
updateClock();
window.setInterval(updateClock, 30_000);
renderAll();

const initialPanel = panelFromHash();
history.replaceState({ panel: initialPanel, openedByApp: false }, '', initialPanel ? `#${initialPanel}` : '#room');
applyPanel(initialPanel);
