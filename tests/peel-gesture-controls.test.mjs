import assert from 'node:assert/strict';
import test from 'node:test';

import { createPeelGestureMapper } from '../peel-gesture-controls.js';

function frame({ x = 0.2, y = 0.4, gesture = 'Pointing_Up', score = 0.95 } = {}) {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  landmarks[0] = { x, y: y + 0.24, z: 0 };
  landmarks[5] = { x, y: y + 0.14, z: 0 };
  landmarks[6] = { x, y: y + 0.09, z: 0 };
  landmarks[7] = { x, y: y + 0.04, z: 0 };
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
  assert.equal(mapper.update(frame({ gesture: 'None', score: 0 }), 33), null);
  assert.equal(mapper.update(frame({ x: 0.3, score: 0.67 }), 66), null);
});

test('确认食指后，低置信度和未知姿势的短暂波动继续使用当前指尖位置', () => {
  const mapper = createPeelGestureMapper({ smoothing: 1 });
  mapper.update(frame({ x: 0.2 }), 0);
  const expectedXs = [0.76, 0.72, 0.68, 0.64];
  const sequence = [
    frame({ x: 0.24 }),
    frame({ x: 0.28, score: 0.4 }),
    frame({ x: 0.32, gesture: 'None', score: 0 }),
    frame({ x: 0.36 }),
  ];
  let previousX = 0.8;
  sequence.forEach((result, index) => {
    const segment = mapper.update(result, (index + 1) * 33);
    assert.equal(segment?.type, 'segment');
    assert.ok(Math.abs(segment.from.x - previousX) < 1e-9);
    assert.ok(Math.abs(segment.to.x - expectedXs[index]) < 1e-9);
    previousX = segment.to.x;
  });
});

test('持续不确定超过 150ms 必须重新确认，弱识别不能无限续期', () => {
  const mapper = createPeelGestureMapper({ smoothing: 1 });
  mapper.update(frame(), 0);
  for (const at of [33, 66, 99, 132, 150]) {
    assert.equal(mapper.update(frame({ x: 0.2 + at / 1000, score: 0.5 }), at)?.type, 'segment');
  }
  assert.equal(mapper.update(frame({ x: 0.36, score: 0.5 }), 151), null);
  assert.equal(mapper.update(frame({ x: 0.4, gesture: 'None' }), 184), null);
  assert.equal(mapper.update(frame({ x: 0.42 }), 217), null, '重新确认的首帧不能连接过期轨迹');
  assert.equal(mapper.update(frame({ x: 0.44 }), 250)?.type, 'segment');
});

test('明确的其他手势立即停刀，再伸食指时不跨越中性轨迹', () => {
  for (const gesture of ['Open_Palm', 'Closed_Fist', 'Victory', 'Thumb_Up', 'pinch']) {
    for (const score of [0.4, 0.95]) {
      const mapper = createPeelGestureMapper({ smoothing: 1 });
      mapper.update(frame(), 0);
      assert.equal(mapper.update(frame({ x: 0.25, gesture, score }), 33), null);
      assert.equal(mapper.update(frame({ x: 0.3, gesture: 'None' }), 66), null);
      assert.equal(mapper.update(frame({ x: 0.35 }), 99), null);
      const segment = mapper.update(frame({ x: 0.4 }), 132);
      assert.deepEqual(segment.from, { x: 0.65, y: 0.4 });
    }
  }
});

test('未知姿势下食指已弯曲时立即停刀，不使用短暂容错', () => {
  const mapper = createPeelGestureMapper({ smoothing: 1 });
  mapper.update(frame(), 0);
  const folded = frame({ x: 0.25, gesture: 'None', score: 0 });
  folded.landmarks[7] = { x: 0.28, y: 0.52, z: 0 };
  folded.landmarks[8] = { x: 0.26, y: 0.56, z: 0 };
  assert.equal(mapper.update(folded, 33), null);
  assert.equal(mapper.update(frame({ x: 0.3, score: 0.4 }), 66), null);
});

