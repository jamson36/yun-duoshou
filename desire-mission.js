export const MISSION_VERSION = 'headphones-1';
export const MISSION_STEPS = Object.freeze(['track', 'peel', 'trial', 'deliver', 'review', 'done']);
export const TRACK_NODES = Object.freeze([
  Object.freeze({ x: 0, z: 8, label: '掌机入口' }),
  Object.freeze({ x: 0, z: 2, label: '追上广告无人机' }),
  Object.freeze({ x: -1.5, z: -5, label: '沿光路进入声巷' }),
  Object.freeze({ x: 0, z: -11, label: '靠近耳机信号源' }),
]);
export const MISSION_WALK_BOUNDS = Object.freeze({ minX: -2.55, maxX: 2.55, minZ: -11.2, maxZ: 11 });
export const MISSION_WALK_SPEED = 4.8;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value) => Number.isFinite(value) ? value : 0;

export function missionMovementInput(codes) {
  const held = new Set(codes);
  return {
    strafe: Number(held.has('KeyD') || held.has('ArrowRight')) - Number(held.has('KeyA') || held.has('ArrowLeft')),
    forward: Number(held.has('KeyW') || held.has('ArrowUp')) - Number(held.has('KeyS') || held.has('ArrowDown')),
  };
}

// Motion is camera-relative, normalized diagonally and bounded to the clear street.
export function stepMissionMovement(position, input, yaw, deltaSeconds) {
  const strafe = clamp(finite(input?.strafe), -1, 1), forward = clamp(finite(input?.forward), -1, 1);
  const divisor = Math.max(1, Math.hypot(strafe, forward));
  const distance = MISSION_WALK_SPEED * clamp(finite(deltaSeconds), 0, 0.06) / divisor;
  const angle = finite(yaw);
  const x = clamp(finite(position?.x) + (strafe * Math.cos(angle) - forward * Math.sin(angle)) * distance,
    MISSION_WALK_BOUNDS.minX, MISSION_WALK_BOUNDS.maxX);
  let z = clamp(finite(position?.z) - (forward * Math.cos(angle) + strafe * Math.sin(angle)) * distance,
    MISSION_WALK_BOUNDS.minZ, MISSION_WALK_BOUNDS.maxZ);
  // Keep the probe clear of the two signal-gate posts at the end of the street.
  if (Math.abs(x) > 1.9) z = Math.max(z, -10.8);
  return { x, z };
}

export function reachableMissionNode(state, position) {
  if (state?.phase !== 'track' || state.destination !== null || state.node >= TRACK_NODES.length - 1
    || !Number.isFinite(position?.x) || !Number.isFinite(position?.z)) return null;
  const next = TRACK_NODES[state.node + 1];
  return Math.hypot(position.x - next.x, position.z - next.z) <= 1.35 ? state.node + 1 : null;
}
export const MISSION_PRODUCT = Object.freeze({
  id: 'headphones', commerceProductId: 'shop-headphones', name: '无线降噪耳机 Air',
  amount: 1299, category: '数码家居',
  image: './assets/figma-commerce-20260901/shop-30-977/raw-image-12.jpeg',
});
export const MISSION_SHELLS = Object.freeze([
  Object.freeze({ id: 'urgency', label: '最后一波优惠', detail: '现在不买，就错过了？', direction: -1 }),
  Object.freeze({ id: 'social', label: '大家都在买', detail: '热闹，是别人的声音。', direction: 1 }),
]);
export const TRIAL_TARGETS = Object.freeze({
  week: Object.freeze(['day-1', 'day-2', 'day-3', 'day-4', 'day-5', 'day-6', 'day-7', 'unsure']),
  alternatives: Object.freeze(['have', 'different', 'unsure']),
  balance: Object.freeze(['goal', 'item', 'unsure']),
});

export function selectMissionProduct(orders = []) {
  const existing = (Array.isArray(orders) ? orders : [])
    .filter((order) => order && !order.demo && order.status === 'cooling'
      && /耳机|headphones?/i.test(String(order.name))
      && Number.isFinite(Number(order.amount)) && Number(order.amount) > 0)
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))[0];
  return existing ? { ...MISSION_PRODUCT, name: existing.name, amount: Number(existing.amount),
    category: existing.category, source: 'order', orderId: existing.id } : { ...MISSION_PRODUCT, source: 'sample' };
}

export function createMissionState({ orders = [], persisted = true } = {}) {
  const product = selectMissionProduct(orders);
  return { version: MISSION_VERSION, phase: product.source === 'order' ? 'done' : 'track',
    node: 0, destination: null, removed: [], trial: 'week', answers: {}, product,
    savedOrderId: product.orderId || null, persisted: persisted !== false };
}

