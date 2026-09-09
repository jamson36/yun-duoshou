import { createMissionState, transitionMission, TRACK_NODES, MISSION_SHELLS,
  shellDragCompleted, pointInside, validateMissionDraft, createMissionGestureMapper, missionMovementInput } from './desire-mission.js?v=20260905-mission-wasd-2';

const COPY = {
  track: ['跟上那束光。', 'WASD 移动，按住空白街景拖动鼠标转向。', '靠近亮起的路标，追到耳机信号源。', '橱窗总在说“快一点”。\n今晚，按你的速度走。'],
  peel: ['把催促，甩开。', '抓住两张广告外壳，向旁边甩出去。', '商品留着，把不属于它的声音摘下来。', '拆掉的是催促。\n留下的，才是商品。'],
  trial: ['让它，进入生活。', '把耳机拖到一个位置，试试你的选择。', '挑一个装置试一试。没有标准答案。', '真正想要的东西，\n在日常里会有位置。'],
  deliver: ['决定，回到你手里。', '把耳机推入传送带，让想买的念头先停一站。', '推入传送带后，仍需你确认才会记录。', '冷静不是放弃。\n是给决定留一点空间。'],
  review: ['留一张冷静单。', '确认这是你想买的商品，再把它记录下来。', '只有确认保存，才会产生一笔欲望冷却中记录。', '你的决定，\n由你亲手确认。'],
  done: ['城市，安静了一点。', '这件商品正在冷静中，决定可以留到之后。', '回到房间，你会看到这张冷静单。', '广告暗下来，\n自己的声音清楚了。'],
};
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (value) => `¥${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;

export function createDesireMissionController({ root, reducedMotion = () => false, onInputMode = () => true,
  onIntent = () => false, onClose = () => {} } = {}) {
  const $ = (id) => root.querySelector(`#${id}`);
  const el = { title: $('missionTitle'), description: $('missionDescription'), world: $('missionWorld'),
    canvas: $('missionCanvas'), bench: $('missionWorkbench'), waypoint: $('missionWaypoint'), waypointLabel: $('missionWaypointLabel'),
    probe: $('missionProbeLabel'), gesture: $('missionGesture'), cursor: $('missionGestureCursor'), pause: $('missionPause'),
    live: $('missionLiveStatus'), hint: $('missionHint'), note: $('missionFieldnote'), help: $('missionInputHelp') };
  let state = createMissionState(), scene = null, opened = false, destroyed = false, generation = 0;
  let drag = null, suppressClick = false, fallbackTimer = null, inputMode = 'pointer', saving = false;
  let lastPhase = null, selectedProduct = false, lastGestureTarget = null, hoverSince = 0;
  let goalName = '', scenePromise = null, renderMode = 'loading', saveError = '';
  let lookDrag = null, waypointLayout = null;
  const heldKeys = new Set(), movementCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
  const gestures = createMissionGestureMapper(), listeners = [];
  const motionReduced = () => Boolean(reducedMotion()) || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); listeners.push(() => target.removeEventListener(type, fn, options)); };
  function announce(text) { el.live.textContent = text; }
  function clearTimer() { if (fallbackTimer !== null) clearTimeout(fallbackTimer); fallbackTimer = null; }
  function endLook() {
    const pointerId = lookDrag?.pointerId;
    lookDrag = null; delete root.dataset.looking;
    if (pointerId !== undefined && root.hasPointerCapture?.(pointerId)) root.releasePointerCapture(pointerId);
  }
  function stopNavigation() { heldKeys.clear(); scene?.setMovement(); endLook(); }
  function walkToWaypoint() { stopNavigation(); dispatch({ type: 'walk' }); }
  function measureWaypoint() {
    if (!opened || state.phase !== 'track') return;
    const world = el.world.getBoundingClientRect(), marker = el.waypoint.getBoundingClientRect();
    const heading = root.querySelector('.mission-heading').getBoundingClientRect();
    const footer = root.querySelector('.mission-footer').getBoundingClientRect();
    waypointLayout = { width: world.width, height: world.height, markerWidth: marker.width, markerHeight: marker.height,
      headingLeft: heading.left - world.left, headingRight: heading.right - world.left,
      headingBottom: heading.bottom - world.top, footerTop: footer.top - world.top };
  }
  function productMarkup({ draggable = false } = {}) {
    return `<button type="button" class="mission-product ${draggable ? 'is-draggable' : ''}" ${draggable ? 'data-drag="product" data-pick-product aria-pressed="false"' : 'tabindex="-1"'} aria-label="${draggable ? '拿起' : ''}${escape(state.product.name)}"><img src="${escape(state.product.image)}" alt="${escape(state.product.name)}" draggable="false" /><span>${draggable ? '抓住我，拖到下方' : '商品本体保持完整'}</span></button>`;
  }
  function trialMarkup() {
    const trial = state.trial, answer = state.answers[trial];
    const tabs = [['week', '七天轨道'], ['alternatives', '已有替代'], ['balance', '目标天平']].map(([id, title]) =>
      `<button type="button" data-trial="${id}" aria-pressed="${trial === id}">${title}${state.answers[id] ? ' · 已试' : ''}</button>`).join('');
    let targets = '', feedback = '';
    if (trial === 'week') {
      const days = Array.from({ length: 7 }, (_, index) => {
        const day = new Date(); day.setDate(day.getDate() + index + 1);
        const id = `day-${index + 1}`;
        return `<button type="button" class="mission-day" data-place="${id}" aria-pressed="${answer === id}" aria-label="放到${day.getMonth() + 1}月${day.getDate()}日"><small>${index === 0 ? '明天' : `周${'日一二三四五六'[day.getDay()]}`}</small><b>${day.getDate()}</b><span>${answer === id ? '已放入' : '＋'}</span></button>`;
      }).join('');
      targets = `<div class="mission-timeline">${days}</div><button class="mission-unsure" type="button" data-place="unsure" aria-pressed="${answer === 'unsure'}">暂时想不到使用时间</button>`;
      feedback = answer === 'unsure' ? '没想好也可以，让它先等一等。' : answer ? `你为它留了第 ${answer.split('-')[1]} 天的位置。记得想一个具体的使用场景。` : '未来七天，第一次会在哪天用到它？';
    } else {
      const options = trial === 'alternatives' ? [['have', '已经有', '类似的耳机'], ['different', '用途不同', '需要另一种'], ['unsure', '回家看看', '暂时不确定']]
        : [['goal', '先留给计划', goalName || '我更在意的事'], ['item', '留给耳机', money(state.product.amount)], ['unsure', '再想一想', '可以晚点决定']];
      targets = `<div class="mission-${trial === 'balance' ? 'balance' : 'drawers'}" data-choice="${answer || ''}">${options.map(([id, label, detail]) => `<button type="button" data-place="${id}" aria-pressed="${answer === id}"><b>${label}</b><small>${escape(detail)}</small><span>${answer === id ? '已放入' : '放这里'}</span></button>`).join('')}</div>`;
      feedback = answer ? (trial === 'alternatives' ? '替代关系由你判断，这次选择只用于眼前的推演。' : '天平记住了你这次的取舍，实际目标和金额没有变化。')
        : trial === 'alternatives' ? '打开已有物品的抽屉，它会重复吗？' : '这笔预算，你更想留给哪一边？';
    }
    return `<div class="mission-trial-tabs" aria-label="选择试用装置">${tabs}</div>${productMarkup({ draggable: true })}<p class="mission-trial-question">${feedback}</p>${targets}<button class="mission-primary mission-next" type="button" data-finish-trial ${Object.keys(state.answers).length ? '' : 'disabled'}>带去冷静中转站 <span>→</span></button>`;
  }
  function render() {
    if (!opened) return;
    const phaseChanged = lastPhase !== state.phase;
    if (phaseChanged && state.phase !== 'track') stopNavigation();
    if (phaseChanged && ['review', 'done'].includes(state.phase) && inputMode === 'gesture') usePointer();
    const focused = root.ownerDocument.activeElement;
    const focusKey = focused?.dataset?.trial ? `[data-trial="${focused.dataset.trial}"]`
      : focused?.dataset?.place ? `[data-place="${focused.dataset.place}"]` : null;
    const copy = COPY[state.phase];
    root.dataset.phase = state.phase; root.dataset.node = String(state.node);
    root.dataset.removed = String(state.removed.length); root.dataset.saved = String(Boolean(state.savedOrderId));
    root.dataset.renderMode = renderMode; root.dataset.quality = motionReduced() ? 'essential' : 'full';
    el.title.textContent = copy[0]; el.description.textContent = copy[1];
    el.hint.replaceChildren(root.ownerDocument.createTextNode(copy[2]));
    const small = root.ownerDocument.createElement('small'); small.textContent = '不计时，不打分，随时可以离开。'; el.hint.append(small);
    el.note.textContent = copy[3];
    const step = ['track', 'peel', 'trial', 'deliver'].indexOf(state.phase);
    root.querySelectorAll('[data-step]').forEach((node, index) => {
      const current = index === (step < 0 ? 3 : step); node.toggleAttribute('data-active', current);
      node.toggleAttribute('data-complete', index < (step < 0 ? 4 : step));
      if (current) node.setAttribute('aria-current', 'step'); else node.removeAttribute('aria-current');
    });
    el.waypoint.hidden = state.phase !== 'track'; el.probe.hidden = state.phase !== 'track';
    el.waypoint.disabled = state.destination !== null;
    el.waypointLabel.textContent = state.destination === null ? TRACK_NODES[Math.min(state.node + 1, 3)].label : '探测器正在沿街移动…';
    el.bench.hidden = state.phase === 'track';
    if (state.phase === 'track') el.bench.innerHTML = '';
    if (state.phase === 'peel') {
      el.bench.innerHTML = `<div class="mission-peel-table"><div class="mission-holo-ring" aria-hidden="true"></div>${productMarkup()}${MISSION_SHELLS.filter((shell) => !state.removed.includes(shell.id)).map((shell) => `<button type="button" class="mission-ad-shell is-${shell.id}" data-drag="shell" data-shell="${shell.id}" aria-label="摘下${shell.label}外壳"><small>AD SIGNAL / ${shell.id === 'urgency' ? '01' : '02'}</small><b>${shell.label}</b><span>${shell.detail}</span><em>抓住向外甩 ↗ · 也可点击摘下</em></button>`).join('')}<span class="mission-shell-count">${state.removed.length} / 2 层外壳已摘下</span></div>`;
    } else if (state.phase === 'trial') el.bench.innerHTML = trialMarkup();
    else if (state.phase === 'deliver') {
      el.bench.innerHTML = `<div class="mission-delivery">${productMarkup({ draggable: true })}<button type="button" class="mission-conveyor" data-push><small>COOLING TRANSIT</small><b>推入冷静传送带</b><span>↓ 拖到这里 · 或点击放入</span><i aria-hidden="true"></i></button><button class="mission-leave" type="button" data-dismiss>我仍然想要，带着它离开 ↗</button></div>`;
    } else if (state.phase === 'review') {
      el.bench.innerHTML = `<form id="missionSaveForm" class="mission-ticket"><p class="mission-ticket-code">COOLING TICKET / 待确认</p><h3>这是你想买的吗？</h3><p class="mission-ticket-note">${state.product.source === 'order' ? '已有冷静单会直接复用。' : '图片与预填内容来自商品池示例。请改为你的实际信息，或确认这是你想买的商品。'}</p><label>商品名称<input name="name" maxlength="80" required value="${escape(state.product.name)}" autocomplete="off" /></label><label>预计金额（元）<input name="amount" type="number" min="0.01" max="99999999.99" step="0.01" inputmode="decimal" required value="${state.product.amount}" /></label><p class="mission-ticket-boundary">保存为“欲望冷却中”，不计为确认省下。这里的记录不代表银行存款到账。</p><p id="missionSaveError" role="alert" ${saveError ? '' : 'hidden'}>${escape(saveError)}</p><button class="mission-primary" type="submit">确认保存冷静单</button><button class="mission-leave" type="button" data-review-back>暂不保存，返回传送带</button></form>`;
    } else if (state.phase === 'done') {
      el.bench.innerHTML = `<div class="mission-done"><span class="mission-done-orbit" aria-hidden="true">✓</span><p class="mission-ticket-code">${state.persisted ? '欲望冷却中' : '本次临时记录'}</p><h3>${escape(state.product.name)}</h3><strong>${money(state.product.amount)}</strong><p>${state.persisted ? '这张冷静单已在当前浏览器中。<br />它还没有计入确认省下。' : '本地存储不可用，刷新后记录可能丢失。<br />你仍可在本次页面中继续体验。'}</p><button class="mission-primary" type="button" data-return>返回房间，看看冷静单</button><button class="mission-leave" type="button" data-replay>再走一遍这条街</button></div>`;
    }
    selectedProduct = false;
    renderInput();
    scene?.setState(state, { reducedMotion: motionReduced() });
    if (phaseChanged) {
      if (lastPhase !== null) el.title.focus({ preventScroll: true });
      announce(`${copy[0]} ${el.description.textContent}`);
    } else if (focusKey) el.bench.querySelector(focusKey)?.focus({ preventScroll: true });
    else if (focused?.dataset?.shell) el.bench.querySelector('[data-shell]')?.focus({ preventScroll: true });
    lastPhase = state.phase;
  }
  function dispatch(action) {
    const next = transitionMission(state, action); if (next === state) return false;
    state = next; render();
    if (['arrive', 'approach'].includes(action.type) && state.phase === 'track') {
      if (action.type === 'arrive' && document.activeElement === document.body) el.waypoint.focus({ preventScroll: true });
      announce(`已到达第 ${state.node} 个路标。${TRACK_NODES[state.node + 1].label}。`);
    }
    if (state.phase === 'track' && state.destination !== null && !scene) scheduleFallbackArrival();
    return true;
  }
  function scheduleFallbackArrival() {
    clearTimer(); const node = state.destination;
    fallbackTimer = setTimeout(() => { fallbackTimer = null; if (opened) dispatch({ type: 'arrive', node }); }, motionReduced() ? 0 : 650);
  }
  function cancelDrag() {
    if (drag) {
      drag.element.style.removeProperty('--drag-x'); drag.element.style.removeProperty('--drag-y');
      drag.element.classList.remove('is-dragging');
      if (drag.pointerId !== null && drag.element.hasPointerCapture?.(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
    }
    drag = null; root.querySelectorAll('.is-drop-hover').forEach((node) => node.classList.remove('is-drop-hover'));
  }
  function beginDrag(element, x, y, pointerId = null) {
    if (!element || !['peel', 'trial', 'deliver'].includes(state.phase)) return false;
    drag = { element, x, y, lastX: x, lastY: y, pointerId, type: element.dataset.drag, shell: element.dataset.shell };
    if (pointerId !== null) element.setPointerCapture?.(pointerId);
    element.classList.add('is-dragging'); return true;
  }
  function moveDrag(x, y) {
    if (!drag) return;
    drag.lastX = x; drag.lastY = y;
    drag.element.style.setProperty('--drag-x', `${x - drag.x}px`); drag.element.style.setProperty('--drag-y', `${y - drag.y}px`);
    root.querySelectorAll('[data-place], [data-push]').forEach((target) => target.classList.toggle('is-drop-hover', pointInside({ x, y }, target.getBoundingClientRect())));
  }
  function endDrag(x, y, cancelled = false) {
    if (!drag) return;
    const active = drag, dx = x - active.x, dy = y - active.y;
    const target = [...root.querySelectorAll('[data-place], [data-push]')].find((node) => pointInside({ x, y }, node.getBoundingClientRect()));
    cancelDrag();
    if (cancelled) return;
    suppressClick = Math.hypot(dx, dy) > 6;
    if (active.type === 'shell' && shellDragCompleted({ dx, dy })) {
      announce('一层催促被甩开了。商品还在。'); dispatch({ type: 'remove-shell', id: active.shell });
    } else if (active.type === 'product' && target && Math.hypot(dx, dy) > 6) {
      if (target.hasAttribute('data-push')) dispatch({ type: 'push' }); else dispatch({ type: 'place', target: target.dataset.place });
    } else if (Math.hypot(dx, dy) > 6) announce(active.type === 'shell' ? '再向外甩远一点；也可以点击摘下外壳。' : '还没放到装置上，商品已回到原处。');
  }
  function usePointer() {
    if (inputMode === 'gesture') { inputMode = 'pointer'; gestures.reset(); onInputMode('pointer'); renderInput(); }
    el.pause.hidden = true; scene?.setPaused(false);
  }
  function click(event) {
    if (!opened) return;
    if (suppressClick) { suppressClick = false; event.preventDefault(); return; }
    const target = event.target.closest('button'); if (!target || target.disabled) return;
    if (target.hasAttribute('data-peel-close') || target.hasAttribute('data-return')) { close(); return; }
    if (target === el.gesture) { void toggleGesture(); return; }
    if (target === el.waypoint) walkToWaypoint();
    if (target.dataset.shell) dispatch({ type: 'remove-shell', id: target.dataset.shell });
    if (target.dataset.trial) dispatch({ type: 'trial', id: target.dataset.trial });
    if (target.dataset.place) dispatch({ type: 'place', target: target.dataset.place });
    if (target.hasAttribute('data-finish-trial')) dispatch({ type: 'finish-trial' });
    if (target.hasAttribute('data-push')) dispatch({ type: 'push' });
    if (target.hasAttribute('data-review-back')) dispatch({ type: 'back' });
    if (target.hasAttribute('data-replay')) dispatch({ type: 'replay' });
    if (target.hasAttribute('data-dismiss')) onIntent({ type: 'dismiss', focusItem: state.product });
    if (target.hasAttribute('data-pick-product')) {
      selectedProduct = !selectedProduct; target.setAttribute('aria-pressed', String(selectedProduct));
      announce(selectedProduct ? '已拿起商品。选择下方装置放入，或再按一次放下。' : '商品已放回。');
    }
  }
  async function save(event) {
    if (event.target.id !== 'missionSaveForm') return;
    event.preventDefault(); if (saving || state.phase !== 'review') return;
    const data = new FormData(event.target), draft = validateMissionDraft({ name: data.get('name'), amount: data.get('amount') });
    if (draft.error) { saveError = draft.error; $('missionSaveError').textContent = saveError; $('missionSaveError').hidden = false; return; }
    saving = true; const sequence = generation;
    const submit = event.target.querySelector('[type="submit"]'); submit.disabled = true;
    try {
      const result = await onIntent({ type: 'mission-save', focusItem: state.product, draft });
      if (opened && sequence === generation) {
        if (result?.order) dispatch({ type: 'saved', ...result });
        else { saveError = '暂时没能记录，请再试一次。'; render(); }
      }
    } catch { if (opened && sequence === generation) { saveError = '暂时没能记录，请再试一次。'; render(); } }
    finally { saving = false; if (submit.isConnected) submit.disabled = false; }
  }
  function renderInput() {
    el.gesture.setAttribute('aria-pressed', String(inputMode === 'gesture'));
    el.gesture.textContent = inputMode === 'gesture' ? '停用手势' : '开启手势';
    el.cursor.hidden = inputMode !== 'gesture';
    const canWalk = state.phase === 'track' && Boolean(scene) && !motionReduced();
    root.dataset.navigation = canWalk ? 'walk' : 'step';
    if (state.phase === 'track') el.description.textContent = canWalk ? COPY.track[1] : '点击亮起的路标，追踪耳机的信号源。';
    el.help.textContent = inputMode === 'gesture'
      ? '摄像头仅在本地识别 · 捏合抓取 / 松开放下 · 保存仍需点击'
      : state.phase === 'track'
        ? canWalk ? 'W/S 前后 · A/D 左右 · 鼠标拖动转向 · 松键即停' : '点击路标或按 W / ↑ 前进 · Tab / Enter 也能完成'
        : '拖动场景里的物件 · 点击或 Tab / Enter 也能完成';
    measureWaypoint();
  }
  async function toggleGesture() {
    if (inputMode === 'gesture') { usePointer(); return; }
    stopNavigation();
    inputMode = 'gesture'; gestures.reset(); renderInput();
    announce('摄像头只在本地识别。捏合抓取，松开放下；确认保存仍需点击。');
    const sequence = generation;
    const started = await onInputMode('gesture');
    if (!opened || sequence !== generation) return;
    if (started === false) { inputMode = 'pointer'; renderInput(); announce('摄像头未开启，鼠标、触屏和键盘仍可继续。'); }
  }
  function applyGestureFrame(frame) {
    if (!opened || inputMode !== 'gesture' || ['review', 'done'].includes(state.phase)) return false;
    const command = gestures.update(frame, frame?.at ?? performance.now()); if (!command) return false;
    if (command.type === 'lost') { cancelDrag(); pause('hand-lost'); return true; }
    if (!el.pause.hidden) resume();
    const rect = el.world.getBoundingClientRect();
    const x = rect.left + command.point.x * rect.width, y = rect.top + command.point.y * rect.height;
    el.cursor.style.left = `${command.point.x * 100}%`; el.cursor.style.top = `${command.point.y * 100}%`;
    el.cursor.classList.toggle('is-held', command.held);
    const hit = document.elementFromPoint(x, y)?.closest('button');
    if (command.type === 'grab') {
      if (hit?.dataset.drag) beginDrag(hit, x, y);
      else if (hit && el.world.contains(hit) && !hit.disabled) hit.click();
    } else if (command.type === 'release' && drag) endDrag(x, y);
    else if (drag) moveDrag(x, y);
    suppressClick = false;
    // Dwell is limited to selecting the next waypoint, never to a business action.
    if (state.phase === 'track' && hit === el.waypoint && !hit.disabled && !command.held) {
      const at = frame.at ?? performance.now();
      if (lastGestureTarget !== hit) { lastGestureTarget = hit; hoverSince = at; }
      else if (at - hoverSince > 1000) { walkToWaypoint(); lastGestureTarget = null; }
    } else lastGestureTarget = null;
    return true;
  }
  function pause(reason = 'hidden') {
    stopNavigation(); cancelDrag(); scene?.setPaused(true);
    if (reason === 'hand-lost') { el.pause.textContent = '暂时没看到手，抓取已取消。伸手继续，或点击页面改用普通操作。'; el.pause.hidden = false; }
  }
  function resume() { el.pause.hidden = true; scene?.setPaused(document.hidden); }
  function fallback() {
    stopNavigation(); scene?.destroy(); scene = null; renderMode = 'fallback'; root.dataset.renderMode = renderMode; renderInput();
    if (opened && state.destination !== null) scheduleFallbackArrival();
    announce('街区已切换为静态视图，所有任务仍可完成。');
  }
  async function open(config = {}) {
    if (destroyed) return false;
    if (opened) return true;
    opened = true; generation++; const sequence = generation;
    state = createMissionState(config); lastPhase = null; saveError = ''; saving = false;
    goalName = config.goal?.name || config.goal?.title || ''; inputMode = config.inputMode === 'gesture' ? 'gesture' : 'pointer';
    root.hidden = false; renderMode = 'loading'; el.pause.hidden = true; render(); renderInput();
    el.title.focus({ preventScroll: true });
    try {
      scenePromise ||= import('./desire-mission-scene.js?v=20260905-mission-wasd-2');
      const { createMissionScene } = await scenePromise;
      if (!opened || sequence !== generation) return false;
      scene = createMissionScene({ canvas: el.canvas, onArrive: (node) => { if (opened) dispatch({ type: 'arrive', node }); }, onFailure: fallback,
        onApproach: (position) => { if (opened) dispatch({ type: 'approach', position }); },
        onFrame: ({ waypoint, probe, position, drawCalls, quality, viewYaw, viewPitch, manual }) => {
          if (!opened) return;
          let markerX = Math.min(80, Math.max(22, waypoint.x * 100));
          let markerY = Math.min(66, Math.max(26, waypoint.y * 100));
          const layout = waypointLayout;
          if (layout?.width && layout.height) {
            const half = layout.markerWidth / 2;
            const x = Math.max(half + 16, Math.min(layout.width - half - 16, markerX * layout.width / 100));
            let y = markerY * layout.height / 100;
            if (x - half < layout.headingRight && x + half > layout.headingLeft) {
              y = Math.max(y, layout.headingBottom + 14 + layout.markerHeight);
            }
            markerX = x / layout.width * 100;
            markerY = Math.min(y, layout.footerTop - 18) / layout.height * 100;
          }
          el.waypoint.style.left = `${markerX}%`; el.waypoint.style.top = `${markerY}%`;
          el.probe.style.left = `${probe.x * 100}%`; el.probe.style.top = `${probe.y * 100}%`;
          root.dataset.probePosition = `${position.x.toFixed(2)},${position.z.toFixed(2)}`;
          root.dataset.viewYaw = viewYaw.toFixed(3); root.dataset.viewPitch = viewPitch.toFixed(3); root.dataset.moving = String(manual);
          root.dataset.drawCalls = String(drawCalls); root.dataset.quality = quality === 1 ? 'essential' : 'full';
        } });
      clearTimer(); renderMode = 'webgl'; root.dataset.renderMode = renderMode;
      renderInput(); scene.setState(state, { reducedMotion: motionReduced() }); scene.setPaused(document.hidden);
    } catch { if (opened && sequence === generation) fallback(); }
    return true;
  }
  function close() {
    if (!opened) return false;
    opened = false; generation++; clearTimer(); stopNavigation(); cancelDrag(); gestures.reset();
    if (inputMode === 'gesture') onInputMode('pointer'); inputMode = 'pointer'; renderInput();
    scene?.destroy(); scene = null; root.hidden = true; onClose(); return true;
  }
  listen(root, 'click', click); listen(root, 'submit', save);
  listen(root, 'pointerdown', (event) => {
    if (!opened || event.button !== 0 || event.isPrimary === false) return;
    suppressClick = false;
    if (event.target.closest('button') !== el.gesture) usePointer();
    const target = event.target.closest('[data-drag]');
    if (target) beginDrag(target, event.clientX, event.clientY, event.pointerId);
    else if (state.phase === 'track' && scene && !motionReduced() && event.pointerType !== 'touch'
      && !event.target.closest('button, input, textarea, select, form, a, label, [contenteditable]')) {
      lookDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      root.setPointerCapture(event.pointerId); root.dataset.looking = 'true'; el.world.focus({ preventScroll: true });
      event.preventDefault();
    }
  });
  listen(root, 'pointermove', (event) => {
    if (drag && drag.pointerId === event.pointerId) moveDrag(event.clientX, event.clientY);
    if (lookDrag?.pointerId === event.pointerId) {
      scene?.lookBy(event.clientX - lookDrag.x, event.clientY - lookDrag.y);
      lookDrag.x = event.clientX; lookDrag.y = event.clientY;
    }
  });
  listen(root, 'pointerup', (event) => {
    if (drag && drag.pointerId === event.pointerId) endDrag(event.clientX, event.clientY);
    if (lookDrag?.pointerId === event.pointerId) endLook();
  });
  listen(root, 'pointercancel', () => { stopNavigation(); cancelDrag(); });
  listen(root, 'lostpointercapture', (event) => { if (lookDrag?.pointerId === event.pointerId) endLook(); });
  // Auto-navigation disables its focused waypoint button. Keep movement usable
  // when the browser returns focus to body, while this modal owns the scene.
  listen(window, 'keydown', (event) => {
    if (!opened) return;
    // A touch drag may not emit a click. The next keyboard activation must not
    // inherit the drag's one-click suppression.
    suppressClick = false;
    if (document.hidden || state.phase !== 'track' || !movementCodes.has(event.code) || event.isComposing
      || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input, textarea, select, [contenteditable], [role="textbox"]')) return;
    if (scene && !motionReduced() && event.repeat && !heldKeys.has(event.code)) return;
    event.preventDefault(); usePointer();
    if (!scene || motionReduced()) {
      if (!event.repeat && ['KeyW', 'ArrowUp'].includes(event.code)) walkToWaypoint();
      return;
    }
    heldKeys.add(event.code); clearTimer(); dispatch({ type: 'steer' });
    scene.setMovement(missionMovementInput(heldKeys));
  });
  listen(window, 'keyup', (event) => { if (heldKeys.delete(event.code)) scene?.setMovement(missionMovementInput(heldKeys)); });
  listen(window, 'blur', stopNavigation);
  listen(root, 'focusin', (event) => { if (event.target.closest('input, textarea, select, [contenteditable], [role="textbox"]')) stopNavigation(); });
  listen(root, 'focusout', (event) => { if (!root.contains(event.relatedTarget)) stopNavigation(); });
  listen(document, 'visibilitychange', () => {
    if (!opened) return;
    if (document.hidden) { clearTimer(); stopNavigation(); cancelDrag(); gestures.reset(); scene?.setPaused(true); }
    else { scene?.setPaused(false); if (!scene && state.destination !== null) scheduleFallbackArrival(); }
  });
  listen(el.canvas, 'webglcontextlost', (event) => { event.preventDefault(); if (opened) fallback(); });
  listen(window, 'resize', () => { measureWaypoint(); scene?.resize(); });
  return { open, close, applyGestureFrame, applySegment: () => false, pause, resume,
    getState: () => ({ ...state, open: opened, inputMode, renderMode }),
    getDiagnostics: () => scene?.getDiagnostics() || { rafActive: false, renderMode },
    destroy() { close(); destroyed = true; listeners.splice(0).forEach((remove) => remove()); } };
}
