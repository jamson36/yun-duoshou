import { selectShellSequence } from './peel-copy-catalog.js';

export const PEEL_GAME_VERSION = 'peel-v1';

export const PEEL_GAME_STATUS = Object.freeze({
  READY: 'ready',
  TUTORIAL: 'tutorial',
  PLAYING: 'playing',
  PAUSED: 'paused',
  SUMMARY: 'summary',
  CLOSED: 'closed',
});

export const PRODUCT_CATALOG = Object.freeze([
  Object.freeze({ id: 'milk-tea', name: '奶茶', category: 'food', glyph: '🧋', source: 'catalog' }),
  Object.freeze({ id: 'cold-brew', name: '冷萃咖啡', category: 'food', glyph: '☕', source: 'catalog' }),
  Object.freeze({ id: 'sparkling-drink', name: '气泡饮', category: 'food', glyph: '🥤', source: 'catalog' }),
  Object.freeze({ id: 'headphones', name: '降噪耳机', category: 'digital', glyph: '🎧', source: 'catalog' }),
  Object.freeze({ id: 'keyboard', name: '机械键盘', category: 'digital', glyph: '⌨️', source: 'catalog' }),
  Object.freeze({ id: 'camera', name: '随身相机', category: 'digital', glyph: '📷', source: 'catalog' }),
  Object.freeze({ id: 'sneakers', name: '复古跑鞋', category: 'fashion', glyph: '👟', source: 'catalog' }),
  Object.freeze({ id: 'shoulder-bag', name: '通勤小包', category: 'fashion', glyph: '👜', source: 'catalog' }),
  Object.freeze({ id: 'blind-box', name: '收藏盲盒', category: 'interest', glyph: '📦', source: 'catalog' }),
  Object.freeze({ id: 'aroma-candle', name: '香氛蜡烛', category: 'home', glyph: '🕯️', source: 'catalog' }),
  Object.freeze({ id: 'camping-lamp', name: '露营灯', category: 'interest', glyph: '🏮', source: 'catalog' }),
]);

const TUTORIAL_COPY = Object.freeze({
  id: 'tutorial-01',
  family: 'tutorial',
  lure: '限时',
  reveal: '倒计时不替我做决定',
  tone: 'gentle',
  intensity: 1,
  isFictionalClaim: true,
  version: PEEL_GAME_VERSION,
});

const GAME_DURATION_MS = 45_000;
const MIXED_PHASE_START_MS = 20_000;
const FOCUS_PHASE_START_MS = 38_000;
const SPAWN_INTERVAL_MS = 1_150;
const GRAVITY = 1.9;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function unitFromSeed(seed) {
  return stableHash(seed) / 0xffffffff;
}

function normalizedCategory(value) {
  const category = String(value || '').trim().toLowerCase();
  return ['food', 'digital', 'fashion', 'interest', 'home'].includes(category)
    ? category
    : 'interest';
}

function structuredTriggersFromOrder(order) {
  const candidates = order?.structuredTriggers
    || order?.decisionSignals
    || order?.triggerReasons
    || [];
  return Array.isArray(candidates)
    ? candidates.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
}

