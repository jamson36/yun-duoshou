import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ENTRY_TRANSITION_MS,
  INTRO_DURATION_MS,
  RoomIntro,
  introProgress,
  pixelBoundary,
} from '../intro-transition.js';

function createVideoMock({ playResult = Promise.resolve() } = {}) {
  const listeners = new Map();
  return {
    muted: false,
    playsInline: false,
    loop: false,
    currentTime: 2,
    playCalls: 0,
    pauseCalls: 0,
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    dispatch(name) {
      listeners.get(name)?.forEach((listener) => listener());
    },
    play() {
      this.playCalls += 1;
      return typeof playResult === 'function' ? playResult() : playResult;
    },
    pause() { this.pauseCalls += 1; },
  };
}

function createIntroHarness({
  video = null,
  entryVideo = null,
  reducedMotion = false,
  onComplete = null,
} = {}) {
  const originalWindow = globalThis.window;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const timers = new Map();
  const frames = new Map();
  let nextTimer = 1;
  let nextFrame = 1;

  globalThis.window = {
    addEventListener() {},
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    devicePixelRatio: 1,
  };
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);

  const classNames = new Set();
  const gateAttributes = new Map();
  const lockupAttributes = new Map();
  const context = {
    clearRect() {},
    fillRect() {},
    fillText() {},
    setTransform() {},
  };
  const gate = {
    classList: {
      add: (...names) => names.forEach((name) => classNames.add(name)),
      remove: (...names) => names.forEach((name) => classNames.delete(name)),
    },
    getBoundingClientRect: () => ({ width: 390, height: 844 }),
    setAttribute(name, value) { gateAttributes.set(name, value); },
  };
  const app = { dataset: {} };
  const status = { textContent: '' };
  const lockup = {
    inert: true,
    setAttribute(name, value) { lockupAttributes.set(name, value); },
  };
  const enterButton = {
    disabled: true,
    addEventListener() {},
  };
  const intro = new RoomIntro({
    app,
    gate,
    canvas: { getContext: () => context, style: {} },
    status,
    lockup,
    enterButton,
    video,
    entryVideo,
    duration: INTRO_DURATION_MS,
    reducedMotion,
    onComplete,
  });

  return {
    app,
    classNames,
    enterButton,
    frames,
    gateAttributes,
    intro,
    lockup,
    lockupAttributes,
    status,
    timers,
    restore() {
      globalThis.window = originalWindow;
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    },
  };
}

test('像素瀑布边界在三段进度中持续向下显露房间', () => {
  const input = { column: 18, columns: 96, rows: 64 };
  const start = pixelBoundary({ ...input, progress: 0 });
  const middle = pixelBoundary({ ...input, progress: 0.5 });
  const end = pixelBoundary({ ...input, progress: 1 });

  assert.ok(start < middle);
  assert.ok(middle < end);
  assert.ok(end > input.rows);
});

test('同一列与进度得到确定性的像素边界', () => {
  const input = { column: 42, columns: 96, rows: 64, progress: 0.38 };
  assert.equal(pixelBoundary(input), pixelBoundary(input));
});

test('开屏固定为 3 秒，进房过渡保持在 300–500ms', () => {
  assert.equal(INTRO_DURATION_MS, 3000);
  assert.ok(ENTRY_TRANSITION_MS >= 300);
  assert.ok(ENTRY_TRANSITION_MS <= 500);
  assert.equal(introProgress({ startedAt: 100, now: 1600 }), 0.5);
  assert.equal(introProgress({ startedAt: 100, now: 3100 }), 1);
});

test('报告结果刷新可一次性跳过开屏并直接恢复房间', () => {
  const openingVideo = createVideoMock();
  const entryVideo = createVideoMock();
  let completed = 0;
  const harness = createIntroHarness({
    video: openingVideo,
    entryVideo,
    onComplete: () => { completed += 1; },
  });

  try {
    harness.intro.skipToRoom();

    assert.equal(harness.app.dataset.roomPhase, 'room');
    assert.equal(harness.intro.started, true);
    assert.equal(harness.intro.finished, true);
    assert.equal(harness.gateAttributes.get('aria-hidden'), 'true');
    assert.equal(harness.gateAttributes.get('aria-busy'), 'false');
    assert.equal(harness.lockup.inert, true);
    assert.equal(harness.lockupAttributes.get('aria-hidden'), 'true');
    assert.equal(harness.enterButton.disabled, true);
    assert.equal(harness.classNames.has('is-complete'), true);
    assert.equal(openingVideo.playCalls, 0);
    assert.equal(entryVideo.playCalls, 0);
    assert.equal(harness.frames.size, 0);
    assert.equal(harness.timers.size, 0);
    assert.equal(completed, 1);

    harness.intro.skipToRoom();
    assert.equal(completed, 1, '重复调用不能再次触发完成回调');
  } finally {
    harness.restore();
  }
});

test('开屏不再渲染金额装饰', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /intro-amount-cloud/);
  assert.doesNotMatch(css, /intro-amount-cloud|intro-amount-drift/);
  assert.doesNotMatch(html, /-10元/);
  assert.doesNotMatch(html, /-35元/);
  assert.doesNotMatch(html, /-120元/);
});

