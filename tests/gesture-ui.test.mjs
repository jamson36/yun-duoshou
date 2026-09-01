import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  GestureFrameGate,
  RoomGestureController,
  cameraErrorMessage,
  gestureFrameInterval,
} from '../gesture-ui.js';

test('gesture frame gate keeps at most one recognition frame in flight', () => {
  const gate = new GestureFrameGate(66);

  assert.equal(gate.tryAcquire(0), true);
  assert.equal(gate.tryAcquire(80), false);

  gate.release();
  assert.equal(gate.tryAcquire(40), false);
  assert.equal(gate.tryAcquire(70), true);
});

test('gesture frame interval backs off on smaller or lower-concurrency devices', () => {
  assert.equal(gestureFrameInterval({ width: 1440, hardwareConcurrency: 8 }), 66);
  assert.equal(gestureFrameInterval({ width: 390, hardwareConcurrency: 8 }), 83);
  assert.equal(gestureFrameInterval({ width: 1440, hardwareConcurrency: 2 }), 100);
});

test('camera errors are translated into actionable, provider-neutral copy', () => {
  assert.match(cameraErrorMessage({ name: 'NotAllowedError' }), /允许摄像头/);
  assert.match(cameraErrorMessage({ name: 'NotFoundError' }), /没有找到可用摄像头/);
  assert.match(cameraErrorMessage({ name: 'NotReadableError' }), /其他应用/);
  assert.match(cameraErrorMessage({ name: 'UnknownError' }), /暂时无法启动/);
});

test('closing the disclosure while permission is pending cancels that gesture session', () => {
  const calls = [];
  const controller = {
    starting: true,
    stop: (reason) => calls.push(['stop', reason]),
    elements: {
      dialog: { open: true, close: () => calls.push(['close']) },
      openButton: { focus: () => calls.push(['focus']) },
    },
  };

  RoomGestureController.prototype.closeDialog.call(controller);
  assert.deepEqual(calls, [['stop', 'user'], ['close'], ['focus']]);
});

test('进入功能页时暂停正在运行的手势，并保留返回房间的恢复资格', () => {
  const calls = [];
  const controller = {
    active: true,
    starting: false,
    stream: null,
    worker: null,
    panelResumePending: false,
    stop: (reason) => calls.push(reason) && true,
  };

  assert.equal(RoomGestureController.prototype.pauseForPanel.call(controller), true);
  assert.equal(controller.panelResumePending, true);
  assert.deepEqual(calls, ['panel']);
});

test('退出功能页后只消费一次恢复资格，未开启或减少动态时不自动启动', () => {
  const calls = [];
  const controller = {
    panelResumePending: true,
    active: false,
    starting: false,
    isRoomAvailable: () => true,
    isReducedMotion: () => false,
    start: (options) => calls.push(options),
  };

  assert.equal(RoomGestureController.prototype.resumeFromPanel.call(controller), true);
  assert.equal(controller.panelResumePending, false);
  assert.deepEqual(calls, [{ resume: true }]);
  assert.equal(RoomGestureController.prototype.resumeFromPanel.call(controller), false);

  controller.panelResumePending = true;
  controller.isReducedMotion = () => true;
  assert.equal(RoomGestureController.prototype.resumeFromPanel.call(controller), false);
  assert.equal(controller.panelResumePending, false);
  assert.deepEqual(calls, [{ resume: true }]);
});

test('主动停止或页面转入后台会取消尚未消费的自动恢复', () => {
  for (const reason of ['user', 'hidden', 'reduced-motion', 'destroy']) {
    const controller = {
      active: false,
      starting: false,
      stream: null,
      worker: null,
      panelResumePending: true,
    };

    assert.equal(RoomGestureController.prototype.stop.call(controller, reason), false);
    assert.equal(controller.panelResumePending, false);
  }
});

test('功能面板打开时暂停手势，回到房间后调用自动恢复钩子', async () => {
  const [appSource, html] = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
  ]);

  assert.match(appSource, /gestureController\.pauseForPanel\(\)/);
  assert.match(appSource, /gestureController\.resumeFromPanel\(\)/);
  assert.doesNotMatch(appSource, /gestureController\.stop\('panel'\)/);
  assert.match(html, /回到房间会自动恢复/);
});
