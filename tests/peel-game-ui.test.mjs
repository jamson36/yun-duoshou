import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_PEEL_DPR,
  MAX_PEEL_ENTITIES,
  MAX_PEEL_PARTICLES,
  MAX_PEEL_REVEAL_CARDS,
  MAX_PEEL_SHARDS,
  createPeelGameController,
} from '../peel-game-ui.js';
import { PEEL_GAME_STATUS } from '../peel-game.js';

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
  toggle(value, force) {
    if (force === true) this.values.add(value);
    else if (force === false) this.values.delete(value);
    else if (this.values.has(value)) this.values.delete(value);
    else this.values.add(value);
  }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor({ width = 760, height = 475, context = undefined } = {}) {
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.style = {
      values: new Map(),
      setProperty: (name, value) => this.style.values.set(name, value),
    };
    this.width = width;
    this.height = height;
    this.rect = { left: 0, top: 0, width, height, right: width, bottom: height };
    if (context !== undefined) this.getContext = () => context;
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== listener));
  }
  dispatch(type, event = {}) {
    const normalized = {
      preventDefault() {},
      stopPropagation() {},
      pointerId: 1,
      button: 0,
      ...event,
      currentTarget: this,
      target: event.target || this,
    };
    for (const listener of this.listeners.get(type) || []) listener(normalized);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) || null; }
  removeAttribute(name) { this.attributes.delete(name); }
  getBoundingClientRect() { return this.rect; }
  setPointerCapture() {}
  releasePointerCapture() {}
  focus() { this.focused = true; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
}

function drawingContext(calls = []) {
  const methods = new Set([
    'beginPath', 'clearRect', 'fill', 'fillRect', 'fillText', 'lineTo', 'moveTo',
    'quadraticCurveTo', 'restore', 'rotate', 'save', 'stroke', 'strokeRect', 'translate',
  ]);
  return new Proxy({}, {
    get(target, key) {
      if (methods.has(key)) return (...args) => calls.push([key, ...args]);
      return target[key];
    },
    set(target, key, value) { target[key] = value; return true; },
  });
}

function frameDriver() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    request(callback) { const id = nextId++; callbacks.set(id, callback); return id; },
    cancel(id) { callbacks.delete(id); },
    run(timestamp) {
      const current = [...callbacks.entries()];
      callbacks.clear();
      current.forEach(([, callback]) => callback(timestamp));
    },
    get size() { return callbacks.size; },
  };
}

function harness({ canvasAvailable = true, reducedMotion = false, onInputMode = () => {} } = {}) {
  const root = new FakeElement();
  root.hidden = true;
  const drawCalls = [];
  const elements = {
    title: new FakeElement(),
    introView: new FakeElement(),
    playView: new FakeElement(),
    summaryView: new FakeElement(),
    startButton: new FakeElement(),
    gestureStartButton: new FakeElement(),
    closeButtons: [new FakeElement()],
    stage: new FakeElement(),
    canvas: new FakeElement({ context: canvasAvailable ? drawingContext(drawCalls) : null }),
    blade: new FakeElement(),
    tutorial: new FakeElement(),
    skipTutorialButton: new FakeElement(),
    shellCount: new FakeElement(),
    timeLeft: new FakeElement(),
    roundPhase: new FakeElement(),
    pauseNotice: new FakeElement(),
    liveStatus: new FakeElement(),
    fallbackTargets: new FakeElement(),
    previousTargetButton: new FakeElement(),
    currentTarget: new FakeElement(),
    currentTargetButton: new FakeElement(),
    nextTargetButton: new FakeElement(),
    summaryCount: new FakeElement(),
    summaryChoices: new FakeElement(),
    reminderTrigger: new FakeElement(),
    reminderText: new FakeElement(),
    summaryFocusName: new FakeElement(),
    summaryFocusGlyph: new FakeElement(),
  };
  const frames = frameDriver();
  let assetLoads = 0;
  const controller = createPeelGameController({
    root,
    elements,
    reducedMotion,
    devicePixelRatio: 3,
    requestFrame: (callback) => frames.request(callback),
    cancelFrame: (id) => frames.cancel(id),
    loadAssets: async () => { assetLoads += 1; },
    onInputMode,
  });
  return { root, elements, frames, controller, drawCalls, get assetLoads() { return assetLoads; } };
}

