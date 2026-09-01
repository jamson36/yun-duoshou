import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANALYSIS_REPORT_DELAY_MS,
  ANALYSIS_STAGE_DURATION_MS,
  createAnalysisStageController,
} from '../analysis-stages.js';

function fakeClock() {
  let currentTime = 0;
  let nextId = 1;
  const queue = [];

  const schedule = (callback, delay) => {
    const task = { id: nextId++, at: currentTime + delay, callback, cancelled: false };
    queue.push(task);
    return task.id;
  };
  const cancel = (id) => {
    const task = queue.find((item) => item.id === id);
    if (task) task.cancelled = true;
  };
  const advance = async (milliseconds) => {
    const target = currentTime + milliseconds;
    while (true) {
      const task = queue
        .filter((item) => !item.cancelled && item.at <= target)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (!task) break;
      task.cancelled = true;
      currentTime = task.at;
      task.callback();
      await Promise.resolve();
    }
    currentTime = target;
    await Promise.resolve();
  };

  return { advance, cancel, now: () => currentTime, schedule };
}

test('成功推演按四阶段推进，完成校验前绝不显示第四阶段', async () => {
  const clock = fakeClock();
  const events = [];
  const controller = createAnalysisStageController({
    ...clock,
    onChange: (state) => events.push([clock.now(), state.index, state.outcome, state.active]),
  });

  controller.start();
  await clock.advance(ANALYSIS_STAGE_DURATION_MS * 4);
  assert.deepEqual(events.filter((event) => event[3]).map((event) => event[1]), [0, 1, 2]);

  const finished = controller.finish('success');
  await Promise.resolve();
  assert.equal(events.at(-1)[1], 3, '真实回包与结构校验后才进入第四阶段');
  await clock.advance(ANALYSIS_STAGE_DURATION_MS + ANALYSIS_REPORT_DELAY_MS - 1);
  assert.equal(controller.getSnapshot().active, true);
  await clock.advance(1);
  assert.equal(await finished, true);
  assert.equal(controller.getSnapshot().active, false);
  assert.equal(events.at(-1)[1], 3);
  assert.equal(events.at(-1)[3], false, '成功完成后观察者必须收到 active=false 终态');
});

test('快速成功响应仍保留 Figma 四阶段节奏，慢响应停在等待阶段', async () => {
  const clock = fakeClock();
  const events = [];
  const controller = createAnalysisStageController({
    ...clock,
    onChange: (state) => { if (state.active) events.push([clock.now(), state.index]); },
  });
  controller.start();
  const finished = controller.finish('success');

  await clock.advance(ANALYSIS_STAGE_DURATION_MS * 3 - 1);
  assert.equal(events.at(-1)[1], 2);
  await clock.advance(1);
  assert.equal(events.at(-1)[1], 3);
  await clock.advance(ANALYSIS_STAGE_DURATION_MS + ANALYSIS_REPORT_DELAY_MS);
  assert.equal(await finished, true);
});

test('错误只展示真实降级阶段，取消会清理所有等待', async () => {
  const errorClock = fakeClock();
  const errorEvents = [];
  const errorController = createAnalysisStageController({
    ...errorClock,
    onChange: (state) => errorEvents.push(state),
  });
  errorController.start();
  const fallback = errorController.finish('error');
  assert.equal(errorController.getSnapshot().index, 3);
  assert.equal(errorController.getSnapshot().outcome, 'error');
  await errorClock.advance(ANALYSIS_REPORT_DELAY_MS);
  assert.equal(await fallback, true);
  assert.equal(errorEvents.at(-1).active, false, '保留错误结果时也必须通知观察者流程已结束');
  assert.equal(errorEvents.at(-1).index, 3);
  assert.equal(errorEvents.at(-1).outcome, 'error');

  const cancelClock = fakeClock();
  const cancelController = createAnalysisStageController({ ...cancelClock });
  cancelController.start();
  const pending = cancelController.finish('success');
  cancelController.stop();
  assert.equal(await pending, false);
  await cancelClock.advance(10_000);
  assert.equal(cancelController.getSnapshot().active, false);
});

test('stop preserve 会保留结果并发出 active=false 的终态快照', async () => {
  const clock = fakeClock();
  const events = [];
  const controller = createAnalysisStageController({
    ...clock,
    onChange: (state) => events.push(state),
  });

  controller.start();
  const finishing = controller.finish('error');
  controller.stop({ preserve: true });

  assert.equal(await finishing, false);
  assert.equal(events.at(-1).active, false);
  assert.equal(events.at(-1).index, 3);
  assert.equal(events.at(-1).outcome, 'error');
});

test('减少动态时不强制等待阶段计时或报告位移', async () => {
  const clock = fakeClock();
  const controller = createAnalysisStageController({ ...clock });
  controller.start({ reduceMotion: true });
  assert.equal(controller.getSnapshot().index, 2);
  assert.equal(await controller.finish('success'), true);
  assert.equal(controller.getSnapshot().index, 3);
  assert.equal(controller.getSnapshot().active, false);
});
