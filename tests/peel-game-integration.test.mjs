import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../peel-game-ui.js', import.meta.url), 'utf8');

function functionSource(name, nextName) {
  const start = appSource.indexOf(`function ${name}(`);
  const end = appSource.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `应能读取 ${name} 的实际实现`);
  return appSource.slice(start, end);
}

test('主页把掌机注册为独立 activity 并交给唯一游戏协调器', () => {
  assert.match(appSource, /import \{[^}]*ACTIVITY_HOTSPOTS[^}]*\} from '.\/scene-config\.js/);
  assert.match(appSource, /import \{ createPeelGameController \} from '.\/peel-game-ui\.js/);
  assert.match(appSource, /import \{ createPeelGestureMapper \} from '.\/peel-gesture-controls\.js/);
  assert.match(appSource, /const sceneHotspots = \[\.\.\.FEATURE_HOTSPOTS, \.\.\.ACTIVITY_HOTSPOTS, \.\.\.createPackageHotspots\(\)\]/);
  assert.match(appSource, /hotspot\.activity === 'peel'[\s\S]*?openPeelActivity\(trigger\)/);
});

test('房间 activity 深链可在启动、后退与当前界面签名之间往返', () => {
  const routeSource = functionSource('routeSnapshot', 'currentRouteSnapshot');
  const currentSource = functionSource('currentRouteSnapshot', 'syncRouteFromLocation');
  const syncSource = functionSource('syncRouteFromLocation', 'idleSpeech');

  assert.match(routeSource, /parseRoomHashState\(location\.hash\)\.activity/);
  assert.match(currentSource, /activity:\s*activePanel \? null : activeActivity/);
  assert.match(syncSource, /route\.activity === 'peel'[\s\S]*?openPeelActivity/);
  assert.match(syncSource, /closePeelActivity/);
  assert.match(appSource, /initialActivity[\s\S]*?buildRoomHash\(\{ activity: initialActivity \}\)/);
});

test('游戏打开后与业务面板互斥，关闭、Esc 与浏览器后退都回到房间层', () => {
  const openSource = functionSource('openPeelActivity', 'finalizePeelActivityClose');
  const closeSource = functionSource('finalizePeelActivityClose', 'closePeelActivity');

  assert.match(openSource, /activePanel/);
  assert.match(openSource, /setRoomUiInteractive\(false\)/);
  assert.match(openSource, /setRoomBackgroundSuppressed\(true\)/);
  assert.match(openSource, /buildRoomHash\(\{ activity: 'peel' \}\)/);
  assert.match(closeSource, /setRoomUiInteractive\(roomEntered && !activePanel\)/);
  assert.match(closeSource, /setRoomBackgroundSuppressed\(Boolean\(activePanel\)\)/);
  assert.match(closeSource, /returnTarget\.focus[\s\S]*?sceneFrame\.focus/);
  const keydownSource = functionSource('handlePeelActivityKeydown', 'idleSpeech');
  assert.match(keydownSource, /activeActivity !== 'peel'[\s\S]*?event\.key === 'Escape'/);
});

test('体感帧只经过剥壳映射器，丢手暂停，恢复后继续', () => {
  const consumerSource = functionSource('consumePeelGestureFrame', 'handlePeelInputMode');
  const inputSource = functionSource('handlePeelInputMode', 'peelRoundSeed');

  assert.match(consumerSource, /peelGestureMapper\.update/);
  assert.match(consumerSource, /command\?\.type === 'segment'[\s\S]*?applySegment/);
  assert.match(consumerSource, /command\?\.type === 'pause'[\s\S]*?\.pause\('hand-lost'\)/);
  assert.match(consumerSource, /command\?\.type === 'resume'[\s\S]*?\.resume\(\)/);
  assert.match(inputSource, /startForActivity\(consumePeelGestureFrame\)/);
  assert.match(inputSource, /pauseActivityForPointer\(\)/);
});

test('结算意图只能复用现有订单页或预填表单，不直接改业务事实', () => {
  const resolverSource = functionSource('resolvePeelFocusAction', 'openPeelBusinessPanel');
  const handlerSource = functionSource('handlePeelGameIntent', 'peelActivityFocusableElements');

  assert.match(resolverSource, /status === 'cooling'/);
  assert.match(handlerSource, /focusPeelOrder/);
  assert.match(handlerSource, /prefillOrderFromCommerce/);
  assert.match(handlerSource, /intent\?\.type === 'dismiss'/);
  assert.match(handlerSource, /intent\?\.type === 'replay'/);
  assert.doesNotMatch(handlerSource, /createOrder|simulateCommerceOrder|mutate\(|localStorage|startAiDiagnosis|requestAiDiagnosis/);
});

test('重玩会重新建立上一局输入模式，但不会从结果页绑定业务手势', () => {
  const replayStart = uiSource.indexOf('function replay()');
  const replayEnd = uiSource.indexOf('async function open(', replayStart);
  const replaySource = uiSource.slice(replayStart, replayEnd);

  assert.match(replaySource, /onInputMode\(inputMode\)/);
  assert.doesNotMatch(uiSource, /data-gesture-target/);
});
