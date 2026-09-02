import {
  PEEL_GAME_STATUS,
  advanceRound,
  applyPeelSegment,
  createPeelGame,
  pauseRound,
  phaseForElapsed,
  resumeRound,
  skipTutorial,
  startRound,
} from './peel-game.js';

export const MAX_PEEL_DPR = 2;
export const MAX_PEEL_ENTITIES = 8;
export const MAX_PEEL_PARTICLES = 60;

const CONTROLLERS = new WeakMap();
const PHASE_LABELS = Object.freeze({
  single: '先看一层',
  mixed: '双层推动出现',
  focus: '看看这一件',
  complete: '本局结束',
});
const REMINDERS = Object.freeze({
  urgency: '让它过一晚，再决定',
  scarcity: '先确认需要，不替库存着急',
  anchor: '只看最终要花多少',
  installment: '把总价完整念一遍',
  bundle: '先删掉为凑门槛加的东西',
  social: '问问这是不是我的需要',
  identity: '不靠一件商品证明自己',
  emotion: '先换一种更轻的奖励',
  collection: '允许系列暂时不完整',
  gift: '只看正装本身值不值得',
  algorithm: '先划走，等需要自己回来',
  upgrade: '先做十分钟，再看要不要装备',
  coupon: '允许优惠券安静过期',
  reflection: '把答案留到明天',
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function defaultRequestFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame(callback);
  return globalThis.setTimeout(() => callback(defaultNow()), 16);
}

function defaultCancelFrame(id) {
  if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(id);
  else globalThis.clearTimeout(id);
}

function queryElements(root) {
  const query = (id) => root.querySelector?.(`#${id}`) || null;
  return {
    title: query('peelGameTitle'),
    introView: query('peelGameIntroView'),
    playView: query('peelGamePlayView'),
    summaryView: query('peelGameSummaryView'),
    startButton: query('peelStartButton'),
    gestureStartButton: query('peelGestureStartButton'),
    closeButtons: [...(root.querySelectorAll?.('[data-peel-close]') || [])],
    stage: query('peelGameStage'),
    canvas: query('peelGameCanvas'),
    blade: query('peelGameBlade'),
    tutorial: query('peelGameTutorial'),
    skipTutorialButton: query('peelSkipTutorialButton'),
    shellCount: query('peelShellCount'),
    timeLeft: query('peelTimeLeft'),
    roundPhase: query('peelRoundPhase'),
    pauseNotice: query('peelPauseNotice'),
    liveStatus: query('peelLiveStatus'),
    fallbackTargets: query('peelFallbackTargets'),
    previousTargetButton: query('peelPreviousTargetButton'),
    currentTarget: query('peelCurrentTarget'),
    currentTargetButton: query('peelCurrentTargetButton'),
    nextTargetButton: query('peelNextTargetButton'),
    summaryCount: query('peelSummaryCount'),
    summaryChoices: query('peelSummaryCopyChoices'),
    reminderTrigger: query('peelReminderTrigger'),
    reminderText: query('peelReminderText'),
    summaryFocusName: query('peelSummaryFocusName'),
    summaryFocusGlyph: query('peelSummaryFocusGlyph'),
    coolButton: query('peelCoolButton'),
    dismissButton: query('peelDismissButton'),
    replayButton: query('peelReplayButton'),
  };
}

function normalizedPointer(event, rect) {
  return {
    x: clamp((Number(event.clientX) - rect.left) / Math.max(1, rect.width), 0, 1),
    y: clamp((Number(event.clientY) - rect.top) / Math.max(1, rect.height), 0, 1),
  };
}

function lineDistance(from, to) {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

function drawRoundedRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath?.();
}

function uniqueReveals(reveals) {
  const seen = new Set();
  return (Array.isArray(reveals) ? reveals : []).filter((reveal) => {
    if (!reveal?.copyId || seen.has(reveal.copyId)) return false;
    seen.add(reveal.copyId);
    return true;
  });
}

export function createPeelGameController({
  root,
  elements: providedElements,
  loadAssets = async () => {},
  onStateChange = () => {},
  onSummary = () => {},
  onClose = () => {},
  onInputMode = () => {},
  onIntent = () => {},
  now = defaultNow,
  requestFrame = defaultRequestFrame,
  cancelFrame = defaultCancelFrame,
  devicePixelRatio = globalThis.devicePixelRatio || 1,
  reducedMotion = false,
  documentRef = root?.ownerDocument || globalThis.document || null,
} = {}) {
  if (!root) throw new TypeError('欲望剥壳机需要根节点');
  if (CONTROLLERS.has(root)) return CONTROLLERS.get(root);

  const elements = { ...queryElements(root), ...(providedElements || {}) };
  let state = null;
  let config = {};
  let opened = false;
  let destroyed = false;
  let assetsPromise = null;
  let context = null;
  let canvasAvailable = false;
  let appliedDpr = 1;
  let rafId = null;
  let lastFrameAt = null;
  let pointer = null;
  let targetIndex = 0;
  let bladePoint = { x: 0.5, y: 0.5 };
  let particles = [];
  let trails = [];
  let inputMode = 'pointer';
  let tutorialSeen = false;
  let replayCount = 0;
  const cleanupListeners = [];

  const motionIsReduced = () => (
    typeof reducedMotion === 'function' ? Boolean(reducedMotion()) : Boolean(reducedMotion)
  );

  function listen(element, type, listener, options) {
    if (!element?.addEventListener) return;
    element.addEventListener(type, listener, options);
    cleanupListeners.push(() => element.removeEventListener(type, listener, options));
  }

  function emitState() {
    onStateChange(state);
  }

  function resizeCanvas() {
    const canvas = elements.canvas;
    const stage = elements.stage;
    if (!canvas || !stage) return;
    const rect = stage.getBoundingClientRect();
    appliedDpr = clamp(Number(devicePixelRatio) || 1, 1, MAX_PEEL_DPR);
    canvas.width = Math.max(1, Math.round(rect.width * appliedDpr));
    canvas.height = Math.max(1, Math.round(rect.height * appliedDpr));
    context = canvas.getContext?.('2d') || null;
    canvasAvailable = Boolean(context);
    if (elements.fallbackTargets) elements.fallbackTargets.hidden = canvasAvailable;
  }

  function activeTargets() {
    return (state?.entities || []).filter((entity) => (
      !entity.coreRevealed && entity.shells.some((shell) => !shell.peeled)
    ));
  }

  function selectedTarget() {
    const targets = activeTargets();
    if (!targets.length) return null;
    targetIndex = ((targetIndex % targets.length) + targets.length) % targets.length;
    return targets[targetIndex];
  }

  function createTextButton(text, onClick) {
    if (!documentRef?.createElement) return { textContent: text };
    const item = documentRef.createElement('li');
    const button = documentRef.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', onClick);
    item.append(button);
    return item;
  }

  function renderFallbackTargets() {
    if (!elements.fallbackTargets || canvasAvailable) return;
    const targets = activeTargets();
    const children = targets.map((entity) => {
      const shell = entity.shells.find((entry) => !entry.peeled);
      return createTextButton(
        `${entity.item.name}：“${shell?.copy?.lure || '等待剥壳'}”`,
        () => peelTarget(entity),
      );
    });
    elements.fallbackTargets.replaceChildren?.(...children);
  }

  function renderTargetController() {
    const target = selectedTarget();
    const shell = target?.shells.find((entry) => !entry.peeled);
    if (elements.currentTarget) {
      elements.currentTarget.textContent = target
        ? `当前空中目标：${target.item.name}的“${shell?.copy?.lure}”外壳`
        : '当前空中目标：等待商品';
    }
    for (const button of [
      elements.previousTargetButton,
      elements.currentTargetButton,
      elements.nextTargetButton,
    ]) {
      if (button) button.disabled = !target;
    }
  }

  function renderState() {
    if (!state) return;
    if (elements.shellCount) elements.shellCount.textContent = String(state.score.peeledShells);
    if (elements.timeLeft) {
      elements.timeLeft.textContent = String(Math.max(0, Math.ceil((state.durationMs - state.elapsedMs) / 1_000)));
    }
    if (elements.roundPhase) {
      elements.roundPhase.textContent = state.status === PEEL_GAME_STATUS.TUTORIAL
        ? '教学不计时'
        : PHASE_LABELS[phaseForElapsed(state.elapsedMs)] || '准备剥壳';
    }
    if (elements.tutorial) elements.tutorial.hidden = state.status !== PEEL_GAME_STATUS.TUTORIAL;
    if (elements.pauseNotice) elements.pauseNotice.hidden = state.status !== PEEL_GAME_STATUS.PAUSED;
    if (elements.blade) {
      elements.blade.style.setProperty('--blade-x', `${Math.round(bladePoint.x * 100)}%`);
      elements.blade.style.setProperty('--blade-y', `${Math.round(bladePoint.y * 100)}%`);
    }
    renderTargetController();
    renderFallbackTargets();
  }

  function drawProduct(entity, width, height) {
    if (!context) return;
    const x = entity.x * width;
    const y = entity.y * height;
    const scale = clamp(entity.radius / 0.082, 0.82, 1.42);
    context.save();
    context.translate(x, y);
    if (!motionIsReduced()) context.rotate(entity.rotation);

    if (entity.coreRevealed) {
      context.beginPath();
      context.fillStyle = 'rgba(215, 255, 67, .42)';
      context.arc?.(0, 0, 55 * scale, 0, Math.PI * 2);
      context.fill();
    }

    drawRoundedRect(context, -42 * scale, -42 * scale, 84 * scale, 84 * scale, 22 * scale);
    context.fillStyle = '#fffaf0';
    context.fill();
    context.strokeStyle = '#302924';
    context.lineWidth = 3 * scale;
    context.stroke();
    context.font = `${42 * scale}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#302924';
    context.fillText(entity.item.glyph || '□', 0, -3 * scale);
    context.font = `800 ${9 * scale}px system-ui, sans-serif`;
    context.fillText(entity.item.name, 0, 31 * scale);

    const shellIndex = entity.shells.findIndex((shell) => !shell.peeled);
    if (shellIndex >= 0) {
      const shell = entity.shells[shellIndex];
      const widthPx = 154 * scale;
      const heightPx = 62 * scale;
      drawRoundedRect(context, -widthPx / 2, -heightPx / 2, widthPx, heightPx, 17 * scale);
      context.fillStyle = shellIndex % 2 === 0 ? '#ffb23f' : '#69ded0';
      context.fill();
      context.strokeStyle = '#302924';
      context.lineWidth = 3 * scale;
      context.stroke();
      context.textAlign = 'left';
      context.textBaseline = 'top';
      context.fillStyle = 'rgba(48, 41, 36, .72)';
      context.font = `900 ${7 * scale}px system-ui, sans-serif`;
      context.fillText('话术样本', -widthPx / 2 + 10 * scale, -heightPx / 2 + 7 * scale);
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = '#302924';
      context.font = `900 ${14 * scale}px system-ui, sans-serif`;
      context.fillText(shell.copy.lure, 0, 6 * scale);
    }
    context.restore();
  }

  function draw() {
    if (!context || !elements.canvas) return;
    const width = elements.canvas.width;
    const height = elements.canvas.height;
    context.clearRect(0, 0, width, height);
    for (const entity of (state?.entities || []).slice(0, MAX_PEEL_ENTITIES)) drawProduct(entity, width, height);

    context.save();
    context.lineCap = 'round';
    for (const trail of trails) {
      context.beginPath();
      context.moveTo(trail.from.x * width, trail.from.y * height);
      context.lineTo(trail.to.x * width, trail.to.y * height);
      context.strokeStyle = 'rgba(255, 255, 255, .86)';
      context.lineWidth = 4 * appliedDpr;
      context.stroke();
    }
    for (const particle of particles) {
      context.fillStyle = particle.color;
      context.fillRect(particle.x * width, particle.y * height, 6 * appliedDpr, 4 * appliedDpr);
    }
    context.restore();
  }

  function addPeelFeedback(previousState, nextState, at) {
    const previousIds = new Set(previousState.reveals.map((reveal) => `${reveal.entityId}:${reveal.copyId}`));
    const fresh = nextState.reveals.filter((reveal) => !previousIds.has(`${reveal.entityId}:${reveal.copyId}`));
    for (const reveal of fresh) {
      const entity = nextState.entities.find((entry) => entry.id === reveal.entityId);
      if (!entity) continue;
      for (let index = 0; index < 10; index += 1) {
        particles.push({
          x: entity.x,
          y: entity.y,
          vx: (index - 4.5) * 0.008,
          vy: -0.05 - (index % 3) * 0.012,
          bornAt: at,
          color: index % 2 ? '#d7ff43' : '#fffaf0',
        });
      }
      if (elements.liveStatus) {
        elements.liveStatus.textContent = `${reveal.lure}，剥开后：${reveal.text}。商品完整保留。`;
      }
    }
    particles = particles.slice(-MAX_PEEL_PARTICLES);
  }

  function updateParticles(deltaMs, at) {
    const delta = Math.min(Math.max(deltaMs, 0), 80) / 1_000;
    particles = particles
      .filter((particle) => at - particle.bornAt < 650)
      .map((particle) => ({
        ...particle,
        x: particle.x + particle.vx * delta * 60,
        y: particle.y + particle.vy * delta * 60,
        vy: particle.vy + 0.006 * delta * 60,
      }))
      .slice(-MAX_PEEL_PARTICLES);
    trails = trails.filter((trail) => at - trail.at < 130).slice(-8);
  }

  function createChoice(reveal, index) {
    if (!documentRef?.createElement) return { textContent: reveal.lure || reveal.text };
    const label = documentRef.createElement('label');
    const input = documentRef.createElement('input');
    const text = documentRef.createElement('span');
    input.type = 'radio';
    input.name = 'peel-summary-copy';
    input.value = reveal.copyId;
    input.checked = index === 0;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      if (elements.reminderTrigger) elements.reminderTrigger.textContent = `“${reveal.lure || reveal.text}”`;
      if (elements.reminderText) elements.reminderText.textContent = REMINDERS[reveal.family] || '停十分钟，再决定';
    });
    text.textContent = reveal.lure || reveal.text;
    label.append(input, text);
    return label;
  }

  function renderSummary() {
    const summary = state?.summary;
    if (!summary) return;
    if (elements.summaryCount) elements.summaryCount.textContent = String(summary.peeledShells);
    if (elements.summaryFocusName) elements.summaryFocusName.textContent = summary.focusItem?.name || '本局商品';
    if (elements.summaryFocusGlyph) elements.summaryFocusGlyph.textContent = summary.focusItem?.glyph || '📦';
    const choices = uniqueReveals(summary.reveals).slice(0, 6);
    elements.summaryChoices?.replaceChildren?.(...choices.map(createChoice));
    if (choices[0]) {
      if (elements.reminderTrigger) elements.reminderTrigger.textContent = `“${choices[0].lure || choices[0].text}”`;
      if (elements.reminderText) elements.reminderText.textContent = REMINDERS[choices[0].family] || '停十分钟，再决定';
    }
  }

  function finishSummary() {
    stopLoop();
    if (elements.playView) elements.playView.hidden = true;
    if (elements.summaryView) elements.summaryView.hidden = false;
    renderSummary();
    elements.summaryView?.querySelector?.('h3')?.focus?.();
    onSummary(state.summary, state);
  }

  function frame(timestamp) {
    rafId = null;
    if (destroyed || state?.status !== PEEL_GAME_STATUS.PLAYING) return;
    const deltaMs = lastFrameAt === null ? 0 : Math.max(0, timestamp - lastFrameAt);
    lastFrameAt = timestamp;
    state = advanceRound(state, deltaMs);
    updateParticles(deltaMs, timestamp);
    renderState();
    draw();
    emitState();
    if (state.status === PEEL_GAME_STATUS.SUMMARY) finishSummary();
    else scheduleLoop();
  }

  function scheduleLoop() {
    if (rafId !== null || state?.status !== PEEL_GAME_STATUS.PLAYING || destroyed) return;
    rafId = requestFrame(frame);
  }

  function stopLoop() {
    if (rafId !== null) cancelFrame(rafId);
    rafId = null;
    lastFrameAt = null;
  }

  function showPlayView() {
    if (elements.introView) elements.introView.hidden = true;
    if (elements.playView) elements.playView.hidden = false;
    if (elements.summaryView) elements.summaryView.hidden = true;
  }

  function start(mode = 'pointer') {
    if (!state || state.status !== PEEL_GAME_STATUS.READY) return state;
    inputMode = mode === 'gesture' ? 'gesture' : mode === 'keyboard' ? 'keyboard' : 'pointer';
    onInputMode(inputMode);
    state = startRound(state);
    showPlayView();
    resizeCanvas();
    renderState();
    draw();
    emitState();
    if (state.status === PEEL_GAME_STATUS.PLAYING) scheduleLoop();
    else elements.stage?.focus?.();
    return state;
  }

  function applySegment(segment) {
    if (!state) return state;
    const at = Number.isFinite(Number(segment?.at)) ? Number(segment.at) : now();
    const normalizedSegment = { ...segment, at };
    const previousState = state;
    state = applyPeelSegment(state, normalizedSegment);
    trails.push({ ...normalizedSegment, at });
    trails = trails.slice(-8);
    addPeelFeedback(previousState, state, at);
    if (previousState.status === PEEL_GAME_STATUS.TUTORIAL && state.status === PEEL_GAME_STATUS.PLAYING) {
      tutorialSeen = true;
      scheduleLoop();
    }
    renderState();
    draw();
    emitState();
    return state;
  }

  function peelTarget(target = selectedTarget()) {
    if (!target) return state;
    return applySegment({
      from: { x: target.x - target.radius * 1.4, y: target.y },
      to: { x: target.x + target.radius * 1.4, y: target.y },
      at: now(),
    });
  }

  function selectRelativeTarget(delta) {
    const targets = activeTargets();
    if (!targets.length) return;
    targetIndex = ((targetIndex + delta) % targets.length + targets.length) % targets.length;
    renderTargetController();
  }

  function skipTutorialAction() {
    if (state?.status !== PEEL_GAME_STATUS.TUTORIAL) return state;
    tutorialSeen = true;
    state = skipTutorial(state);
    renderState();
    draw();
    emitState();
    scheduleLoop();
    return state;
  }

  function pause(reason = 'manual') {
    if (!state) return state;
    state = pauseRound(state);
    stopLoop();
    if (elements.pauseNotice) {
      elements.pauseNotice.hidden = false;
      elements.pauseNotice.textContent = reason === 'hand-lost'
        ? '暂时没有识别到手，游戏已暂停。回到画面会继续。'
        : '游戏已暂停，回到这里可以继续。';
    }
    renderState();
    emitState();
    return state;
  }

  function resume() {
    if (!state) return state;
    state = resumeRound(state);
    if (elements.pauseNotice) elements.pauseNotice.hidden = true;
    renderState();
    emitState();
    scheduleLoop();
    return state;
  }

  function replay() {
    if (!state) return state;
    stopLoop();
    onInputMode(inputMode);
    replayCount += 1;
    state = createPeelGame({
      ...config,
      seed: `${config.seed || 'peel-round'}:replay:${replayCount}`,
      tutorialCompleted: true,
      reducedMotion: motionIsReduced(),
    });
    state = startRound(state);
    particles = [];
    trails = [];
    targetIndex = 0;
    bladePoint = { x: 0.5, y: 0.5 };
    showPlayView();
    renderState();
    draw();
    emitState();
    scheduleLoop();
    return state;
  }

  async function open(nextConfig = {}) {
    if (destroyed) return null;
    if (!assetsPromise) assetsPromise = Promise.resolve().then(() => loadAssets());
    await assetsPromise;
    if (opened) return state;
    config = { ...nextConfig };
    state = createPeelGame({
      ...config,
      tutorialCompleted: Boolean(config.tutorialCompleted || tutorialSeen),
      reducedMotion: motionIsReduced(),
    });
    opened = true;
    root.hidden = false;
    root.setAttribute?.('aria-hidden', 'false');
    if (elements.introView) elements.introView.hidden = false;
    if (elements.playView) elements.playView.hidden = true;
    if (elements.summaryView) elements.summaryView.hidden = true;
    resizeCanvas();
    renderState();
    emitState();
    elements.title?.focus?.();
    return state;
  }

  function close() {
    stopLoop();
    pointer = null;
    particles = [];
    trails = [];
    opened = false;
    if (state) state = { ...state, status: PEEL_GAME_STATUS.CLOSED };
    root.hidden = true;
    root.setAttribute?.('aria-hidden', 'true');
    onClose(state);
    config.returnFocus?.focus?.();
    return state;
  }

  function destroy() {
    if (destroyed) return;
    close();
    destroyed = true;
    cleanupListeners.splice(0).forEach((cleanup) => cleanup());
    CONTROLLERS.delete(root);
  }

  function pointerDown(event) {
    if (event.button !== 0 || state?.status === PEEL_GAME_STATUS.SUMMARY) return;
    const point = normalizedPointer(event, elements.stage.getBoundingClientRect());
    pointer = { id: event.pointerId, point, moved: false };
    bladePoint = point;
    elements.stage.setPointerCapture?.(event.pointerId);
    renderState();
  }

  function pointerMove(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const point = normalizedPointer(event, elements.stage.getBoundingClientRect());
    if (lineDistance(pointer.point, point) >= 0.008) {
      pointer.moved = true;
      applySegment({ from: pointer.point, to: point, at: now() });
      pointer.point = point;
    }
    bladePoint = point;
    renderState();
  }

  function pointerUp(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const point = normalizedPointer(event, elements.stage.getBoundingClientRect());
    if (!pointer.moved) {
      applySegment({
        from: { x: point.x - 0.045, y: point.y },
        to: { x: point.x + 0.045, y: point.y },
        at: now(),
      });
    }
    pointer = null;
    elements.stage.releasePointerCapture?.(event.pointerId);
  }

  function keyDown(event) {
    const movement = {
      ArrowLeft: [-0.06, 0],
      ArrowRight: [0.06, 0],
      ArrowUp: [0, -0.06],
      ArrowDown: [0, 0.06],
    }[event.key];
    if (movement) {
      event.preventDefault();
      bladePoint = {
        x: clamp(bladePoint.x + movement[0], 0.04, 0.96),
        y: clamp(bladePoint.y + movement[1], 0.04, 0.96),
      };
      renderState();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      applySegment({
        from: { x: bladePoint.x - 0.075, y: bladePoint.y + 0.035 },
        to: { x: bladePoint.x + 0.075, y: bladePoint.y - 0.035 },
        at: now(),
      });
    }
  }

  listen(elements.startButton, 'click', () => start('pointer'));
  listen(elements.gestureStartButton, 'click', () => start('gesture'));
  for (const button of elements.closeButtons || []) listen(button, 'click', close);
  listen(elements.skipTutorialButton, 'click', skipTutorialAction);
  listen(elements.stage, 'pointerdown', pointerDown);
  listen(elements.stage, 'pointermove', pointerMove);
  listen(elements.stage, 'pointerup', pointerUp);
  listen(elements.stage, 'pointercancel', pointerUp);
  listen(elements.stage, 'keydown', keyDown);
  listen(elements.previousTargetButton, 'click', () => selectRelativeTarget(-1));
  listen(elements.nextTargetButton, 'click', () => selectRelativeTarget(1));
  listen(elements.currentTargetButton, 'click', () => peelTarget());
  listen(elements.coolButton, 'click', () => onIntent({ type: 'cool', focusItem: state?.focusItem, state }));
  listen(elements.dismissButton, 'click', () => onIntent({ type: 'dismiss', focusItem: state?.focusItem, state }));
  listen(elements.replayButton, 'click', () => {
    onIntent({ type: 'replay', focusItem: state?.focusItem, state });
    replay();
  });
  if (documentRef) {
    listen(documentRef, 'visibilitychange', () => {
      if (documentRef.hidden) pause('hidden');
      else if (state?.status === PEEL_GAME_STATUS.PAUSED) resume();
    });
  }

  const controller = {
    open,
    start,
    applySegment,
    pause,
    resume,
    replay,
    close,
    destroy,
    skipTutorial: skipTutorialAction,
    getState: () => state,
    getInputMode: () => inputMode,
    getDiagnostics: () => ({
      opened,
      canvasAvailable,
      appliedDpr,
      particles: particles.length,
      rafActive: rafId !== null,
      listeners: cleanupListeners.length,
    }),
  };
  CONTROLLERS.set(root, controller);
  return controller;
}
