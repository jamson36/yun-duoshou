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

test('功能页暂停释放摄像头与推理帧，但保留已初始化的 Worker 供快速恢复', () => {
  const calls = [];
  const controller = {
    active: true,
    starting: false,
    stream: { getTracks: () => [] },
    worker: {},
    workerReady: true,
    panelResumePending: true,
    session: 4,
    releaseResources: (options) => calls.push(['release', options]),
    mapper: { reset: () => calls.push(['mapper-reset']) },
    updatePointer: (value) => calls.push(['pointer', value]),
    elements: {
      root: { removeAttribute: (name) => calls.push(['remove', name]) },
      dialog: { open: false },
    },
    setState: (state, copy) => calls.push(['state', state, copy]),
    onToast: (copy) => calls.push(['toast', copy]),
  };

  assert.equal(RoomGestureController.prototype.stop.call(controller, 'panel'), true);
  assert.equal(controller.session, 5);
  assert.equal(controller.active, false);
  assert.equal(controller.starting, false);
  assert.deepEqual(calls[0], ['release', { keepWorker: true }]);
});

test('功能页之间切换不会重复停止已保留的 Worker', () => {
  const controller = {
    active: false,
    starting: false,
    worker: {},
    panelResumePending: true,
    stop: () => assert.fail('不应重复停止 Worker'),
  };

  assert.equal(RoomGestureController.prototype.pauseForPanel.call(controller), true);
  assert.equal(controller.panelResumePending, true);
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

test('房间手势进入剥壳机时复用当前摄像头与 Worker，并切换输入域', () => {
  const calls = [];
  const consumer = () => {};
  const controller = {
    active: true,
    starting: false,
    stream: {},
    worker: {},
    workerReady: true,
    inputContext: 'room',
    activityFrameConsumer: null,
    activityReturnToRoom: false,
    resumePolicy: 'manual',
    mapper: { reset: () => calls.push('mapper-reset') },
    updatePointer: (pointer) => calls.push(['pointer', pointer]),
    setState: (state, copy) => calls.push(['state', state, copy]),
    stop: () => assert.fail('切换输入域不应停止媒体流'),
  };
  controller.canContinueIntoActivity = RoomGestureController.prototype.canContinueIntoActivity;

  assert.equal(RoomGestureController.prototype.canContinueIntoActivity.call(controller), true);
  assert.equal(RoomGestureController.prototype.continueIntoActivity.call(controller, consumer), true);
  assert.equal(controller.inputContext, 'activity');
  assert.equal(controller.activityFrameConsumer, consumer);
  assert.equal(controller.activityReturnToRoom, true);
  assert.equal(controller.resumePolicy, 'automatic');
  assert.deepEqual(calls.slice(0, 2), ['mapper-reset', ['pointer', null]]);

  assert.equal(RoomGestureController.prototype.continueIntoActivity.call(controller, consumer), true);
  assert.equal(controller.activityReturnToRoom, true);
  assert.equal(controller.resumePolicy, 'automatic');
});

test('剥壳机输入域只转发识别帧，不再驱动房间镜头或热点', () => {
  const calls = [];
  const controller = {
    inputContext: 'activity',
    consecutiveFrameErrors: 2,
    activityFrameConsumer: (frame) => calls.push(['activity', frame]),
    frameGate: { release: () => calls.push(['release']) },
    drawLandmarks: () => calls.push(['draw']),
    updateCalibration: () => assert.fail('游戏内不应触发房间校准提示'),
    stage: { getBoundingClientRect: () => assert.fail('游戏内不应读取房间舞台') },
    panorama: { applyInputDelta: () => assert.fail('游戏内不应驱动房间') },
    elements: { dialog: { open: true }, mode: { textContent: '' } },
  };
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));

  RoomGestureController.prototype.handleWorkerMessage.call(controller, {
    type: 'result',
    gesture: 'Pointing_Up',
    confidence: 0.91,
    landmarks,
  });

  assert.deepEqual(calls.slice(0, 2), [['release'], ['draw']]);
  assert.equal(calls[2][0], 'activity');
  assert.equal(calls[2][1].gesture, 'Pointing_Up');
  assert.equal(calls[2][1].score, 0.91);
  assert.equal(controller.consecutiveFrameErrors, 0);
  assert.match(controller.elements.mode.textContent, /食指/);
});

