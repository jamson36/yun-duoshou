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

function movingHandFrame(options = {}) {
  const result = frame(options);
  const tip = result.landmarks[8];
  [9, 13, 17].forEach((index, offset) => {
    result.landmarks[index] = { x: tip.x + 0.025 * (offset + 1), y: tip.y + 0.16, z: 0 };
  });
  return result;
}

test('首帧只定位刀锋并建立镜像锚点，第二帧才输出切割线段', () => {
  const mapper = createPeelGestureMapper({ smoothing: 1 });

  assert.deepEqual(mapper.update(frame({ x: 0.2, y: 0.4 }), 0), {
    type: 'cursor', to: { x: 0.8, y: 0.4 }, at: 0,
  });
  assert.deepEqual(mapper.update(frame({ x: 0.3, y: 0.5 }), 16), {
    type: 'segment',
    from: { x: 0.8, y: 0.4 },
    to: { x: 0.7, y: 0.5 },
    at: 16,
  });
});

test('1.8 倍位移在保持镜像方向的同时放大水平和垂直行程', () => {
  const mapper = createPeelGestureMapper({ smoothing: 1, controlGain: 1.8 });
  assert.deepEqual(mapper.update(frame({ x: 0.5, y: 0.5 }), 0), {
    type: 'cursor', to: { x: 0.5, y: 0.5 }, at: 0,
  });
  const segment = mapper.update(frame({ x: 0.4, y: 0.6 }), 33);
  assert.deepEqual(segment.from, { x: 0.5, y: 0.5 });
  assert.ok(Math.abs(segment.to.x - 0.68) < 1e-9);
  assert.ok(Math.abs(segment.to.y - 0.68) < 1e-9);
});

test('镜头中央约 56% 范围可抵达舞台四边，不需要手指到镜头边缘', () => {
  const halfRange = 0.5 / 1.8;
  for (const [x, y, expected] of [
    [0.5 + halfRange, 0.5, { x: 0, y: 0.5 }],
    [0.5 - halfRange, 0.5, { x: 1, y: 0.5 }],
    [0.5, 0.5 - halfRange, { x: 0.5, y: 0 }],
    [0.5, 0.5 + halfRange, { x: 0.5, y: 1 }],
  ]) {
    const mapper = createPeelGestureMapper({ smoothing: 1, controlGain: 1.8 });
    mapper.update(movingHandFrame({ x: 0.5, y: 0.5 }), 0);
    const segment = mapper.update(movingHandFrame({ x, y }), 33);
    assert.equal(segment?.type, 'segment');
    assert.ok(Math.abs(segment.to.x - expected.x) < 1e-9);
    assert.ok(Math.abs(segment.to.y - expected.y) < 1e-9);
  }
});

test('增益后的长线段不触发原始跳变阈值，小幅手抖仍按原始坐标过滤', () => {
  const mapper = createPeelGestureMapper({ smoothing: 1, controlGain: 1.8 });
  mapper.update(frame({ x: 0.375, y: 0.5 }), 0);
  const longSegment = mapper.update(frame({ x: 0.625, y: 0.5 }), 33);
  assert.equal(longSegment?.type, 'segment');
  assert.ok(Math.abs(longSegment.from.x - longSegment.to.x - 0.45) < 1e-9);
  assert.equal(mapper.update(frame({ x: 0.628, y: 0.5 }), 66), null);
  assert.equal(mapper.update(frame({ x: 0.632, y: 0.5 }), 99)?.type, 'segment');
});

test('超出舒适区夹在舞台边界，不重复切割，返回时从边界连续跟随', () => {
  const mapper = createPeelGestureMapper({ smoothing: 1, controlGain: 1.8 });
  mapper.update(frame({ x: 0.3, y: 0.5 }), 0);
  const edge = mapper.update(frame({ x: 0.15, y: 0.5 }), 33);
  assert.equal(edge.to.x, 1);
  assert.equal(mapper.update(frame({ x: 0.1, y: 0.5 }), 66), null);
  assert.equal(mapper.update(frame({ x: 0.2, y: 0.5 }), 99), null);
  const returned = mapper.update(frame({ x: 0.3, y: 0.5 }), 132);
  assert.equal(returned.from.x, 1);
  assert.ok(Math.abs(returned.to.x - 0.86) < 1e-9);
});

