import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GACHAPON_CHAMBER,
  createGachaponMotion,
  createInitialGachaponBodies,
  resolveBallCollision,
  resolveEllipseBoundary,
  stepGachaponPhysics,
} from '../gachapon-motion.js';

function fakeElement(width = 400, tokenWidth = width) {
  const properties = new Map();
  return {
    dataset: {},
    style: {
      left: '',
      top: '',
      transform: '',
      setProperty(name, value) { properties.set(name, value); },
      getPropertyValue(name) { return properties.get(name) ?? ''; },
    },
    getBoundingClientRect() { return { width: tokenWidth, height: tokenWidth }; },
  };
}

function fakeDocument() {
  const listeners = new Map();
  return {
    hidden: false,
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
    dispatch(name) { listeners.get(name)?.(); },
  };
}

function rafHarness() {
  let nextId = 0;
  const callbacks = new Map();
  const cancelled = [];
  return {
    request(callback) {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id) {
      cancelled.push(id);
      callbacks.delete(id);
    },
    flush(timestamp) {
      const queued = [...callbacks.values()];
      callbacks.clear();
      queued.forEach((callback) => callback(timestamp));
    },
    get pending() { return callbacks.size; },
    cancelled,
  };
}

test('固定种子生成相同且全部位于球舱内的六颗球', () => {
  assert.deepEqual(DEFAULT_GACHAPON_CHAMBER, { cx: 280, cy: 301, rx: 213, ry: 224 });
  const first = createInitialGachaponBodies({ count: 6, seed: 'same-seed' });
  const second = createInitialGachaponBodies({ count: 6, seed: 'same-seed' });
  assert.deepEqual(first, second);
  assert.equal(first.length, 6);

  for (const body of first) {
    const allowedRx = DEFAULT_GACHAPON_CHAMBER.rx - body.radius;
    const allowedRy = DEFAULT_GACHAPON_CHAMBER.ry - body.radius;
    const x = (body.x - DEFAULT_GACHAPON_CHAMBER.cx) / allowedRx;
    const y = (body.y - DEFAULT_GACHAPON_CHAMBER.cy) / allowedRy;
    assert.ok((x * x) + (y * y) <= 1);
  }
});

test('越过椭圆边界时被拉回舱内并反射向外速度', () => {
  const body = { x: 490, y: 318, vx: 120, vy: 10, radius: 38, angle: 0, angularVelocity: 0 };
  assert.equal(resolveEllipseBoundary(body), true);
  assert.ok(body.x <= DEFAULT_GACHAPON_CHAMBER.cx + DEFAULT_GACHAPON_CHAMBER.rx - body.radius + 0.001);
  assert.ok(body.vx < 0);
  assert.notEqual(body.angularVelocity, 0);
});

test('等质量小球相撞后完成分离并交换法向冲量', () => {
  const first = { x: 100, y: 100, vx: 80, vy: 0, radius: 20, angle: 0, angularVelocity: 0 };
  const second = { x: 135, y: 100, vx: -40, vy: 0, radius: 20, angle: 0, angularVelocity: 0 };
  assert.equal(resolveBallCollision(first, second, 1), true);
  assert.ok(Math.hypot(second.x - first.x, second.y - first.y) >= 40);
  assert.equal(Math.round(first.vx), -40);
  assert.equal(Math.round(second.vx), 80);
});

test('固定步长更新包含速度上限并保持球体在舱内', () => {
  const bodies = createInitialGachaponBodies({ count: 6, seed: 'step-seed' });
  bodies[0].vx = 5000;
  bodies[0].vy = -5000;
  for (let index = 0; index < 180; index += 1) {
    stepGachaponPhysics(bodies, { dt: 1 / 60, elapsed: index / 60, maximumSpeed: 300 });
  }
  for (const body of bodies) {
    assert.ok(Math.hypot(body.vx, body.vy) <= 300.001);
    const allowedRx = DEFAULT_GACHAPON_CHAMBER.rx - body.radius;
    const allowedRy = DEFAULT_GACHAPON_CHAMBER.ry - body.radius;
    const x = (body.x - DEFAULT_GACHAPON_CHAMBER.cx) / allowedRx;
    const y = (body.y - DEFAULT_GACHAPON_CHAMBER.cy) / allowedRy;
    assert.ok((x * x) + (y * y) <= 1.00001);
  }
});

test('ready 与 locked 都使用克制的环境物理，让首次进入也能看到扭蛋运动', () => {
  const raf = rafHarness();
  const machine = fakeElement(400);
  const tokens = Array.from({ length: 6 }, () => fakeElement(400, 44));
  const motion = createGachaponMotion({
    machine,
    tokens,
    requestFrame: raf.request,
    cancelFrame: raf.cancel,
    documentRef: fakeDocument(),
    ResizeObserverClass: null,
  });

  assert.equal(raf.pending, 1);
  assert.equal(motion.getSnapshot().mode, 'ambient');
  assert.equal(machine.dataset.gachaponMotion, 'ambient');
  const before = motion.getSnapshot().bodies[0];
  raf.flush(0);
  raf.flush(17);
  const after = motion.getSnapshot().bodies[0];
  assert.notDeepEqual(
    { x: after.x, y: after.y, angle: after.angle },
    { x: before.x, y: before.y, angle: before.angle },
  );
  assert.ok(motion.getSnapshot().bodies.every((body) => Math.hypot(body.vx, body.vy) <= 82.001));

  motion.setState('locked');
  assert.equal(raf.pending, 1);
  assert.equal(motion.getSnapshot().running, true);
  assert.equal(motion.getSnapshot().mode, 'ambient');
  assert.equal(machine.dataset.gachaponMotion, 'ambient');
  const lockedBefore = motion.getSnapshot().bodies[0];
  raf.flush(34);
  raf.flush(51);
  const lockedAfter = motion.getSnapshot().bodies[0];
  assert.notDeepEqual(
    { x: lockedAfter.x, y: lockedAfter.y, angle: lockedAfter.angle },
    { x: lockedBefore.x, y: lockedBefore.y, angle: lockedBefore.angle },
  );
  motion.destroy();
});