test('房间手势先进入显示帧插值，不把整段识别增量直接跳到全景', () => {
  const calls = [];
  const command = {
    mode: 'pan',
    panX: 48,
    panY: -12,
    zoomDelta: 0,
    pointer: null,
    activation: null,
  };
  const controller = {
    inputContext: 'room',
    consecutiveFrameErrors: 0,
    frameGate: { release: () => calls.push(['release']) },
    drawLandmarks: () => assert.fail('预览对话框关闭后不应继续绘制骨架'),
    updateCalibration: () => calls.push(['calibration']),
    mapper: { update: () => command },
    motionInterpolator: {
      setMode: (mode) => calls.push(['mode', mode]),
      push: (value) => calls.push(['push', value]),
    },
    stage: { getBoundingClientRect: () => ({ width: 1_000, height: 700 }) },
    panorama: {
      applyInputDelta: () => assert.fail('识别回调不应直接产生阶梯式镜头跳动'),
      hotspotAtPoint: () => null,
    },
    updatePointer: (pointer) => calls.push(['pointer', pointer]),
    elements: {
      dialog: { open: false },
      mode: { textContent: '' },
    },
  };

  RoomGestureController.prototype.handleWorkerMessage.call(controller, {
    type: 'result',
    gesture: 'Closed_Fist',
    confidence: 0.93,
    landmarks: Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 })),
  });

  assert.deepEqual(calls.find(([type]) => type === 'mode'), ['mode', 'pan']);
  assert.deepEqual(calls.find(([type]) => type === 'push'), ['push', command]);
});

test('显示帧只在房间上下文取出一小段镜头增量', () => {
  const calls = [];
  const controller = {
    active: true,
    inputContext: 'room',
    motionInterpolator: {
      sample: (at) => ({ panX: at / 10, panY: -2, zoomDelta: 0.01 }),
    },
    panorama: {
      applyInputDelta: (delta) => calls.push(delta),
    },
  };

  RoomGestureController.prototype.flushGestureMotion.call(controller, 160);
  assert.deepEqual(calls, [{ panX: 16, panY: -2, zoomDelta: 0.01 }]);

  controller.inputContext = 'activity';
  RoomGestureController.prototype.flushGestureMotion.call(controller, 176);
  assert.equal(calls.length, 1, '游戏输入域不能顺带移动房间镜头');
});

test('游戏内单独开启体感只请求游戏上下文，不获得返回房间自动恢复资格', async () => {
  const calls = [];
  const consumer = () => {};
  const controller = {
    active: false,
    starting: false,
    inputContext: 'none',
    activityFrameConsumer: null,
    activityReturnToRoom: false,
    resumePolicy: 'manual',
    start: async (options) => {
      calls.push(options);
      controller.active = true;
      controller.inputContext = options.context;
    },
  };
  controller.canContinueIntoActivity = RoomGestureController.prototype.canContinueIntoActivity;

  assert.equal(await RoomGestureController.prototype.startForActivity.call(controller, consumer), true);
  assert.equal(controller.inputContext, 'activity');
  assert.equal(controller.activityFrameConsumer, consumer);
  assert.equal(controller.activityReturnToRoom, false);
  assert.equal(controller.resumePolicy, 'manual');
  assert.deepEqual(calls, [{ context: 'activity' }]);
});

test('从房间带入的体感在结算后重玩仍保留返回房间资格', async () => {
  const consumer = () => {};
  const controller = {
    active: false,
    starting: false,
    inputContext: 'none',
    activityFrameConsumer: null,
    activityReturnToRoom: true,
    resumePolicy: 'automatic',
    start: async (options) => {
      controller.active = true;
      controller.inputContext = options.context;
    },
  };
  controller.canContinueIntoActivity = RoomGestureController.prototype.canContinueIntoActivity;

  assert.equal(await RoomGestureController.prototype.startForActivity.call(controller, consumer), true);
  assert.equal(controller.activityReturnToRoom, true);
  assert.equal(controller.resumePolicy, 'automatic');
  assert.equal(controller.inputContext, 'activity');
  assert.equal(controller.activityFrameConsumer, consumer);
});

