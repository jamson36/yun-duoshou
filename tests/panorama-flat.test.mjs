import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PanoramaRoom,
  canManipulatePanorama,
  computeFlatProjectionFrame,
  projectFlatPoint,
  projectedHotspotFitsViewport,
  unprojectFlatPoint,
} from '../panorama.js';

const degrees = (value) => (value * Math.PI) / 180;
const defaultFov = degrees(70);

test('平面全景默认按原图比例 cover 桌面画布', () => {
  const frame = computeFlatProjectionFrame({
    width: 1920,
    height: 1080,
    sourceAspect: 2,
    view: { yaw: 0, pitch: 0, fov: defaultFov },
    defaultFov,
  });

  assert.ok(Math.abs(frame.spanU - (16 / 18)) < 1e-9);
  assert.equal(frame.spanV, 1);
  assert.equal(frame.centerU, 0.5);
  assert.equal(frame.centerV, 0.5);
  assert.equal(frame.contentWidth, 1920);
  assert.equal(frame.contentHeight, 1080);
});

test('较高的桌面视口使用居中的 16 比 9 房间舞台而不继续裁掉两侧', () => {
  const frame = computeFlatProjectionFrame({
    width: 1440,
    height: 1000,
    sourceAspect: 2,
    view: { yaw: 0, pitch: 0, fov: defaultFov },
    defaultFov,
  });

  assert.equal(frame.contentX, 0);
  assert.equal(frame.contentY, 95);
  assert.equal(frame.contentWidth, 1440);
  assert.equal(frame.contentHeight, 810);
  assert.ok(Math.abs(frame.spanU - (16 / 18)) < 1e-9);
  assert.equal(frame.spanV, 1);

  const gym = projectFlatPoint(degrees(111), degrees(-5), frame);
  const sofa = projectFlatPoint(degrees(-2), degrees(-21), frame);
  const whiteboard = projectFlatPoint(degrees(-125), degrees(3), frame);
  assert.ok(gym.visible && sofa.visible && whiteboard.visible);
  assert.ok(gym.x < sofa.x && sofa.x < whiteboard.x);
});

test('Figma 房间三个核心物件按健身区、沙发、白板从左到右投影', () => {
  const frame = computeFlatProjectionFrame({
    width: 1920,
    height: 1080,
    sourceAspect: 2,
    view: { yaw: 0, pitch: 0, fov: defaultFov },
    defaultFov,
  });
  const gym = projectFlatPoint(degrees(111), degrees(-5), frame);
  const sofa = projectFlatPoint(degrees(-2), degrees(-21), frame);
  const whiteboard = projectFlatPoint(degrees(-125), degrees(3), frame);

  assert.ok(gym.visible && sofa.visible && whiteboard.visible);
  assert.ok(gym.x < sofa.x && sofa.x < whiteboard.x);
  assert.ok(gym.x > 0 && whiteboard.x < frame.width);
});

test('手机端 cover 取景保持纵向铺满且不拉伸原图', () => {
  const frame = computeFlatProjectionFrame({
    width: 390,
    height: 844,
    sourceAspect: 2,
    view: { yaw: 0, pitch: 0, fov: defaultFov },
    defaultFov,
  });

  assert.equal(frame.spanV, 1);
  assert.ok(Math.abs(frame.spanU - ((390 / 844) / 2)) < 1e-9);
  assert.ok(Math.abs((frame.width / frame.spanU) / (frame.height / frame.spanV) - 2) < 1e-9);
  assert.equal(frame.contentWidth, 390);
  assert.equal(frame.contentHeight, 844);
});

test('平面视图不会越过 cover 基线造成单轴拉伸', () => {
  const frame = computeFlatProjectionFrame({
    width: 390,
    height: 844,
    sourceAspect: 2,
    view: { yaw: 0, pitch: 0, fov: degrees(100) },
    defaultFov,
  });

  assert.equal(frame.spanV, 1);
  assert.ok(Math.abs(frame.spanU - ((390 / 844) / 2)) < 1e-9);
});

test('平面热点投影与反投影在拖动缩放后仍可逆', () => {
  const frame = computeFlatProjectionFrame({
    width: 1440,
    height: 900,
    sourceAspect: 2,
    view: { yaw: degrees(-24), pitch: degrees(-8), fov: degrees(42) },
    defaultFov,
  });
  const expected = { yaw: degrees(-12), pitch: degrees(-18) };
  const projected = projectFlatPoint(expected.yaw, expected.pitch, frame);
  const actual = unprojectFlatPoint(projected.x, projected.y, frame);

  assert.ok(projected.visible);
  assert.ok(Math.abs(actual.yaw - expected.yaw) < 1e-9);
  assert.ok(Math.abs(actual.pitch - expected.pitch) < 1e-9);
});

test('球形投影中的房间角色会随视角旋转改变屏幕位置', () => {
  const room = {
    projection: 'spherical',
    stage: { clientWidth: 1440, clientHeight: 1000 },
    view: { yaw: degrees(0), pitch: degrees(-2), fov: degrees(78) },
  };
  const raccoon = { yaw: degrees(-42), pitch: degrees(-24) };
  const initialFrame = PanoramaRoom.prototype.projectionFrame.call(room);
  const initial = PanoramaRoom.prototype.projectPoint.call(room, raccoon.yaw, raccoon.pitch, initialFrame);

  room.view = { ...room.view, yaw: degrees(-28) };
  const rotatedFrame = PanoramaRoom.prototype.projectionFrame.call(room);
  const rotated = PanoramaRoom.prototype.projectPoint.call(room, raccoon.yaw, raccoon.pitch, rotatedFrame);

  assert.equal(initial.visible, true);
  assert.equal(rotated.visible, true);
  assert.notEqual(Math.round(initial.x), Math.round(rotated.x));
});

