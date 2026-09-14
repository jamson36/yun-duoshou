import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { SceneBudgetWhiteboard, SCENE_ORDER_PAGE_SIZE } from '../budget-whiteboard.js';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const between = (name, next) => source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${next}(`));
const orders = (count) => Array.from({ length: count }, (_, index) => ({
  id: `order-${index}`, name: `商品 ${index}`, amount: index + 1, status: index % 2 ? 'saved' : 'cooling',
  category: '数码家居', reason: '先比较', demo: false,
  createdAt: new Date(Date.UTC(2026, 8, 14, 0, 0, index)).toISOString(),
}));

function element() {
  return {
    children: [], dataset: {}, listeners: {}, attributes: {}, style: { setProperty() {} },
    classList: { add() {}, toggle() {} }, clientWidth: 1440, clientHeight: 1000,
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    append(...children) { children.forEach((child) => this.appendChild(child)); },
    appendChild(child) { child.parent = this; this.children.push(child); },
    remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); },
  };
}

test('1000 笔订单全部可分页访问，筛选总数与金额继续来自完整记录', () => {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const state = { orders: orders(1000), goals: [] };
  const original = JSON.stringify(state);
  const context = {
    state, activeFilter: 'all', activeTimeFilter: 'all', orderPage: 0, ORDER_PAGE_SIZE: 30,
    orderList: node('#orderList'), document: { querySelector: node, querySelectorAll: () => [] },
    ORDER_TIME_FILTER_LABELS: { all: '全部时间' }, ORDER_DATE_FORMATTER: new Intl.DateTimeFormat('zh-CN'),
    orderMatchesTimeFilter: () => true, money: String, escapeHtml: String, orderThumbnailFor: () => '',
    allowedOrderStatusActions: () => [], STATUS_LABELS: {}, STATUS_TAG_LABELS: {},
  };
  vm.runInNewContext(between('renderOrders', 'changeOrderPage'), context);
  const seen = new Set();
  for (let page = 0; page < 34; page += 1) {
    context.orderPage = page;
    context.renderOrders();
    const ids = [...new Set([...context.orderList.innerHTML.matchAll(/data-order-id="([^"]+)"/g)].map((match) => match[1]))];
    assert.ok(ids.length <= 30);
    ids.forEach((id) => seen.add(id));
  }
  assert.equal(seen.size, 1000);
  assert.match(node('#orderSummary').textContent, /1000.*500500/);
  assert.equal(node('#orderPageNext').disabled, true);
  context.orderPage = 0;
  context.renderOrders({ focusOrderId: 'order-0' });
  assert.equal(context.orderPage, 33);
  assert.match(context.orderList.innerHTML, /data-order-id="order-0"/);
  context.activeFilter = 'saved';
  context.renderOrders();
  assert.equal(context.orderPage, 16, '筛选收缩后页码不能留在不存在的页面');
  assert.match(node('#orderCountSticker').textContent, /500\/1000/);
  assert.match(node('#orderSummary').textContent, /500500/);
  assert.equal(JSON.stringify(state), original);
  state.orders = [];
  context.renderOrders();
  assert.equal(context.orderPage, 0);
  assert.equal(node('#orderPagination').hidden, true);
});

test('业务数据更新只绘制当前面板，房间便签在回到房间时才同步', () => {
  const calls = [];
  const context = { state: { orders: [] }, activePanel: 'orders' };
  for (const name of ['renderMetrics', 'renderOrderDashboard', 'renderCommerceShell', 'renderOrderEditor', 'renderOrders', 'renderClinic', 'renderGoal', 'renderTestHistory']) {
    context[name] = () => calls.push(name);
  }
  context.sceneWhiteboard = { renderOrders: () => calls.push('scene') };
  vm.runInNewContext(between('renderActivePanel', 'createOrder'), context);
  context.renderAll();
  assert.deepEqual(calls, ['renderMetrics', 'renderOrders']);
  calls.length = 0;
  context.activePanel = null;
  context.renderAll();
  assert.deepEqual(calls, ['renderMetrics', 'scene']);
  calls.length = 0;
  context.activePanel = 'clinic';
  context.renderAll();
  assert.deepEqual(calls, ['renderMetrics', 'renderClinic', 'renderTestHistory']);
});

test('白板分页覆盖全部订单、复用未变化的便签，记录减少后自动收敛页码', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  globalThis.document = { createElement: element };
  globalThis.window = { requestAnimationFrame: (fn) => fn() };
  try {
    const board = new SceneBudgetWhiteboard({
      layer: element(), status: element(),
      panorama: { addProjectionObserver: () => () => {}, projectPoint: (yaw, pitch) => ({ x: 300 + yaw * 400, y: 100 + pitch * 500, localZ: 1 }) },
      surface: { topLeft: { yaw: 0, pitch: 0 }, topRight: { yaw: 1, pitch: 0 }, bottomLeft: { yaw: 0, pitch: 1 }, bottomRight: { yaw: 1, pitch: 1 } },
    });
    const records = orders(35);
    const original = JSON.stringify(records);
    board.renderOrders(records);
    assert.equal(board.notes.size, SCENE_ORDER_PAGE_SIZE);
    const firstNote = board.notes.values().next().value.element;
    board.renderOrders(records);
    assert.equal(board.notes.values().next().value.element, firstNote);
    const seen = new Set(board.notes.keys());
    board.pageNext.listeners.click();
    board.notes.forEach((_, id) => seen.add(id));
    board.pageNext.listeners.click();
    board.notes.forEach((_, id) => seen.add(id));
    assert.equal(seen.size, records.length);
    assert.equal(board.notes.size, 3);
    assert.equal(board.pageNext.disabled, true);
    assert.equal(JSON.stringify(records), original);
    board.renderOrders([records[0]]);
    assert.equal(board.orderPage, 0);
    assert.equal(board.orderPagination.hidden, true);
    records[0].amount = 888;
    board.renderOrders([records[0]]);
    assert.match(board.notes.get(records[0].id).element.attributes['aria-label'], /888/);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});
