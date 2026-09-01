import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GestureCommandMapper,
  handCenter,
  normalizedPinchDistance,
} from '../gesture-controls.js';

function hand({ x = 0.5, y = 0.5, pinchRatio = 1.4 } = {}) {
  const points = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
  const palmHalfWidth = 0.08;
  points[0] = { x, y: y + 0.12, z: 0 };
  points[5] = { x: x - palmHalfWidth, y, z: 0 };
  points[9] = { x, y: y - 0.01, z: 0 };
  points[13] = { x: x + 0.04, y, z: 0 };
  points[17] = { x: x + palmHalfWidth, y, z: 0 };
  points[8] = { x, y: y - 0.19, z: 0 };
  points[4] = { x: x + (palmHalfWidth * 2 * pinchRatio), y: y - 0.19, z: 0 };
  return points;
}

function frame({ gesture = 'None', score = 0.95, x, y, pinchRatio } = {}) {
  return { gesture, score, landmarks: hand({ x, y, pinchRatio }) };
}

test('手掌中心和捏合距离使用掌宽归一化，避免远近变化改变阈值', () => {
  const landmarks = hand({ x: 0.42, y: 0.48, pinchRatio: 0.25 });
  const center = handCenter(landmarks);

  assert.ok(Math.abs(center.x - 0.42) < 0.03);
  assert.ok(Math.abs(center.y - 0.50) < 0.04);
  assert.ok(Math.abs(normalizedPinchDistance(landmarks) - 0.25) < 1e-9);
});

test('低置信度和缺手帧回到空闲，不输出相机命令', () => {
  const mapper = new GestureCommandMapper({ smoothing: 1 });

  assert.deepEqual(mapper.update(frame({ gesture: 'Closed_Fist', score: 0.3 }), {
    now: 0,
    width: 1000,
    height: 800,
  }), {
    mode: 'idle',
    panX: 0,
    panY: 0,
    zoomDelta: 0,
    pointer: null,
    activation: null,
  });
  assert.equal(mapper.update(null, { now: 16, width: 1000, height: 800 }).mode, 'idle');
});

test('握拳首帧只建立锚点，后续位移经过死区和速度上限输出平滑环视', () => {
  const mapper = new GestureCommandMapper({ smoothing: 1, panDeadZone: 0.002, maxPanPixels: 36 });

  const anchored = mapper.update(frame({ gesture: 'Closed_Fist', x: 0.5, y: 0.5 }), {
    now: 0,
    width: 1000,
    height: 800,
  });
  const moved = mapper.update(frame({ gesture: 'Closed_Fist', x: 0.57, y: 0.46 }), {
    now: 70,
    width: 1000,
    height: 800,
  });

  assert.equal(anchored.mode, 'pan');
  assert.equal(anchored.panX, 0);
  assert.equal(anchored.panY, 0);
  assert.ok(moved.panX < 0 && moved.panX >= -36, '水平位移应跟随镜像预览方向');
  assert.ok(moved.panY < 0 && moved.panY >= -36);
});

test('默认握拳环视提高水平灵敏度，但不放大垂直位移', () => {
  const mapper = new GestureCommandMapper({
    smoothing: 1,
    panDeadZone: 0,
    maxPanPixelsX: 100,
    maxPanPixelsY: 100,
  });

  mapper.update(frame({ gesture: 'Closed_Fist', x: 0.5, y: 0.5 }), {
    now: 0,
    width: 1000,
    height: 1000,
  });
  const moved = mapper.update(frame({ gesture: 'Closed_Fist', x: 0.52, y: 0.52 }), {
    now: 70,
    width: 1000,
    height: 1000,
  });

  assert.ok(Math.abs(moved.panX + 48) < 1e-9);
  assert.ok(Math.abs(moved.panY - 24) < 1e-9);
});

test('快速握拳挥动使用独立水平上限，不放宽垂直视角上限', () => {
  const mapper = new GestureCommandMapper({ smoothing: 1, panDeadZone: 0 });

  mapper.update(frame({ gesture: 'Closed_Fist', x: 0.5, y: 0.5 }), {
    now: 0,
    width: 1000,
    height: 1000,
  });
  const moved = mapper.update(frame({ gesture: 'Closed_Fist', x: 0.8, y: 0.8 }), {
    now: 70,
    width: 1000,
    height: 1000,
  });

  assert.equal(moved.panX, -84);
  assert.equal(moved.panY, 42);
});

test('捏合后上下移动输出有界缩放，松开后重新建立锚点', () => {
  const mapper = new GestureCommandMapper({ smoothing: 1, maxZoomDelta: 0.08 });

  const anchored = mapper.update(frame({ y: 0.5, pinchRatio: 0.25 }), {
    now: 0,
    width: 1000,
    height: 800,
  });
  const moved = mapper.update(frame({ y: 0.62, pinchRatio: 0.25 }), {
    now: 70,
    width: 1000,
    height: 800,
  });
  mapper.update(frame({ y: 0.62, pinchRatio: 1.2 }), { now: 140, width: 1000, height: 800 });
  const reanchored = mapper.update(frame({ y: 0.4, pinchRatio: 0.25 }), {
    now: 210,
    width: 1000,
    height: 800,
  });

  assert.equal(anchored.mode, 'zoom');
  assert.equal(anchored.zoomDelta, 0);
  assert.ok(moved.zoomDelta > 0 && moved.zoomDelta <= 0.08);
  assert.equal(reanchored.zoomDelta, 0);
});

test('指向手势镜像为空气指针，稳定停留后只激活一次并执行冷却', () => {
  const mapper = new GestureCommandMapper({ smoothing: 1, dwellMs: 800, cooldownMs: 1200 });
  const hitTest = () => 'sofa-phone';
  const pointing = frame({ gesture: 'Pointing_Up', x: 0.2, y: 0.5 });

  const started = mapper.update(pointing, { now: 0, width: 1000, height: 800, hitTest });
  const halfway = mapper.update(pointing, { now: 400, width: 1000, height: 800, hitTest });
  const activated = mapper.update(pointing, { now: 800, width: 1000, height: 800, hitTest });
  const cooling = mapper.update(pointing, { now: 900, width: 1000, height: 800, hitTest });

  assert.equal(started.mode, 'point');
  assert.ok(started.pointer.x > 700, '镜像后画面左侧的手应落在屏幕右侧');
  assert.equal(started.pointer.progress, 0);
  assert.ok(halfway.pointer.progress >= 0.49 && halfway.pointer.progress <= 0.51);
  assert.deepEqual(activated.activation, { hotspotId: 'sofa-phone' });
  assert.equal(cooling.activation, null);
  assert.equal(cooling.pointer.progress, 0);
});

test('空气指针切换热点会重新计算停留时间', () => {
  const mapper = new GestureCommandMapper({ smoothing: 1, dwellMs: 800 });
  let hotspotId = 'gym-screen';
  const hitTest = () => hotspotId;
  const pointing = frame({ gesture: 'Pointing_Up' });

  mapper.update(pointing, { now: 0, width: 1000, height: 800, hitTest });
  mapper.update(pointing, { now: 600, width: 1000, height: 800, hitTest });
  hotspotId = 'whiteboard';
  const switched = mapper.update(pointing, { now: 700, width: 1000, height: 800, hitTest });

  assert.equal(switched.pointer.hotspotId, 'whiteboard');
  assert.equal(switched.pointer.progress, 0);
  assert.equal(switched.activation, null);
});
