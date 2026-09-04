import { createObservatoryScene } from './desire-observatory-scene.js?v=20260904-night-window-5';

export const MAX_OBSERVATORY_DPR = 1.6;
export const MAX_OBSERVATORY_VISIBLE_PRODUCTS = 3;

const TAU = Math.PI * 2;
const CONTROLLERS = new WeakMap();

const SIGNAL_LIBRARY = Object.freeze({
  urgency: Object.freeze({ id: 'urgency', label: '今晚恢复', code: 'TIME' }),
  social: Object.freeze({ id: 'social', label: '都在抢', code: 'CROWD' }),
  bundle: Object.freeze({ id: 'bundle', label: '凑单更值', code: 'BUNDLE' }),
  installment: Object.freeze({ id: 'installment', label: '每天几块', code: 'SPLIT' }),
  upgrade: Object.freeze({ id: 'upgrade', label: '一步到位', code: 'UPGRADE' }),
  reward: Object.freeze({ id: 'reward', label: '辛苦奖励', code: 'REWARD' }),
  scarcity: Object.freeze({ id: 'scarcity', label: '只剩几件', code: 'STOCK' }),
  collection: Object.freeze({ id: 'collection', label: '就差这一只', code: 'SERIES' }),
  productivity: Object.freeze({ id: 'productivity', label: '效率装备', code: 'OUTPUT' }),
});

