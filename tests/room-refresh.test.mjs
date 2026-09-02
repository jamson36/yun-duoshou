import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, appSource, css] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
]);

test('主房间只保留三个功能入口、测试数据与问号说明', () => {
  const cluster = html.match(/<nav\b[^>]*class="[^"]*\broom-primary-nav\b[^"]*"[^>]*>[\s\S]*?<\/nav>/)?.[0] || '';
  assert.equal((cluster.match(/<button\b/g) || []).length, 3);
  assert.match(cluster, /消费测试/);
  assert.match(cluster, /开始买吧/);
  assert.match(cluster, /回血计划/);
  assert.match(html, /id="loadDemoButton"[^>]*>导入测试数据</);
  assert.match(html, /id="roomHelpDialog"/);
  assert.match(html, /class="room-help-heading modal-header"/);
  assert.doesNotMatch(html, /class="zone-nav"/);
  assert.doesNotMatch(html, /class="mascot scene-mascot"/);
  assert.doesNotMatch(html, /class="panorama-hint"/);
  assert.doesNotMatch(html, /class="scene-raccoon-guide"/, '坐姿浣熊应来自完整全景资源，不能再叠一只站姿角色');
  const greeting = html.match(/<p class="scene-raccoon-speech" id="mascotBubble"[^>]*>[\s\S]*?<\/p>/)?.[0] || '';
  assert.match(greeting, /欢迎来到让你花个爽/);
  assert.doesNotMatch(greeting, /\bsr-only\b/, '主页问候必须可见，不能只给辅助技术朗读');
  assert.match(appSource, /panorama\.addProjectionObserver\(/);
  assert.doesNotMatch(appSource, /sceneRaccoonGuide/);
});

test('主页问候锚定在全景内坐姿浣熊的投影点', () => {
  const observerStart = appSource.indexOf('panorama.addProjectionObserver(');
  const observerEnd = appSource.indexOf('const roomUiLayers', observerStart);
  const observerSource = appSource.slice(observerStart, observerEnd);

  assert.ok(observerStart >= 0 && observerEnd > observerStart, '应保留房间投影观察器');
  assert.match(observerSource, /panorama\.projectPoint\(ROOM_RACCOON_POINT\.yaw, ROOM_RACCOON_POINT\.pitch\)/);
  assert.match(observerSource, /mascotBubble\.hidden\s*=\s*!point\.visible/);
  assert.match(observerSource, /mascotBubble\.style\.left\s*=\s*`\$\{point\.x\}px`/);
  assert.match(observerSource, /mascotBubble\.style\.top\s*=\s*`\$\{point\.y\}px`/);
  assert.match(css, /\.scene-raccoon-speech\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?pointer-events:\s*none;/);
  assert.match(css, /\.panorama-app\[data-room-phase="room"\] \.scene-raccoon-speech:not\(\[hidden\]\)/);
});

test('三秒揭幕只播一次，Figma 4:5 入口视频循环播放', () => {
  const openingVideo = html.match(/<video[^>]*id="roomIntroVideo"[^>]*>[\s\S]*?<\/video>/)?.[0] || '';
  const entryVideo = html.match(/<video[^>]*id="roomEntryVideo"[^>]*>[\s\S]*?<\/video>/)?.[0] || '';

  assert.doesNotMatch(openingVideo, /\bloop\b/);
  assert.match(openingVideo, /room-intro-hq\.mp4/);
  assert.match(openingVideo, /room-intro-poster-hq\.webp/);
  assert.match(entryVideo, /\bloop\b/);
  assert.match(entryVideo, /room-entry-loop\.mp4/);
  assert.match(entryVideo, /room-entry-poster-hq\.webp/);
  assert.doesNotMatch(css, /is-entry-video-playing \.room-entry-title-art[\s\S]*?opacity:\s*0/);
  assert.doesNotMatch(css, /is-entry-video-playing \.enter-room-button[\s\S]*?color:\s*transparent/);
  assert.match(
    css,
    /@media \(min-width: 821px\)[\s\S]*?\.entry-loop-stage\s*\{[\s\S]*?left:\s*70%;[\s\S]*?width:\s*max\(100vw, 177\.7778vh\);[\s\S]*?height:\s*max\(100vh, 56\.25vw\);[\s\S]*?transform:\s*translate\(-70%, -50%\);/,
  );
});

test('进入后使用带红凳坐姿浣熊的高清球形全景并保留非一级快递探索热点', () => {
  assert.match(appSource, /imageUrl:\s*'\.\/assets\/room-panorama-hd\.webp'/);
  assert.doesNotMatch(appSource, /imageUrl:\s*'\.\/assets\/room-panorama\.webp'/);
  assert.match(appSource, /scene-config\.js\?v=20260902-desire-peel-2-desk-hotspot-1/);
  assert.match(appSource, /const sceneViewportMedia = window\.matchMedia\('\(max-width: 820px\)'\)/);
  assert.match(appSource, /currentSceneDefaultView = \(\) => \([\s\S]*?sceneViewportMedia\.matches \? SCENE_MOBILE_DEFAULT_VIEW : SCENE_DEFAULT_VIEW/);
  assert.match(appSource, /sceneViewportMedia\.addEventListener\('change', syncSceneDefaultView\)/);
  assert.match(appSource, /projection:\s*'spherical'/);
  assert.match(appSource, /const sceneHotspots = \[\.\.\.FEATURE_HOTSPOTS, \.\.\.ACTIVITY_HOTSPOTS, \.\.\.createPackageHotspots\(\)\]/);
  assert.match(appSource.split('\n').slice(0, 6).join('\n'), /createPackageHotspots/);
});

test('移动端新增界面无额外背景，桌面端保留场景背景框且顶部入口不会浮在业务页', () => {
  assert.match(css, /@media \(min-width: 821px\)[\s\S]*?\.order-composer-modal\s*\{[\s\S]*?figma-entry-background\.webp/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?\.order-composer-modal\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?backdrop-filter:\s*none;/);
  assert.match(css, /\.order-composer-card\s*\{[\s\S]*?min-height:\s*100dvh;[\s\S]*?border-radius:\s*0;/);
  const navigationOverride = css.slice(css.indexOf('/* 2026-09-01 confirmed navigation hierarchy'));
  assert.match(navigationOverride, /\.app\.is-focused \.room-entry-cluster\.room-primary-nav\s*\{[\s\S]*?visibility:\s*hidden;[\s\S]*?pointer-events:\s*none\s*!important;/);
  assert.match(css, /@media \(max-height: 620px\)[\s\S]*?\.room-entry-lockup \.enter-room-button\s*\{[\s\S]*?bottom:\s*14px;/);
  assert.match(css, /\.room-help-dialog\s*\{[\s\S]*?overflow:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/);
});

test('月度额度、四态控制器与测试历史形成浏览器本地闭环', () => {
  assert.equal((html.match(/data-monthly-goal=/g) || []).length, 3);
  assert.match(appSource, /function setMonthlyGoalPreset\(/);
  const tiers = appSource.slice(
    appSource.indexOf('const CONTROLLER_BUDGET_TIERS'),
    appSource.indexOf('function renderControllerBudget'),
  );
  assert.equal((tiers.match(/Object\.freeze\(\{/g) || []).length, 4);
  assert.match(tiers, /优雅有钱人/);
  assert.match(tiers, /努力打工人/);
  assert.match(tiers, /深夜副业党/);
  assert.match(tiers, /落魄讨饭人/);
  assert.match(html, /id="testHistoryList"/);
  assert.match(appSource, /TEST_HISTORY_STORAGE_KEY/);
  assert.match(appSource, /RETURN_TO_ROOM_ON_LOAD_KEY/);
});