test('容错中的食指伸展校验不依赖向上方向、镜像或手掌大小', () => {
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 3]) {
    for (const scale of [0.5, 1, 1.5]) {
      for (const mirror of [1, -1]) {
        const transform = (result) => ({
          ...result,
          landmarks: result.landmarks.map(({ x, y, z }) => ({
            x: 0.5 + scale * ((x - 0.5) * Math.cos(angle) - (y - 0.5) * Math.sin(angle)) * mirror,
            y: 0.5 + scale * ((x - 0.5) * Math.sin(angle) + (y - 0.5) * Math.cos(angle)),
            z,
          })),
        });
        const mapper = createPeelGestureMapper({ smoothing: 1 });
        mapper.update(transform(frame({ x: 0.5 })), 0);
        assert.equal(mapper.update(transform(frame({ x: 0.52, gesture: 'None', score: 0 })), 33)?.type, 'segment');
      }
    }
  }
});

test('丢手即断开轨迹，短暂丢手恢复也不跨空白补刀', () => {
  const mapper = createPeelGestureMapper({ smoothing: 1 });
  mapper.update(frame(), 0);
  assert.equal(mapper.update(null, 33), null);
  assert.equal(mapper.update(frame({ x: 0.3, score: 0.5 }), 66), null);
  assert.equal(mapper.update(frame({ x: 0.35 }), 99), null);
  assert.deepEqual(mapper.update(frame({ x: 0.4 }), 132).from, { x: 0.65, y: 0.4 });
});

test('坐标仍在但姿势分数低不算丢手，暂停只由真实坐标丢失触发', () => {
  const mapper = createPeelGestureMapper({ smoothing: 1 });
  mapper.update(frame(), 0);
  for (let at = 100; at <= 1000; at += 100) {
    assert.equal(mapper.update(frame({ gesture: 'None', score: 0 }), at)?.type === 'pause', false);
  }
  assert.equal(mapper.update(null, 1599), null);
  assert.deepEqual(mapper.update(null, 1600), { type: 'pause', reason: 'hand-lost' });
  assert.deepEqual(mapper.update(frame({ gesture: 'None', score: 0 }), 1633), { type: 'resume' });
  assert.equal(mapper.update(frame({ x: 0.3, score: 0.3 }), 1666), null);
  assert.equal(mapper.update(frame({ x: 0.32 }), 1699), null);
  assert.equal(mapper.update(frame({ x: 0.34 }), 1732)?.type, 'segment');
});

test('手部坐标缺失或无效时停止，不能只凭食指点或姿势高分继续', () => {
  const invalidFrames = [
    { ...frame(), landmarks: [] },
    { ...frame(), landmarks: frame().landmarks.slice(0, 9) },
    { ...frame(), landmarks: new Array(21) },
    ...[0, 5, 8, 20].flatMap((index) => [NaN, Infinity, null, undefined].map((x) => {
      const invalid = frame();
      invalid.landmarks[index].x = x;
      return invalid;
    })),
  ];
  for (const invalid of invalidFrames) {
    const mapper = createPeelGestureMapper({ smoothing: 1 });
    mapper.update(frame(), 0);
    assert.equal(mapper.update(invalid, 33), null);
    assert.equal(mapper.update(frame({ x: 0.25 }), 66), null);
  }
});

test('长时间没有帧时重新建锚，较慢设备仍可用高置信度帧连续切割', () => {
  const mapper = createPeelGestureMapper({ smoothing: 1 });
  mapper.update(frame(), 0);
  assert.equal(mapper.update(frame({ x: 0.3 }), 600), null);
  assert.equal(mapper.update(frame({ x: 0.32 }), 800)?.type, 'segment');
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

test('默认平滑不能掩盖原始坐标跳变，容错也不能跨越跳变', () => {
  for (const score of [0.5, 0.95]) {
    const mapper = createPeelGestureMapper();
    mapper.update(frame({ x: 0.1 }), 0);
    assert.equal(mapper.update(frame({ x: 0.9, score }), 33), null);
    assert.equal(mapper.update(frame({ x: 0.87, score: 0.5 }), 66)?.type === 'segment', score >= 0.68);
    mapper.update(frame({ x: 0.85 }), 99);
    const segment = mapper.update(frame({ x: 0.82 }), 132);
    assert.equal(segment?.type, 'segment');
    assert.ok(segment.from.x < 0.2, '新线段应从跳变后的手指附近出发');
  }
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