test('减少动态时禁用连续旋转与缩放，但不禁用三个文字入口', () => {
  assert.equal(canManipulatePanorama({ interactionEnabled: true, reducedMotion: false }), true);
  assert.equal(canManipulatePanorama({ interactionEnabled: true, reducedMotion: true }), false);
  assert.equal(canManipulatePanorama({ interactionEnabled: false, reducedMotion: false }), false);
});

test('统一相机输入约束环视和缩放，并在交互锁定时拒绝手势增量', () => {
  let renderCount = 0;
  const room = {
    interactionEnabled: true,
    reducedMotion: false,
    projection: 'spherical',
    defaultView: { yaw: 0, pitch: 0, fov: degrees(86) },
    view: { yaw: 0, pitch: 0, fov: degrees(70) },
    idleView: null,
    animation: { resolve() {} },
    stage: { clientHeight: 800 },
    requestRender() { renderCount += 1; },
  };

  const applied = PanoramaRoom.prototype.applyInputDelta.call(room, {
    panX: 10_000,
    panY: 10_000,
    zoomDelta: -10,
  });

  assert.equal(applied, true);
  assert.equal(room.view.pitch, 0.4);
  assert.equal(room.view.fov, 0.55);
  assert.ok(room.view.yaw >= -Math.PI && room.view.yaw <= Math.PI);
  assert.deepEqual(room.idleView, room.view);
  assert.equal(room.animation, null);
  assert.equal(renderCount, 1);

  room.reducedMotion = true;
  const before = { ...room.view };
  assert.equal(PanoramaRoom.prototype.applyInputDelta.call(room, { panX: 20 }), false);
  assert.deepEqual(room.view, before);
});

test('体感角度增量复用全景交互锁、动态偏好与视角边界', () => {
  const calls = [];
  const room = {
    interactionEnabled: true,
    reducedMotion: false,
    projection: 'spherical',
    defaultView: { fov: 1.2 },
    view: { yaw: 0.1, pitch: 0.39, fov: 1 },
    idleView: {},
    animation: null,
    requestRender: () => calls.push('render'),
  };

  assert.equal(PanoramaRoom.prototype.applyAngularInputDelta.call(room, {
    yawDelta: 0.2,
    pitchDelta: 0.2,
  }), true);
  assert.ok(Math.abs(room.view.yaw - 0.3) < 1e-9);
  assert.equal(room.view.pitch, 0.4);
  assert.deepEqual(calls, ['render']);

  room.reducedMotion = true;
  assert.equal(PanoramaRoom.prototype.applyAngularInputDelta.call(room, { yawDelta: 0.5 }), false);
  assert.ok(Math.abs(room.view.yaw - 0.3) < 1e-9);
});

test('房间功能标签完整进入可视区后才显示，避免平板端露出半截', () => {
  const frame = { width: 768, height: 900 };
  const hotspot = {
    kind: 'feature',
    asset: { src: './hotspot.png', width: 190, height: 79 },
  };

  assert.equal(
    projectedHotspotFitsViewport({ visible: true, x: 40, y: 450 }, frame, hotspot),
    false,
  );
  assert.equal(
    projectedHotspotFitsViewport({ visible: true, x: 110, y: 450 }, frame, hotspot),
    true,
  );
  assert.equal(
    projectedHotspotFitsViewport({ visible: true, x: 20, y: 450 }, frame, { kind: 'thought' }),
    true,
  );
});

test('空气指针只命中可见功能热点，并沿用热点原有点击入口', () => {
  let clicks = 0;
  const featureElement = {
    hidden: false,
    getBoundingClientRect: () => ({ left: 110, top: 220, right: 250, bottom: 300 }),
    click: () => { clicks += 1; },
  };
  const thoughtElement = {
    hidden: false,
    getBoundingClientRect: () => ({ left: 110, top: 220, right: 250, bottom: 300 }),
    click: () => { clicks += 10; },
  };
  const room = {
    interactionEnabled: true,
    stage: { getBoundingClientRect: () => ({ left: 10, top: 20 }) },
    hotspots: [
      { id: 'sofa-phone', kind: 'feature' },
      { id: 'package-thought', kind: 'thought' },
    ],
    hotspotElements: new Map([
      ['sofa-phone', featureElement],
      ['package-thought', thoughtElement],
    ]),
  };

  assert.equal(PanoramaRoom.prototype.hotspotAtPoint.call(room, { x: 150, y: 230 }), 'sofa-phone');
  assert.equal(PanoramaRoom.prototype.hotspotAtPoint.call(room, { x: 20, y: 20 }), null);
  assert.equal(PanoramaRoom.prototype.activateHotspot.call(room, 'package-thought'), false);
  assert.equal(PanoramaRoom.prototype.activateHotspot.call(room, 'sofa-phone'), true);
  assert.equal(clicks, 1);
});
