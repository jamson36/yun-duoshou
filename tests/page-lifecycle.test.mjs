import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const lifecycle = source.slice(source.indexOf('function handlePageHide('), source.indexOf("sceneFrame.addEventListener('panoramaready'"));

function harness() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  const controller = (name) => ({
    stop: record(`${name}.stop`), pause: record(`${name}.pause`),
    resume: record(`${name}.resume`), destroy: record(`${name}.destroy`),
  });
  const context = {
    window: { addEventListener: record('listen') },
    document: { removeEventListener: record('removeKeydown') },
    sceneViewportMedia: { removeEventListener: record('removeViewport') },
    syncSceneDefaultView() {}, handlePeelActivityKeydown() {},
    aiConsentChannel: { close: record('channel.close') },
    cancelAiRequest: () => true,
    aiUiState: { status: 'requesting' }, activeActivity: 'peel', activePanel: 'clinic',
    gachaponMotion: { setActive: record('motion.active'), destroy: record('motion.destroy') },
    gestureController: controller('gesture'), orientationController: controller('orientation'),
    peelGameController: controller('peel'), peelCloseOptions: {},
    roomIntro: { stopVideo: record('video.stop'), startEntryVideo: record('video.start') },
    app: { dataset: { roomPhase: 'entry' } },
    STORAGE_KEY: 'state', localStorage: { getItem: () => 'updated-state' },
    applyExternalBusinessState: record('storage.sync'),
    aiConsentRevokedByFallback: () => true,
    applyExternalConsentRevocation: record('consent.revoke'), renderAll: record('render'),
  };
  vm.runInNewContext(lifecycle, context);
  return { calls, context };
}

test('页面缓存往返可重复暂停并恢复，保留控制器和入口监听', () => {
  const { context, calls } = harness();
  for (let visit = 0; visit < 2; visit += 1) {
    context.handlePageHide({ persisted: true });
    assert.equal(context.aiUiState.status, 'idle');
    context.handlePageShow({ persisted: true });
  }
  for (const name of ['gesture.stop', 'orientation.stop', 'peel.pause', 'peel.resume', 'storage.sync', 'consent.revoke', 'video.start']) {
    assert.equal(calls.filter(([event]) => event === name).length, 2, name);
  }
  assert.equal(calls.some(([event]) => event.endsWith('.destroy') || event.startsWith('remove') || event === 'channel.close'), false);
  assert.deepEqual(calls.filter(([event]) => event === 'motion.active'), [
    ['motion.active', false], ['motion.active', true], ['motion.active', false], ['motion.active', true],
  ]);
});

test('真正离开页面时销毁资源，普通 pageshow 不重复启动控制器', () => {
  const { context, calls } = harness();
  context.handlePageHide({ persisted: false });
  for (const name of ['gesture.destroy', 'orientation.destroy', 'peel.destroy', 'motion.destroy', 'channel.close', 'removeKeydown', 'removeViewport']) {
    assert.equal(calls.filter(([event]) => event === name).length, 1, name);
  }
  const count = calls.length;
  context.handlePageShow({ persisted: false });
  assert.equal(calls.length, count);
});

test('缓存恢复时本地存储不可用也能恢复交互，进入房间后不重播开屏', () => {
  const { context, calls } = harness();
  context.localStorage.getItem = () => { throw new Error('storage unavailable'); };
  context.app.dataset.roomPhase = 'room';
  context.handlePageShow({ persisted: true });
  assert.equal(calls.some(([event]) => event === 'peel.resume'), true);
  assert.equal(calls.some(([event]) => event === 'video.start'), false);
});
