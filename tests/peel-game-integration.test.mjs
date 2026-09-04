import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../desire-observatory.js', import.meta.url), 'utf8');

function functionSource(name, nextName) {
  const start = appSource.indexOf(`function ${name}(`);
  const end = appSource.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `应能读取 ${name} 的实际实现`);
  return appSource.slice(start, end);
}

test('主页把掌机注册为独立 activity 并交给唯一观察舱协调器', () => {
  assert.match(appSource, /import \{[^}]*ACTIVITY_HOTSPOTS[^}]*\} from '.\/scene-config\.js/);
  assert.match(appSource, /import \{ createDesireObservatoryController \} from '.\/desire-observatory\.js/);
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

test('观察舱打开后与业务面板互斥，关闭、Esc 与浏览器后退都回到房间层', () => {
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

test('观察舱作为模态 activity 时也从辅助技术中隐藏顶部语义入口', () => {
  const start = appSource.indexOf('const roomBackgroundRegions = [');
  const end = appSource.indexOf('function panelForMobileDockButton', start);
  const source = appSource.slice(start, end);

  assert.match(source, /document\.querySelector\('\.mobile-dock'\)/);
});

test('观察舱焦点循环跳过仅用于点击遮罩的负 tabindex 按钮', () => {
  const source = functionSource('peelActivityFocusableElements', 'handlePeelActivityKeydown');

  assert.match(source, /element\.tabIndex >= 0/);
});

test('体感帧经过平滑映射器后只旋转商品，丢手暂停，恢复后继续', () => {
  const consumerSource = functionSource('consumePeelGestureFrame', 'handlePeelInputMode');
  const inputSource = functionSource('handlePeelInputMode', 'peelRoundSeed');

  assert.match(consumerSource, /peelGestureMapper\.update/);
  assert.match(consumerSource, /command\?\.type === 'segment'[\s\S]*?applySegment/);
  assert.match(consumerSource, /command\?\.type === 'pause'[\s\S]*?\.pause\('hand-lost'\)/);
  assert.match(consumerSource, /command\?\.type === 'resume'[\s\S]*?\.resume\(\)/);
  assert.match(inputSource, /startForActivity\(consumePeelGestureFrame\)/);
  assert.match(inputSource, /pauseActivityForPointer\(\)/);
});

test('观察意图只能复用现有订单页或预填表单，不直接改业务事实', () => {
  const resolverSource = functionSource('resolvePeelFocusAction', 'openPeelBusinessPanel');
  const handlerSource = functionSource('handlePeelGameIntent', 'peelActivityFocusableElements');

  assert.match(resolverSource, /status === 'cooling'/);
  assert.match(handlerSource, /focusPeelOrder/);
  assert.match(handlerSource, /prefillOrderFromCommerce/);
  assert.match(handlerSource, /intent\?\.type === 'dismiss'/);
  assert.doesNotMatch(handlerSource, /createOrder|simulateCommerceOrder|mutate\(|localStorage|startAiDiagnosis|requestAiDiagnosis/);
});

test('观察舱只保留可丢弃交互状态，并通过 intent 交接业务', () => {
  assert.match(uiSource, /createDesireObservatoryController/);
  assert.match(uiSource, /onIntent\(\{ type: 'cool', focusItem: currentProduct\(\) \}\)/);
  assert.match(uiSource, /dismissedSignalIds\s*=\s*new Set/);
  assert.doesNotMatch(uiSource, /localStorage|sessionStorage|fetch\(|XMLHttpRequest/);
  assert.doesNotMatch(uiSource, /data-gesture-target/);
});