test('放大控制范围仍拒绝原始跳变，丢手恢复也不能跨空白补刀', () => {
  for (const interrupt of ['jump', 'lost']) {
    const mapper = createPeelGestureMapper({ smoothing: 1, controlGain: 1.8 });
    mapper.update(movingHandFrame({ x: 0.2, y: 0.5 }), 0);
    if (interrupt === 'lost') mapper.update(null, 33);
    const reanchored = mapper.update(movingHandFrame({ x: 0.9, y: 0.5 }), 66);
    if (interrupt === 'jump') assert.equal(reanchored, null);
    else assert.deepEqual(reanchored, { type: 'cursor', to: { x: 0, y: 0.5 }, at: 66 });
    const segment = mapper.update(movingHandFrame({ x: 0.7, y: 0.5 }), 99);
    assert.equal(segment?.type, 'segment');
    assert.equal(segment.from.x, 0);
    assert.ok(Math.abs(segment.to.x - 0.14) < 1e-9);
  }
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
  assert.equal(mapper.update(frame({ x: 0.42 }), 217)?.type, 'cursor', '重新确认只定位，不连接过期轨迹');
  assert.equal(mapper.update(frame({ x: 0.44 }), 250)?.type, 'segment');
});

test('明确的其他手势立即停刀，再伸食指时不跨越中性轨迹', () => {
  for (const gesture of ['Open_Palm', 'Closed_Fist', 'Victory', 'Thumb_Up', 'pinch']) {
    for (const score of [0.4, 0.95]) {
      const mapper = createPeelGestureMapper({ smoothing: 1 });
      mapper.update(frame(), 0);
      assert.equal(mapper.update(frame({ x: 0.25, gesture, score }), 33), null);
      assert.equal(mapper.update(frame({ x: 0.3, gesture: 'None' }), 66), null);
      assert.equal(mapper.update(frame({ x: 0.35 }), 99)?.type, 'cursor');
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
  assert.deepEqual(mapper.update(frame({ x: 0.35 }), 99), {
    type: 'cursor', to: { x: 0.65, y: 0.4 }, at: 99,
  });
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
  assert.equal(mapper.update(frame({ x: 0.32 }), 1699)?.type, 'cursor');
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
    assert.deepEqual(mapper.update(frame({ x: 0.25 }), 66), {
      type: 'cursor', to: { x: 0.75, y: 0.4 }, at: 66,
    });
  }
});

test('长时间没有帧时重新建锚，较慢设备仍可用高置信度帧连续切割', () => {
  const mapper = createPeelGestureMapper({ smoothing: 1 });
  mapper.update(frame(), 0);
  assert.equal(mapper.update(frame({ x: 0.3 }), 600)?.type, 'cursor');
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

test('15–30fps 下手掌与指尖共同快速移动时保留完整线段', () => {
  for (const interval of [33, 50, 66]) {
    for (const pose of [{}, { score: 0.4 }, { gesture: 'None', score: 0 }]) {
      const mapper = createPeelGestureMapper({ smoothing: 1 });
      mapper.update(movingHandFrame({ x: 0.2 }), 0);
      const segment = mapper.update(movingHandFrame({ x: 0.62, ...pose }), interval);
      assert.equal(segment?.type, 'segment');
      assert.deepEqual(segment.from, { x: 0.8, y: 0.4 });
      assert.deepEqual(segment.to, { x: 0.38, y: 0.4 });
    }
  }
});

test('指尖单独跳变、极短间隔、过大位移和长间隔仍重新建锚', () => {
  const cases = [
    { result: frame({ x: 0.62 }), interval: 50 },
    { result: movingHandFrame({ x: 0.62 }), interval: 10 },
    { result: movingHandFrame({ x: 0.86 }), interval: 66 },
    { result: movingHandFrame({ x: 0.62 }), interval: 151 },
  ];
  for (const { result, interval } of cases) {
    const mapper = createPeelGestureMapper({ smoothing: 1 });
    mapper.update(movingHandFrame({ x: 0.2 }), 0);
    assert.equal(mapper.update(result, interval), null);
    const segment = mapper.update(movingHandFrame({ x: result.landmarks[8].x - 0.02 }), interval + 33);
    assert.equal(segment?.type, 'segment');
    assert.ok(Math.abs(segment.to.x - segment.from.x) < 0.03, '拒绝后的轨迹从新位置起步');
  }
});

test('快划判断使用采样间隔，推理耗时变化不会伪造手部速度', () => {
  for (const [capturedAt, handledAt, allowed] of [[50, 116, true], [10, 200, false]]) {
    const mapper = createPeelGestureMapper({ smoothing: 1 });
    mapper.update({ ...movingHandFrame(), capturedAt: 0 }, 100);
    const segment = mapper.update({ ...movingHandFrame({ x: 0.62 }), capturedAt }, handledAt);
    assert.equal(segment?.type === 'segment', allowed);
  }
});

test('真实丢手后的快划不能跨缺失区间补刀', () => {
  const mapper = createPeelGestureMapper({ smoothing: 1 });
  mapper.update(movingHandFrame(), 0);
  mapper.update(null, 33);
  assert.deepEqual(mapper.update(movingHandFrame({ x: 0.62 }), 66), {
    type: 'cursor', to: { x: 0.38, y: 0.4 }, at: 66,
  });
  assert.equal(mapper.update(movingHandFrame({ x: 0.64 }), 99)?.type, 'segment');
});

test('已接受的连续移动不会在平滑追赶时被第二次跳变检查截断', () => {
  const mapper = createPeelGestureMapper({ responseMs: 200, fastResponseMs: 200 });
  mapper.update(frame({ x: 0.1 }), 0);
  mapper.update(frame({ x: 0.35 }), 33);
  const previous = mapper.update(frame({ x: 0.6 }), 66);
  const caughtUp = mapper.update(frame({ x: 0.85 }), 250);
  assert.equal(caughtUp?.type, 'segment');
  assert.deepEqual(caughtUp.from, previous.to);
  assert.ok(Math.abs(caughtUp.to.x - caughtUp.from.x) > 0.3);
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
  assert.deepEqual(mapper.update(frame({ x: 0.4 }), 800), {
    type: 'resume', to: { x: 0.6, y: 0.4 }, at: 800,
  });
  assert.equal(mapper.update(frame({ x: 0.42 }), 816).type, 'segment');
});

test('reset 清除锚点、丢手状态和命中冷却', () => {
  const mapper = createPeelGestureMapper({ smoothing: 1 });
  mapper.update(frame({ x: 0.2 }), 0);
  mapper.registerHit('product-1', 10);
  mapper.reset();

  assert.equal(mapper.update(frame({ x: 0.3 }), 20)?.type, 'cursor');
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

test('快划和折返更快跟随，不超出观测范围，停止后不自行延长轨迹', () => {
  const adaptive = createPeelGestureMapper({ minTravel: 0 });
  const steady = createPeelGestureMapper({ minTravel: 0, fastResponseMs: 58 });
  const xs = [0.23, 0.32, 0.41, 0.50, 0.59, 0.68, 0.77, 0.68, 0.59, 0.50, 0.41, 0.32, 0.23];
  let adaptiveError = 0;
  let steadyError = 0;
  xs.forEach((x, index) => {
    const at = index * 1000 / 30;
    const fast = adaptive.update(movingHandFrame({ x }), at);
    const slow = steady.update(movingHandFrame({ x }), at);
    assert.ok(fast.to.x >= 0.23 && fast.to.x <= 0.77);
    if (index > 0) {
      assert.equal(fast.type, 'segment');
      adaptiveError += Math.abs(fast.to.x - (1 - x));
      steadyError += Math.abs(slow.to.x - (1 - x));
    }
  });
  assert.ok(adaptiveError < steadyError * 0.4, '连续快划的累计滞后应明显缩短');
  let previous = adaptive.smoothedPoint.x;
  for (let at = 440; at < 1000; at += 33) {
    adaptive.update(movingHandFrame({ x: 0.23 }), at);
    assert.ok(adaptive.smoothedPoint.x >= previous && adaptive.smoothedPoint.x <= 0.77);
    previous = adaptive.smoothedPoint.x;
  }
});

test('小幅慢移保留原去抖，1.8 倍增益下静止噪声不生成切割', () => {
  const adaptive = createPeelGestureMapper({ minTravel: 0 });
  const steady = createPeelGestureMapper({ minTravel: 0, fastResponseMs: 58 });
  const jitter = createPeelGestureMapper({ controlGain: 1.8 });
  jitter.update(frame({ x: 0.5 }), 0);
  for (let index = 0; index < 40; index++) {
    const x = 0.4 + index * 0.008;
    const at = index * 33;
    assert.deepEqual(adaptive.update(frame({ x }), at), steady.update(frame({ x }), at));
    assert.equal(jitter.update(frame({ x: 0.5 + (index % 2 ? 0.003 : -0.003) }), at + 33), null);
  }
});

test('同一采集轨迹的平滑不受推理送达间隔波动影响', () => {
  const stable = createPeelGestureMapper();
  const delayed = createPeelGestureMapper();
  const xs = [0.2, 0.29, 0.38, 0.47, 0.56, 0.47, 0.38];
  const delays = [20, 55, 28, 70, 41, 35, 60];
  xs.forEach((x, index) => {
    const capturedAt = index * 66;
    const observed = { ...movingHandFrame({ x }), capturedAt };
    const normal = stable.update(observed, capturedAt + 20);
    const late = delayed.update(observed, capturedAt + delays[index]);
    assert.deepEqual(late.to, normal.to);
    assert.deepEqual(late.from, normal.from);
    assert.equal(late.at, capturedAt + delays[index], '命中时间仍使用实际送达时间');
  });
});
