import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const overhaulCss = css.slice(css.indexOf('/* Figma route-scale overhaul'));

test('Figma 开屏使用正式标题、状态点和可见开始文案，房间热点采用资源尺寸', () => {
  assert.match(html, /<img class="room-entry-dots" src="\.\/assets\/figma-entry-dots\.svg"[^>]*aria-hidden="true"\s*\/>/);
  assert.match(html, /<img class="room-entry-title-art" src="\.\/assets\/figma-entry-title\.webp" alt="让你花个爽！"[^>]*\/>/);
  assert.match(html, /<button class="enter-room-button" id="enterRoomButton"[^>]*>[\s\S]*?<span>点击开始<\/span>[\s\S]*?<\/button>/);

  const legacyRuleIndex = css.indexOf('.panorama-app[data-room-phase="room"] .scene-hotspot.is-feature {');
  const assetRuleIndex = css.lastIndexOf('.panorama-app[data-room-phase="room"] .scene-hotspot.is-feature.has-hotspot-asset {');
  assert.ok(legacyRuleIndex >= 0, '应保留热点图片失败时使用的 56px 旧视觉回退');
  assert.ok(assetRuleIndex > legacyRuleIndex, '正式热点资源尺寸规则应位于旧 56px 规则之后');
  assert.match(css.slice(legacyRuleIndex), /\.scene-hotspot\.is-feature\s*\{\s*width:\s*56px;\s*height:\s*56px;/);
  assert.match(css.slice(assetRuleIndex), /\.scene-hotspot\.is-feature\.has-hotspot-asset\s*\{\s*width:\s*var\(--hotspot-asset-width\);\s*height:\s*var\(--hotspot-asset-height\);/);
});

test('Figma 业务页使用整屏路由，不再退回左右分栏抽屉', () => {
  assert.match(overhaulCss, /\.focus-panel,[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;[\s\S]*?width:\s*100vw;[\s\S]*?height:\s*100dvh;/);
  assert.match(overhaulCss, /\.app\.is-focused \.focus-panel\s*\{[\s\S]*?transform:\s*none;[\s\S]*?opacity:\s*1;/);
  assert.match(overhaulCss, /\.focus-panel \.panel-rail\s*\{\s*display:\s*none;/);
});

test('开始买吧按 5:25 先展示介绍页，再进入共享的模拟手机首页', () => {
  assert.match(html, /class="panel-view phone-device" data-panel="new" aria-label="开始买吧"/);
  assert.match(html, /id="shoppingIntroView"[^>]*aria-labelledby="shoppingIntroTitle"/);
  assert.match(html, /id="shoppingIntroTitle"[^>]*>还在为深夜剁手/);
  assert.match(html, /id="enterShoppingPhoneButton"[^>]*>[\s\S]*?进入模拟手机/);
  assert.match(html, /hand-21-155\/hand-21-155-4x\.png/);
  assert.match(html, /phone-20-3\/phone-home-20-3-4x\.png/);
  const introStart = html.indexOf('id="shoppingIntroView"');
  const stageStart = html.indexOf('class="shopping-intro-stage"', introStart);
  const handStart = html.indexOf('class="shopping-intro-art"', stageStart);
  const phoneStart = html.indexOf('class="shopping-intro-phone-preview"', stageStart);
  const stageEnd = html.indexOf('</div>', html.indexOf('</div>', phoneStart) + 6);
  assert.ok(stageStart > introStart, '手臂和手机应共用同一个视觉舞台');
  assert.ok(handStart > stageStart && handStart < stageEnd, '手臂应位于共享舞台内');
  assert.ok(phoneStart > handStart && phoneStart < stageEnd, '手机应位于共享舞台内并叠在手臂上方');
  const introCss = css.slice(css.indexOf('/* 2026-09-01 Figma 5:25 flow'));
  assert.match(introCss, /\.shopping-intro-stage\s*\{[\s\S]*?width:\s*min\(64\.908854vw, 115\.393519dvh\);[\s\S]*?aspect-ratio:\s*4985 \/ 4320;/);
  assert.match(introCss, /\.shopping-intro-phone-preview\s*\{[\s\S]*?top:\s*9\.465162%;[\s\S]*?left:\s*33\.440321%;[\s\S]*?width:\s*31\.534604%;/);
  assert.match(appSource, /let phoneView\s*=\s*'intro'/);
  assert.match(appSource, /enterShoppingPhoneButton\.addEventListener\('click',[\s\S]*?pushPhoneView\('home'/);
  assert.match(appSource, /shoppingIntroView\.hidden = phoneView !== 'intro'/);
  assert.match(appSource, /const panelBackLabel = phoneView === 'intro' \? '回房间' : '返回上一页'[\s\S]*?panelClose\.setAttribute\('aria-label', panelBackLabel\)/);
  assert.match(appSource, /activePanel === 'new' && phoneView === 'home'[\s\S]*?#newPanelTitle[\s\S]*?activePanel === 'new' && phoneView === 'intro'[\s\S]*?shoppingIntroTitle/);
});

test('冷静单与回血计划保持 Figma 桌面画板尺寸和暖色房间背景', () => {
  assert.match(overhaulCss, /background:\s*url\("\.\/assets\/recovery-room-background\.webp"\) center \/ cover no-repeat;/);
  assert.match(overhaulCss, /\.panel-view\[data-panel="orders"\][\s\S]*?width:\s*min\(1251px, calc\(100vw - 96px\)\);/);
  assert.match(overhaulCss, /\.panel-view\[data-panel="goals"\]\s*\{[\s\S]*?width:\s*min\(1251px, calc\(100vw - 96px\)\);/);
  assert.match(overhaulCss, /\.wishlist-surface\s*\{\s*min-height:\s*848px;/);
  assert.match(overhaulCss, /\.goals-surface\s*\{\s*min-height:\s*848px;/);
});

test('移动端使用真实手机画板宽高并采用 Figma 单列冷静单', () => {
  assert.match(overhaulCss, /Mobile Home Frame 24:158 has no desktop phone bezel/);
  assert.match(overhaulCss, /\.app\[data-focus="new"\] \.phone-device,[\s\S]*?width:\s*100vw;[\s\S]*?height:\s*100dvh;[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0;/);
  assert.match(overhaulCss, /\.panel-view\[data-panel="orders"\] \.order-list\s*\{\s*grid-template-columns:\s*1fr;/);
  assert.match(overhaulCss, /data-phone-view="catalog"[\s\S]*?data-phone-view="detail"[\s\S]*?\.panel-close\s*\{\s*display:\s*none;/);
});

test('欲望控制器是独立 Figma 子页面，并随预算更新本地提示', () => {
  assert.match(html, /data-goals-panel="goal"/);
  assert.match(html, /data-goals-panel="controller"/);
  assert.match(html, /id="desireBudgetRange"[^>]*min="500"[^>]*max="10000"[^>]*step="100"[^>]*value="600"/);
  assert.match(html, /class="controller-range-limits"[^>]*>[\s\S]*?¥500[\s\S]*?¥10,000/);
  assert.match(html, /id="controllerRaccoonImage"[^>]*controller-elegant\.webp[^>]*width="1024"[^>]*height="1024"/);
  assert.match(html, /id="controllerStateBadge">优雅有钱人</);
  assert.match(html, /id="controllerVerdict">钱包状态：容光焕发</);
  assert.match(html, /id="controllerAdvice">不错不错，保持下去，小目标不是梦！</);
  assert.match(appSource, /const CONTROLLER_BUDGET_TIERS = Object\.freeze\(\[/);
  assert.match(appSource, /function setGoalsView\(/);
  assert.match(appSource, /desireBudgetRange\.addEventListener\('input', renderControllerBudget\)/);
  assert.match(css, /data-tier="steady"[^}]*--controller-wash:\s*#fff4d2/);
  assert.match(css, /data-tier="alert"[^}]*--controller-wash:\s*#ffce92/);
  assert.match(css, /data-tier="pause"[^}]*--controller-wash:\s*#ffab80/);
});

test('欲望控制器按四个 Figma 代表态映射连续预算，并保留四张高清 IP', async () => {
  const configSource = appSource.slice(
    appSource.indexOf('const CONTROLLER_BUDGET_MIN'),
    appSource.indexOf('function renderControllerBudget'),
  );
  const context = {};
  vm.runInNewContext(`${configSource}\nthis.controllerBudgetTierFor = controllerBudgetTierFor; this.tiers = CONTROLLER_BUDGET_TIERS;`, context);

  assert.equal(context.tiers.length, 4);
  assert.deepEqual(
    Array.from(context.tiers, ({ name, anchor, badge, quote, verdict, advice, imageSrc }) => ({
      name,
      anchor,
      badge,
      quote,
      verdict,
      advice,
      imageSrc,
    })),
    [
      {
        name: 'calm',
        anchor: 600,
        badge: '优雅有钱人',
        quote: '预算可以很自由，钱包不行。',
        verdict: '钱包状态：容光焕发',
        advice: '不错不错，保持下去，小目标不是梦！',
        imageSrc: './assets/figma-controller-20260901/controller-elegant.webp',
      },
      {
        name: 'steady',
        anchor: 3000,
        badge: '努力打工人',
        quote: '花钱之前，先把班上了。',
        verdict: '钱包状态：轻微颤抖',
        advice: '已经够花了，再往右拖，浣熊要开始加班了。',
        imageSrc: './assets/figma-controller-20260901/controller-worker.webp',
      },
      {
        name: 'alert',
        anchor: 7000,
        badge: '深夜副业党',
        quote: '节不了流就学着开源，少走弯路',
        verdict: '钱包状态：勉强保命',
        advice: '拉的大大胆胆，单子肥肥嘟嘟，钱包岌岌可危',
        imageSrc: './assets/figma-controller-20260901/controller-side-hustle.webp',
      },
      {
        name: 'pause',
        anchor: 10000,
        badge: '落魄讨饭人',
        quote: '预算可以很自由，钱包不行。',
        verdict: '钱包状态：命悬一线',
        advice: '就只活一天，明天后天大后天都不想活了吗？',
        imageSrc: './assets/figma-controller-20260901/controller-beggar.webp',
      },
    ],
  );
  assert.equal(context.controllerBudgetTierFor(600).name, 'calm');
  assert.equal(context.controllerBudgetTierFor(3000).name, 'steady');
  assert.equal(context.controllerBudgetTierFor(7000).name, 'alert');
  assert.equal(context.controllerBudgetTierFor(10000).name, 'pause');

  assert.equal(context.controllerBudgetTierFor(1800).name, 'calm');
  assert.equal(context.controllerBudgetTierFor(1900).name, 'steady');
  assert.equal(context.controllerBudgetTierFor(5000).name, 'steady');
  assert.equal(context.controllerBudgetTierFor(5100).name, 'alert');
  assert.equal(context.controllerBudgetTierFor(8500).name, 'alert');
  assert.equal(context.controllerBudgetTierFor(8600).name, 'pause');
  assert.equal(context.controllerBudgetTierFor(-1).name, 'calm');
  assert.equal(context.controllerBudgetTierFor(50_000).name, 'pause');
  assert.equal(context.controllerBudgetTierFor(Number.NaN).name, 'calm');

  const tierOrder = new Map(context.tiers.map(({ name }, index) => [name, index]));
  const steppedTiers = [];
  for (let amount = 500; amount <= 10000; amount += 100) {
    steppedTiers.push(tierOrder.get(context.controllerBudgetTierFor(amount).name));
  }
  steppedTiers.forEach((tierIndex, index) => {
    assert.ok(tierIndex >= 0 && tierIndex <= 3);
    if (index > 0) assert.ok(tierIndex >= steppedTiers[index - 1], '连续滑块状态只能随预算单向递进');
  });

  const assetPaths = context.tiers.map(({ imageSrc }) => new URL(`../${imageSrc.replace('./', '')}`, import.meta.url));
  const assetBuffers = await Promise.all(assetPaths.map((assetPath) => readFile(assetPath)));
  assetBuffers.forEach((asset, index) => assert.ok(asset.byteLength > 50_000, `第 ${index + 1} 张控制器 IP 应是高清导出资源`));
  assert.equal(new Set(context.tiers.map(({ imageSrc }) => imageSrc)).size, 4);

  const renderSource = appSource.slice(
    appSource.indexOf('function renderControllerBudget'),
    appSource.indexOf('CONTROLLER_BUDGET_TIERS.forEach'),
  );
  assert.doesNotMatch(renderSource, /mutate\(|saveState\(|setGoal\(|setMonthlyGoalPreset\(|localStorage/);
});

test('人格扭蛋起始态按 Figma 顺序收进桌面和手机首屏', () => {
  assert.match(overhaulCss, /Clinic start: keep the Figma 20:2 machine/);
  assert.match(overhaulCss, /\.ai-card:is\(\[data-gachapon-state="ready"\], \[data-gachapon-state="locked"\]\) \.gachapon-stage\s*\{[\s\S]*?min-height:\s*0;/);
  assert.match(overhaulCss, /\.ai-card:is\(\[data-gachapon-state="ready"\], \[data-gachapon-state="locked"\]\) \.gachapon-machine\s*\{[\s\S]*?width:\s*min\(520px, 48dvh, 55vw\);/);
  assert.match(overhaulCss, /@media \(max-width: 820px\)[\s\S]*?\.gachapon-machine\s*\{[\s\S]*?width:\s*min\(310px, 42dvh, calc\(100vw - 48px\)\);/);
  const finalClinicCss = css.slice(css.indexOf('/* The current semantic wrapper'));
  assert.match(finalClinicCss, /width:\s*min\(687px, 63\.61dvh, 68vw\);/);
  assert.match(finalClinicCss, /\.gachapon-machine\s*\{\s*aspect-ratio:\s*687 \/ 797;/);
  assert.match(finalClinicCss, /\.gachapon-machine > img\s*\{[\s\S]*?top:\s*-9\.59%;[\s\S]*?height:\s*114\.98%;/);
  assert.match(finalClinicCss, /font-size:\s*clamp\(30px, 1\.875vw, 36px\);[\s\S]*?white-space:\s*nowrap;/);
  assert.match(finalClinicCss, /min-height:\s*66px;[\s\S]*?border-radius:\s*18px;[\s\S]*?font-size:\s*24px;/);
});

test('消费测试默认直达扭蛋起始态，报告是可返回的独立滚动视图', () => {
  assert.match(html, /<section class="panel-view" data-panel="clinic"[^>]*data-clinic-view="start"/);
  assert.match(html, /id="clinicReportView"[^>]*hidden/);
  assert.match(html, /id="clinicReportBackButton"[^>]*>[\s\S]*?<span>返回扭蛋机<\/span>/);
  const reportStart = html.indexOf('id="clinicReportView"');
  const reportEnd = html.indexOf('</section>', reportStart);
  assert.ok(reportStart >= 0 && reportEnd > reportStart, '报告视图应作为独立区域存在');
  assert.ok(html.indexOf('id="personalityProfile"', reportStart) < reportEnd, '可滚动报告视图应包含人格报告');
  assert.match(appSource, /let clinicView\s*=\s*'start'/);
  assert.match(appSource, /function setClinicView\(/);
  assert.match(css, /\.clinic-report-view\s*\{[\s\S]*?width:\s*min\(1100px, 100%\);/);
  assert.match(css, /\.panel-inner\s*\{[\s\S]*?overflow-y:\s*auto;/);
});

test('业务页返回入口共用 Figma 左箭头语言，消费目标双列控件严格同高', () => {
  assert.match(html, /class="[^"]*app-back[^"]*" id="panelClose"[^>]*>[\s\S]*?figma-chevron-left\.svg/);
  assert.match(html, /class="[^"]*app-back[^"]*" id="commerceBackButton"[^>]*>[\s\S]*?figma-chevron-left\.svg/);
  assert.match(html, /class="[^"]*app-back[^"]*" id="clinicReportBackButton"[^>]*>[\s\S]*?figma-chevron-left\.svg/);
  const polishCss = css.slice(css.indexOf('/* 2026-09-01 Figma refinement'));
  assert.match(polishCss, /\.app-back-icon\s*\{[\s\S]*?border-radius:\s*50%;[\s\S]*?background:\s*rgba\(255, 253, 248, \.9\);/);
  assert.match(polishCss, /\.focus-panel \.panel-close\.app-back \.app-back-icon img,[\s\S]*?\.clinic-report-back\.app-back-text \.app-back-icon img\s*\{\s*width:\s*20px;\s*height:\s*20px;/);
  assert.match(polishCss, /\.panel-view\[data-panel="goals"\] \.goal-form-row\s*\{\s*align-items:\s*start;/);
  assert.match(polishCss, /\.panel-view\[data-panel="goals"\] \.money-input\s*\{[\s\S]*?height:\s*48px;[\s\S]*?min-height:\s*48px;/);
  assert.match(polishCss, /\.panel-view\[data-panel="goals"\] \.goal-current-saved,[\s\S]*?height:\s*48px;[\s\S]*?min-height:\s*48px;/);
});

test('人格授权是扭蛋主界面内联勾选，不再切到覆盖式确认弹层', () => {
  const stageStart = html.indexOf('class="gachapon-stage"');
  const consentIndex = html.indexOf('id="aiConsentPanel"');
  const checkboxIndex = html.indexOf('id="aiConsentCheckbox"');
  const analyzeIndex = html.indexOf('id="analyzeButton"');
  const contentIndex = html.indexOf('class="ai-card-content');
  assert.ok(stageStart >= 0, '应保留人格扭蛋主区域');
  assert.ok(consentIndex > stageStart && consentIndex < contentIndex, '授权条应位于 gachapon-stage，而不是结果内容层');
  assert.ok(checkboxIndex > consentIndex && checkboxIndex < analyzeIndex, '显式授权勾选应在主抽取按钮之前');
  const checkboxTag = html.slice(html.lastIndexOf('<input', checkboxIndex), html.indexOf('>', checkboxIndex) + 1);
  assert.match(checkboxTag, /type="checkbox"/);
  assert.doesNotMatch(html, /id="allowAiButton"/);
  assert.doesNotMatch(appSource, /status:\s*['"]consent['"]|machineState\s*=\s*['"]confirm['"]/);
  assert.doesNotMatch(css, /data-gachapon-state="confirm"/);
});

test('实际位于 aiCard 外的人格报告使用 Figma 奶油卡而非旧黑边视觉', () => {
  assert.ok(html.indexOf('id="aiCard"') < html.indexOf('id="personalityProfile"'));
  assert.match(css, /\.panel-view\[data-panel="clinic"\] #personalityProfile\s*\{[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*28px;[\s\S]*?background:\s*rgba\(255, 253, 248, \.94\);/);
  assert.match(css, /#personalityProfile \.profile-identity\s*\{[\s\S]*?background:\s*linear-gradient\(135deg, #fff1c6, #ffe0cd 62%, #ffd5bc\);/);
});

test('新增想买物采用 Figma 居中弹窗并把焦点限制在弹窗内', () => {
  assert.match(html, /class="order-composer-modal" id="orderComposerModal" role="dialog" aria-modal="true"/);
  assert.match(html, /id="orderComposerCloseButton"[^>]*aria-label="关闭新增想买物弹窗"/);
  assert.match(css, /\.order-composer-modal\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;[\s\S]*?place-items:\s*center;/);
  assert.match(appSource, /function openOrderComposer\([\s\S]*?orderForm\.elements\.name\.focus/);
  assert.match(appSource, /function closeOrderComposer\([\s\S]*?returnTarget\.focus/);
  assert.match(appSource, /!orderComposerModal\.hidden && event\.key === 'Tab'/);
  assert.match(appSource, /!orderComposerModal\.hidden[\s\S]*?closeOrderComposer\(\)/);
});

test('新增与成功弹窗会隔离移动底栏和后方页面', () => {
  assert.match(appSource, /function syncTransientModalIsolation\(\)[\s\S]*?setHiddenAndInert\(panelInner, composerOpen\)/);
  assert.match(appSource, /setHiddenAndInert\(mobileDock, composerOpen \|\| successOpen\)/);
  assert.match(appSource, /app\.classList\.toggle\('has-transient-modal', composerOpen \|\| successOpen\)/);
  assert.match(css, /\.app\.has-transient-modal \.focus-panel\s*\{\s*z-index:\s*180;/);
  assert.match(css, /\.order-composer-modal\s*\{[\s\S]*?z-index:\s*220;/);
  assert.match(css, /\.mall-success-modal\s*\{[\s\S]*?z-index:\s*220;/);
});

test('回血三页拥有完整页签关系且控制器路由可刷新恢复', () => {
  assert.match(html, /id="recoveryOrdersTabOrders"[^>]*aria-controls="wishlistSurface"/);
  assert.match(html, /id="wishlistSurface" role="tabpanel" aria-labelledby="recoveryOrdersTabOrders"/);
  assert.match(html, /id="goalPlannerView"[^>]*role="tabpanel" aria-labelledby="recoveryGoalTabGoals"/);
  assert.match(html, /id="goalController"[^>]*role="tabpanel" aria-labelledby="recoveryControllerTabGoals"/);
  assert.match(appSource, /function goalsHash\([\s\S]*?'#goals-controller'/);
  assert.match(appSource, /function goalsViewFromHash\([\s\S]*?location\.hash === '#goals-controller'/);
  assert.match(appSource, /initialGoalsView = initialRoute\.goalsView/);
  assert.match(appSource, /initialPanel === 'goals'\s*\? goalsHash\(initialGoalsView\)/);
});

test('商城先填一填打开预填弹窗，商品详情双 CTA 跟随正文且不遮挡内容', () => {
  const prefillStart = appSource.indexOf('function prefillOrderFromCommerce(');
  const prefillEnd = appSource.indexOf('function restartMallGif(', prefillStart);
  const prefillSource = appSource.slice(prefillStart, prefillEnd);
  assert.match(prefillSource, /orderForm\.elements\.name\.value = product\.name/);
  assert.match(prefillSource, /openOrderComposer\(trigger\)/);
  assert.doesNotMatch(prefillSource, /showPhoneView\('home'/);
  const finalInteractionCss = css.slice(css.indexOf('/* Commerce interaction closure'));
  assert.match(finalInteractionCss, /\.app\[data-focus="new"\]\[data-phone-view="detail"\] \.commerce-detail-actions\s*\{[\s\S]*?position:\s*static;[\s\S]*?bottom:\s*auto;/);
  assert.match(finalInteractionCss, /#commerceDetailContent h3\):focus-visible\s*\{[\s\S]*?outline:\s*3px solid #17110e;/);
  assert.match(finalInteractionCss, /:is\(\[data-phone-view="catalog"\], \[data-phone-view="detail"\]\) \.panel-close\s*\{\s*display:\s*none;/);
  assert.match(finalInteractionCss, /@media \(max-width: 820px\)[\s\S]*?\.category-shortcuts button\s*\{\s*width:\s*44%;/);
});

test('手机业务长页统一预留底栏和系统安全区', () => {
  const mobileClearanceCss = css.slice(css.indexOf('/* Desktop composer has a contextual backdrop'));
  assert.match(mobileClearanceCss, /\.app\.is-focused\s*\{\s*--mobile-dock-clearance:\s*calc\(104px \+ env\(safe-area-inset-bottom\)\);\s*\}/);
  assert.match(mobileClearanceCss, /\.app\[data-focus="new"\] \.phone-screen-scroll\s*\{[\s\S]*?padding-bottom:\s*var\(--mobile-dock-clearance\);[\s\S]*?scroll-padding-bottom:\s*var\(--mobile-dock-clearance\);/);
  assert.match(mobileClearanceCss, /\.app\[data-focus="clinic"\] \.panel-inner,[\s\S]*?\.app\[data-focus="goals"\] \.panel-inner\s*\{[\s\S]*?padding-bottom:\s*var\(--mobile-dock-clearance\);/);
  assert.match(mobileClearanceCss, /\.app\.is-focused \.toast\s*\{[\s\S]*?bottom:\s*var\(--mobile-dock-clearance\);/);
});

test('订单页归入开始买吧主入口并持续标记当前顶部导航', () => {
  assert.match(html, /<nav class="[^"]*room-primary-nav[^"]*" aria-label="房间顶部主要功能">/);
  assert.match(appSource, /const activePanel = panel === 'orders' \? 'new' : panel;/);
  assert.match(appSource, /panelForMobileDockButton\(button\) === activePanel/);
});

test('手机订单筛选独占整行并把导出操作收进次级面板', () => {
  assert.match(html, /<details class="order-export-panel">[\s\S]*?<summary>备份与导出<\/summary>[\s\S]*?id="exportButton"[\s\S]*?id="exportCsvButton"/);
  assert.match(overhaulCss, /\.order-filter-controls\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*1fr;/);
  assert.match(overhaulCss, /\.segmented\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/);
});

test('商城入口在桌面与手机都可见，三个分类卡点击后直接进入对应商城', () => {
  assert.match(html, /id="openMallButton"/);
  assert.doesNotMatch(overhaulCss, /\.app\[data-focus="new"\] \.mall-entry-button\s*\{\s*display:\s*none/);
  assert.match(overhaulCss, /@media \(max-width: 820px\)[\s\S]*?\.app\[data-focus="new"\] \.mall-entry-button\s*\{\s*display:\s*flex;/);
  assert.match(html, /查看模拟商品 →/);
  assert.match(appSource, /actionLabel\.textContent = '查看模拟商品 →'/);
  assert.match(appSource, /当前选中，点击查看模拟商品/);
  assert.doesNotMatch(appSource, /if \(index !== activeCategoryCardIndex\) \{[\s\S]*?return;[\s\S]*?pushPhoneView\('catalog'/);
  assert.match(appSource, /if \(index !== activeCategoryCardIndex\) setActiveCategoryCard\(index,[\s\S]*?COMMERCE_TYPE_BY_CATEGORY[\s\S]*?pushPhoneView\('catalog'/);
});

test('桌面商城与详情恢复 393×844 仿真手机，手机端继续无重复外壳', () => {
  const flowCss = css.slice(css.indexOf('/* 2026-09-01 Figma 5:25 flow'));
  assert.match(flowCss, /:not\(\[data-phone-view="intro"\]\) \.phone-device,[\s\S]*?height:\s*min\(844px, calc\(100dvh - 28px\)\);[\s\S]*?aspect-ratio:\s*393 \/ 844;[\s\S]*?border:\s*10px solid #ffdbb7;[\s\S]*?border-radius:\s*54px;/);
  assert.match(flowCss, /:not\(\[data-phone-view="intro"\]\) \.phone-status-bar\s*\{\s*display:\s*grid;/);
  assert.match(flowCss, /:not\(\[data-phone-view="intro"\]\) \.device-tabs\s*\{\s*display:\s*grid;/);
  assert.match(flowCss, /\.commerce-products\[data-layout="grid"\]\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(flowCss, /\.commerce-detail-view\s*\{\s*display:\s*block;/);
  assert.match(overhaulCss, /Mobile Home Frame 24:158 has no desktop phone bezel[\s\S]*?width:\s*100vw;[\s\S]*?border:\s*0;/);
});

test('复诊中保留四阶段状态与撤回入口，不再被最终样式隐藏', () => {
  assert.match(appSource, /ANALYSIS_STAGES/);
  assert.match(appSource, /class="ai-analysis-progress"/);
  const finalClinicCss = css.slice(css.indexOf('/* Figma diagnosis timeline'));
  assert.match(finalClinicCss, /data-gachapon-state="spinning"\] \.ai-card-content\s*\{[\s\S]*?display:\s*block;/);
  assert.match(finalClinicCss, /\.ai-revoke:not\(\[hidden\]\)\s*\{[\s\S]*?display:\s*inline-flex;/);
});

test('分享报告完整展示 1080×1538 人格卡，并且只留返回和保存两个按钮', () => {
  const posterDialog = html.match(/<dialog\b[^>]*\bid="posterShare"[^>]*>[\s\S]*?<\/dialog>/)?.[0] || '';
  const buttonLabels = [...posterDialog.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)]
    .map((match) => match[1]
      .replaceAll(/<span\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, '')
      .replaceAll(/<[^>]+>/g, '')
      .replaceAll(/\s+/g, ' ')
      .trim());

  assert.match(posterDialog, /class="poster-figma-card"[\s\S]*?class="poster-preview-shell"/);
  assert.deepEqual(buttonLabels, ['返回', '保存到相册']);
  assert.doesNotMatch(posterDialog, /posterShareCloseButton|copyPosterButton|copyPosterCaptionButton/);
  const posterVariantCss = css.slice(css.indexOf('/* Figma personality-poster variants'));
  assert.match(posterVariantCss, /--poster-card-width:\s*380px;/);
  assert.match(posterVariantCss, /aspect-ratio:\s*1080 \/ 1538;/);
  assert.match(posterVariantCss, /\.poster-preview\s*\{[\s\S]*?object-fit:\s*contain;/);
  assert.match(posterVariantCss, /@media \(max-width: 520px\)[\s\S]*?--poster-card-width:\s*244px;/);
  assert.match(posterVariantCss, /\.poster-share-actions button\s*\{[\s\S]*?min-height:\s*44px;/);
});
