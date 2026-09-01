import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  orientationErrorMessage,
  requestOrientationPermission,
  shouldOfferOrientationControl,
} from '../orientation-ui.js';

test('只在支持方向事件的触屏设备上用体感替代摄像头手势', () => {
  assert.equal(shouldOfferOrientationControl({ hasOrientationEvent: true, coarsePointer: true }), true);
  assert.equal(shouldOfferOrientationControl({ hasOrientationEvent: true, maxTouchPoints: 5, viewportWidth: 390 }), true);
  assert.equal(shouldOfferOrientationControl({ hasOrientationEvent: true, coarsePointer: false, maxTouchPoints: 0, viewportWidth: 390 }), false);
  assert.equal(shouldOfferOrientationControl({ hasOrientationEvent: false, coarsePointer: true }), false);
});

test('需要显式权限的浏览器在用户动作中请求，拒绝时返回可识别错误', async () => {
  const granted = await requestOrientationPermission({ requestPermission: async () => 'granted' });
  assert.equal(granted, true);

  await assert.rejects(
    requestOrientationPermission({ requestPermission: async () => 'denied' }),
    (error) => error?.name === 'NotAllowedError',
  );
});

test('不需要额外权限方法的浏览器直接继续', async () => {
  assert.equal(await requestOrientationPermission({}), true);
});

test('体感错误文案可操作且不会暗示摄像头已开启', () => {
  assert.match(orientationErrorMessage({ name: 'NotAllowedError' }), /方向与动作权限/);
  assert.match(orientationErrorMessage({ name: 'SensorTimeoutError' }), /方向数据/);
  assert.doesNotMatch(orientationErrorMessage({ name: 'SensorTimeoutError' }), /摄像头/);
});

test('体感入口、校准和停止生命周期接入房间而不触碰业务动作', async () => {
  const [html, appSource, uiSource] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../orientation-ui.js', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /id="orientationControlButton"/);
  assert.match(html, /id="orientationRecalibrateButton"/);
  assert.match(html, /不使用摄像头/);
  assert.match(appSource, /orientationController\.stop\('panel'\)/);
  assert.match(appSource, /orientationController\.handleReducedMotionChange\(shouldReduceMotion\)/);
  assert.match(appSource, /orientationController\.destroy\(\)/);
  assert.doesNotMatch(uiSource, /orders|goals|diagnosis|localStorage|fetch\(/i);
});
