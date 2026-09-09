import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { projectedHotspotFitsViewport } from '../panorama.js';
import { activeBudgetGoal, nextGoalNote, normalizeBudgetGoal, validateBudgetGoalAmount } from '../budget-goals.js';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const picker = readFileSync(new URL('../goal-date-picker.js', import.meta.url), 'utf8');

test('快递和活动热点离开视口后不再留下不可见的可聚焦按钮', () => {
  const frame = { width: 1440, height: 1000 };
  for (const kind of ['thought', 'activity']) {
    assert.equal(projectedHotspotFitsViewport({ visible: true, x: 20, y: 400 }, frame, { kind }), true);
    for (const [x, y] of [[-30, 400], [1480, 400], [720, -40], [720, 1060]]) {
      assert.equal(projectedHotspotFitsViewport({ visible: true, x, y }, frame, { kind }), false);
    }
  }
});

function sourceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}

function applyMonthlyPreset(state, amount) {
  const context = {
    state, activeBudgetGoal, nextGoalNote, normalizeBudgetGoal, validateBudgetGoalAmount,
    localDateKey: (date) => date.toISOString().slice(0, 10),
    mutate: (callback) => callback(state), renderGoal() {}, showToast() {}, money: String,
    selectedGoalId: null, goalFormMode: 'new', renderedGoalId: null,
  };
  vm.runInNewContext(`${sourceBetween(app, 'function replaceGoalForScope(', 'function setGoal(')}
${sourceBetween(app, 'function setMonthlyGoalPreset(', 'function focusGoalForm(')}
this.apply = setMonthlyGoalPreset;`, context);
  return context.apply(amount);
}

test('快捷额度保留手动目标的身份、创建时间、内容与已有回血订单关联', () => {
  const goal = normalizeBudgetGoal({id:'custom-goal',name:'相机计划',amount:1000,createdAt:'2026-08-01T00:00:00.000Z',deadline:'2026-12-01',noteText:'先看看旧相机',demo:false}, 'custom-goal');
  const state = {goals:[goal],activeGoalId:goal.id,orders:[{id:'saved-ticket',status:'saved',amount:120,goalId:goal.id,createdAt:'2026-08-10T00:00:00.000Z'}]};
  const before = structuredClone(state);
  assert.equal(applyMonthlyPreset(state,3000),true);
  assert.equal(state.goals.length,1);
  for (const key of ['id','name','createdAt','deadline','noteText','demo']) assert.equal(state.goals[0][key],before.goals[0][key],key);
  assert.deepEqual(state.goals[0].note,before.goals[0].note);
  assert.deepEqual(state.orders,before.orders);
  assert.equal(state.activeGoalId,goal.id);
  assert.equal(state.goals[0].amount,3000);
  applyMonthlyPreset(state,5000);
  assert.equal(state.goals[0].id,goal.id);
  assert.equal(state.goals[0].createdAt,before.goals[0].createdAt);
});

test('调整演示目标额度不会把它变成个人目标或解除演示订单关联', () => {
  const state = {goals:[normalizeBudgetGoal({id:'demo-goal',name:'演示相机',amount:1000,demo:true},'demo-goal')],activeGoalId:'demo-goal',orders:[{id:'demo-ticket',status:'saved',amount:60,demo:true,goalId:'demo-goal'}]};
  applyMonthlyPreset(state,3000);
  assert.equal(state.goals.length,1);
  assert.equal(state.goals[0].id,'demo-goal');
  assert.equal(state.goals[0].demo,true);
  assert.equal(state.orders[0].goalId,'demo-goal');
});

test('没有目标时快捷额度创建单个目标，无效额度不修改已有数据', () => {
  const state = {goals:[],activeGoalId:null,orders:[]};
  assert.equal(applyMonthlyPreset(state,3000),true);
  assert.equal(state.goals.length,1);
  assert.equal(state.goals[0].amount,3000);
  assert.equal(state.goals[0].demo,false);
  const before = structuredClone(state);
  assert.equal(applyMonthlyPreset(state,10001),false);
  assert.deepEqual(state,before);
});