function orderTimestamp(order) {
  const parsed = Date.parse(order?.updatedAt || order?.createdAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

export function selectFocusItem({ orders = [], seed = 'peel-focus' } = {}) {
  const coolingOrders = (Array.isArray(orders) ? orders : [])
    .filter((order) => order?.status === 'cooling' && order?.demo !== true)
    .sort((left, right) => orderTimestamp(right) - orderTimestamp(left));
  const order = coolingOrders[0];
  if (order) {
    const amount = Number(order.amount);
    return Object.freeze({
      id: `order-${String(order.id)}`,
      orderId: String(order.id),
      name: String(order.name || order.productName || '这件想买的东西'),
      category: normalizedCategory(order.category),
      glyph: '📦',
      source: 'order',
      structuredTriggers: Object.freeze(structuredTriggersFromOrder(order)),
      ...(Number.isFinite(amount) && amount > 0 ? { amount } : {}),
    });
  }

  return PRODUCT_CATALOG[stableHash(`${seed}:fallback`) % PRODUCT_CATALOG.length];
}

export function phaseForElapsed(elapsedMs) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  if (elapsed >= GAME_DURATION_MS) return 'complete';
  if (elapsed >= FOCUS_PHASE_START_MS) return 'focus';
  if (elapsed >= MIXED_PHASE_START_MS) return 'mixed';
  return 'single';
}

function baseScore() {
  return {
    peeledShells: 0,
    revealedProducts: 0,
    missedProducts: 0,
  };
}

export function createPeelGame({
  seed = 'peel-round',
  tutorialCompleted = false,
  orders = [],
  reducedMotion = false,
} = {}) {
  return {
    version: PEEL_GAME_VERSION,
    status: PEEL_GAME_STATUS.READY,
    seed: String(seed),
    durationMs: GAME_DURATION_MS,
    elapsedMs: 0,
    tutorialCompleted: Boolean(tutorialCompleted),
    reducedMotion: Boolean(reducedMotion),
    entities: [],
    reveals: [],
    copyHistory: [],
    productHistory: [],
    nextEntityOrdinal: 0,
    spawnAccumulatorMs: 0,
    focusSpawned: false,
    focusItem: selectFocusItem({ orders, seed }),
    pausedFrom: null,
    score: baseScore(),
    summary: null,
  };
}

function selectCatalogItem(state, ordinal) {
  const recent = state.productHistory.slice(-2)
    .map((id) => PRODUCT_CATALOG.find((item) => item.id === id)?.category)
    .filter(Boolean);
  const repeatedCategory = recent.length === 2 && recent[0] === recent[1]
    ? recent[0]
    : null;
  const candidates = PRODUCT_CATALOG.filter((item) => item.category !== repeatedCategory);
  return candidates[stableHash(`${state.seed}:product:${ordinal}`) % candidates.length];
}

function makeShells(copies) {
  return copies.map((copy) => ({ copy, peeled: false }));
}

function createEntity(state, { item, phase, tutorial = false }) {
  const ordinal = state.nextEntityOrdinal;
  const entitySeed = `${state.seed}:entity:${ordinal}`;
  const copies = tutorial
    ? [TUTORIAL_COPY]
    : selectShellSequence({
      seed: entitySeed,
      phase,
      history: state.copyHistory,
      item,
    });
  const x = tutorial ? 0.5 : 0.18 + unitFromSeed(`${entitySeed}:x`) * 0.64;
  const horizontalDirection = unitFromSeed(`${entitySeed}:direction`) > 0.5 ? 1 : -1;
  const reducedMotion = state.reducedMotion && !tutorial;

  return {
    id: `peel-entity-${ordinal}`,
    item,
    x,
    y: tutorial ? 0.46 : reducedMotion ? 1.02 : 1.08,
    vx: tutorial || reducedMotion ? 0 : horizontalDirection * (0.04 + unitFromSeed(`${entitySeed}:vx`) * 0.13),
    vy: tutorial ? 0 : reducedMotion ? -0.42 : -(1.72 + unitFromSeed(`${entitySeed}:vy`) * 0.28),
    gravity: tutorial ? 0 : reducedMotion ? 0.36 : GRAVITY,
    rotation: unitFromSeed(`${entitySeed}:rotation`) * Math.PI * 2,
    rotationVelocity: tutorial || reducedMotion ? 0 : (unitFromSeed(`${entitySeed}:spin`) - 0.5) * 2.2,
    radius: tutorial ? 0.12 : phase === 'focus' ? 0.115 : 0.082,
    shells: makeShells(copies),
    coreRevealed: false,
    frozen: tutorial,
    phase,
  };
}

function appendEntity(state, item, phase, { tutorial = false } = {}) {
  const entity = createEntity(state, { item, phase, tutorial });
  const overflow = state.entities.length >= 8 ? state.entities[0] : null;
  const entities = overflow ? state.entities.slice(1) : state.entities;
  return {
    ...state,
    entities: [...entities, entity],
    copyHistory: tutorial
      ? state.copyHistory
      : [...state.copyHistory, ...entity.shells.map((shell) => shell.copy.id)],
    productHistory: tutorial
      ? state.productHistory
      : [...state.productHistory, item.id],
    nextEntityOrdinal: state.nextEntityOrdinal + 1,
    score: overflow && !overflow.coreRevealed
      ? { ...state.score, missedProducts: state.score.missedProducts + 1 }
      : state.score,
  };
}

export function startRound(state) {
  if (!state || state.status !== PEEL_GAME_STATUS.READY) return state;
  const reset = {
    ...state,
    status: state.tutorialCompleted ? PEEL_GAME_STATUS.PLAYING : PEEL_GAME_STATUS.TUTORIAL,
    elapsedMs: 0,
    entities: [],
    reveals: [],
    copyHistory: [],
    productHistory: [],
    nextEntityOrdinal: 0,
    spawnAccumulatorMs: 0,
    focusSpawned: false,
    pausedFrom: null,
    score: baseScore(),
    summary: null,
  };
  if (!state.tutorialCompleted) {
    const tutorialItem = PRODUCT_CATALOG.find((item) => item.id === 'milk-tea');
    return appendEntity(reset, tutorialItem, 'tutorial', { tutorial: true });
  }
  return appendEntity(reset, selectCatalogItem(reset, 0), 'single');
}

function pointToSegmentDistance(point, from, to) {
  const segmentX = to.x - from.x;
  const segmentY = to.y - from.y;
  const lengthSquared = segmentX ** 2 + segmentY ** 2;
  if (lengthSquared <= Number.EPSILON) return Math.hypot(point.x - from.x, point.y - from.y);
  const amount = clamp(
    ((point.x - from.x) * segmentX + (point.y - from.y) * segmentY) / lengthSquared,
    0,
    1,
  );
  return Math.hypot(
    point.x - (from.x + segmentX * amount),
    point.y - (from.y + segmentY * amount),
  );
}

function validPoint(point) {
  return Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y));
}

