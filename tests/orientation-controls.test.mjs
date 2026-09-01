import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DeviceOrientationMapper,
  screenAdjustedPitch,
  shortestDegreeDelta,
} from '../orientation-controls.js';

function sample({ alpha = 30, beta = 80, gamma = 5, screenAngle = 0 } = {}) {
  return { alpha, beta, gamma, screenAngle };
}

test('方向角跨过 360 度时使用最短增量，不让房间反向跳转', () => {
  assert.equal(shortestDegreeDelta(359, 1), 2);
  assert.equal(shortestDegreeDelta(1, 359), -2);
  assert.equal(shortestDegreeDelta(10, 25), 15);
});

test('上下倾斜按当前屏幕方向映射，并忽略滚转本身', () => {
  assert.ok(Math.abs(screenAdjustedPitch(sample({ beta: 12, gamma: 7, screenAngle: 0 })) - 12) < 1e-9);
  assert.ok(Math.abs(screenAdjustedPitch(sample({ beta: 12, gamma: 7, screenAngle: 90 })) - 7) < 1e-9);
  assert.ok(Math.abs(screenAdjustedPitch(sample({ beta: 12, gamma: 7, screenAngle: 180 })) + 12) < 1e-9);
  assert.ok(Math.abs(screenAdjustedPitch(sample({ beta: 12, gamma: 7, screenAngle: 270 })) + 7) < 1e-9);
});

test('首帧只校准，后续方向变化输出有界且平滑的角度增量', () => {
  const mapper = new DeviceOrientationMapper({
    smoothing: 1,
    deadZoneDegrees: 0.05,
    maxYawStepDegrees: 3,
    maxPitchStepDegrees: 2,
    yawGain: 1,
    pitchGain: 1,
  });

  const calibrated = mapper.update(sample({ alpha: 359, beta: 80 }), { now: 0 });
  const moved = mapper.update(sample({ alpha: 1, beta: 83 }), { now: 16 });

  assert.equal(calibrated.calibrated, true);
  assert.equal(calibrated.yawDelta, 0);
  assert.equal(calibrated.pitchDelta, 0);
  assert.equal(moved.calibrated, false);
  assert.ok(Math.abs(moved.yawDelta - (2 * Math.PI / 180)) < 1e-9);
  assert.ok(Math.abs(moved.pitchDelta - (2 * Math.PI / 180)) < 1e-9, '俯仰单帧应受 2 度上限约束');
});

test('微小噪声留在死区，积累到可感知幅度后再移动', () => {
  const mapper = new DeviceOrientationMapper({
    smoothing: 1,
    deadZoneDegrees: 0.2,
    yawGain: 1,
    pitchGain: 1,
  });
  mapper.update(sample({ alpha: 20 }), { now: 0 });

  const noise = mapper.update(sample({ alpha: 20.1 }), { now: 16 });
  const intentional = mapper.update(sample({ alpha: 20.4 }), { now: 32 });

  assert.equal(noise.yawDelta, 0);
  assert.ok(intentional.yawDelta > 0);
});

test('横竖屏切换和异常大跳变会重新校准，不把变化施加到相机', () => {
  const mapper = new DeviceOrientationMapper({ smoothing: 1, sensorJumpDegrees: 45 });
  mapper.update(sample({ alpha: 40, screenAngle: 0 }), { now: 0 });

  const rotated = mapper.update(sample({ alpha: 42, screenAngle: 90 }), { now: 16 });
  const jumped = mapper.update(sample({ alpha: 140, screenAngle: 90 }), { now: 32 });

  assert.equal(rotated.recalibrated, true);
  assert.equal(rotated.yawDelta, 0);
  assert.equal(jumped.recalibrated, true);
  assert.equal(jumped.yawDelta, 0);
});

test('缺失或非数字方向数据不会完成校准', () => {
  const mapper = new DeviceOrientationMapper();
  const result = mapper.update({ alpha: null, beta: 20, gamma: 2, screenAngle: 0 }, { now: 0 });
  assert.deepEqual(result, {
    valid: false,
    calibrated: false,
    recalibrated: false,
    yawDelta: 0,
    pitchDelta: 0,
  });
});