test('折叠的判断选项不进入弹窗 Tab 顺序，展开后恢复并保留 summary 入口', () => {
  let expanded = false;
  const summary = { contains: (element) => element === summary };
  const details = { querySelector: () => summary };
  const makeTarget = (insideDetails = false) => ({
    focus() {},
    getClientRects: () => [{}],
    closest: (selector) => insideDetails && !expanded && selector === 'details:not([open])' ? details : null,
  });
  Object.assign(summary, makeTarget(true));
  const name = makeTarget();
  const checkbox = makeTarget(true);
  const submit = makeTarget();
  const context = {
    document: { contains: () => true },
    orderComposerModal: { querySelectorAll: () => [name, summary, checkbox, submit] },
  };
  vm.runInNewContext(`${sourceBetween(app, 'function isAvailableFocusTarget(', 'function focusFirstAvailableTarget(')}
${sourceBetween(app, 'function orderComposerFocusableElements(', 'function cancelPendingOrderComposerOpen(')}
this.focusable = orderComposerFocusableElements;`, context);
  assert.deepEqual([...context.focusable()], [name, summary, submit]);
  expanded = true;
  assert.deepEqual([...context.focusable()], [name, summary, checkbox, submit]);
});

test('路由返回会清理订单、成功、报告和确认弹层，并安全取消待确认的操作', () => {
  const calls = [];
  const context = {};
  for (const name of ['closeMallSuccess', 'closeOrderComposer', 'closePosterShare', 'closeGachaponResult', 'finishSiteConfirmation']) {
    context[name] = (options) => calls.push([name, options]);
  }
  context.siteConfirmDialog = { open: true };
  for (const name of ['roomHelpDialog', 'resetDataDialog']) {
    context[name] = { open: true, close: () => calls.push([name]) };
  }
  context.goalDatePicker = { close: (options) => calls.push(['calendar', options]) };
  vm.runInNewContext(`${sourceBetween(app, 'function closeRouteOverlays(', 'function syncRouteFromLocation(')}
closeRouteOverlays();`, context);
  assert.equal(calls.length, 8);
  assert.equal(calls.find(([name]) => name === 'finishSiteConfirmation')[1], false);
  for (const name of ['closeOrderComposer', 'closePosterShare', 'closeGachaponResult', 'calendar']) {
    assert.equal(calls.find(([called]) => called === name)[1].restoreFocus, false);
  }
});

test('日期弹层失去焦点会收起，焦点在日期控件内部移动不会提前关闭', () => {
  const listeners = new Map();
  const calls = [];
  const trigger = {};
  const day = {};
  const outside = {};
  const context = {
    document: { addEventListener: (name, handler) => listeners.set(name, handler) },
    picker: {
      isOpen: true,
      root: { contains: (target) => target === trigger },
      popover: { contains: (target) => target === day },
      close: (options) => calls.push(options),
    },
  };
  const handler = sourceBetween(picker, "document.addEventListener('focusin'", "document.addEventListener('keydown'");
  vm.runInNewContext(`(function () { ${handler} }).call(picker);`, context);
  const focusin = listeners.get('focusin');
  focusin({ target: trigger });
  focusin({ target: day });
  assert.equal(calls.length, 0);
  focusin({ target: outside });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].restoreFocus, false);
});

test('日期弹层在动画帧前关闭后，不再把焦点抢回已隐藏的日期', () => {
  const scheduled = [];
  let focuses = 0;
  const context = {
    window: { requestAnimationFrame: (callback) => scheduled.push(callback) },
    picker: {
      isOpen: false,
      popover: { hidden: true },
      trigger: { setAttribute() {} },
      render() {},
      positionPopover() {},
      grid: { querySelector: () => ({ focus: () => { focuses += 1; } }) },
    },
  };
  const open = sourceBetween(picker, '  open() {', '  close(').replace('open() {', 'function open() {');
  vm.runInNewContext(`${open}\nopen.call(picker);`, context);
  context.picker.isOpen = false;
  scheduled[0]();
  assert.equal(focuses, 0);
});