test('同一根节点只创建一个控制器，素材只在首次 open 时加载且 DPR 上限为 2', async () => {
  const setup = harness();
  const duplicate = createPeelGameController({ root: setup.root, elements: setup.elements });
  assert.equal(duplicate, setup.controller);

  await setup.controller.open({ seed: 'open', tutorialCompleted: true });
  await setup.controller.open({ seed: 'open-again', tutorialCompleted: true });
  assert.equal(setup.assetLoads, 1);
  assert.equal(setup.root.hidden, false);
  assert.equal(setup.elements.canvas.width, 760 * MAX_PEEL_DPR);
  assert.equal(MAX_PEEL_DPR, 2);
});

test('首次开始用 RAF 从底部抛起无计时教学，skip 后沿用单一 RAF 且 replay 不重复教学', async () => {
  const inputModes = [];
  const setup = harness({ onInputMode: (mode) => inputModes.push(mode) });
  await setup.controller.open({ seed: 'tutorial', tutorialCompleted: false });
  setup.controller.start('pointer');
  assert.equal(setup.controller.getState().status, PEEL_GAME_STATUS.TUTORIAL);
  assert.equal(setup.frames.size, 1);
  assert.equal(setup.elements.tutorial.hidden, false);

  const initialY = setup.controller.getState().entities[0].y;
  setup.frames.run(0);
  setup.frames.run(500);
  assert.ok(setup.controller.getState().entities[0].y < initialY);

  setup.controller.skipTutorial();
  assert.equal(setup.controller.getState().status, PEEL_GAME_STATUS.PLAYING);
  assert.equal(setup.controller.getState().elapsedMs, 0);
  assert.equal(setup.frames.size, 1);

  setup.controller.replay();
  assert.equal(setup.controller.getState().status, PEEL_GAME_STATUS.PLAYING);
  assert.equal(setup.elements.tutorial.hidden, true);
  assert.deepEqual(inputModes, ['pointer', 'pointer'], '重玩应重新建立上一局输入上下文');
});

test('触屏轻点与拖动都走同一线段入口，商品本体不会被重复结算', async () => {
  const setup = harness();
  await setup.controller.open({ seed: 'pointer', tutorialCompleted: true });
  setup.controller.start('pointer');
  setup.frames.run(0);
  setup.frames.run(320);
  const entity = setup.controller.getState().entities[0];
  const clientX = entity.x * setup.elements.stage.rect.width;
  const clientY = entity.y * setup.elements.stage.rect.height;

  setup.elements.stage.dispatch('pointerdown', { clientX, clientY });
  setup.elements.stage.dispatch('pointerup', { clientX, clientY });
  assert.equal(setup.controller.getState().score.peeledShells, 1);
  assert.equal(setup.controller.getDiagnostics().shellShards, 2);
  assert.equal(setup.controller.getDiagnostics().revealCards, 1);

  const afterFirst = setup.controller.getState();
  setup.controller.applySegment({
    from: { x: entity.x - 0.1, y: entity.y },
    to: { x: entity.x + 0.1, y: entity.y },
    at: 1_000,
  });
  assert.ok(setup.controller.getState().score.peeledShells >= afterFirst.score.peeledShells);
  assert.ok(setup.controller.getDiagnostics().particles <= MAX_PEEL_PARTICLES);
});

test('键盘刀锋和持久目标按钮可操作同一批动态实体', async () => {
  const setup = harness();
  await setup.controller.open({ seed: 'keyboard', tutorialCompleted: true });
  setup.controller.start('keyboard');
  const beforeLeft = setup.elements.blade.style.values.get('--blade-x');
  setup.elements.stage.dispatch('keydown', { key: 'ArrowRight' });
  assert.notEqual(setup.elements.blade.style.values.get('--blade-x'), beforeLeft);
  assert.match(setup.elements.currentTarget.textContent, /当前空中目标：/);

  setup.elements.currentTargetButton.dispatch('click');
  assert.equal(setup.controller.getState().score.peeledShells, 1);
  assert.equal(setup.elements.currentTargetButton.focused, undefined, '动态实体变化不应替换持久按钮');
});