export function transitionMission(state, action = {}) {
  if (!state || !MISSION_STEPS.includes(state.phase)) return state;
  if (action.type === 'replay' && state.phase === 'done') {
    return { ...state, phase: 'track', node: 0, destination: null, removed: [], answers: {}, trial: 'week' };
  }
  if (action.type === 'walk' && state.phase === 'track' && state.destination === null && state.node < 3) {
    return { ...state, destination: state.node + 1 };
  }
  if (action.type === 'steer' && state.phase === 'track' && state.destination !== null) {
    return { ...state, destination: null };
  }
  if (action.type === 'approach') {
    const node = reachableMissionNode(state, action.position);
    if (node !== null) return { ...state, node, phase: node === 3 ? 'peel' : 'track' };
  }
  if (action.type === 'arrive' && state.phase === 'track' && state.destination !== null
    && action.node === state.destination) {
    return { ...state, node: action.node, destination: null, phase: action.node === 3 ? 'peel' : 'track' };
  }
  if (action.type === 'remove-shell' && state.phase === 'peel'
    && MISSION_SHELLS.some((shell) => shell.id === action.id) && !state.removed.includes(action.id)) {
    const removed = [...state.removed, action.id];
    return { ...state, removed, phase: removed.length === MISSION_SHELLS.length ? 'trial' : 'peel' };
  }
  if (action.type === 'trial' && state.phase === 'trial' && Object.hasOwn(TRIAL_TARGETS, action.id)) {
    return { ...state, trial: action.id };
  }
  if (action.type === 'place' && state.phase === 'trial' && TRIAL_TARGETS[state.trial]?.includes(action.target)) {
    return { ...state, answers: { ...state.answers, [state.trial]: action.target } };
  }
  if (action.type === 'finish-trial' && state.phase === 'trial' && Object.keys(state.answers).length) {
    return { ...state, phase: 'deliver' };
  }
  if (action.type === 'push' && state.phase === 'deliver') return { ...state, phase: 'review' };
  if (action.type === 'back' && state.phase === 'review') return { ...state, phase: 'deliver' };
  if (action.type === 'saved' && state.phase === 'review' && action.order?.id && action.order.status === 'cooling') {
    return { ...state, phase: 'done', savedOrderId: action.order.id, persisted: action.persisted !== false,
      product: { ...state.product, source: 'order', orderId: action.order.id, name: action.order.name,
        amount: action.order.amount, category: action.order.category } };
  }
  return state;
}

// A cancelled/short drag never changes task state. Units are CSS pixels.
export function shellDragCompleted({ dx, dy, cancelled = false } = {}) {
  return !cancelled && Number.isFinite(dx) && Number.isFinite(dy) && Math.hypot(dx, dy) >= 76;
}
export function pointInside({ x, y } = {}, rect) {
  return Boolean(rect) && Number.isFinite(x) && Number.isFinite(y)
    && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function validateMissionDraft(draft = {}) {
  const name = String(draft.name || '').trim().slice(0, 80);
  const raw = String(draft.amount ?? '').trim();
  const amount = Number(raw);
  if (!name) return { error: '写下你想买的商品名称。' };
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || !Number.isFinite(amount) || amount <= 0 || amount > 99999999.99) {
    return { error: '请输入大于 0 的金额，最多两位小数。' };
  }
  return { name, amount };
}

export function matchingMissionOrder(orders, draft) {
  return (Array.isArray(orders) ? orders : []).find((order) => !order.demo && order.status === 'cooling'
    && String(order.name).trim() === draft.name && Number(order.amount) === draft.amount) || null;
}

// Camera frames are interpreted as a pointer, never as permission to save an order.
export function createMissionGestureMapper() {
  let held = false, lastSeen = null, lastPoint = null;
  return {
    reset() { held = false; lastSeen = null; lastPoint = null; },
    update(frame, at = 0) {
      const finger = frame?.landmarks?.[8], thumb = frame?.landmarks?.[4];
      if (!finger || !Number.isFinite(finger.x) || !Number.isFinite(finger.y) || !(frame.score >= 0.68)) {
        if (lastSeen !== null && at - lastSeen > 650) {
          held = false; lastSeen = null; return { type: 'lost' };
        }
        return null;
      }
      lastSeen = at;
      const raw = { x: Math.max(0, Math.min(1, 1 - finger.x)), y: Math.max(0, Math.min(1, finger.y)) };
      const point = lastPoint ? { x: lastPoint.x * 0.45 + raw.x * 0.55, y: lastPoint.y * 0.45 + raw.y * 0.55 } : raw;
      lastPoint = point;
      const gap = thumb && Number.isFinite(thumb.x) && Number.isFinite(thumb.y)
        ? Math.hypot(finger.x - thumb.x, finger.y - thumb.y) : Infinity;
      const pinch = gap < (held ? 0.09 : 0.055) || String(frame.gesture).toLowerCase() === 'closed_fist';
      const type = pinch && !held ? 'grab' : !pinch && held ? 'release' : 'move';
      held = pinch;
      return { type, point, held };
    },
  };
}