export function applyPeelSegment(state, { from, to, at } = {}) {
  if (![PEEL_GAME_STATUS.TUTORIAL, PEEL_GAME_STATUS.PLAYING].includes(state?.status)) return state;
  if (!validPoint(from) || !validPoint(to)) return state;

  let peeledShells = 0;
  let revealedProducts = 0;
  const reveals = [];
  const segmentAt = Number(at);
  const hasSegmentTime = Number.isFinite(segmentAt);
  const entities = state.entities.map((entity) => {
    if (entity.coreRevealed || pointToSegmentDistance(entity, from, to) > entity.radius) return entity;
    if (hasSegmentTime && Number.isFinite(entity.lastHitAt) && segmentAt - entity.lastHitAt < 120) return entity;
    const shellIndex = entity.shells.findIndex((shell) => !shell.peeled);
    if (shellIndex < 0) return entity;

    const shells = entity.shells.map((shell, index) => (
      index === shellIndex ? { ...shell, peeled: true } : shell
    ));
    const coreRevealed = shells.every((shell) => shell.peeled);
    peeledShells += 1;
    if (coreRevealed) revealedProducts += 1;
    reveals.push({
      entityId: entity.id,
      copyId: shells[shellIndex].copy.id,
      lure: shells[shellIndex].copy.lure,
      text: shells[shellIndex].copy.reveal,
      family: shells[shellIndex].copy.family,
      atMs: state.elapsedMs,
    });
    return { ...entity, shells, coreRevealed, ...(hasSegmentTime ? { lastHitAt: segmentAt } : {}) };
  });

  if (!peeledShells) return state;

  if (state.status === PEEL_GAME_STATUS.TUTORIAL && revealedProducts > 0) {
    return {
      ...state,
      status: PEEL_GAME_STATUS.PLAYING,
      tutorialCompleted: true,
      entities: [],
      reveals: [],
      copyHistory: [],
      productHistory: [],
      nextEntityOrdinal: 0,
      spawnAccumulatorMs: 0,
      score: baseScore(),
    };
  }

  return {
    ...state,
    entities,
    reveals: [...state.reveals, ...reveals],
    score: {
      ...state.score,
      peeledShells: state.score.peeledShells + peeledShells,
      revealedProducts: state.score.revealedProducts + revealedProducts,
    },
  };
}

