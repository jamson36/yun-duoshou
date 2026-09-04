import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { validateBudgetGoalAmount } from '../budget-goals.js';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const helperStart = appSource.indexOf('const ORDER_STATUS_TRANSITIONS');
const helperEnd = appSource.indexOf('const COMMERCE_TYPE_BY_CATEGORY');
assert.ok(helperStart >= 0 && helperEnd > helperStart, '订单状态辅助逻辑应保持可测试的独立区域');

const context = {};
vm.runInNewContext(`${appSource.slice(helperStart, helperEnd)}
this.orderStateApi = { allowedOrderStatusActions, applyOrderStatusTransition, orderMatchesTimeFilter };`, context);
const { allowedOrderStatusActions, applyOrderStatusTransition, orderMatchesTimeFilter } = context.orderStateApi;

function functionSource(name, nextName) {
  const start = appSource.indexOf(`function ${name}(`);
  const end = appSource.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `应能读取 ${name} 的实际实现`);
  return appSource.slice(start, end);
}

function trailingFunctionSource(name, terminator) {
  const start = appSource.indexOf(`function ${name}(`);
  const end = appSource.indexOf(terminator, start + 1);
  assert.ok(start >= 0 && end > start, `应能读取 ${name} 的实际实现`);
  return appSource.slice(start, end);
}

test('订单状态只允许冷静后决定，已决定订单只能在两种结果间纠正', () => {
  assert.deepEqual([...allowedOrderStatusActions('cooling')], ['saved', 'purchased']);
  assert.deepEqual([...allowedOrderStatusActions('saved')], ['purchased']);
  assert.deepEqual([...allowedOrderStatusActions('purchased')], ['saved']);
  assert.deepEqual([...allowedOrderStatusActions('unknown')], []);
});

test('已决定订单纠正状态时保留首次决定时间，且不能退回冷静中', () => {
  const order = { status: 'cooling', decidedAt: null, statusHistory: [] };
  assert.equal(applyOrderStatusTransition(order, 'saved', '2026-08-30T10:00:00.000Z'), true);
  assert.equal(order.decidedAt, '2026-08-30T10:00:00.000Z');

  assert.equal(applyOrderStatusTransition(order, 'purchased', '2026-08-30T11:00:00.000Z'), true);
  assert.equal(order.decidedAt, '2026-08-30T10:00:00.000Z');
  assert.deepEqual(order.statusHistory.map(({ from, to }) => ({ from, to })), [
    { from: 'cooling', to: 'saved' },
    { from: 'saved', to: 'purchased' },
  ]);

  const beforeInvalidTransition = structuredClone(order);
  assert.equal(applyOrderStatusTransition(order, 'cooling', '2026-08-30T12:00:00.000Z'), false);
  assert.equal(JSON.stringify(order), JSON.stringify(beforeInvalidTransition));
});

test('订单列表不再提供退回冷静中的操作', () => {
  assert.doesNotMatch(appSource, /data-order-action="cooling"/);
});

test('订单时间筛选按设备本地自然周、月和年度计算', () => {
  const now = new Date(2026, 7, 30, 12);
  const orderAt = (year, month, day) => ({ createdAt: new Date(year, month, day, 12) });
  assert.equal(orderMatchesTimeFilter(orderAt(2026, 7, 24), 'week', now), true);
  assert.equal(orderMatchesTimeFilter(orderAt(2026, 7, 23), 'week', now), false);
  assert.equal(orderMatchesTimeFilter(orderAt(2026, 7, 1), 'month', now), true);
  assert.equal(orderMatchesTimeFilter(orderAt(2026, 6, 31), 'month', now), false);
  assert.equal(orderMatchesTimeFilter(orderAt(2026, 0, 1), 'year', now), true);
  assert.equal(orderMatchesTimeFilter(orderAt(2025, 11, 31), 'year', now), false);
  assert.equal(orderMatchesTimeFilter(orderAt(2025, 11, 31), 'all', now), true);
  assert.equal(orderMatchesTimeFilter({ createdAt: 'not-a-date' }, 'month', now), false);
});