test('Canvas 不可用时开启语义目标降级，减少动态取消高速抛物与旋转', async () => {
  const setup = harness({ canvasAvailable: false, reducedMotion: true });
  await setup.controller.open({ seed: 'fallback', tutorialCompleted: true });
  setup.controller.start('pointer');

  assert.equal(setup.elements.fallbackTargets.hidden, false);
  assert.equal(setup.controller.getDiagnostics().canvasAvailable, false);
  assert.equal(setup.controller.getState().entities[0].rotationVelocity, 0);
  assert.ok(Math.abs(setup.controller.getState().entities[0].vy) < 0.6);
  assert.equal(MAX_PEEL_ENTITIES, 8);
  assert.equal(MAX_PEEL_PARTICLES, 60);
  setup.elements.currentTargetButton.dispatch('click');
  assert.equal(setup.controller.getDiagnostics().particles, 0);
  assert.equal(setup.controller.getDiagnostics().shellShards, 0);
  assert.equal(setup.controller.getDiagnostics().revealCards, 1, '减少动态仍应保留静态文字揭示');
  assert.equal(MAX_PEEL_SHARDS, 16);
  assert.equal(MAX_PEEL_REVEAL_CARDS, 8);
});

test('剥开个人冷静单后只展示订单已有真实价格，不为本地商品池虚构金额', async () => {
  const setup = harness();
  await setup.controller.open({
    seed: 'real-price',
    tutorialCompleted: true,
    orders: [{
      id: 'priced-order',
      name: '想买的相机',
      amount: 3299,
      status: 'cooling',
      updatedAt: '2026-09-02T09:00:00Z',
    }],
  });
  setup.controller.start('pointer');
  setup.frames.run(0);
  setup.frames.run(38_000);
  let focus = setup.controller.getState().entities.find((entity) => entity.item.orderId === 'priced-order');
  assert.ok(focus);
  while (!focus.coreRevealed) {
    setup.controller.applySegment({
      from: { x: focus.x - focus.radius, y: focus.y },
      to: { x: focus.x + focus.radius, y: focus.y },
      at: 40_000 + setup.controller.getState().score.peeledShells * 200,
    });
    focus = setup.controller.getState().entities.find((entity) => entity.item.orderId === 'priced-order');
  }

  const drawnTexts = setup.drawCalls.filter(([method]) => method === 'fillText').map(([, value]) => value);
  assert.ok(drawnTexts.includes('¥3,299'));
  assert.equal(drawnTexts.some((value) => /^¥/.test(String(value)) && value !== '¥3,299'), false);
});

test('第 45 秒切换结果页并停止 RAF，summary 后拒绝命中，close 清理状态', async () => {
  const setup = harness();
  await setup.controller.open({ seed: 'summary', tutorialCompleted: true });
  setup.controller.start('pointer');
  setup.elements.currentTargetButton.dispatch('click');
  setup.frames.run(0);
  setup.frames.run(45_000);

  assert.equal(setup.controller.getState().status, PEEL_GAME_STATUS.SUMMARY);
  assert.equal(setup.frames.size, 0);
  assert.equal(setup.elements.playView.hidden, true);
  assert.equal(setup.elements.summaryView.hidden, false);
  assert.ok(setup.elements.summaryChoices.children.length <= setup.controller.getState().reveals.length + 1);
  const summaryLabels = setup.elements.summaryChoices.children
    .flatMap((label) => [label, ...(label.children || [])])
    .map((child) => child.textContent)
    .filter(Boolean);
  assert.ok(summaryLabels.includes('没什么感觉'));

  const score = setup.controller.getState().score.peeledShells;
  setup.controller.applySegment({ from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, at: 50_000 });
  assert.equal(setup.controller.getState().score.peeledShells, score);
  setup.controller.close();
  assert.equal(setup.root.hidden, true);
  assert.equal(setup.frames.size, 0);
});