export function skipTutorial(state) {
  if (!state || state.status !== PEEL_GAME_STATUS.TUTORIAL) return state;
  return {
    ...state,
    status: PEEL_GAME_STATUS.PLAYING,
    tutorialCompleted: true,
    elapsedMs: 0,
    entities: [],
    reveals: [],
    copyHistory: [],
    productHistory: [],
    nextEntityOrdinal: 0,
    spawnAccumulatorMs: 0,
    score: baseScore(),
  };
}

function updateEntities(entities, deltaSeconds) {
  let missedProducts = 0;
  const nextEntities = [];
  for (const entity of entities) {
    if (entity.frozen) {
      nextEntities.push(entity);
      continue;
    }
    const next = {
      ...entity,
      x: entity.x + entity.vx * deltaSeconds,
      y: entity.y + entity.vy * deltaSeconds + 0.5 * entity.gravity * deltaSeconds ** 2,
      vy: entity.vy + entity.gravity * deltaSeconds,
      rotation: entity.rotation + entity.rotationVelocity * deltaSeconds,
    };
    if (next.y - next.radius > 1.3 && next.vy > 0) {
      if (!next.coreRevealed) missedProducts += 1;
    } else {
      nextEntities.push(next);
    }
  }
  return { entities: nextEntities, missedProducts };
}

export function summarizeRound(state) {
  return Object.freeze({
    version: PEEL_GAME_VERSION,
    durationMs: GAME_DURATION_MS,
    peeledShells: state.score.peeledShells,
    revealedProducts: state.score.revealedProducts,
    missedProducts: state.score.missedProducts,
    missesArePenalized: false,
    leaderboard: null,
    reward: null,
    focusItem: state.focusItem,
    reveals: Object.freeze([...state.reveals]),
  });
}

export function advanceRound(state, deltaMs = 0) {
  if (!state || state.status !== PEEL_GAME_STATUS.PLAYING) return state;
  const safeDeltaMs = Math.max(0, Number(deltaMs) || 0);
  if (safeDeltaMs === 0) return state;

  const elapsedMs = Math.min(GAME_DURATION_MS, state.elapsedMs + safeDeltaMs);
  const physicsDeltaSeconds = Math.min(safeDeltaMs, 500) / 1_000;
  const physics = updateEntities(state.entities, physicsDeltaSeconds);
  let next = {
    ...state,
    elapsedMs,
    entities: physics.entities,
    score: {
      ...state.score,
      missedProducts: state.score.missedProducts + physics.missedProducts,
    },
  };

  if (elapsedMs >= GAME_DURATION_MS) {
    next = { ...next, status: PEEL_GAME_STATUS.SUMMARY };
    return { ...next, summary: summarizeRound(next) };
  }

  const previousPhase = phaseForElapsed(state.elapsedMs);
  const phase = phaseForElapsed(elapsedMs);
  if (phase === 'focus') {
    if (!next.focusSpawned || previousPhase !== 'focus') {
      next = appendEntity(next, next.focusItem, 'focus');
      next = { ...next, focusSpawned: true, spawnAccumulatorMs: 0 };
    }
    return next;
  }

  let accumulator = state.spawnAccumulatorMs + safeDeltaMs;
  let spawnCount = Math.floor(accumulator / SPAWN_INTERVAL_MS);
  accumulator %= SPAWN_INTERVAL_MS;
  spawnCount = Math.min(spawnCount, 3);
  next = { ...next, spawnAccumulatorMs: accumulator };
  for (let index = 0; index < spawnCount; index += 1) {
    const item = selectCatalogItem(next, next.nextEntityOrdinal);
    next = appendEntity(next, item, phase);
  }
  return next;
}

export function pauseRound(state) {
  if (!state || ![PEEL_GAME_STATUS.PLAYING, PEEL_GAME_STATUS.TUTORIAL].includes(state.status)) return state;
  return { ...state, status: PEEL_GAME_STATUS.PAUSED, pausedFrom: state.status };
}

export function resumeRound(state) {
  if (!state || state.status !== PEEL_GAME_STATUS.PAUSED) return state;
  return {
    ...state,
    status: state.pausedFrom === PEEL_GAME_STATUS.TUTORIAL
      ? PEEL_GAME_STATUS.TUTORIAL
      : PEEL_GAME_STATUS.PLAYING,
    pausedFrom: null,
  };
}