test('游戏改用触摸时关闭摄像头但保留原房间手势的恢复资格', () => {
  const calls = [];
  const controller = {
    active: true,
    starting: false,
    stream: {},
    worker: {},
    inputContext: 'activity',
    activityFrameConsumer: () => {},
    activityReturnToRoom: true,
    resumePolicy: 'automatic',
    stop: (reason) => calls.push(reason) && true,
  };

  assert.equal(RoomGestureController.prototype.pauseActivityForPointer.call(controller), true);
  assert.equal(controller.inputContext, 'none');
  assert.equal(controller.activityFrameConsumer, null);
  assert.equal(controller.activityReturnToRoom, true);
  assert.equal(controller.resumePolicy, 'automatic');
  assert.deepEqual(calls, ['activity-pointer']);
});

test('结算关闭摄像头，退出游戏后只为原本已开启的房间手势恢复一次', () => {
  const calls = [];
  const controller = {
    active: true,
    starting: false,
    stream: {},
    worker: {},
    inputContext: 'activity',
    activityFrameConsumer: () => {},
    activityReturnToRoom: true,
    resumePolicy: 'automatic',
    isRoomAvailable: () => true,
    isReducedMotion: () => false,
    stop: (reason) => {
      calls.push(['stop', reason]);
      controller.active = false;
      controller.starting = false;
      controller.stream = null;
      return true;
    },
    start: (options) => calls.push(['start', options]),
  };

  assert.equal(RoomGestureController.prototype.finishActivityForSummary.call(controller), true);
  assert.equal(controller.inputContext, 'none');
  assert.deepEqual(calls, [['stop', 'activity-summary']]);

  assert.equal(RoomGestureController.prototype.returnToRoomFromActivity.call(controller), true);
  assert.equal(controller.activityReturnToRoom, false);
  assert.equal(controller.resumePolicy, 'manual');
  assert.deepEqual(calls, [
    ['stop', 'activity-summary'],
    ['start', { resume: true, context: 'room' }],
  ]);
  assert.equal(RoomGestureController.prototype.returnToRoomFromActivity.call(controller), false);
});

test('游戏介绍页直接返回房间时原地切回房间输入，不重启媒体流', () => {
  const calls = [];
  const controller = {
    active: true,
    starting: false,
    stream: {},
    inputContext: 'activity',
    activityFrameConsumer: () => {},
    activityReturnToRoom: true,
    resumePolicy: 'automatic',
    isRoomAvailable: () => true,
    isReducedMotion: () => false,
    mapper: { reset: () => calls.push('mapper-reset') },
    updatePointer: (pointer) => calls.push(['pointer', pointer]),
    setState: (state, copy) => calls.push(['state', state, copy]),
    stop: () => assert.fail('媒体流仍可用时不应先停止'),
    start: () => assert.fail('媒体流仍可用时不应重新请求'),
  };

  assert.equal(RoomGestureController.prototype.returnToRoomFromActivity.call(controller), true);
  assert.equal(controller.inputContext, 'room');
  assert.equal(controller.activityFrameConsumer, null);
  assert.equal(controller.activityReturnToRoom, false);
  assert.deepEqual(calls.slice(0, 2), ['mapper-reset', ['pointer', null]]);
});

test('从游戏进入业务页时只为原房间手势保留面板恢复资格', () => {
  const calls = [];
  const controller = {
    active: false,
    starting: false,
    stream: null,
    worker: {},
    workerReady: true,
    inputContext: 'none',
    activityFrameConsumer: null,
    activityReturnToRoom: true,
    resumePolicy: 'automatic',
    panelResumePending: false,
    stop: (reason) => calls.push(reason) && true,
  };

  assert.equal(RoomGestureController.prototype.handoffActivityToPanel.call(controller), true);
  assert.equal(controller.panelResumePending, true);
  assert.equal(controller.activityReturnToRoom, false);
  assert.equal(controller.resumePolicy, 'manual');
  assert.deepEqual(calls, ['panel']);
});

test('用户在游戏内主动停用体感会取消全部自动恢复资格', () => {
  const calls = [];
  const controller = {
    inputContext: 'activity',
    activityFrameConsumer: () => {},
    activityReturnToRoom: true,
    resumePolicy: 'automatic',
    stop: (reason) => calls.push(reason) && true,
  };

  assert.equal(RoomGestureController.prototype.stopActivityByUser.call(controller), true);
  assert.equal(controller.inputContext, 'none');
  assert.equal(controller.activityFrameConsumer, null);
  assert.equal(controller.activityReturnToRoom, false);
  assert.equal(controller.resumePolicy, 'manual');
  assert.deepEqual(calls, ['user']);
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
