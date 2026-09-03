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
import { drawPeelProductVisual } from './peel-product-visuals.js?v=20260902-gallery-glass-1';

export const MAX_PEEL_DPR = 2;
export const MAX_PEEL_ENTITIES = 8;
export const MAX_PEEL_PARTICLES = 60;
export const MAX_PEEL_SHARDS = 16;
export const MAX_PEEL_REVEAL_CARDS = 8;

const CONTROLLERS = new WeakMap();
const PHASE_LABELS = Object.freeze({
  single: '单信号',
  mixed: '双信号',
  focus: '焦点商品',
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
  neutral: '不需要硬找原因，照常慢慢决定',
});
const NO_FEELING_CHOICE = Object.freeze({
  copyId: 'neutral-no-feeling',
  lure: '没什么感觉',
  text: '这一局没有哪句话特别推我',
  family: 'neutral',
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

const SIGNAL_FILM_COLORS = Object.freeze([
  Object.freeze({ line: 'rgba(215, 255, 67, .78)', fill: 'rgba(215, 255, 67, .12)' }),
  Object.freeze({ line: 'rgba(112, 231, 218, .72)', fill: 'rgba(112, 231, 218, .11)' }),
]);

function drawSignalFilm(context, shell, shellIndex, scale, {
  front = false,
  showLabel = false,
} = {}) {
  const palette = SIGNAL_FILM_COLORS[shellIndex % SIGNAL_FILM_COLORS.length];
  const angle = (shellIndex % 2 === 0 ? -0.19 : 0.22) + shellIndex * 0.025;
  const radiusX = (72 + shellIndex * 7) * scale;
  const radiusY = (27 + shellIndex * 3) * scale;
  context.save();
  context.rotate(angle);
  context.lineCap = 'round';
  context.strokeStyle = palette.line;
  context.lineWidth = (front ? 2 : 1.2) * scale;
  context.shadowColor = palette.line;
  context.shadowBlur = front ? 12 * scale : 5 * scale;
  context.beginPath();
  context.ellipse?.(0, 0, radiusX, radiusY, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
  context.stroke();

  if (front && showLabel) {
    const lure = String(shell?.copy?.lure || '先等等');
    const labelWidth = clamp(40 + lure.length * 11, 82, 128) * scale;
    const labelHeight = 25 * scale;
    const labelX = radiusX * 0.3 - labelWidth / 2;
    const labelY = -radiusY - labelHeight * 0.18;
    drawRoundedRect(context, labelX, labelY, labelWidth, labelHeight, labelHeight / 2);
    context.fillStyle = palette.fill;
    context.fill();
    context.strokeStyle = palette.line;
    context.lineWidth = 0.8 * scale;
    context.stroke();
    context.shadowBlur = 8 * scale;
    context.fillStyle = '#f4f0e7';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `600 ${10 * scale}px "PingFang SC", sans-serif`;
    context.fillText(lure, labelX + labelWidth / 2, labelY + labelHeight / 2);
  }
  context.restore();
}

function uniqueReveals(reveals) {
  const seen = new Set();
  return (Array.isArray(reveals) ? reveals : []).filter((reveal) => {
    if (!reveal?.copyId || seen.has(reveal.copyId)) return false;
    seen.add(reveal.copyId);
    return true;
  });
}

function formatCny(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return '';
  const fractionDigits = Number.isInteger(value) ? 0 : 2;
  return `¥${value.toLocaleString('zh-CN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 2,
  })}`;
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
  let gestureBladeTarget = null;
  let particles = [];
  let shellShards = [];
  let revealCards = [];
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
        `${entity.item.name}：“${shell?.copy?.lure || '等待信号'}”`,
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
        ? `当前空中目标：${target.item.name} · “${shell?.copy?.lure}”`
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
      elements.blade.style.setProperty('--blade-x', `${(clamp(bladePoint.x, 0, 1) * 100).toFixed(3)}%`);
      elements.blade.style.setProperty('--blade-y', `${(clamp(bladePoint.y, 0, 1) * 100).toFixed(3)}%`);
    }
    renderTargetController();
    renderFallbackTargets();
  }

  function drawProduct(entity, width, height) {
    if (!context) return;
    const x = entity.x * width;
    const y = entity.y * height;
    const scale = clamp(entity.radius / 0.082, 0.82, 1.42) * appliedDpr;
    const price = entity.coreRevealed ? formatCny(entity.item.amount) : '';
    const unpeeledShells = entity.shells
      .map((shell, index) => ({ shell, index }))
      .filter(({ shell }) => !shell.peeled);
    context.save();
    context.translate(x, y);
    if (!motionIsReduced()) context.rotate(Math.sin(entity.rotation) * 0.16);

    unpeeledShells.forEach(({ shell, index }) => {
      drawSignalFilm(context, shell, index, scale, { front: false });
    });

    context.beginPath();
    context.fillStyle = entity.coreRevealed
      ? 'rgba(215, 255, 67, .16)'
      : 'rgba(244, 240, 231, .055)';
    context.shadowColor = entity.coreRevealed ? 'rgba(215, 255, 67, .72)' : 'rgba(244, 240, 231, .2)';
    context.shadowBlur = entity.coreRevealed ? 28 * scale : 12 * scale;
    context.arc?.(0, 0, 50 * scale, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;

    drawPeelProductVisual(context, entity.item, {
      scale,
      revealed: entity.coreRevealed,
      color: '#f4f0e7',
      accent: '#d7ff43',
    });

    unpeeledShells.forEach(({ shell, index }, visibleIndex) => {
      drawSignalFilm(context, shell, index, scale, {
        front: true,
        showLabel: visibleIndex === 0,
      });
    });

    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = entity.coreRevealed ? '#f4f0e7' : 'rgba(244, 240, 231, .82)';
    context.font = `600 ${10 * scale}px "PingFang SC", sans-serif`;
    context.fillText(entity.item.name, 0, (price ? 53 : 48) * scale);
    if (price) {
      context.fillStyle = '#d7ff43';
      context.font = `650 ${8.5 * scale}px ui-monospace, SFMono-Regular, monospace`;
      context.fillText(price, 0, 64 * scale);
    }
    context.restore();
  }

  function drawShellShard(shard, width, height) {
    if (!context) return;
    const shardWidth = 66 * appliedDpr;
    const shardHeight = 24 * appliedDpr;
    context.save();
    context.translate(shard.x * width, shard.y * height);
    context.rotate(shard.rotation);
    context.globalCompositeOperation = 'screen';
    context.globalAlpha = 0.72;
    context.fillStyle = shard.color;
    context.strokeStyle = 'rgba(244, 240, 231, .58)';
    context.lineWidth = 0.8 * appliedDpr;
    context.shadowColor = shard.color;
    context.shadowBlur = 12 * appliedDpr;
    context.beginPath();
    context.moveTo(-shardWidth / 2, 0);
    context.lineTo(-shardWidth * 0.08, -shardHeight / 2);
    context.lineTo(shardWidth / 2, -shardHeight * 0.08);
    context.lineTo(shardWidth * 0.12, shardHeight / 2);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  function drawRevealCard(card, width, height) {
    if (!context) return;
    const echoWidth = Math.min(240 * appliedDpr, width - 36 * appliedDpr);
    const x = clamp(card.x * width, 18 * appliedDpr + echoWidth / 2, width - 18 * appliedDpr - echoWidth / 2);
    const y = clamp(card.y * height - 90 * appliedDpr, 30 * appliedDpr, height - 76 * appliedDpr);
    const text = String(card.text || '先看清，再决定');
    const lines = text.length > 16 ? [text.slice(0, 16), text.slice(16, 32)] : [text];
    context.save();
    context.globalCompositeOperation = 'screen';
    context.strokeStyle = 'rgba(215, 255, 67, .72)';
    context.lineWidth = 0.8 * appliedDpr;
    context.shadowColor = 'rgba(215, 255, 67, .38)';
    context.shadowBlur = 10 * appliedDpr;
    context.beginPath();
    context.moveTo(x - echoWidth * 0.28, y - 13 * appliedDpr);
    context.lineTo(x + echoWidth * 0.28, y - 13 * appliedDpr);
    context.stroke();
    context.beginPath();
    context.arc(x - echoWidth * 0.32, y - 13 * appliedDpr, 1.8 * appliedDpr, 0, Math.PI * 2);
    context.fillStyle = '#d7ff43';
    context.fill();
    context.fillStyle = 'rgba(244, 240, 231, .94)';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `550 ${10.5 * appliedDpr}px "PingFang SC", system-ui, sans-serif`;
    lines.forEach((line, index) => {
      const lineOffset = index * 15 * appliedDpr;
      context.fillText(line, x, y + lineOffset);
    });
    context.restore();
  }

  function draw() {
    if (!context || !elements.canvas) return;
    const width = elements.canvas.width;
    const height = elements.canvas.height;
    context.clearRect(0, 0, width, height);
    for (const shard of shellShards) drawShellShard(shard, width, height);
    for (const entity of (state?.entities || []).slice(0, MAX_PEEL_ENTITIES)) drawProduct(entity, width, height);
    for (const card of revealCards) drawRevealCard(card, width, height);

    context.save();
    context.lineCap = 'round';
    for (const trail of trails) {
      context.beginPath();
      context.moveTo(trail.from.x * width, trail.from.y * height);
      context.lineTo(trail.to.x * width, trail.to.y * height);
      context.strokeStyle = 'rgba(215, 255, 67, .13)';
      context.lineWidth = 10 * appliedDpr;
      context.stroke();
      context.strokeStyle = 'rgba(244, 240, 231, .94)';
      context.lineWidth = 1.8 * appliedDpr;
      context.stroke();
    }
    for (const particle of particles) {
      context.beginPath();
      context.fillStyle = particle.color;
      context.arc(
        particle.x * width,
        particle.y * height,
        (particle.radius || 1.7) * appliedDpr,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    context.restore();
  }

  function addPeelFeedback(previousState, nextState, at) {
    const previousIds = new Set(previousState.reveals.map((reveal) => `${reveal.entityId}:${reveal.copyId}`));
    const fresh = nextState.reveals.filter((reveal) => !previousIds.has(`${reveal.entityId}:${reveal.copyId}`));
    for (const reveal of fresh) {
      const entity = previousState.entities.find((entry) => entry.id === reveal.entityId)
        || nextState.entities.find((entry) => entry.id === reveal.entityId);
      if (!entity) continue;
      revealCards.push({ x: entity.x, y: entity.y, text: reveal.text, bornAt: at });
      if (!motionIsReduced()) {
        const shellIndex = entity.shells.findIndex((shell) => shell.copy.id === reveal.copyId);
        const shellColor = shellIndex % 2 === 0
          ? 'rgba(215, 255, 67, .28)'
          : 'rgba(112, 231, 218, .24)';
        [-1, 1].forEach((side) => {
          shellShards.push({
            x: entity.x + side * 0.018,
            y: entity.y,
            vx: side * 0.035,
            vy: -0.065,
            rotation: side * 0.08,
            rotationVelocity: side * 0.12,
            bornAt: at,
            color: shellColor,
          });
        });
        for (let index = 0; index < 10; index += 1) {
          particles.push({
            x: entity.x,
            y: entity.y,
            vx: (index - 4.5) * 0.008,
            vy: -0.05 - (index % 3) * 0.012,
            bornAt: at,
            radius: index % 3 === 0 ? 2.1 : 1.35,
            color: index % 2 ? 'rgba(215, 255, 67, .86)' : 'rgba(244, 240, 231, .7)',
          });
        }
      }
      if (elements.liveStatus) {
        elements.liveStatus.textContent = `已识别“${reveal.lure}”。降噪提示：${reveal.text}。商品完整保留。`;
      }
    }
    particles = particles.slice(-MAX_PEEL_PARTICLES);
    shellShards = shellShards.slice(-MAX_PEEL_SHARDS);
    revealCards = revealCards.slice(-MAX_PEEL_REVEAL_CARDS);
  }

  function updateEffects(deltaMs, at) {
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
    shellShards = shellShards
      .filter((shard) => at - shard.bornAt < 560)
      .map((shard) => ({
        ...shard,
        x: shard.x + shard.vx * delta * 60,
        y: shard.y + shard.vy * delta * 60,
        vy: shard.vy + 0.008 * delta * 60,
        rotation: shard.rotation + shard.rotationVelocity * delta * 60,
      }))
      .slice(-MAX_PEEL_SHARDS);
    revealCards = revealCards
      .filter((card) => at - card.bornAt < 1_250)
      .slice(-MAX_PEEL_REVEAL_CARDS);
    trails = trails.filter((trail) => at - trail.at < 130).slice(-8);
  }

  function updateGestureBlade(deltaMs) {
    if (inputMode !== 'gesture' || !gestureBladeTarget || deltaMs <= 0) return;
    const alpha = 1 - Math.exp(-Math.min(deltaMs, 80) / 42);
    bladePoint = {
      x: bladePoint.x + (gestureBladeTarget.x - bladePoint.x) * alpha,
      y: bladePoint.y + (gestureBladeTarget.y - bladePoint.y) * alpha,
    };
    if (lineDistance(bladePoint, gestureBladeTarget) < 0.0005) {
      bladePoint = { ...gestureBladeTarget };
    }
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
    const choices = [...uniqueReveals(summary.reveals).slice(0, 5), NO_FEELING_CHOICE];
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
    if (destroyed || ![PEEL_GAME_STATUS.TUTORIAL, PEEL_GAME_STATUS.PLAYING].includes(state?.status)) return;
    const deltaMs = lastFrameAt === null ? 0 : Math.max(0, timestamp - lastFrameAt);
    lastFrameAt = timestamp;
    state = advanceRound(state, deltaMs);
    updateEffects(deltaMs, timestamp);
    updateGestureBlade(deltaMs);
    renderState();
    draw();
    emitState();
    if (state.status === PEEL_GAME_STATUS.SUMMARY) finishSummary();
    else if (state.status !== PEEL_GAME_STATUS.TUTORIAL || state.entities.some((entity) => !entity.frozen)) scheduleLoop();
  }

  function scheduleLoop() {
    if (
      rafId !== null
      || ![PEEL_GAME_STATUS.TUTORIAL, PEEL_GAME_STATUS.PLAYING].includes(state?.status)
      || destroyed
    ) return;
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
    bladePoint = { x: 0.5, y: 0.5 };
    gestureBladeTarget = null;
    onInputMode(inputMode);
    state = startRound(state);
    showPlayView();
    resizeCanvas();
    renderState();
    draw();
    emitState();
    scheduleLoop();
    elements.stage?.focus?.();
    return state;
  }

  function applySegment(segment) {
    if (!state) return state;
    const at = Number.isFinite(Number(segment?.at)) ? Number(segment.at) : now();
    const normalizedSegment = { ...segment, at };
    if (
      inputMode === 'gesture'
      && Number.isFinite(Number(normalizedSegment.to?.x))
      && Number.isFinite(Number(normalizedSegment.to?.y))
    ) {
      gestureBladeTarget = {
        x: clamp(Number(normalizedSegment.to.x), 0, 1),
        y: clamp(Number(normalizedSegment.to.y), 0, 1),
      };
    }
    const previousState = state;
    state = applyPeelSegment(state, normalizedSegment);
    trails.push({ ...normalizedSegment, at });
    trails = trails.slice(-8);
    addPeelFeedback(previousState, state, at);
    if (previousState.status === PEEL_GAME_STATUS.TUTORIAL && state.status === PEEL_GAME_STATUS.PLAYING) {
      tutorialSeen = true;
      lastFrameAt = null;
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
    lastFrameAt = null;
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
    shellShards = [];
    revealCards = [];
    trails = [];
    targetIndex = 0;
    bladePoint = { x: 0.5, y: 0.5 };
    gestureBladeTarget = null;
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
    shellShards = [];
    revealCards = [];
    trails = [];
    gestureBladeTarget = null;
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
      shellShards: shellShards.length,
      revealCards: revealCards.length,
      rafActive: rafId !== null,
      listeners: cleanupListeners.length,
    }),
  };
  CONTROLLERS.set(root, controller);
  return controller;
}
