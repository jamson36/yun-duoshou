import assert from 'node:assert/strict';
import test from 'node:test';

import { createPeelGestureMapper } from '../peel-gesture-controls.js';

function frame({ x = 0.2, y = 0.4, gesture = 'Pointing_Up', score = 0.95 } = {}) {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  landmarks[8] = { x, y, z: 0 };
  return { gesture, score, landmarks };
}

test('首帧只建立镜像锚点，第二帧才输出归一化切割线段', () => {
  const mapper = createPeelGestureMapper({ smoothing: 1 });

  assert.equal(mapper.update(frame({ x: 0.2, y: 0.4 }), 0), null);
  assert.deepEqual(mapper.update(frame({ x: 0.3, y: 0.5 }), 16), {
    type: 'segment',
    from: { x: 0.8, y: 0.4 },
    to: { x: 0.7, y: 0.5 },
    at: 16,
  });
});

test('低置信度或非指向手势不生成剥壳轨迹', () => {
  const mapper = createPeelGestureMapper({ smoothing: 1 });

  assert.equal(mapper.update(frame({ score: 0.67 }), 0), null);
  assert.equal(mapper.update(frame({ gesture: 'Open_Palm' }), 16), null);
});

test('坐标跳变超过阈值时重置锚点，避免生成横跨画面的误切', () => {
  const mapper = createPeelGestureMapper({ smoothing: 1, maxJump: 0.25 });

  mapper.update(frame({ x: 0.1, y: 0.2 }), 0);
  assert.equal(mapper.update(frame({ x: 0.9, y: 0.8 }), 16), null);
  const segment = mapper.update(frame({ x: 0.85, y: 0.78 }), 32);
  assert.equal(segment.type, 'segment');
  assert.ok(Math.hypot(
    segment.to.x - segment.from.x,
    segment.to.y - segment.from.y,
  ) < 0.25);
});

test('同一目标在 120ms 内只接受一次命中', () => {
  const mapper = createPeelGestureMapper({ hitCooldownMs: 120 });

  assert.equal(mapper.registerHit('product-1', 100), true);
  assert.equal(mapper.registerHit('product-1', 219), false);
  assert.equal(mapper.registerHit('product-2', 219), true);
  assert.equal(mapper.registerHit('product-1', 220), true);
});

test('丢手 600ms 只输出一次暂停，恢复后先恢复再重新建锚', () => {
  const mapper = createPeelGestureMapper({ smoothing: 1, handLostMs: 600 });

  mapper.update(frame(), 0);
  assert.equal(mapper.update(null, 599), null);
  assert.deepEqual(mapper.update(null, 600), { type: 'pause', reason: 'hand-lost' });
  assert.equal(mapper.update(null, 700), null);
  assert.deepEqual(mapper.update(frame({ x: 0.4 }), 800), { type: 'resume' });
  assert.equal(mapper.update(frame({ x: 0.42 }), 816).type, 'segment');
});

test('reset 清除锚点、丢手状态和命中冷却', () => {
  const mapper = createPeelGestureMapper({ smoothing: 1 });
  mapper.update(frame({ x: 0.2 }), 0);
  mapper.registerHit('product-1', 10);
  mapper.reset();

  assert.equal(mapper.update(frame({ x: 0.3 }), 20), null);
  assert.equal(mapper.registerHit('product-1', 20), true);
});

test('体感刀锋平滑按真实时间收敛，不随识别帧率改变拖尾距离', () => {
  function finalPoint(stepMs) {
    const mapper = createPeelGestureMapper({ minTravel: 0, maxJump: 1 });
    mapper.update(frame({ x: 0.2 }), 0);
    let latest = null;
    for (let at = stepMs; at <= 330; at += stepMs) {
      latest = mapper.update(frame({ x: 0.4 }), at);
    }
    return latest.to.x;
  }

  const thirtyFps = finalPoint(33);
  const fifteenFps = finalPoint(66);
  assert.ok(Math.abs(thirtyFps - fifteenFps) < 0.002, `同一时长的刀锋位置偏差过大：${thirtyFps} / ${fifteenFps}`);
  assert.ok(fifteenFps < 0.605, '330ms 内刀锋应基本追上手指');
});