test('订单时间筛选与状态筛选串联，不建立第二套订单数据源', () => {
  const source = functionSource('renderOrders', 'setOrderTimeFilterMenu');
  assert.match(source, /activeFilter === 'all' \|\| order\.status === activeFilter/);
  assert.match(source, /orderMatchesTimeFilter\(order, activeTimeFilter\)/);
  assert.match(indexSource, /role="menuitemradio" data-time-filter="all"/);
  assert.match(appSource, /orderTimeFilterButton\.setAttribute\('aria-expanded'/);
});

test('报告商品只取最终购买，按合计金额稳定选出最贵三个且不造数据', () => {
  const reportHelperStart = appSource.indexOf('const REPORT_IMPULSE_SIGNAL_LABELS');
  const reportHelperEnd = appSource.indexOf('function localReportSuggestion', reportHelperStart);
  assert.ok(reportHelperStart >= 0 && reportHelperEnd > reportHelperStart, '报告商品选择逻辑应保持可单独验证');

  const reportContext = {
    Date,
    Map,
    Math,
    Set,
    localDateKey: () => '2026-08-31',
  };
  vm.runInNewContext(`${appSource.slice(reportHelperStart, reportHelperEnd)}
this.reportProductGroups = reportProductGroups;`, reportContext);

  const purchased = (name, amount, createdAt, extra = {}) => ({
    name,
    amount,
    createdAt,
    decidedAt: createdAt,
    status: 'purchased',
    category: '数码家居',
    reason: '被种草',
    decisionSignals: [],
    ...extra,
  });
  const orders = [
    purchased('降噪耳机', 600, '2026-08-28T10:00:00.000Z'),
    purchased('降噪耳机', 350, '2026-08-30T10:00:00.000Z'),
    purchased('复古托特包', 800, '2026-08-29T10:00:00.000Z', { category: '服饰美妆' }),
    purchased('即时相机', 700, '2026-08-29T09:00:00.000Z'),
    purchased('掌机', 700, '2026-08-30T09:00:00.000Z'),
    purchased('口袋打印机', 120, '2026-08-31T09:00:00.000Z'),
    purchased('未购买的昂贵商品', 99_999, '2026-08-31T10:00:00.000Z', { status: 'cooling' }),
    purchased('幸好没买的昂贵商品', 88_888, '2026-08-31T11:00:00.000Z', { status: 'saved' }),
  ];

  const selected = reportContext.reportProductGroups(orders);
  assert.deepEqual(JSON.parse(JSON.stringify(selected.map(({ name, amount }) => ({ name, amount })))), [
    { name: '降噪耳机', amount: 950 },
    { name: '复古托特包', amount: 800 },
    { name: '掌机', amount: 700 },
  ]);
  assert.ok(selected.every(({ latestOrder }) => latestOrder.status === 'purchased'));
  assert.deepEqual(
    JSON.parse(JSON.stringify(reportContext.reportProductGroups(orders).map(({ name }) => name))),
    ['降噪耳机', '复古托特包', '掌机'],
    '金额相同时按最近购买时间稳定决定顺序',
  );

  const onlyTwo = reportContext.reportProductGroups([
    purchased('商品 A', 80, '2026-08-30T10:00:00.000Z'),
    purchased('商品 B', 60, '2026-08-29T10:00:00.000Z'),
    purchased('不应补位', 999, '2026-08-31T10:00:00.000Z', { status: 'saved' }),
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(onlyTwo.map(({ name }) => name))), ['商品 A', '商品 B']);
});

test('商城筛选重绘后把焦点还给同一筛选项', () => {
  let focusedFilter = '';
  const focusContext = {
    commerceFilters: {
      querySelectorAll: () => [
        { dataset: { commerceFilter: '推荐' }, focus: () => { focusedFilter = '推荐'; } },
        { dataset: { commerceFilter: '数码' }, focus: () => { focusedFilter = '数码'; } },
      ],
    },
  };
  vm.runInNewContext(`${functionSource('focusCommerceFilter', 'renderCommerceDetail')}
focusCommerceFilter('数码');`, focusContext);
  assert.equal(focusedFilter, '数码');
});

test('订单状态重绘后优先聚焦同张小票的下一个合法操作', () => {
  let focusedTarget = '';
  const buttons = [
    { dataset: { orderId: 'order-1', orderAction: 'purchased' }, focus: () => { focusedTarget = 'purchased'; } },
    { dataset: { orderId: 'order-1', orderAction: 'delete' }, focus: () => { focusedTarget = 'delete'; } },
  ];
  const focusContext = {
    activeFilter: 'all',
    allowedOrderStatusActions: (status) => ({ saved: ['purchased'], purchased: ['saved'] })[status] || [],
    orderList: { querySelectorAll: () => buttons },
    document: { querySelector: () => ({ focus: () => { focusedTarget = 'filter'; } }) },
  };
  vm.runInNewContext(`${functionSource('focusOrderAction', 'focusOrderAfterStatusChange')}
${functionSource('focusOrderAfterStatusChange', 'confidenceLabel')}
focusOrderAfterStatusChange('order-1', 'saved');`, focusContext);
  assert.equal(focusedTarget, 'purchased');

  focusContext.orderList.querySelectorAll = () => [];
  vm.runInNewContext(`${functionSource('focusOrderAction', 'focusOrderAfterStatusChange')}
${functionSource('focusOrderAfterStatusChange', 'confidenceLabel')}
focusOrderAfterStatusChange('missing', 'saved');`, focusContext);
  assert.equal(focusedTarget, 'filter');
});

test('订单编辑保存后把焦点还到重绘后的同张小票编辑按钮', () => {
  let focusedTarget = '';
  const buttons = [
    { dataset: { orderId: 'order-1', orderAction: 'saved' }, focus: () => { focusedTarget = 'saved'; } },
    { dataset: { orderId: 'order-1', orderAction: 'edit' }, focus: () => { focusedTarget = 'edit'; } },
  ];
  const focusContext = {
    activeFilter: 'all',
    orderList: { querySelectorAll: () => buttons },
    document: { querySelector: () => ({ focus: () => { focusedTarget = 'filter'; } }) },
  };
  vm.runInNewContext(`${functionSource('focusOrderAction', 'focusOrderAfterStatusChange')}
focusOrderAction('order-1', 'edit');`, focusContext);
  assert.equal(focusedTarget, 'edit');

  const editSaveSource = functionSource('createOrder', 'resetOrderComposer');
  assert.match(editSaveSource, /requestAnimationFrame\(\(\) => focusOrderAction\(orderId, 'edit'\)\)/);
});

test('确认删除订单后把焦点移到相邻小票，列表为空时退到当前筛选', () => {
  let focusedTarget = '';
  const buttons = [
    { dataset: { orderId: 'order-2', orderAction: 'saved' }, focus: () => { focusedTarget = 'order-2'; } },
  ];
  const focusContext = {
    activeFilter: 'all',
    orderList: { querySelectorAll: () => buttons },
    document: { querySelector: () => ({ focus: () => { focusedTarget = 'filter'; } }) },
  };
  vm.runInNewContext(`${functionSource('focusOrderAction', 'focusOrderAfterDeletion')}
${functionSource('focusOrderAfterDeletion', 'focusOrderAfterStatusChange')}
focusOrderAfterDeletion('order-1', ['order-1', 'order-2']);`, focusContext);
  assert.equal(focusedTarget, 'order-2');

  focusContext.orderList.querySelectorAll = () => [];
  vm.runInNewContext(`${functionSource('focusOrderAction', 'focusOrderAfterDeletion')}
${functionSource('focusOrderAfterDeletion', 'focusOrderAfterStatusChange')}
focusOrderAfterDeletion('order-1', ['order-1']);`, focusContext);
  assert.equal(focusedTarget, 'filter');

  const deleteSource = functionSource('deleteOrder', 'updateOrderStatus');
  assert.match(deleteSource, /visibleOrderIds[\s\S]*?requestAnimationFrame\(\(\) => focusOrderAfterDeletion\(id, visibleOrderIds\)\)/);
});

test('商城立即模拟会先丢弃旧编辑标记，再新建冷静单', () => {
  let editingOrderId = 'old-order';
  let editingIdSeenByCreate = 'not-called';
  const simulateContext = {
    FormData,
    product: { name: '新商品', price: 88, category: '数码家居', reason: '被种草' },
    get editingOrderId() { return editingOrderId; },
    set editingOrderId(value) { editingOrderId = value; },
    resetOrderComposer: () => { editingOrderId = null; },
    createOrder: () => {
      editingIdSeenByCreate = editingOrderId;
      return { id: 'new-order' };
    },
    showMallSuccess: () => {},
  };
  vm.runInNewContext(`${functionSource('simulateCommerceOrder', 'renderOrderEditor')}
simulateCommerceOrder(product);`, simulateContext);
  assert.equal(editingIdSeenByCreate, null);
});

test('从订单列表编辑时会退出残留商品详情并回到表单首页', () => {
  const source = functionSource('editOrder', 'deleteOrder');
  const showHome = source.indexOf("showPhoneView('home')");
  const applyNewPanel = source.indexOf("applyPanel('new', trigger)");
  assert.ok(showHome >= 0 && applyNewPanel > showHome);
});

test('从订单页取消新增或编辑会恢复来源路由与触发按钮', () => {
  const start = appSource.indexOf('function captureOrderComposerReturnContext(');
  const end = appSource.indexOf('function prefillOrderFromCommerce(', start);
  assert.ok(start >= 0 && end > start, '订单弹窗应提供来源上下文的捕获与恢复逻辑');
  const source = appSource.slice(start, end);
  const focused = [];
  const trigger = {
    getClientRects: () => [{}],
    focus: () => focused.push('trigger'),
  };
  const fallback = { focus: () => focused.push('fallback') };
  const isolationTarget = () => ({
    inert: false,
    setAttribute: () => {},
    removeAttribute: () => {},
  });
  const newDeviceTabs = isolationTarget();
  const replaced = [];
  const appliedRoutes = [];
  const context = {
    activePanel: 'orders',
    currentRouteSnapshot: () => ({ panel: 'orders', phoneView: 'intro' }),
    location: { hash: '#orders' },
    history: {
      state: { panel: 'orders', openedByApp: false },
      replaceState(state, _title, hash) {
        this.state = state;
        replaced.push({ state, hash });
      },
    },
    orderComposerReturnFocus: null,
    orderComposerReturnContext: null,
    orderComposerOpenTimer: null,
    orderComposerModal: { hidden: true, querySelectorAll: () => [] },
    mallSuccessModal: { hidden: true },
    app: { dataset: {}, classList: { toggle: () => {} } },
    panelInner: isolationTarget(),
    newPhoneScreen: isolationTarget(),
    panelClose: isolationTarget(),
    mobileDock: isolationTarget(),
    document: {
      activeElement: trigger,
      contains: (element) => element === trigger,
      querySelector: (selector) => (selector.includes('.device-tabs') ? newDeviceTabs : fallback),
    },
    orderForm: { elements: { name: { focus: () => {} } } },
    window: {
      requestAnimationFrame: (callback) => callback(),
      clearTimeout: () => {},
    },
    resetOrderComposer: () => {},
    syncRouteFromLocation: (route) => {
      context.activePanel = route.panel;
      appliedRoutes.push(route);
    },
    focusFirstAvailableTarget: (primary) => {
      primary?.focus();
      return Boolean(primary);
    },
    panelFocusTargets: () => [fallback],
  };
  vm.runInNewContext(`${source}
this.composerApi = { captureOrderComposerReturnContext, openOrderComposer, closeOrderComposer };`, context);

  const returnContext = context.composerApi.captureOrderComposerReturnContext();
  context.activePanel = 'new';
  context.history.state = { panel: 'new', phoneView: 'home', openedByApp: false };
  context.location.hash = '#new?view=home';
  context.composerApi.openOrderComposer(trigger, { returnContext });
  context.composerApi.closeOrderComposer();

  assert.equal(context.orderComposerModal.hidden, true);
  assert.equal(replaced.at(-1).hash, '#orders');
  assert.equal(appliedRoutes.at(-1).panel, 'orders');
  assert.deepEqual(focused, ['trigger']);

  const addHandler = appSource.slice(
    appSource.indexOf("document.querySelectorAll('[data-open]:not(.scene-hotspot):not([data-recovery-view])')"),
    appSource.indexOf("document.querySelectorAll('[data-scroll-target]:not([data-open])"),
  );
  assert.match(addHandler, /captureOrderComposerReturnContext\(\)[\s\S]*?openOrderComposer\(trigger, \{ returnContext \}\)/);
  assert.match(functionSource('editOrder', 'deleteOrder'), /captureOrderComposerReturnContext\(\)[\s\S]*?scheduleOrderComposerOpen\(trigger, \{[\s\S]*?returnContext/);
});

test('编辑面板动画期间按 Esc 会取消待打开弹窗并回到订单页', () => {
  const start = appSource.indexOf('function captureOrderComposerReturnContext(');
  const end = appSource.indexOf('function prefillOrderFromCommerce(', start);
  assert.ok(start >= 0 && end > start, '订单弹窗应提供可取消的延迟打开逻辑');
  const source = appSource.slice(start, end);
  const scheduled = new Map();
  let nextTimerId = 1;
  const focused = [];
  const trigger = {
    getClientRects: () => [{}],
    focus: () => focused.push('trigger'),
  };
  const fallback = { focus: () => focused.push('fallback') };
  const isolationTarget = () => ({
    inert: false,
    setAttribute: () => {},
    removeAttribute: () => {},
  });
  const context = {
    activePanel: 'new',
    location: { hash: '#new?view=home' },
    history: {
      state: { panel: 'new', phoneView: 'home', openedByApp: false },
      replaceState(state, _title, hash) {
        this.state = state;
        context.location.hash = hash;
      },
    },
    orderComposerReturnFocus: null,
    orderComposerReturnContext: null,
    orderComposerOpenTimer: null,
    orderComposerModal: { hidden: true, querySelectorAll: () => [] },
    mallSuccessModal: { hidden: true },
    app: { dataset: {}, classList: { toggle: () => {} } },
    panelInner: isolationTarget(),
    newPhoneScreen: isolationTarget(),
    panelClose: isolationTarget(),
    mobileDock: isolationTarget(),
    document: {
      activeElement: trigger,
      contains: (element) => element === trigger,
      querySelector: (selector) => (selector.includes('.device-tabs') ? isolationTarget() : fallback),
    },
    orderForm: { elements: { name: { focus: () => {} } } },
    window: {
      requestAnimationFrame: (callback) => callback(),
      setTimeout(callback) {
        const id = nextTimerId++;
        scheduled.set(id, callback);
        return id;
      },
      clearTimeout(id) { scheduled.delete(id); },
    },
    resetOrderComposer: () => {},
    syncRouteFromLocation: (route) => { context.activePanel = route.panel; },
    focusFirstAvailableTarget: (primary) => {
      primary?.focus();
      return Boolean(primary);
    },
    panelFocusTargets: () => [fallback],
  };
  vm.runInNewContext(`${source}
this.composerApi = { scheduleOrderComposerOpen, closeOrderComposer };`, context);

  const returnContext = {
    route: { panel: 'orders', phoneView: 'intro' },
    historyState: { panel: 'orders', openedByApp: false },
    hash: '#orders',
  };
  context.composerApi.scheduleOrderComposerOpen(trigger, { returnContext, delay: 360 });
  assert.equal(context.orderComposerModal.hidden, true);
  assert.equal(scheduled.size, 1);

  context.composerApi.closeOrderComposer();
  assert.equal(scheduled.size, 0, '取消操作必须清除延迟打开回调');
  assert.equal(context.location.hash, '#orders');
  assert.equal(context.activePanel, 'orders');
  assert.deepEqual(focused, ['trigger']);
});

test('商城延迟焦点可取消，且旧页面或已关闭面板的回调不能抢焦点', () => {
  const source = functionSource('cancelPhoneViewFocus', 'pushPhoneView');
  const scheduled = new Map();
  let nextTimerId = 1;
  const focused = [];
  const focusTarget = (name) => ({ focus: () => focused.push(name) });
  const focusContext = {
    activePanel: 'new',
    activeCommerceType: 'shop',
    activeCommerceProductId: null,
    activeCommerceFilter: '推荐',
    editingOrderId: null,
    phoneView: 'home',
    phoneViewFocusTimer: null,
    phoneViewFocusSequence: 0,
    COMMERCE_CATALOGS: { shop: {} },
    app: { dataset: {} },
    panelClose: { setAttribute: () => {} },
    panelCloseLabel: { textContent: '' },
    shoppingIntroView: {},
    shoppingIntroTitle: focusTarget('intro'),
    phoneHomeView: {},
    phoneCommerce: {},
    commerceCatalogView: {},
    commerceDetailView: {},
    newPhoneScreen: {
      dataset: {},
      classList: { toggle: () => {} },
      scrollTo: () => {},
    },
    commerceTitle: focusTarget('catalog'),
    commerceDetailContent: { querySelector: () => focusTarget('detail') },
    commerceCatalog: () => ({ filters: ['推荐'] }),
    commerceTypeForSelectedCard: () => 'shop',
    commerceProduct: () => ({ id: 'product' }),
    resetOrderComposer: () => {},
    renderCommerceCatalog: () => {},
    renderCommerceDetail: () => {},
    document: {
      body: { classList: { contains: () => false } },
      querySelector: () => focusTarget('home'),
    },
    window: {
      setTimeout(callback) {
        const id = nextTimerId++;
        scheduled.set(id, callback);
        return id;
      },
      clearTimeout(id) { scheduled.delete(id); },
    },
  };

  vm.runInNewContext(`${source}\nthis.focusApi = { showPhoneView };`, focusContext);
  focusContext.focusApi.showPhoneView('catalog', { type: 'shop', focus: true });
  const staleCatalogFocus = [...scheduled.values()][0];
  focusContext.focusApi.showPhoneView('home', { type: 'shop', focus: false });
  staleCatalogFocus();
  assert.deepEqual(focused, [], '被后续视图取消的旧回调不得重新聚焦目录标题');

  focusContext.focusApi.showPhoneView('detail', { type: 'shop', productId: 'product', focus: true });
  const panelChangedFocus = [...scheduled.values()][0];
  focusContext.activePanel = 'orders';
  panelChangedFocus();
  assert.deepEqual(focused, [], '离开新建面板后延迟回调不得抢回焦点');

  focusContext.activePanel = 'new';
  focusContext.focusApi.showPhoneView('detail', { type: 'shop', productId: 'product', focus: true });
  const currentFocus = [...scheduled.values()].at(-1);
  currentFocus();
  assert.deepEqual(focused, ['detail'], '当前面板与视图仍匹配时才执行焦点移动');
});

test('功能面板打开时隐藏并禁用背景区域，关闭后完整恢复', () => {
  const regions = Array.from({ length: 3 }, () => ({
    inert: false,
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
  }));
  const accessibilityContext = { roomBackgroundRegions: regions };
  vm.runInNewContext(`${functionSource('setRoomBackgroundSuppressed', 'completeRoomEntry')}
setRoomBackgroundSuppressed(true);`, accessibilityContext);
  assert.ok(regions.every((region) => region.inert && region.attributes.get('aria-hidden') === 'true'));

  vm.runInNewContext('setRoomBackgroundSuppressed(false);', accessibilityContext);
  assert.ok(regions.every((region) => !region.inert && !region.attributes.has('aria-hidden')));
});

test('功能面板只把焦点送到内容标题，不在进入动画后再次抢焦点', () => {
  const source = functionSource('applyPanel', 'openPanel');
  assert.doesNotMatch(source, /panelClose\.focus/);
  assert.match(source, /requestAnimationFrame\([\s\S]*focusPanelEntry\(activePanel\)/);
});

test('功能面板内部切换后仍保留最初的房间触发器用于关闭时恢复焦点', () => {
  const source = functionSource('applyPanel', 'openPanel');
  assert.match(source, /previousTriggerIsPersistent\s*=\s*Boolean\(previousTrigger\?\.closest/);
  assert.match(
    source,
    /triggerIsPersistent\s*\?\s*trigger[\s\S]*previousTriggerIsPersistent\s*\?\s*previousTrigger[\s\S]*panorama\.getTriggerForPanel\(activePanel\)/,
  );
});

test('焦点恢复跳过隐藏或失效触发器，并使用可见后备入口', () => {
  const source = `${functionSource('isAvailableFocusTarget', 'focusFirstAvailableTarget')}
${functionSource('focusFirstAvailableTarget', 'setRoomUiInteractive')}`;
  const focused = [];
  const document = {
    activeElement: null,
    contains: () => true,
  };
  const target = (name, { visible = true, acceptsFocus = true } = {}) => ({
    disabled: false,
    closest: () => null,
    getClientRects: () => (visible ? [{}] : []),
    focus() {
      focused.push(name);
      if (acceptsFocus) document.activeElement = this;
    },
  });
  const hidden = target('hidden', { visible: false });
  const rejected = target('rejected', { acceptsFocus: false });
  const fallback = target('fallback');
  const context = { document };
  vm.runInNewContext(`${source}\nthis.focusFirstAvailableTarget = focusFirstAvailableTarget;`, context);

  assert.equal(context.focusFirstAvailableTarget(hidden, rejected, fallback), true);
  assert.deepEqual(focused, ['rejected', 'fallback']);
  assert.equal(document.activeElement, fallback);

  const applyPanelSource = functionSource('applyPanel', 'openPanel');
  assert.match(
    applyPanelSource,
    /focusPanel\.inert = true;[\s\S]*restorePanelReturnFocus\(returnTarget, resetComplete\)/,
    '关闭面板应在解除房间隔离后延迟恢复焦点，并以全景容器兜底',
  );
});

test('面板关闭时会等待全景投影再恢复原触发器焦点', async () => {
  const source = `${functionSource('isAvailableFocusTarget', 'focusFirstAvailableTarget')}
${functionSource('focusFirstAvailableTarget', 'restorePanelReturnFocus')}
${functionSource('restorePanelReturnFocus', 'setRoomUiInteractive')}`;
  const callbacks = [];
  const focused = [];
  let targetVisible = false;
  let resolveReset;
  const resetComplete = new Promise((resolve) => { resolveReset = resolve; });
  const document = {
    activeElement: null,
    contains: () => true,
  };
  const returnTarget = {
    disabled: false,
    closest: () => null,
    getClientRects: () => (targetVisible ? [{}] : []),
    focus() {
      focused.push('return');
      document.activeElement = this;
    },
  };
  const sceneFrame = {
    disabled: false,
    closest: () => null,
    getClientRects: () => [{}],
    focus() {
      focused.push('scene');
      document.activeElement = this;
    },
  };
  const context = {
    document,
    sceneFrame,
    window: { requestAnimationFrame: (callback) => callbacks.push(callback) },
  };
  vm.runInNewContext(`${source}\nrestorePanelReturnFocus(returnTarget, resetComplete);`, {
    ...context,
    resetComplete,
    returnTarget,
  });

  assert.equal(callbacks.length, 1);
  callbacks.shift()();
  assert.deepEqual(focused, ['scene'], '投影动画期间先提供可操作的全景焦点');

  targetVisible = true;
  resolveReset();
  await resetComplete;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(focused, ['scene', 'return']);

  const applyPanelSource = functionSource('applyPanel', 'openPanel');
  assert.match(applyPanelSource, /const resetComplete = panorama\.resetView\(\)/);
  assert.match(applyPanelSource, /restorePanelReturnFocus\(returnTarget, resetComplete\)/);
});

test('打开的原生对话框会在首尾控件间双向循环焦点', () => {
  let focusedTarget = '';
  let prevented = false;
  const focusTarget = (name) => ({
    disabled: false,
    closest: () => null,
    getClientRects: () => [{}],
    focus: () => { focusedTarget = name; },
  });
  const first = focusTarget('first');
  const last = focusTarget('last');
  const dialog = {
    contains: (target) => target === first || target === last,
    querySelectorAll: () => [first, last],
  };
  const focusContext = {
    document: {
      activeElement: last,
      contains: (target) => target === first || target === last,
      querySelectorAll: () => [dialog],
    },
  };
  vm.runInNewContext(`${functionSource('isAvailableFocusTarget', 'focusFirstAvailableTarget')}
${functionSource('trapOpenDialogFocus', 'completeRoomEntry')}
this.trapOpenDialogFocus = trapOpenDialogFocus;`, focusContext);

  assert.equal(focusContext.trapOpenDialogFocus({
    key: 'Tab',
    shiftKey: false,
    preventDefault: () => { prevented = true; },
  }), true);
  assert.equal(prevented, true);
  assert.equal(focusedTarget, 'first');

  focusContext.document.activeElement = first;
  prevented = false;
  assert.equal(focusContext.trapOpenDialogFocus({
    key: 'Tab',
    shiftKey: true,
    preventDefault: () => { prevented = true; },
  }), true);
  assert.equal(prevented, true);
  assert.equal(focusedTarget, 'last');
  assert.match(appSource, /document\.addEventListener\('keydown', \(event\) => \{\s*if \(trapOpenDialogFocus\(event\)\) return;/);
});

test('生成冷静小票后把键盘焦点移到新小票标题', () => {
  const source = functionSource('createOrder', 'resetOrderComposer');
  const reveal = source.indexOf('orderReceipt.hidden = false');
  const focus = source.indexOf("document.querySelector('#receiptProductName').focus", reveal);
  assert.ok(reveal >= 0 && focus > reveal);
});

test('分享海报为读屏提供与图中事实一致的替代文本', () => {
  const start = appSource.indexOf('function posterAltText(');
  const end = appSource.indexOf('async function generatePoster(', start);
  assert.ok(start >= 0 && end > start);
  const source = appSource.slice(start, end);
  const posterContext = {};
  vm.runInNewContext(`${source}\nthis.posterAltText = posterAltText;`, posterContext);
  const alt = posterContext.posterAltText({
    periodLabel: '最近 7 天',
    recordScope: '演示记录',
    persona: '研究主权者',
    savedAmount: 88,
    savedLabel: '¥88',
    savedCountLabel: '2 次',
    topCategory: '学习成长',
    orderCount: 4,
    confidence: 72,
    goalLabel: '当前预算目标：相机',
    advice: '先等一晚再决定。',
    generatedDate: '2026-08-30',
  });
  assert.match(alt, /最近 7 天.*演示记录.*研究主权者.*¥88.*2 次.*学习成长.*4 笔.*72%.*相机.*先等一晚.*2026-08-30/);
  assert.match(alt, /近期行为观察，不是永久标签/);
  assert.match(alt, /数据来自用户自我记录/);
  assert.match(alt, /虚拟记录，不代表真实账户余额/);
  assert.match(appSource, /posterPreview\.alt = posterAltText\(model\)/);
});

test('关键统计与复诊结果持续标明个人、演示或混合数据范围', () => {
  const start = appSource.indexOf('function orderDataMode(');
  const end = appSource.indexOf('function showToast(', start);
  assert.ok(start >= 0 && end > start);
  const scopeContext = {};
  vm.runInNewContext(`${appSource.slice(start, end)}\nthis.scopeApi = { orderDataMode, dataScopeLabel };`, scopeContext);
  assert.equal(scopeContext.scopeApi.dataScopeLabel(scopeContext.scopeApi.orderDataMode([]), 0), '暂无记录');
  assert.equal(scopeContext.scopeApi.dataScopeLabel(scopeContext.scopeApi.orderDataMode([{ demo: true }]), 1), '演示数据');
  assert.equal(scopeContext.scopeApi.dataScopeLabel(scopeContext.scopeApi.orderDataMode([{ demo: true }, { demo: false }]), 2), '个人 + 演示');
  assert.equal(scopeContext.scopeApi.dataScopeLabel(scopeContext.scopeApi.orderDataMode([{ demo: false }]), 1), '个人记录');
  assert.match(appSource, /metricDataScope\.textContent = dataScopeLabel/);
  assert.match(appSource, /orderDataScope\.textContent = dataScopeLabel/);
  assert.match(appSource, /复诊结论 · \$\{escapeHtml\(scopeLabel\)\}/);
});

test('复诊与海报调用层只传入和画像来源一致的当前目标', () => {
  const source = functionSource('goalForAssessment', 'goalById');
  const context = { activeGoal: null };
  vm.runInNewContext(`
    function currentGoal() { return activeGoal; }
    ${source}
    this.goalScope = { goalForAssessment };
  `, context);

  const demoGoal = { id: 'demo-goal', demo: true };
  const personalGoal = { id: 'personal-goal', demo: false };
  context.activeGoal = demoGoal;
  assert.equal(context.goalScope.goalForAssessment({ source: 'demo' }).id, demoGoal.id);
  assert.equal(context.goalScope.goalForAssessment({ source: 'personal' }), null);
  context.activeGoal = personalGoal;
  assert.equal(context.goalScope.goalForAssessment({ source: 'personal' }).id, personalGoal.id);
  assert.equal(context.goalScope.goalForAssessment({ source: 'demo' }), null);
  assert.equal(context.goalScope.goalForAssessment({ source: 'mixed' }), null);

  const consentSource = functionSource('renderConsentSummary', 'renderAiResult');
  const posterSource = functionSource('posterModel', 'posterAltText');
  const requestSource = functionSource('requestAiDiagnosis', 'startAiDiagnosis');
  assert.match(consentSource, /goal: goalForAssessment\(assessment\)/);
  assert.match(posterSource, /goal: goalForAssessment\(effectiveAssessment\)/);
  assert.match(requestSource, /goal: goalForAssessment\(requestAssessment\)/);
});

test('发送同意摘要只展示目标金额和进度，不读取目标名称', () => {
  const source = functionSource('renderConsentSummary', 'renderAiResult');
  const context = {
    state: { orders: [] },
    aiConsentSummary: { innerHTML: '' },
    buildDiagnosisRequest: () => ({
      period: 30,
      categories: [{ category: '餐饮饮品' }],
      reasons: [{ reason: '嘴馋' }],
      goal: { targetAmount: 3000, progress: 750, progressRate: 0.25 },
    }),
    goalForAssessment: () => ({ id: 'goal-private' }),
    dataScopeLabel: () => '个人数据',
    money: (value) => `¥${value}`,
    escapeHtml: (value) => String(value),
  };
  vm.runInNewContext(`${source}\nthis.renderConsentSummary = renderConsentSummary;`, context);
  context.renderConsentSummary({
    dataMode: 'personal',
    orderCount: 3,
    primaryPersona: { name: '欲望观察员' },
  });
  assert.match(context.aiConsentSummary.innerHTML, /已确认 ¥750 \/ 目标 ¥3000 · 25%/);
  assert.doesNotMatch(source, /payload\.goal\??\.name|payload\.goal\.name/);
});

test('人格抽取首次点击由主按钮读取内联勾选，不进入二次确认状态', () => {
  const source = functionSource('startAiDiagnosis', 'setGoal');
  assert.match(source, /aiConsentCheckbox\.checked/);
  assert.match(source, /setAiConsentRevocationFallback\(false\)/);
  assert.match(source, /setAiConsentGrantedForSession\(true\)/);
  assert.match(source, /requestAiDiagnosis\(\)/);
  assert.doesNotMatch(source, /status:\s*['"]consent['"]/);
  assert.doesNotMatch(source, /querySelector\(['"]#aiConsentTitle['"]\)/);
  assert.match(appSource, /analyzeButton\.addEventListener\('click', startAiDiagnosis\)/);
});

test('未勾选主按钮直接走本地测试且不请求，勾选后同一次点击授权并请求', () => {
  const source = functionSource('startAiDiagnosis', 'setGoal');

  function runStart({ checked }) {
    let sessionGranted = false;
    let revokeCleared = 0;
    let requestCalls = 0;
    let localRevealCalls = 0;
    let localRevealTarget = null;
    let renderCalls = 0;
    const state = { settings: { aiConsent: false } };
    const analyzeButton = { id: 'analyze-button' };
    const context = {
      state,
      analyzeButton,
      activeClinicPeriod: 30,
      currentAssessment: null,
      clockClinicAssessmentFingerprint: '',
      aiUiState: { status: 'idle', message: '' },
      aiConsentCheckbox: {
        checked,
        focus: () => {},
        setAttribute: () => {},
      },
      scorePersonality: () => ({ eligible: true, period: 30, orderCount: 3 }),
      assessmentReportFingerprint: () => 'eligible-assessment',
      aiConsentIsCurrent: () => state.settings.aiConsent && sessionGranted,
      setAiConsentRevocationFallback: (revoked) => {
        if (!revoked) revokeCleared += 1;
        return { storageUpdated: true, cookieUpdated: true };
      },
      setAiConsentGrantedForSession: (granted) => {
        sessionGranted = granted;
        return true;
      },
      requestAiDiagnosis: () => { requestCalls += 1; },
      startLocalGachaponReveal: (returnFocus) => {
        localRevealCalls += 1;
        localRevealTarget = returnFocus;
      },
      renderClinic: () => { renderCalls += 1; },
      window: { setTimeout: (callback) => callback() },
      document: { querySelector: () => null },
    };
    vm.runInNewContext(`${source}\nthis.startAiDiagnosis = startAiDiagnosis;`, context);
    context.startAiDiagnosis();
    return {
      consent: state.settings.aiConsent,
      sessionGranted,
      revokeCleared,
      requestCalls,
      localRevealCalls,
      localRevealTarget,
      analyzeButton,
      renderCalls,
      status: context.aiUiState.status,
    };
  }

  const unchecked = runStart({ checked: false });
  assert.equal(unchecked.consent, false);
  assert.equal(unchecked.sessionGranted, false);
  assert.equal(unchecked.revokeCleared, 0);
  assert.equal(unchecked.requestCalls, 0);
  assert.equal(unchecked.localRevealCalls, 1);
  assert.equal(unchecked.localRevealTarget, unchecked.analyzeButton);
  assert.equal(unchecked.status, 'idle');

  const checked = runStart({ checked: true });
  assert.equal(checked.consent, true);
  assert.equal(checked.sessionGranted, true);
  assert.equal(checked.revokeCleared, 1);
  assert.equal(checked.requestCalls, 1);
  assert.equal(checked.localRevealCalls, 0);
  assert.equal(checked.status, 'idle');
});

test('演示目标不会被编辑洗成个人数据，备份也不留下悬空目标引用', () => {
  const goalSource = functionSource('setGoal', 'focusGoalForm');
  const exportSource = functionSource('exportData', 'csvCell');
  assert.match(goalSource, /demo:\s*Boolean\(existing\?\.demo\)/);
  assert.match(exportSource, /personalGoalIds[\s\S]*delete sanitized\.goalId/);
  assert.match(appSource, /exportButton'\)\.disabled = !state\.orders\.some\(\(order\) => !order\.demo\)/);
  assert.match(appSource, /needsBudgetMigrationCleanup = JSON\.stringify\(parsed\.goals \|\| \[\]\)/);
});

test('本地存储失败警告在成功提示之后仍会成为最终提示', () => {
  const source = functionSource('saveState', 'mutate');
  const pending = [];
  const messages = [];
  const persistenceContext = {
    STORAGE_KEY: 'spree-test',
    state: { orders: [] },
    localStorage: { setItem: () => { throw new Error('quota'); } },
    window: { setTimeout: (callback) => pending.push(callback) },
    showToast: (message) => messages.push(message),
  };
  vm.runInNewContext(`${source}\nthis.saveState = saveState;`, persistenceContext);
  assert.equal(persistenceContext.saveState(), false);
  messages.push('模拟订单已创建');
  pending.forEach((callback) => callback());
  assert.equal(messages.at(-1), '本地存储暂不可用，本次刷新后数据可能丢失。');
});

test('保存目标时拒绝早于设备当天的日期', () => {
  const source = functionSource('setGoal', 'focusGoalForm');
  assert.match(source, /deadline && !isDateOnOrAfter\(deadline\)/);
  assert.match(source, /目标日期不能早于今天/);
});

test('撤回数据发送同意在本地存储失败时仍以跨会话标记兜底', () => {
  const start = appSource.indexOf('function setAiConsentRevocationFallback(');
  const end = appSource.indexOf('function loadState(', start);
  assert.ok(start >= 0 && end > start);
  const source = appSource.slice(start, end);
  const values = new Map();
  const storedValues = new Map();
  let cookieJar = '';
  const document = {};
  Object.defineProperty(document, 'cookie', {
    get: () => cookieJar,
    set: (value) => {
      cookieJar = String(value).includes('Max-Age=0') ? '' : String(value).split(';')[0];
    },
  });
  const consentContext = {
    SESSION_AI_REVOCATION_KEY: 'revoked',
    SESSION_AI_CONSENT_KEY: 'granted',
    AI_REVOCATION_STORAGE_KEY: 'revoked-at',
    AI_REVOCATION_COOKIE: 'spree_ai_revoked',
    document,
    sessionStorage: {
      setItem: (key, value) => values.set(key, value),
      getItem: (key) => values.get(key) || null,
      removeItem: (key) => values.delete(key),
    },
    localStorage: {
      setItem: (key, value) => storedValues.set(key, value),
      getItem: (key) => storedValues.get(key) || null,
      removeItem: (key) => storedValues.delete(key),
    },
  };
  consentContext.state = { settings: { aiConsent: true } };
  vm.runInNewContext(`${source}\nthis.consentApi = { setAiConsentRevocationFallback, aiConsentRevokedByFallback, setAiConsentGrantedForSession, aiConsentGrantedForSession, aiConsentIsCurrent };`, consentContext);
  assert.equal(consentContext.consentApi.aiConsentGrantedForSession(), false);
  assert.equal(consentContext.consentApi.setAiConsentGrantedForSession(true), true);
  assert.equal(consentContext.consentApi.aiConsentGrantedForSession(), true);
  const protectedResult = consentContext.consentApi.setAiConsentRevocationFallback(true);
  assert.equal(protectedResult.storageUpdated, true);
  assert.equal(protectedResult.cookieUpdated, true);
  values.clear();
  cookieJar = '';
  assert.equal(consentContext.consentApi.aiConsentRevokedByFallback(), true);
  const clearedResult = consentContext.consentApi.setAiConsentRevocationFallback(false);
  assert.equal(clearedResult.cookieUpdated, true);
  assert.equal(consentContext.consentApi.aiConsentRevokedByFallback(), false);
  assert.equal(consentContext.consentApi.setAiConsentGrantedForSession(false), true);
  assert.equal(consentContext.consentApi.aiConsentGrantedForSession(), false);
  const restoreSource = functionSource('restoreAiSessionState', 'aiConsentIsCurrent');
  assert.match(restoreSource, /const consentIsCurrent = aiConsentGrantedForSession\(\) && !aiConsentRevokedByFallback\(\)/);
  assert.match(restoreSource, /diagnosisIsAllowed = consentIsCurrent && !aiDiagnosisInvalidatedForSession\(\)/);
  assert.match(restoreSource, /diagnosisIsAllowed \? loadPersistedAiDiagnosis\(\) : null/);
  assert.match(restoreSource, /if \(!diagnosisIsAllowed\) persistAiDiagnosis\(null/);
  assert.match(appSource, /const fallbackProtection = setAiConsentRevocationFallback\(true\)/);
  assert.match(appSource, /const sessionConsentCleared = setAiConsentGrantedForSession\(false\)/);
  assert.match(appSource, /state\.settings\.aiConsent = false;[\s\S]*state\.diagnosis = null;[\s\S]*cancelAiRequest\('consent-revoked'\)/);
});

test('撤回同意会同步到已打开页面，发送前也会再次检查当前授权', () => {
  const requestSource = functionSource('requestAiDiagnosis', 'startAiDiagnosis');
  assert.match(requestSource, /if \(!aiConsentIsCurrent\(\)\)/);
  assert.match(appSource, /aiConsentChannel\?\.postMessage\(\{ type: 'revoked' \}\)/);
  assert.match(appSource, /aiConsentChannel\?\.addEventListener\('message',[\s\S]*applyExternalConsentRevocation/);
  assert.match(appSource, /window\.addEventListener\('storage',[\s\S]*event\.key === AI_REVOCATION_STORAGE_KEY[\s\S]*applyExternalConsentRevocation/);
  assert.doesNotMatch(appSource, /persisted\?\.settings\?\.aiConsent === false/);
  assert.match(requestSource, /if \(!aiConsentIsCurrent\(\)\)[\s\S]*error\.code = 'consent_revoked'/);
  assert.match(functionSource('diagnosisIsFreshFor', 'diagnosisIsFresh'), /if \(!aiConsentIsCurrent\(\)\) return false/);
  assert.match(functionSource('applyExternalConsentRevocation', 'loadState'), /state\.diagnosis = null/);
  assert.doesNotMatch(functionSource('applyExternalConsentRevocation', 'loadState'), /saveState\(\)/);
});

test('旧标签接收撤回事件时只清内存授权，不覆盖新标签已保存的业务数据', () => {
  const source = functionSource('applyExternalConsentRevocation', 'loadState');
  const latestPersisted = {
    orders: [{ id: 'new-order-from-tab-a' }],
    goals: [{ id: 'new-goal-from-tab-a' }],
  };
  let persisted = JSON.stringify(latestPersisted);
  let saveCalls = 0;
  let resultCloseCalls = 0;
  const context = {
    state: {
      orders: [{ id: 'stale-order-from-tab-b' }],
      goals: [],
      diagnosis: { result: { persona: { cardId: 'stale-card' } } },
      settings: { aiConsent: true },
    },
    aiConsentGrantedForSession: () => true,
    setAiConsentGrantedForSession: () => true,
    aiConsentCheckbox: { checked: true },
    aiConsentMessage: { textContent: 'old message' },
    setAiDiagnosisInvalidatedForSession: () => true,
    cancelAiRequest: () => true,
    persistAiDiagnosis: () => true,
    gachaponResultModal: { open: true },
    closeGachaponResult: () => { resultCloseCalls += 1; },
    clearPoster: () => {},
    saveState: () => {
      saveCalls += 1;
      persisted = JSON.stringify(context.state);
      return true;
    },
    activePanel: 'clinic',
    renderClinic: () => {},
    showToast: () => {},
  };
  vm.runInNewContext(`${source}\nthis.applyExternalConsentRevocation = applyExternalConsentRevocation;`, context);
  context.applyExternalConsentRevocation();
  assert.equal(saveCalls, 0);
  assert.deepEqual(JSON.parse(persisted), latestPersisted);
  assert.equal(context.state.settings.aiConsent, false);
  assert.equal(context.state.diagnosis, null);
  assert.equal(resultCloseCalls, 1);
});

test('旧标签主动撤回时依赖独立标记，不把旧订单和目标整包写回', () => {
  const start = appSource.indexOf("revokeAiConsentButton.addEventListener('click'");
  const end = appSource.indexOf("posterButton.addEventListener('click'", start);
  assert.ok(start >= 0 && end > start);
  const source = appSource.slice(start, end);
  const latestPersisted = {
    orders: [{ id: 'new-order-from-tab-a' }],
    goals: [{ id: 'new-goal-from-tab-a' }],
  };
  let persisted = JSON.stringify(latestPersisted);
  let saveCalls = 0;
  let resultCloseCalls = 0;
  let revokeHandler = null;
  const context = {
    revokeAiConsentButton: { addEventListener: (_event, handler) => { revokeHandler = handler; } },
    aiConsentCheckbox: { checked: true },
    aiConsentMessage: { textContent: 'old message' },
    state: {
      orders: [{ id: 'stale-order-from-tab-b' }],
      goals: [],
      diagnosis: { result: { persona: { cardId: 'stale-card' } } },
      settings: { aiConsent: true },
    },
    cancelAiRequest: () => true,
    setAiDiagnosisInvalidatedForSession: () => true,
    setAiConsentGrantedForSession: () => true,
    setAiConsentRevocationFallback: () => ({ storageUpdated: true, cookieUpdated: true }),
    persistAiDiagnosis: () => true,
    closeGachaponResult: () => { resultCloseCalls += 1; },
    clearPoster: () => {},
    saveState: () => {
      saveCalls += 1;
      persisted = JSON.stringify(context.state);
      return true;
    },
    aiConsentChannel: { postMessage: () => {} },
    aiUiState: { status: 'idle', message: '' },
    renderClinic: () => {},
    showToast: () => {},
  };
  vm.runInNewContext(source, context);
  assert.equal(typeof revokeHandler, 'function');
  revokeHandler();
  assert.equal(saveCalls, 0);
  assert.deepEqual(JSON.parse(persisted), latestPersisted);
  assert.equal(context.state.settings.aiConsent, false);
  assert.equal(context.state.diagnosis, null);
  assert.equal(resultCloseCalls, 1);
});

test('内联授权不再保留独立确认按钮，本地结果与撤回入口继续存在', () => {
  assert.doesNotMatch(indexSource, /id="allowAiButton"/);
  assert.doesNotMatch(appSource, /allowAiButton\.addEventListener/);
  assert.match(indexSource, /id="localOnlyButton"/);
  assert.match(indexSource, /id="revokeAiConsentButton"/);
  assert.match(appSource, /localOnlyButton\.addEventListener\('click'/);
  assert.match(appSource, /revokeAiConsentButton\.addEventListener\('click'/);
});

test('诊断结果使用独立存储，业务快照始终剥离同意与诊断字段', () => {
  const businessSource = functionSource('businessStateForStorage', 'parseBusinessStateSnapshot');
  const diagnosisSource = functionSource('persistAiDiagnosis', 'restoreAiSessionState');
  const writes = new Map();
  const context = {
    AI_DIAGNOSIS_STORAGE_KEY: 'diagnosis-only',
    localStorage: {
      setItem: (key, value) => writes.set(key, value),
      removeItem: (key) => writes.delete(key),
    },
    window: { setTimeout: (callback) => callback() },
    showToast: () => {},
  };
  vm.runInNewContext(`${businessSource}\n${diagnosisSource}\nthis.persistenceApi = { businessStateForStorage, persistAiDiagnosis };`, context);
  const business = context.persistenceApi.businessStateForStorage({
    schemaVersion: 2,
    orders: [{ id: 'kept-order' }],
    goals: [{ id: 'kept-goal' }],
    diagnosis: { result: 'private' },
    settings: { reduceMotion: true, aiConsent: true },
  });
  assert.equal(business.diagnosis, null);
  assert.equal(business.settings.aiConsent, false);
  assert.equal(business.settings.reduceMotion, true);
  assert.deepEqual(business.orders, [{ id: 'kept-order' }]);
  assert.equal(context.persistenceApi.persistAiDiagnosis({ requestFingerprint: 'fresh' }), true);
  assert.deepEqual(JSON.parse(writes.get('diagnosis-only')), { requestFingerprint: 'fresh' });
  assert.equal(writes.size, 1);
});

test('完整业务同步指纹保留便签视图，而诊断业务指纹排除坐标颜色和旋转', () => {
  const source = functionSource('businessStateFingerprint', 'loadPersistedAiDiagnosis');
  const context = {
    businessStateStorageDirty: false,
    activeBudgetGoal: (snapshot) => snapshot.goals.find((goal) => goal.id === snapshot.activeGoalId) || snapshot.goals[0] || null,
  };
  vm.runInNewContext(`${source}\nthis.fingerprints = { businessStateFingerprint, diagnosisBusinessStateFingerprint };`, context);
  const base = {
    schemaVersion: 2,
    dataRevision: 7,
    orders: [{ id: 'order-1', amount: 88 }],
    goals: [{
      id: 'goal-1',
      amount: 1000,
      createdAt: '2026-08-01T00:00:00.000Z',
      demo: false,
      note: { x: 0.2, y: 0.3, color: 'yellow', rotation: -2 },
    }],
    activeGoalId: 'goal-1',
  };
  const viewOnly = structuredClone(base);
  viewOnly.goals[0].note = { x: 0.8, y: 0.7, color: 'coral', rotation: 4 };
  assert.notEqual(
    context.fingerprints.businessStateFingerprint(base),
    context.fingerprints.businessStateFingerprint(viewOnly),
    '完整同步仍需看到便签视图变化',
  );
  assert.equal(
    context.fingerprints.diagnosisBusinessStateFingerprint(base),
    context.fingerprints.diagnosisBusinessStateFingerprint(viewOnly),
    '便签视图元数据不能使综合人格过期',
  );
  const amountChanged = structuredClone(base);
  amountChanged.goals[0].amount = 1200;
  assert.notEqual(
    context.fingerprints.diagnosisBusinessStateFingerprint(base),
    context.fingerprints.diagnosisBusinessStateFingerprint(amountChanged),
    '影响目标进度的金额变化必须使综合人格过期',
  );
});

test('主业务存储写失败会标记内存 dirty，持久态诊断门禁随后视为不可用', () => {
  const fingerprintSource = functionSource('businessStateFingerprint', 'loadPersistedAiDiagnosis');
  const saveSource = functionSource('saveState', 'applyExternalBusinessState');
  const context = {
    STORAGE_KEY: 'business',
    state: { schemaVersion: 2, dataRevision: 3, orders: [{ id: 'memory-new' }], goals: [], settings: {} },
    businessStateStorageDirty: false,
    localStorage: {
      setItem: () => { throw new Error('quota'); },
      getItem: () => JSON.stringify({ schemaVersion: 2, dataRevision: 2, orders: [{ id: 'persisted-old' }], goals: [] }),
    },
    businessStateForStorage: (snapshot) => snapshot,
    parseBusinessStateSnapshot: (raw) => JSON.parse(raw),
    window: { setTimeout: () => 1 },
    showToast: () => {},
  };
  vm.runInNewContext(`${fingerprintSource}\n${saveSource}\nthis.persistenceGuard = { saveState, persistedDiagnosisBusinessStateFingerprint };`, context);
  assert.equal(context.persistenceGuard.saveState(), false);
  assert.equal(context.businessStateStorageDirty, true);
  assert.equal(context.persistenceGuard.persistedDiagnosisBusinessStateFingerprint(), 'unavailable');
  assert.equal(context.state.orders[0].id, 'memory-new');
});

test('刷新进入没有会话同意的新页面时不会恢复旧综合诊断', () => {
  const source = functionSource('restoreAiSessionState', 'aiConsentIsCurrent');
  let diagnosisLoadCalls = 0;
  let diagnosisClearCalls = 0;
  const context = {
    aiConsentGrantedForSession: () => false,
    aiConsentRevokedByFallback: () => false,
    aiDiagnosisInvalidatedForSession: () => false,
    loadPersistedAiDiagnosis: () => { diagnosisLoadCalls += 1; return { requestFingerprint: 'old' }; },
    persistAiDiagnosis: (diagnosis) => { if (diagnosis === null) diagnosisClearCalls += 1; },
  };
  vm.runInNewContext(`${source}\nthis.restoreAiSessionState = restoreAiSessionState;`, context);
  const restored = context.restoreAiSessionState({
    settings: { reduceMotion: false, aiConsent: true },
    diagnosis: { requestFingerprint: 'legacy-old' },
  });
  assert.equal(restored.settings.aiConsent, false);
  assert.equal(restored.diagnosis, null);
  assert.equal(diagnosisLoadCalls, 0);
  assert.equal(diagnosisClearCalls, 1);
});

test('跨标签业务变化会只读同步最新快照，并立即作废旧诊断与顶层结果', () => {
  const source = functionSource('applyExternalBusinessState', 'mutate');
  const latest = {
    schemaVersion: 2,
    dataRevision: 9,
    orders: [{ id: 'new-order-from-tab-a' }],
    goals: [{ id: 'new-goal-from-tab-a' }],
    activeGoalId: 'new-goal-from-tab-a',
    diagnosis: null,
    settings: { reduceMotion: false, aiConsent: false },
  };
  const rawValue = JSON.stringify(latest);
  let cancelled = 0;
  let diagnosisCleared = 0;
  let modalClosed = 0;
  let posterCleared = 0;
  let renders = 0;
  let writes = 0;
  const context = {
    STORAGE_KEY: 'business',
    localStorage: {
      getItem: () => rawValue,
      setItem: () => { writes += 1; },
    },
    state: {
      schemaVersion: 2,
      dataRevision: 8,
      orders: [{ id: 'stale-order-from-tab-b' }],
      goals: [],
      activeGoalId: null,
      diagnosis: { result: 'stale' },
      settings: { reduceMotion: false, aiConsent: true },
    },
    parseBusinessStateSnapshot: () => structuredClone(latest),
    businessStateStorageDirty: false,
    businessStateFingerprint: (snapshot) => JSON.stringify({
      dataRevision: snapshot.dataRevision,
      orders: snapshot.orders,
      goals: snapshot.goals,
      activeGoalId: snapshot.activeGoalId,
    }),
    diagnosisBusinessStateFingerprint: (snapshot) => JSON.stringify({
      dataRevision: snapshot.dataRevision,
      orders: snapshot.orders,
      goals: snapshot.goals.map(({ id, amount, createdAt, demo }) => ({ id, amount, createdAt, demo })),
      activeGoalId: snapshot.activeGoalId,
    }),
    cancelAiRequest: () => { cancelled += 1; },
    aiConsentGrantedForSession: () => true,
    aiConsentRevokedByFallback: () => false,
    setAiDiagnosisInvalidatedForSession: () => true,
    persistAiDiagnosis: (diagnosis) => { if (diagnosis === null) diagnosisCleared += 1; },
    aiUiState: { status: 'requesting', message: '' },
    currentAssessment: { stale: true },
    personalityProfileRenderSignature: 'stale',
    selectedGoalId: null,
    goalFormMode: 'new',
    renderedGoalId: null,
    closeGachaponResult: () => { modalClosed += 1; },
    clearPoster: () => { posterCleared += 1; },
    syncReducedMotionPreference: () => {},
    renderAll: () => { renders += 1; },
    showToast: () => {},
  };
  vm.runInNewContext(`${source}\nthis.applyExternalBusinessState = applyExternalBusinessState;`, context);
  assert.equal(context.applyExternalBusinessState(rawValue), true);
  assert.equal(writes, 0);
  assert.equal(cancelled, 1);
  assert.equal(diagnosisCleared, 1);
  assert.equal(modalClosed, 1);
  assert.equal(posterCleared, 1);
  assert.equal(renders, 1);
  assert.equal(context.state.orders[0].id, 'new-order-from-tab-a');
  assert.equal(context.state.settings.aiConsent, true);
  assert.match(appSource, /event\.key === STORAGE_KEY\) applyExternalBusinessState\(event\.newValue\)/);
});

test('跨标签只换色或拖动便签会同步视图但保留请求、诊断、弹窗与海报', () => {
  const source = functionSource('applyExternalBusinessState', 'mutate');
  const current = {
    schemaVersion: 2,
    dataRevision: 8,
    orders: [{ id: 'same-order', amount: 88 }],
    goals: [{
      id: 'goal-1',
      amount: 1000,
      createdAt: '2026-08-01T00:00:00.000Z',
      demo: false,
      note: { x: 0.2, y: 0.3, color: 'yellow', rotation: -2 },
    }],
    activeGoalId: 'goal-1',
    diagnosis: { requestFingerprint: 'fresh-hybrid' },
    settings: { reduceMotion: false, aiConsent: true },
  };
  const incoming = structuredClone(current);
  incoming.diagnosis = null;
  incoming.settings.aiConsent = false;
  incoming.goals[0].note = { x: 0.75, y: 0.18, color: 'acid', rotation: 4 };
  const rawValue = JSON.stringify(incoming);
  let cancelled = 0;
  let diagnosisCleared = 0;
  let modalClosed = 0;
  let posterCleared = 0;
  let renders = 0;
  const fullFingerprint = (snapshot) => JSON.stringify({
    dataRevision: snapshot.dataRevision,
    orders: snapshot.orders,
    goals: snapshot.goals,
    activeGoalId: snapshot.activeGoalId,
  });
  const diagnosisFingerprint = (snapshot) => JSON.stringify({
    dataRevision: snapshot.dataRevision,
    orders: snapshot.orders,
    goals: snapshot.goals.map(({ id, amount, createdAt, demo }) => ({ id, amount, createdAt, demo })),
    activeGoalId: snapshot.activeGoalId,
  });
  const context = {
    STORAGE_KEY: 'business',
    localStorage: { getItem: () => rawValue },
    state: structuredClone(current),
    businessStateStorageDirty: false,
    parseBusinessStateSnapshot: () => structuredClone(incoming),
    businessStateFingerprint: fullFingerprint,
    diagnosisBusinessStateFingerprint: diagnosisFingerprint,
    cancelAiRequest: () => { cancelled += 1; },
    aiConsentGrantedForSession: () => true,
    aiConsentRevokedByFallback: () => false,
    setAiDiagnosisInvalidatedForSession: () => true,
    persistAiDiagnosis: (diagnosis) => { if (diagnosis === null) diagnosisCleared += 1; },
    aiUiState: { status: 'success', message: '' },
    currentAssessment: { current: true },
    personalityProfileRenderSignature: 'current-profile',
    selectedGoalId: 'goal-1',
    goalFormMode: 'edit',
    renderedGoalId: 'goal-1',
    closeGachaponResult: () => { modalClosed += 1; },
    clearPoster: () => { posterCleared += 1; },
    syncReducedMotionPreference: () => {},
    renderAll: () => { renders += 1; },
    showToast: () => {},
  };
  vm.runInNewContext(`${source}\nthis.applyExternalBusinessState = applyExternalBusinessState;`, context);
  assert.equal(context.applyExternalBusinessState(rawValue), true);
  assert.equal(context.state.goals[0].note.color, 'acid');
  assert.equal(context.state.diagnosis.requestFingerprint, 'fresh-hybrid');
  assert.equal(context.aiUiState.status, 'success');
  assert.equal(cancelled, 0);
  assert.equal(diagnosisCleared, 0);
  assert.equal(modalClosed, 0);
  assert.equal(posterCleared, 0);
  assert.equal(renders, 1);
});

test('减少动态按钮的 aria-pressed 反映站内开关与系统偏好的有效结果', () => {
  const applied = [];
  const motionButton = { setAttribute: (_name, value) => applied.push(['aria', value]) };
  const motionContext = {
    state: { settings: { reduceMotion: false } },
    reducedMotionQuery: { matches: true },
    document: {
      body: { classList: { toggle: (_name, value) => applied.push(['body', value]) } },
      querySelector: () => motionButton,
    },
    analysisStageController: { setReducedMotion: (value) => applied.push(['stages', value]) },
    panorama: { setReducedMotion: (value) => applied.push(['panorama', value]) },
    roomIntro: { setReducedMotion: (value) => applied.push(['intro', value]) },
    gachaponMotion: { setReducedMotion: (value) => applied.push(['gachapon', value]) },
    gestureController: { handleReducedMotionChange: (value) => applied.push(['gesture', value]) },
    orientationController: { handleReducedMotionChange: (value) => applied.push(['orientation', value]) },
  };
  vm.runInNewContext(`${trailingFunctionSource('syncReducedMotionPreference', '\nsyncReducedMotionPreference();')}
syncReducedMotionPreference();`, motionContext);
  assert.deepEqual(applied, [
    ['body', true],
    ['stages', true],
    ['panorama', true],
    ['intro', true],
    ['gachapon', true],
    ['gesture', true],
    ['orientation', true],
    ['aria', 'true'],
  ]);
});

function createLocalGachaponHarness({ reducedMotion = false } = {}) {
  const scheduled = [];
  const openedSources = [];
  let renderCalls = 0;
  let toastCalls = 0;
  const assessment = {
    eligible: true,
    period: 30,
    orderCount: 4,
    fingerprint: 'stable-local-assessment',
  };
  const context = {
    activePanel: 'clinic',
    activeClinicPeriod: 30,
    aiUiState: { status: 'idle', message: '' },
    clinicRenderPending: false,
    clockClinicAssessmentFingerprint: '',
    currentAssessment: null,
    localGachaponSpinSequence: 0,
    localGachaponSpinTimer: null,
    localGachaponSpinning: false,
    analyzeButton: { id: 'analyze-button' },
    state: { dataRevision: 7, orders: [] },
    assessmentReportFingerprint: (value) => value.fingerprint,
    closeGachaponResult: () => {},
    document: {
      body: {
        classList: { contains: (name) => name === 'reduce-motion' && reducedMotion },
      },
    },
    gachaponIsBusy: () => context.aiUiState.status === 'requesting' || context.localGachaponSpinning,
    gachaponMachine: { classList: { remove: () => {} } },
    gachaponMotion: { setState: () => {} },
    aiCard: { setAttribute: () => {} },
    openGachaponResult: ({ source }) => {
      openedSources.push(source);
      return true;
    },
    renderClinic: () => { renderCalls += 1; },
    scorePersonality: () => assessment,
    showToast: () => { toastCalls += 1; },
    window: {
      setTimeout(callback, delay) {
        scheduled.push({ callback, delay });
        return scheduled.length;
      },
    },
  };
  vm.runInNewContext(`${functionSource('startLocalGachaponReveal', 'closeGachaponResult')}
this.startLocalGachaponReveal = startLocalGachaponReveal;`, context);
  return {
    context,
    scheduled,
    openedSources,
    start: context.startLocalGachaponReveal,
    get renderCalls() { return renderCalls; },
    get toastCalls() { return toastCalls; },
  };
}

test('本地人格先进入碰撞旋转，常规 1400ms 与减弱动效 0ms 后各只揭晓一次', () => {
  for (const [reducedMotion, expectedDelay] of [[false, 1400], [true, 0]]) {
    const harness = createLocalGachaponHarness({ reducedMotion });
    assert.equal(harness.start(), true);
    assert.equal(harness.context.localGachaponSpinning, true);
    assert.deepEqual(harness.openedSources, [], '开始抽取时不能立即打开结果弹窗');
    assert.equal(harness.renderCalls, 1, '开始时先重绘成扭蛋旋转状态');
    assert.equal(harness.scheduled.length, 1);
    assert.equal(harness.scheduled[0].delay, expectedDelay);

    assert.equal(harness.start(), false, '旋转期间重复点击不得再排一个揭晓任务');
    assert.equal(harness.scheduled.length, 1);
    harness.scheduled[0].callback();
    assert.equal(harness.context.localGachaponSpinning, false);
    assert.deepEqual(harness.openedSources, ['local']);
    assert.equal(harness.toastCalls, 1);
  }
});

test('关闭本地人格结果后把焦点还给实际发起抽取的按钮', () => {
  const focused = [];
  const classNames = new Set();
  const document = {
    activeElement: null,
    contains: () => true,
  };
  const focusTarget = (name) => ({
    disabled: false,
    closest: () => null,
    getClientRects: () => [{}],
    focus() {
      focused.push(name);
      document.activeElement = this;
    },
  });
  const localOnlyButton = focusTarget('local-only');
  const analyzeButton = focusTarget('hybrid');
  const modal = {
    open: false,
    dataset: {},
    style: { setProperty: () => {} },
    showModal() { this.open = true; },
    close() { this.open = false; },
  };
  const presentation = {
    canonical: { id: 'research-sovereign', name: '研究主权者' },
    card: {
      id: 'rational-survivor',
      displayName: '理性生存者',
      accent: '#ff7a00',
      gradient: ['#fff4dc', '#ffd4a0'],
      art: 'persona-figma-rational-survivor.png',
      tags: ['先研究', '再决定'],
    },
    decision: 'local',
    inference: null,
  };
  const context = {
    activePanel: 'clinic',
    currentAssessment: { eligible: true, period: 30, orderCount: 4, confidence: { level: 'stable' } },
    clinicRenderPending: false,
    gachaponResultReturnFocus: null,
    gachaponResultSource: 'hybrid',
    gachaponResultModal: modal,
    gachaponResultArt: {},
    gachaponResultFlair: { textContent: '' },
    gachaponResultTags: { innerHTML: '' },
    gachaponResultTitle: focusTarget('title'),
    gachaponResultDescription: { textContent: '' },
    gachaponResultRetryButton: { textContent: '' },
    localOnlyButton,
    analyzeButton,
    aiCard: {
      classList: {
        add: (name) => classNames.add(name),
        remove: (name) => classNames.delete(name),
      },
    },
    closePosterShare: () => {},
    resolvePersonaPresentation: () => presentation,
    personaPresentationFor: () => presentation,
    personaArtUrl: (art) => `./assets/${art}`,
    escapeHtml: (value) => String(value),
    renderClinic: () => {},
    document,
    window: { requestAnimationFrame: (callback) => callback() },
  };
  vm.runInNewContext(`${functionSource('isAvailableFocusTarget', 'focusFirstAvailableTarget')}
${functionSource('focusFirstAvailableTarget', 'setRoomUiInteractive')}
${functionSource('openGachaponResult', 'startLocalGachaponReveal')}
${functionSource('closeGachaponResult', 'clearPoster')}
this.resultApi = { openGachaponResult, closeGachaponResult };`, context);

  assert.equal(context.resultApi.openGachaponResult({ source: 'local', returnFocus: analyzeButton }), true);
  assert.equal(context.gachaponResultRetryButton.textContent, '再测一次');
  assert.equal(classNames.has('is-gachapon-result-open'), true);
  context.resultApi.closeGachaponResult();
  assert.deepEqual(focused, ['title', 'hybrid']);
  assert.equal(classNames.has('is-gachapon-result-open'), false);
});

test('本地结果的“再抽一次”继续走本地路径，不误触在线综合推演', () => {
  const start = appSource.indexOf("gachaponResultRetryButton.addEventListener('click'");
  const end = appSource.indexOf("gachaponResultOpenButton.addEventListener('click'", start);
  assert.ok(start >= 0 && end > start, '应能读取再抽一次的事件处理');
  let retryHandler = null;
  let closeCalls = 0;
  let localCalls = 0;
  let hybridCalls = 0;
  const returnFocus = { id: 'original-trigger' };
  let localReturnFocus = null;
  const context = {
    gachaponResultSource: 'local',
    gachaponResultReturnFocus: returnFocus,
    gachaponResultRetryButton: {
      addEventListener: (_event, handler) => { retryHandler = handler; },
    },
    closeGachaponResult: () => { closeCalls += 1; },
    startLocalGachaponReveal: (target) => {
      localCalls += 1;
      localReturnFocus = target;
    },
    startAiDiagnosis: () => { hybridCalls += 1; },
  };
  vm.runInNewContext(appSource.slice(start, end), context);
  assert.equal(typeof retryHandler, 'function');
  retryHandler();
  assert.equal(closeCalls, 1);
  assert.equal(localCalls, 1);
  assert.equal(localReturnFocus, returnFocus);
  assert.equal(hybridCalls, 0);

  context.gachaponResultSource = 'hybrid';
  retryHandler();
  assert.equal(localCalls, 1);
  assert.equal(hybridCalls, 1);
});

test('打开人格报告会从结果弹窗切到可滚动报告，并可返回扭蛋机', () => {
  const openStart = appSource.indexOf("gachaponResultOpenButton.addEventListener('click'");
  const openEnd = appSource.indexOf("downloadPosterButton.addEventListener('click'", openStart);
  const openSource = appSource.slice(openStart, openEnd);
  const backStart = appSource.indexOf("clinicReportBackButton.addEventListener('click'");
  const backSource = appSource.slice(backStart, backStart + 500);

  assert.ok(openStart >= 0 && openEnd > openStart, '应保留结果弹窗的打开报告操作');
  assert.match(openSource, /closeGachaponResult\(\{\s*restoreFocus:\s*false\s*\}\)/);
  assert.match(openSource, /setClinicView\('report',[\s\S]*?focus:\s*true/);
  assert.doesNotMatch(openSource, /scrollIntoView\(/, '打开报告应切换视图，不是在扭蛋首页向下找旧报告');

  assert.ok(backStart >= 0, '报告页应提供返回扭蛋机操作');
  assert.match(backSource, /setClinicView\('start',[\s\S]*?focus:\s*true/);

  const applyPanelSource = functionSource('applyPanel', 'openPanel');
  assert.match(applyPanelSource, /nextPanel\s*===\s*'clinic'[\s\S]*?setClinicView\('start'/);
});

test('预算表单统一调用一万元校验，同时允许历史超限原值原样展示保存', () => {
  let customValidity = '';
  let focusCalls = 0;
  let reportCalls = 0;
  const goalAmountInput = {
    value: '10000',
    setCustomValidity: (message) => { customValidity = message; },
    focus: () => { focusCalls += 1; },
    reportValidity: () => { reportCalls += 1; },
  };
  const goalAmountError = { textContent: '', hidden: true };
  const context = {
    goalFormMode: 'new',
    selectedGoalId: null,
    goalAmountInput,
    goalAmountError,
    MAX_BUDGET_GOAL_AMOUNT: 10_000,
    validateBudgetGoalAmount,
    goalById: () => null,
  };
  vm.runInNewContext(`${functionSource('selectedGoalAmountForValidation', 'renderGoalAmountChoice')}
this.goalValidationApi = { selectedGoalAmountForValidation, validateGoalAmountField };`, context);

  assert.deepEqual({ ...context.goalValidationApi.validateGoalAmountField() }, {
    amount: 10_000,
    valid: true,
    reason: 'valid',
    preservesLegacyAmount: false,
  });
  assert.equal(customValidity, '');
  assert.equal(goalAmountError.hidden, true);

  goalAmountInput.value = '10001';
  const overLimit = context.goalValidationApi.validateGoalAmountField({ announce: true });
  assert.equal(overLimit.valid, false);
  assert.equal(overLimit.reason, 'over-limit');
  assert.match(customValidity, /最多为 ¥10,000/);
  assert.equal(goalAmountError.hidden, false);
  assert.equal(focusCalls, 1);
  assert.equal(reportCalls, 1);

  context.goalFormMode = 'edit';
  context.selectedGoalId = 'legacy-goal';
  context.goalById = () => ({ id: 'legacy-goal', amount: 12_000 });
  goalAmountInput.value = '12000';
  const legacy = context.goalValidationApi.validateGoalAmountField();
  assert.equal(legacy.valid, true);
  assert.equal(legacy.reason, 'legacy-preserved');
  assert.equal(customValidity, '');
  assert.equal(goalAmountError.hidden, true);

  assert.match(indexSource, /id="goalAmountInput"[^>]*max="10000"/);
  assert.match(functionSource('fillGoalForm', 'resetGoalForm'), /goalAmountInput\.max = String\(goal\.amount > MAX_BUDGET_GOAL_AMOUNT \? goal\.amount : MAX_BUDGET_GOAL_AMOUNT\)/);
  assert.match(functionSource('setGoal', 'setActiveGoal'), /validateBudgetGoalAmount\(formData\.get\('goalAmount'\), selectedGoalAmountForValidation\(\)\)/);
});

test('CSV 固定字段顺序并中和表格公式前缀', () => {
  const start = appSource.indexOf('const CSV_ORDER_HEADERS');
  const end = appSource.indexOf('function exportOrdersCsv', start);
  assert.ok(start >= 0 && end > start, 'CSV 合同应保持可测试的独立区域');
  const csvContext = { STATUS_LABELS: { cooling: '冷静中' } };
  vm.runInNewContext(`${appSource.slice(start, end)}
this.csvApi = { CSV_ORDER_HEADERS, csvCell, csvOrderRow };`, csvContext);
  const { CSV_ORDER_HEADERS, csvCell, csvOrderRow } = csvContext.csvApi;

  assert.deepEqual([...CSV_ORDER_HEADERS], [
    '订单编号', '商品名称', '金额', '分类', '购买原因', '备注', '状态', '创建时间', '更新时间',
  ]);
  assert.equal(csvCell('=2+3'), "'=2+3");
  assert.equal(csvCell('  +2+3'), "'  +2+3");
  assert.equal(csvCell('@SUM(1,2)'), '"\'@SUM(1,2)"');

  const row = csvOrderRow({
    id: 'order-1',
    name: '耳机',
    amount: 88,
    category: '数码家居',
    reason: '被种草',
    note: '等一天',
    status: 'cooling',
    createdAt: '2026-08-30T10:00:00+08:00',
    updatedAt: '2026-08-30T11:00:00+08:00',
  });
  assert.deepEqual([...row], [
    'order-1', '耳机', '88.00', '数码家居', '被种草', '等一天', '冷静中',
    '2026-08-30T10:00:00+08:00', '2026-08-30T11:00:00+08:00',
  ]);
});

test('导出文件名使用设备本地日期而不是 UTC 日期', () => {
  const source = functionSource('localDateStamp', 'exportData');
  const dateContext = {};
  vm.runInNewContext(`${source}\nthis.localDateStamp = localDateStamp;`, dateContext);
  const fakeLocalDate = {
    getFullYear: () => 2026,
    getMonth: () => 7,
    getDate: () => 30,
  };
  assert.equal(dateContext.localDateStamp(fakeLocalDate), '2026-08-30');
  assert.match(appSource, /让你花个爽！数据-\$\{localDateStamp\(\)\}\.json/);
  assert.match(appSource, /让你花个爽！订单-\$\{localDateStamp\(\)\}\.csv/);
  assert.match(appSource, /让你花个爽-钱包人格-\$\{localDateStamp\(\)\}\.png/);
  assert.doesNotMatch(appSource, /toISOString\(\)\.slice\(0, 10\)/);
});