test('三秒揭幕只播一次，随后循环 Figma 4:5 入口视频直到进入房间', async () => {
  const openingVideo = createVideoMock();
  const entryVideo = createVideoMock();
  const harness = createIntroHarness({ video: openingVideo, entryVideo });

  try {
    harness.intro.start();
    assert.equal(openingVideo.playCalls, 1);
    assert.equal(openingVideo.muted, true);
    assert.equal(openingVideo.playsInline, true);
    assert.equal(openingVideo.currentTime, 0);
    assert.equal(entryVideo.playCalls, 0);
    assert.equal(harness.frames.size, 1, '视频真正 playing 前 Canvas 持续提供回退');

    openingVideo.dispatch('playing');
    assert.equal(harness.classNames.has('is-video-playing'), true);
    assert.equal(harness.frames.size, 0, '视频播放时停止重复绘制全屏 Canvas');

    const gateTimer = [...harness.timers.values()][0];
    assert.equal(gateTimer.delay, INTRO_DURATION_MS);
    gateTimer.callback();
    assert.equal(harness.intro.finished, true);
    assert.equal(harness.enterButton.disabled, false);
    assert.equal(harness.classNames.has('is-video-playing'), false);
    assert.equal(harness.classNames.has('is-entry-ready'), true);
    assert.ok(openingVideo.pauseCalls >= 1);
    assert.equal(entryVideo.playCalls, 1);
    assert.equal(entryVideo.muted, true);
    assert.equal(entryVideo.playsInline, true);
    assert.equal(entryVideo.loop, true);
    assert.equal(entryVideo.currentTime, 0);

    entryVideo.dispatch('playing');
    assert.equal(harness.classNames.has('is-entry-video-playing'), true);

    await harness.intro.enter();
    assert.equal(harness.classNames.has('is-video-playing'), false);
    assert.equal(harness.classNames.has('is-entry-video-playing'), false);
    assert.ok(entryVideo.pauseCalls >= 1);
  } finally {
    harness.restore();
  }
});

test('开屏视频播放被拒绝时继续 Canvas 回退且不改变门禁时长', async () => {
  const video = createVideoMock({ playResult: () => Promise.reject(new Error('autoplay denied')) });
  const harness = createIntroHarness({ video });

  try {
    harness.intro.start();
    await Promise.resolve();
    assert.equal(harness.intro.videoFailed, true);
    assert.equal(harness.classNames.has('is-video-playing'), false);
    assert.equal(harness.frames.size, 1);
    assert.equal([...harness.timers.values()][0].delay, INTRO_DURATION_MS);
    assert.equal(harness.intro.finished, false);
  } finally {
    harness.intro.finish();
    harness.restore();
  }
});

test('视频开屏途中切换减少动态会暂停视频并立即显示静态回退', () => {
  const video = createVideoMock();
  const harness = createIntroHarness({ video });
  const draws = [];
  const draw = harness.intro.draw.bind(harness.intro);
  harness.intro.draw = (progress) => {
    draws.push(progress);
    draw(progress);
  };

  try {
    harness.intro.start();
    video.dispatch('playing');
    harness.intro.setReducedMotion(true);

    assert.equal(harness.classNames.has('is-video-playing'), false);
    assert.equal(harness.frames.size, 0);
    assert.equal(draws.at(-1), 1);
    assert.ok(video.pauseCalls >= 1);
    assert.equal(harness.intro.finished, false);
    assert.equal([...harness.timers.values()][0].delay, INTRO_DURATION_MS);
  } finally {
    harness.intro.finish();
    harness.restore();
  }
});

test('开屏途中切换减少动态会直接揭示且不提前解除三秒门禁', () => {
  const originalWindow = globalThis.window;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const timers = new Map();
  const frames = new Map();
  let nextTimer = 1;
  let nextFrame = 1;

  globalThis.window = {
    addEventListener() {},
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    devicePixelRatio: 1,
  };
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);

  const classNames = new Set();
  const context = {
    clearRect() {},
    fillRect() {},
    fillText() {},
    setTransform() {},
  };
  const gate = {
    classList: { add: (name) => classNames.add(name) },
    getBoundingClientRect: () => ({ width: 390, height: 844 }),
    setAttribute() {},
  };
  const enterButton = {
    disabled: true,
    addEventListener() {},
  };
  const intro = new RoomIntro({
    app: { dataset: {} },
    gate,
    canvas: { getContext: () => context, style: {} },
    status: { textContent: '' },
    lockup: { inert: true, setAttribute() {} },
    enterButton,
    duration: INTRO_DURATION_MS,
  });
  const draws = [];
  const draw = intro.draw.bind(intro);
  intro.draw = (progress) => {
    draws.push(progress);
    draw(progress);
  };

  try {
    intro.start();
    const gateTimer = [...timers.values()][0];
    assert.equal(gateTimer.delay, INTRO_DURATION_MS);

    const firstFrame = [...frames.values()][0];
    frames.clear();
    firstFrame(intro.startedAt + 1200);
    assert.ok(draws.at(-1) > 0 && draws.at(-1) < 1);

    intro.setReducedMotion(true);
    assert.equal(draws.at(-1), 1, '切换减少动态后直接揭示，不回画黑色起点');
    assert.equal(intro.finished, false);
    assert.equal(enterButton.disabled, true);
    assert.equal(timers.size, 1, '固定三秒门禁计时器仍然保留');

    intro.setReducedMotion(false);
    const resumedFrame = [...frames.values()][0];
    frames.clear();
    resumedFrame(intro.startedAt + 1500);
    assert.equal(draws.at(-1), 1, '恢复动态后也不得从已揭示状态倒退');
    assert.equal(intro.finished, false, '视觉揭示不等于提前结束门禁');

    gateTimer.callback();
    assert.equal(intro.finished, true);
    assert.equal(enterButton.disabled, false);
    assert.ok(classNames.has('is-entry-ready'));
  } finally {
    globalThis.window = originalWindow;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});