test('spinning 的平均速度显著高于 ready 环境驱动', () => {
  const base = createInitialGachaponBodies({ count: 6, seed: 'drive-strength' })
    .map((body) => ({ ...body, vx: 0, vy: 0, angularVelocity: 0 }));
  const ambient = structuredClone(base);
  const spinning = structuredClone(base);

  for (let index = 0; index < 240; index += 1) {
    const elapsed = index / 60;
    stepGachaponPhysics(ambient, {
      dt: 1 / 60,
      elapsed,
      spinning: true,
      driveStrength: 0.1,
      maximumSpeed: 82,
    });
    stepGachaponPhysics(spinning, {
      dt: 1 / 60,
      elapsed,
      spinning: true,
      driveStrength: 1,
      maximumSpeed: 430,
    });
  }

  const averageSpeed = (bodies) => bodies.reduce(
    (sum, body) => sum + Math.hypot(body.vx, body.vy),
    0,
  ) / bodies.length;
  assert.ok(averageSpeed(spinning) > averageSpeed(ambient) * 5);
  assert.ok(ambient.every((body) => Math.hypot(body.vx, body.vy) <= 82.001));
});

test('重复进入 spinning 只保留一个 RAF，离开状态后自然减速收尾', () => {
  const raf = rafHarness();
  const documentRef = fakeDocument();
  const machine = fakeElement(400);
  const tokens = Array.from({ length: 6 }, () => fakeElement(400, 44));
  const motion = createGachaponMotion({
    machine,
    tokens,
    requestFrame: raf.request,
    cancelFrame: raf.cancel,
    documentRef,
    ResizeObserverClass: null,
  });

  motion.setState('spinning');
  motion.setState('spinning');
  assert.equal(raf.pending, 1);
  raf.flush(0);
  assert.equal(raf.pending, 1);
  raf.flush(17);
  assert.match(tokens[0].style.transform, /rotate\(/);
  assert.equal(raf.pending, 1);

  const beforeCoast = motion.getSnapshot().bodies[0];
  motion.setState('revealed');
  assert.equal(raf.pending, 1);
  assert.equal(motion.getSnapshot().coasting, true);
  raf.flush(34);
  const duringCoast = motion.getSnapshot().bodies[0];
  assert.notDeepEqual(
    { x: duringCoast.x, y: duringCoast.y, angle: duringCoast.angle },
    { x: beforeCoast.x, y: beforeCoast.y, angle: beforeCoast.angle },
  );
  assert.equal(raf.pending, 1);

  for (let timestamp = 51; timestamp <= 850; timestamp += 17) raf.flush(timestamp);
  assert.equal(raf.pending, 0);
  assert.equal(motion.getSnapshot().running, false);
  assert.equal(motion.getSnapshot().coasting, false);
  assert.ok(motion.getSnapshot().bodies.every((body) => (
    body.vx === 0 && body.vy === 0 && body.angularVelocity === 0
  )));
  motion.destroy();
});

test('收尾过程中重复设置同一状态不会新增 RAF 或延长收尾', () => {
  const raf = rafHarness();
  const motion = createGachaponMotion({
    machine: fakeElement(400),
    tokens: Array.from({ length: 6 }, () => fakeElement(400, 44)),
    requestFrame: raf.request,
    cancelFrame: raf.cancel,
    documentRef: fakeDocument(),
    ResizeObserverClass: null,
  });

  motion.setState('spinning');
  raf.flush(0);
  raf.flush(17);
  motion.setState('revealed');
  motion.setState('revealed');
  assert.equal(raf.pending, 1);
  for (let timestamp = 34; timestamp <= 850; timestamp += 17) raf.flush(timestamp);
  assert.equal(raf.pending, 0);
  motion.destroy();
});

test('ready 环境动效和 spinning 都服从减少动态、页面隐藏、inactive 与 destroy', () => {
  const raf = rafHarness();
  const documentRef = fakeDocument();
  const machine = fakeElement(400);
  const tokens = Array.from({ length: 6 }, () => fakeElement(400, 44));
  const motion = createGachaponMotion({
    machine,
    tokens,
    requestFrame: raf.request,
    cancelFrame: raf.cancel,
    documentRef,
    ResizeObserverClass: null,
  });

  assert.equal(raf.pending, 1);
  assert.equal(motion.getSnapshot().mode, 'ambient');
  motion.setReducedMotion(true);
  assert.equal(raf.pending, 0);
  motion.setReducedMotion(false);
  assert.equal(raf.pending, 1);

  documentRef.hidden = true;
  documentRef.dispatch('visibilitychange');
  assert.equal(raf.pending, 0);
  documentRef.hidden = false;
  documentRef.dispatch('visibilitychange');
  assert.equal(raf.pending, 1);

  motion.setActive(false);
  assert.equal(raf.pending, 0);
  motion.setActive(true);
  assert.equal(raf.pending, 1);
  motion.setState('spinning');
  assert.equal(raf.pending, 1);
  assert.equal(motion.getSnapshot().mode, 'spinning');
  motion.destroy();
  assert.equal(raf.pending, 0);
  assert.equal(machine.dataset.gachaponMotion, 'idle');
  motion.setState('spinning');
  assert.equal(raf.pending, 0);
});