export const OBSERVATORY_PRODUCTS = Object.freeze([
  Object.freeze({
    id: 'headphones',
    commerceProductId: 'shop-headphones',
    name: '无线降噪耳机 Air',
    amount: 1299,
    category: '数码家居',
    image: './assets/figma-commerce-20260901/shop-30-977/raw-image-12.jpeg',
    model: 'headphones',
    code: 'AUDIO / 01',
    accent: Object.freeze([0.84, 1, 0.25]),
    signals: Object.freeze(['installment', 'social', 'upgrade']),
  }),
  Object.freeze({
    id: 'milk-tea',
    commerceProductId: 'food-milktea',
    name: '芝士芋泥啵啵奶茶',
    amount: 22,
    category: '餐饮饮品',
    image: './assets/figma-commerce-20260901/food-30-1334/product-milk-tea.jpg',
    model: 'milk-tea',
    code: 'DRINK / 02',
    accent: Object.freeze([1, 0.44, 0.19]),
    signals: Object.freeze(['reward', 'bundle', 'urgency']),
  }),
  Object.freeze({
    id: 'keyboard',
    commerceProductId: 'shop-keyboard',
    name: '客制化机械键盘',
    amount: 899,
    category: '数码家居',
    image: './assets/figma-commerce-20260901/shop-30-977/raw-image-03.jpeg',
    model: 'keyboard',
    code: 'DESK / 03',
    accent: Object.freeze([0.44, 0.91, 0.86]),
    signals: Object.freeze(['productivity', 'upgrade', 'urgency']),
  }),
  Object.freeze({
    id: 'sneakers',
    commerceProductId: 'shop-shoes',
    name: '城市跑步鞋 Flow',
    amount: 599,
    category: '服饰美妆',
    image: './assets/figma-commerce-20260901/shop-30-977/raw-image-02.jpeg',
    model: 'sneakers',
    code: 'MOVE / 04',
    accent: Object.freeze([1, 0.76, 0.28]),
    signals: Object.freeze(['upgrade', 'social', 'urgency']),
  }),
  Object.freeze({
    id: 'camera',
    commerceProductId: 'shop-camera',
    name: '复古胶片相机',
    amount: 2380,
    category: '数码家居',
    image: './assets/figma-commerce-20260901/shop-30-977/raw-image-16.jpeg',
    model: 'camera',
    code: 'IMAGE / 05',
    accent: Object.freeze([1, 0.38, 0.2]),
    signals: Object.freeze(['installment', 'productivity', 'social']),
  }),
  Object.freeze({
    id: 'blind-box',
    commerceProductId: 'shop-blindbox',
    name: '盲盒潮玩 · 星际系列',
    amount: 239,
    category: '娱乐社交',
    image: './assets/figma-commerce-20260901/shop-30-977/raw-image-14.jpeg',
    model: 'blind-box',
    code: 'SERIES / 06',
    accent: Object.freeze([0.84, 1, 0.25]),
    signals: Object.freeze(['collection', 'scarcity', 'social']),
  }),
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function formatCny(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return '¥0';
  return `¥${value.toLocaleString('zh-CN', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizedName(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN');
}

export function modelForOrder(order = {}) {
  const source = `${order.name || ''} ${order.category || ''}`.toLocaleLowerCase('zh-CN');
  if (/耳机|headphone|音响|audio/.test(source)) return 'headphones';
  if (/奶茶|咖啡|饮品|饮料|tea|coffee/.test(source)) return 'milk-tea';
  if (/键盘|电脑|数码|电子|keyboard/.test(source)) return 'keyboard';
  if (/鞋|跑步|运动|sneaker|shoe/.test(source)) return 'sneakers';
  if (/相机|摄影|camera/.test(source)) return 'camera';
  if (/盲盒|潮玩|手办|玩具|blind/.test(source)) return 'blind-box';
  return 'package';
}

function signalsForOrder(order = {}) {
  const candidates = [];
  const reason = String(order.reason || '');
  const decisions = Array.isArray(order.decisionSignals) ? order.decisionSignals : [];
  if (/限时|优惠|促销/.test(reason)) candidates.push('urgency');
  if (/种草|社交|朋友/.test(reason)) candidates.push('social');
  if (/提升|工作|学习/.test(reason)) candidates.push('productivity');
  if (/情绪|奖励|无聊|嘴馋/.test(reason)) candidates.push('reward');
  decisions.forEach((decision) => {
    const key = String(decision || '').toLowerCase();
    if (/deal|coupon|discount|wait/.test(key)) candidates.push('urgency');
    if (/compare|research/.test(key)) candidates.push('upgrade');
    if (/social|ask/.test(key)) candidates.push('social');
  });
  const fallback = ['urgency', 'social', 'bundle'];
  return [...new Set([...candidates, ...fallback])].slice(0, 3);
}

function productFromOrder(order) {
  const normalized = normalizedName(order.name);
  const preset = OBSERVATORY_PRODUCTS.find((product) => normalizedName(product.name) === normalized);
  const model = preset?.model || modelForOrder(order);
  const visualPreset = OBSERVATORY_PRODUCTS.find((product) => product.model === model) || OBSERVATORY_PRODUCTS[0];
  return Object.freeze({
    id: preset?.id || `order-${String(order.id || stableHash(normalized)).replace(/[^a-zA-Z0-9_-]/g, '')}`,
    commerceProductId: preset?.commerceProductId || null,
    source: 'order',
    orderId: order.id,
    name: String(order.name || '未拆封的商品').trim() || '未拆封的商品',
    amount: Number(order.amount) || 0,
    category: String(order.category || '其他'),
    image: preset?.image || visualPreset?.image || '',
    model,
    code: preset?.code || 'YOUR ITEM / 00',
    accent: preset?.accent || Object.freeze([0.84, 1, 0.25]),
    signals: Object.freeze(signalsForOrder(order)),
  });
}

export function selectObservatoryProducts({ orders = [], seed = 'observatory' } = {}) {
  const coolingOrders = (Array.isArray(orders) ? orders : [])
    .filter((order) => order?.status === 'cooling' && !order.demo && String(order.name || '').trim())
    .sort((left, right) => {
      const leftAt = new Date(left.updatedAt || left.createdAt || 0).getTime() || 0;
      const rightAt = new Date(right.updatedAt || right.createdAt || 0).getTime() || 0;
      return rightAt - leftAt;
    });
  const offset = OBSERVATORY_PRODUCTS.length
    ? stableHash(seed) % OBSERVATORY_PRODUCTS.length
    : 0;
  const ordered = OBSERVATORY_PRODUCTS.map((_, index) => (
    OBSERVATORY_PRODUCTS[(index + offset) % OBSERVATORY_PRODUCTS.length]
  ));
  if (!coolingOrders.length) return ordered;

  const current = productFromOrder(coolingOrders[0]);
  return [
    current,
    ...ordered.filter((product) => normalizedName(product.name) !== normalizedName(current.name)),
  ].slice(0, OBSERVATORY_PRODUCTS.length + 1);
}

export function signalsForProduct(product = {}) {
  return (Array.isArray(product.signals) ? product.signals : [])
    .map((id) => SIGNAL_LIBRARY[id])
    .filter(Boolean)
    .slice(0, 3);
}

export function nextObservatoryIndex(index, direction, total) {
  const count = Math.max(0, Number(total) || 0);
  if (!count) return 0;
  const step = Number(direction) < 0 ? -1 : 1;
  return ((Number(index) || 0) + step + count) % count;
}

export function rotationDeltaForSegment(segment, { yaw = 4.6, pitch = 3.2 } = {}) {
  const fromX = Number(segment?.from?.x);
  const fromY = Number(segment?.from?.y);
  const toX = Number(segment?.to?.x);
  const toY = Number(segment?.to?.y);
  if (![fromX, fromY, toX, toY].every(Number.isFinite)) return { x: 0, y: 0 };
  return {
    x: clamp((toY - fromY) * pitch, -0.22, 0.22),
    y: clamp((toX - fromX) * yaw, -0.32, 0.32),
  };
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
    title: query('observatoryTitle'),
    stage: query('observatoryStage'),
    canvas: query('observatoryCanvas'),
    fallback: query('observatoryFallback'),
    fallbackImage: query('observatoryFallbackImage'),
    fallbackObject: query('observatoryFallbackObject'),
    productName: query('observatoryProductName'),
    productCategory: query('observatoryProductCategory'),
    productPrice: query('observatoryProductPrice'),
    productCode: query('observatoryProductCode'),
    productIndex: query('observatoryProductIndex'),
    previousButton: query('observatoryPreviousProduct'),
    nextButton: query('observatoryNextProduct'),
    gestureButton: query('observatoryGestureButton'),
    signals: query('observatorySignals'),
    signalCount: query('observatorySignalCount'),
    question: query('observatoryQuestion'),
    coolButton: query('observatoryCoolButton'),
    dismissButton: query('observatoryDismissButton'),
    liveStatus: query('observatoryLiveStatus'),
    pauseNotice: query('observatoryPauseNotice'),
    closeButtons: [...(root.querySelectorAll?.('[data-peel-close]') || [])],
  };
}

function visibleProductNumber(index, total) {
  return `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
}

export function createDesireObservatoryController({
  root,
  elements: providedElements,
  reducedMotion = false,
  onInputMode = () => true,
  onIntent = () => {},
  onClose = () => {},
  now = defaultNow,
  requestFrame = defaultRequestFrame,
  cancelFrame = defaultCancelFrame,
  devicePixelRatio = globalThis.devicePixelRatio || 1,
  documentRef = root?.ownerDocument || globalThis.document || null,
} = {}) {
  if (!root) throw new TypeError('欲望观察舱需要根节点');
  if (CONTROLLERS.has(root)) return CONTROLLERS.get(root);

  const elements = { ...queryElements(root), ...(providedElements || {}) };
  const cleanupListeners = [];
  let products = [...OBSERVATORY_PRODUCTS];
  let selectedIndex = 0;
  let dismissedSignalIds = new Set();
  let rotation = { x: -0.08, y: 0.5 };
  let targetRotation = { ...rotation };
  let inputMode = 'pointer';
  let opened = false;
  let destroyed = false;
  let pausedReason = null;
  let hiddenByDocument = Boolean(documentRef?.hidden);
  let renderer = null;
  let renderMode = 'pending';
  let quality = 'full';
  let lastFrameAt = null;
  let rafId = null;
  let pointer = null;
  let slowFrameDebt = 0;
  let lastDiagnostics = { drawCalls: 0, dpr: 1, quality };
  let resizeObserver = null;
  let switchTimer = null;

  const motionIsReduced = () => (
    typeof reducedMotion === 'function' ? Boolean(reducedMotion()) : Boolean(reducedMotion)
  );

  function listen(element, type, listener, options) {
    if (!element?.addEventListener) return;
    element.addEventListener(type, listener, options);
    cleanupListeners.push(() => element.removeEventListener(type, listener, options));
  }

  function currentProduct() {
    return products[selectedIndex] || products[0] || OBSERVATORY_PRODUCTS[0];
  }

  function setPortalOrigin(origin) {
    const x = Number(origin?.x);
    const y = Number(origin?.y);
    root.style?.setProperty?.('--observatory-origin-x', `${(clamp(Number.isFinite(x) ? x : 0.66, 0, 1) * 100).toFixed(2)}%`);
    root.style?.setProperty?.('--observatory-origin-y', `${(clamp(Number.isFinite(y) ? y : 0.58, 0, 1) * 100).toFixed(2)}%`);
  }

  function announce(message) {
    if (elements.liveStatus) elements.liveStatus.textContent = message;
  }

  function createSignalButton(signal, index) {
    if (!documentRef?.createElement) return null;
    const button = documentRef.createElement('button');
    const dismissed = dismissedSignalIds.has(signal.id);
    button.type = 'button';
    button.dataset.observatorySignal = signal.id;
    button.dataset.dismissed = String(dismissed);
    button.setAttribute('aria-pressed', String(dismissed));
    button.setAttribute('aria-label', dismissed ? `已关掉催促信号：${signal.label}` : `关掉催促信号：${signal.label}`);
    const number = documentRef.createElement('small');
    number.textContent = `0${index + 1}`;
    const label = documentRef.createElement('b');
    label.textContent = signal.label;
    const state = documentRef.createElement('span');
    state.textContent = dismissed ? '已安静' : signal.code;
    button.append(number, label, state);
    button.addEventListener('click', () => dismissSignal(signal.id));
    return button;
  }

  function renderSignals() {
    const signals = signalsForProduct(currentProduct());
    const buttons = signals.map(createSignalButton).filter(Boolean);
    elements.signals?.replaceChildren?.(...buttons);
    const remaining = signals.filter((signal) => !dismissedSignalIds.has(signal.id)).length;
    if (elements.signalCount) elements.signalCount.textContent = String(remaining);
    if (elements.question) elements.question.hidden = dismissedSignalIds.size < 2;
    if (root.dataset) root.dataset.calmLevel = String(Math.min(3, dismissedSignalIds.size));
  }

  function renderProduct({ announceSelection = false } = {}) {
    const product = currentProduct();
    if (elements.productName) elements.productName.textContent = product.name;
    if (elements.productCategory) elements.productCategory.textContent = product.category;
    if (elements.productPrice) elements.productPrice.textContent = formatCny(product.amount);
    if (elements.productCode) elements.productCode.textContent = product.code;
    if (elements.productIndex) elements.productIndex.textContent = visibleProductNumber(selectedIndex, products.length);
    if (elements.fallbackObject?.dataset) elements.fallbackObject.dataset.model = product.model;
    if (elements.fallbackObject) elements.fallbackObject.textContent = product.code.split('/')[0].trim();
    if (elements.fallbackImage) {
      elements.fallbackImage.src = product.image || '';
      elements.fallbackImage.alt = '';
    }
    if (root.style) {
      const accent = Array.isArray(product.accent) ? product.accent : [1, 0.43, 0.25];
      root.style.setProperty('--observatory-current-accent', `rgb(${accent.map((value) => Math.round(value * 255)).join(' ')})`);
    }
    if (elements.stage) elements.stage.setAttribute('aria-label', `查看${product.name}。拖动旋转，方向键切换或调整角度。`);
    if (elements.coolButton) {
      elements.coolButton.textContent = product.source === 'order' ? '查看这笔冷静单' : '放进冷静单';
    }
    renderSignals();
    if (announceSelection) announce(`正在观察${product.name}，${formatCny(product.amount)}。`);
  }

  function drawStaticFrame() {
    if (!renderer || renderMode !== 'webgl') return;
    lastDiagnostics = renderer.render({
      products,
      selectedIndex,
      rotationX: rotation.x,
      rotationY: rotation.y,
      dismissedCount: dismissedSignalIds.size,
      time: now(),
      reducedMotion: motionIsReduced(),
    });
  }

  function setRenderMode(nextMode) {
    renderMode = nextMode;
    if (root.dataset) root.dataset.renderMode = nextMode;
    if (elements.canvas) elements.canvas.hidden = nextMode !== 'webgl';
    if (elements.fallback) elements.fallback.hidden = nextMode === 'webgl';
  }

  function setQuality(nextQuality) {
    if (!['full', 'balanced', 'essential'].includes(nextQuality) || quality === nextQuality) return;
    quality = nextQuality;
    if (root.dataset) root.dataset.quality = nextQuality;
    renderer?.setQuality(nextQuality);
    renderer?.resize();
  }

  function updateQuality(deltaMs) {
    if (motionIsReduced()) {
      setQuality('essential');
      return;
    }
    if (!Number.isFinite(deltaMs) || deltaMs <= 0 || deltaMs > 180) return;
    slowFrameDebt = clamp(slowFrameDebt + (deltaMs > 28 ? 1.35 : -0.22), 0, 42);
    if (slowFrameDebt >= 28) setQuality('essential');
    else if (slowFrameDebt >= 12) setQuality('balanced');
    else if (slowFrameDebt <= 3) setQuality('full');
  }

  function canAnimate() {
    return opened && !destroyed && !pausedReason && !hiddenByDocument && renderMode === 'webgl';
  }

  function stopAnimation() {
    if (rafId !== null) cancelFrame(rafId);
    rafId = null;
    lastFrameAt = null;
  }

  function frame(at) {
    rafId = null;
    if (!canAnimate()) return;
    const deltaMs = lastFrameAt === null ? 16 : clamp(at - lastFrameAt, 0, 80);
    lastFrameAt = at;
    updateQuality(deltaMs);
    const direct = motionIsReduced() || pointer;
    const response = direct ? 1 : 1 - Math.exp(-deltaMs / (inputMode === 'gesture' ? 42 : 76));
    rotation.x += (targetRotation.x - rotation.x) * response;
    rotation.y += (targetRotation.y - rotation.y) * response;
    if (!motionIsReduced() && !pointer && inputMode !== 'gesture') {
      targetRotation.y += (0 - targetRotation.y) * Math.min(1, deltaMs / 1600);
      targetRotation.x += (-0.04 - targetRotation.x) * Math.min(1, deltaMs / 1800);
    }
    lastDiagnostics = renderer.render({
      products,
      selectedIndex,
      rotationX: rotation.x,
      rotationY: rotation.y,
      dismissedCount: dismissedSignalIds.size,
      time: at,
      reducedMotion: motionIsReduced(),
    });
    rafId = requestFrame(frame);
  }

  function startAnimation() {
    if (rafId !== null || !canAnimate()) return;
    lastFrameAt = null;
    rafId = requestFrame(frame);
  }

  function initializeRenderer() {
    if (!elements.canvas) {
      setRenderMode('fallback');
      return;
    }
    try {
      renderer?.destroy?.();
      renderer = createObservatoryScene(elements.canvas, { devicePixelRatio });
      renderer.setQuality(motionIsReduced() ? 'essential' : 'full');
      setRenderMode('webgl');
      drawStaticFrame();
      startAnimation();
    } catch {
      renderer = null;
      setRenderMode('fallback');
      announce('3D 展示暂不可用，已切换为静态商品视图。所有操作仍可继续。');
    }
  }

  function selectProduct(direction) {
    if (!opened || products.length < 2) return false;
    selectedIndex = nextObservatoryIndex(selectedIndex, direction, products.length);
    dismissedSignalIds = new Set();
    rotation = { x: -0.08, y: direction < 0 ? -0.46 : 0.46 };
    targetRotation = { x: -0.08, y: 0 };
    if (root.dataset) root.dataset.switching = 'true';
    if (switchTimer !== null) globalThis.clearTimeout(switchTimer);
    switchTimer = globalThis.setTimeout(() => {
      if (root.dataset) delete root.dataset.switching;
      switchTimer = null;
    }, motionIsReduced() ? 0 : 320);
    renderProduct({ announceSelection: true });
    drawStaticFrame();
    startAnimation();
    return true;
  }

  function dismissSignal(signalId) {
    const signal = signalsForProduct(currentProduct()).find((item) => item.id === signalId);
    if (!signal || dismissedSignalIds.has(signal.id)) return false;
    dismissedSignalIds.add(signal.id);
    renderSignals();
    const remaining = Math.max(0, signalsForProduct(currentProduct()).length - dismissedSignalIds.size);
    announce(`已关掉“${signal.label}”，还剩 ${remaining} 个催促信号。`);
    drawStaticFrame();
    return true;
  }

  function rotateBy(deltaX, deltaY, { direct = false } = {}) {
    targetRotation.x = clamp(targetRotation.x + deltaX, -0.7, 0.7);
    targetRotation.y += deltaY;
    if (direct || motionIsReduced()) rotation = { ...targetRotation };
    drawStaticFrame();
    startAnimation();
  }

  function pointerDown(event) {
    if (!opened || event.button > 0) return;
    if (event.target?.closest?.('button, a, input, select, textarea, [role="button"]')) return;
    pointer = { id: event.pointerId, x: Number(event.clientX), y: Number(event.clientY) };
    elements.stage?.setPointerCapture?.(event.pointerId);
    if (root.dataset) root.dataset.dragging = 'true';
    if (inputMode !== 'pointer') {
      inputMode = 'pointer';
      onInputMode('pointer');
      renderInputMode();
    }
    event.preventDefault?.();
  }

  function pointerMove(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const rect = elements.stage?.getBoundingClientRect?.() || { width: 1, height: 1 };
    const dx = (Number(event.clientX) - pointer.x) / Math.max(1, rect.width);
    const dy = (Number(event.clientY) - pointer.y) / Math.max(1, rect.height);
    pointer.x = Number(event.clientX);
    pointer.y = Number(event.clientY);
    rotateBy(dy * 3.8, dx * 5.4, { direct: true });
    event.preventDefault?.();
  }

  function pointerUp(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    elements.stage?.releasePointerCapture?.(event.pointerId);
    pointer = null;
    if (root.dataset) delete root.dataset.dragging;
  }

  function stageKeydown(event) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      selectProduct(event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      rotateBy(event.key === 'ArrowUp' ? -0.14 : 0.14, 0, { direct: true });
      announce(`已从${event.key === 'ArrowUp' ? '较高' : '较低'}角度查看${currentProduct().name}。`);
      return;
    }
    if (event.key.toLowerCase() === 'a' || event.key.toLowerCase() === 'd') {
      event.preventDefault();
      rotateBy(0, event.key.toLowerCase() === 'a' ? -0.22 : 0.22, { direct: true });
    }
  }

  function renderInputMode() {
    if (!elements.gestureButton) return;
    const active = inputMode === 'gesture';
    elements.gestureButton.dataset.active = String(active);
    elements.gestureButton.setAttribute('aria-pressed', String(active));
    const label = elements.gestureButton.querySelector?.('b');
    if (label) label.textContent = active ? '手势已接管' : '手势旋转';
    const state = elements.gestureButton.querySelector?.('small');
    if (state) state.textContent = active ? '再次点击退出' : '可选 · 本地识别';
  }

  function toggleGesture() {
    const nextMode = inputMode === 'gesture' ? 'pointer' : 'gesture';
    if (onInputMode(nextMode) === false) return;
    inputMode = nextMode;
    pausedReason = null;
    if (elements.pauseNotice) elements.pauseNotice.hidden = true;
    renderInputMode();
    announce(nextMode === 'gesture'
      ? '手势旋转已开启。伸出食指，左右移动查看商品。'
      : '已切换为触摸、鼠标和键盘操作。');
    startAnimation();
  }

  function handleVisibilityChange() {
    hiddenByDocument = Boolean(documentRef?.hidden);
    if (hiddenByDocument) stopAnimation();
    else startAnimation();
  }

  function applySegment(segment) {
    if (!opened || destroyed) return false;
    const delta = rotationDeltaForSegment(segment);
    inputMode = 'gesture';
    pausedReason = null;
    if (elements.pauseNotice) elements.pauseNotice.hidden = true;
    renderInputMode();
    rotateBy(delta.x, delta.y);
    return Boolean(delta.x || delta.y);
  }

  function pause(reason = 'paused') {
    if (!opened || destroyed) return false;
    pausedReason = reason;
    stopAnimation();
    if (elements.pauseNotice) {
      elements.pauseNotice.hidden = false;
      elements.pauseNotice.textContent = reason === 'hand-lost'
        ? '暂时没看到手，商品停在原处。重新伸出食指即可继续。'
        : '观察舱已暂停。';
    }
    if (root.dataset) root.dataset.paused = 'true';
    return true;
  }

  function resume() {
    if (!opened || destroyed) return false;
    pausedReason = null;
    if (elements.pauseNotice) elements.pauseNotice.hidden = true;
    if (root.dataset) delete root.dataset.paused;
    announce('手势已恢复，商品保持原角度继续响应。');
    startAnimation();
    return true;
  }

  async function open(config = {}) {
    if (destroyed) return false;
    products = selectObservatoryProducts(config);
    selectedIndex = 0;
    dismissedSignalIds = new Set();
    rotation = { x: -0.08, y: 0.5 };
    targetRotation = { x: -0.08, y: 0 };
    inputMode = config.inputMode === 'gesture' ? 'gesture' : 'pointer';
    pausedReason = null;
    hiddenByDocument = Boolean(documentRef?.hidden);
    slowFrameDebt = 0;
    quality = motionIsReduced() ? 'essential' : 'full';
    setPortalOrigin(config.portalOrigin);
    root.hidden = false;
    if (root.dataset) {
      root.dataset.quality = quality;
      root.dataset.calmLevel = '0';
    }
    opened = true;
    renderProduct();
    renderInputMode();
    if (elements.pauseNotice) elements.pauseNotice.hidden = true;
    setRenderMode('pending');
    requestFrame(() => {
      if (!opened || destroyed) return;
      initializeRenderer();
      elements.title?.focus?.({ preventScroll: true });
    });
    announce(`欲望观察舱已打开。正在观察${currentProduct().name}，没有倒计时。`);
    return true;
  }

  function close() {
    if (!opened || destroyed) return false;
    opened = false;
    pointer = null;
    stopAnimation();
    root.hidden = true;
    if (root.dataset) {
      delete root.dataset.dragging;
      delete root.dataset.paused;
      delete root.dataset.switching;
    }
    onClose();
    return true;
  }

  function destroy() {
    if (destroyed) return;
    opened = false;
    destroyed = true;
    stopAnimation();
    if (switchTimer !== null) globalThis.clearTimeout(switchTimer);
    resizeObserver?.disconnect?.();
    cleanupListeners.splice(0).forEach((cleanup) => cleanup());
    renderer?.destroy?.();
    renderer = null;
    CONTROLLERS.delete(root);
  }

  function snapshot() {
    return {
      open: opened,
      selectedIndex,
      selectedProductId: currentProduct()?.id || null,
      productCount: products.length,
      dismissedSignalIds: [...dismissedSignalIds],
      inputMode,
      renderMode,
      pausedReason,
      rotation: { ...rotation },
      quality,
    };
  }

  listen(elements.previousButton, 'click', () => selectProduct(-1));
  listen(elements.nextButton, 'click', () => selectProduct(1));
  listen(elements.gestureButton, 'click', toggleGesture);
  listen(elements.stage, 'pointerdown', pointerDown);
  listen(elements.stage, 'pointermove', pointerMove);
  listen(elements.stage, 'pointerup', pointerUp);
  listen(elements.stage, 'pointercancel', pointerUp);
  listen(elements.stage, 'keydown', stageKeydown);
  listen(elements.coolButton, 'click', () => onIntent({ type: 'cool', focusItem: currentProduct() }));
  listen(elements.dismissButton, 'click', () => onIntent({ type: 'dismiss', focusItem: currentProduct() }));
  elements.closeButtons.forEach((button) => listen(button, 'click', close));
  listen(documentRef, 'visibilitychange', handleVisibilityChange);
  listen(elements.canvas, 'webglcontextlost', (event) => {
    event.preventDefault?.();
    stopAnimation();
    renderer?.destroy?.();
    renderer = null;
    setRenderMode('fallback');
    announce('3D 展示已暂停，静态商品视图仍可继续操作。');
  });

  if (typeof globalThis.ResizeObserver === 'function' && elements.stage) {
    resizeObserver = new globalThis.ResizeObserver(() => {
      renderer?.resize?.();
      drawStaticFrame();
    });
    resizeObserver.observe(elements.stage);
  } else {
    listen(globalThis, 'resize', () => {
      renderer?.resize?.();
      drawStaticFrame();
    });
  }

  const controller = {
    open,
    close,
    destroy,
    applySegment,
    pause,
    resume,
    selectProduct,
    dismissSignal,
    getState: snapshot,
    getDiagnostics: () => ({
      ...lastDiagnostics,
      renderMode,
      quality,
      rafActive: rafId !== null,
      visibleProducts: Math.min(products.length, quality === 'full' ? MAX_OBSERVATORY_VISIBLE_PRODUCTS : 1),
    }),
  };
  CONTROLLERS.set(root, controller);
  return controller;
}
