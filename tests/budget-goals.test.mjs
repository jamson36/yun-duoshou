import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BUDGET_GOAL_AMOUNT,
  activeBudgetGoal,
  goalForSavedOrder,
  migrateBudgetState,
  nextGoalNote,
  validateBudgetGoalAmount,
} from '../budget-goals.js';

test('新建或修改后的目标金额不得超过一万元', () => {
  assert.equal(MAX_BUDGET_GOAL_AMOUNT, 10_000);
  assert.deepEqual(validateBudgetGoalAmount(10_000), {
    amount: 10_000,
    valid: true,
    reason: 'valid',
    preservesLegacyAmount: false,
  });
  assert.deepEqual(validateBudgetGoalAmount(10_001), {
    amount: 10_001,
    valid: false,
    reason: 'over-limit',
    preservesLegacyAmount: false,
  });
});

test('历史超限目标保留原值但修改金额时必须降至一万元以内', () => {
  const migrated = migrateBudgetState({
    schemaVersion: 2,
    activeGoalId: 'legacy-expensive-goal',
    goals: [{ id: 'legacy-expensive-goal', name: '历史目标', amount: 12_000 }],
    orders: [],
  });
  assert.equal(migrated.goals[0].amount, 12_000);
  assert.deepEqual(validateBudgetGoalAmount(12_000, 12_000), {
    amount: 12_000,
    valid: true,
    reason: 'legacy-preserved',
    preservesLegacyAmount: true,
  });
  assert.equal(validateBudgetGoalAmount(11_000, 12_000).valid, false);
  assert.equal(validateBudgetGoalAmount(10_000, 12_000).valid, true);
});

test('旧版单目标会迁移为当前目标且保留已归入的确认省下记录', () => {
  const migrated = migrateBudgetState({
    schemaVersion: 1,
    goal: { name: '去海边', amount: 3000, createdAt: '2026-08-01T00:00:00.000Z' },
    orders: [
      { id: 'before', amount: 20, status: 'saved', updatedAt: '2026-07-01T00:00:00.000Z' },
      { id: 'after', amount: 80, status: 'saved', updatedAt: '2026-08-20T00:00:00.000Z' },
    ],
  });
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.goals.length, 1);
  assert.equal(migrated.activeGoalId, migrated.goals[0].id);
  assert.equal(migrated.orders[0].goalId, undefined);
  assert.equal(migrated.orders[1].goalId, migrated.activeGoalId);
  assert.equal(Object.hasOwn(migrated, 'goal'), false);
});

test('当前目标从目标数组中确定且无效 id 会安全回退', () => {
  const state = { activeGoalId: 'missing', goals: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] };
  assert.equal(activeBudgetGoal(state).id, 'a');
});

test('幸好没买优先保留原目标分配，否则进入当前目标', () => {
  const goals = [{ id: 'a' }, { id: 'b' }];
  assert.equal(goalForSavedOrder({ goalId: 'a' }, goals, 'b'), 'a');
  assert.equal(goalForSavedOrder({}, goals, 'b'), 'b');
  assert.equal(goalForSavedOrder({}, goals, 'missing'), null);
});

test('个人订单不会归入演示目标，演示订单也不会归入个人目标', () => {
  const goals = [{ id: 'personal' }, { id: 'demo', demo: true }];
  assert.equal(goalForSavedOrder({}, goals, 'demo'), null);
  assert.equal(goalForSavedOrder({ demo: true }, goals, 'personal'), null);
  assert.equal(goalForSavedOrder({ demo: true }, goals, 'demo'), 'demo');
  assert.equal(goalForSavedOrder({}, goals, 'personal'), 'personal');
});

test('新增便签会轮换白板位置而不是完全重叠', () => {
  const first = nextGoalNote([]);
  const second = nextGoalNote([{ id: 'a' }]);
  assert.notDeepEqual({ x: first.x, y: first.y }, { x: second.x, y: second.y });
});

test('演示目标迁移后仍保留演示标记', () => {
  const migrated = migrateBudgetState({
    schemaVersion: 2,
    activeGoalId: 'demo-goal',
    goals: [{ id: 'demo-goal', name: '演示目标', amount: 1000, demo: true }],
    orders: [],
  });
  assert.equal(migrated.goals[0].demo, true);
});

test('旧版全演示记录会把无标记目标迁移为演示目标', () => {
  const migrated = migrateBudgetState({
    schemaVersion: 1,
    goal: { name: '演示相机', amount: 5000, createdAt: '2026-08-01T00:00:00.000Z' },
    orders: [
      { id: 'demo-saved', demo: true, amount: 500, status: 'saved', updatedAt: '2026-08-20T00:00:00.000Z' },
    ],
  });
  assert.equal(migrated.goals[0].demo, true);
  assert.equal(migrated.orders[0].goalId, migrated.activeGoalId);
});

test('已经错误持久化的演示订单关联会修复目标范围', () => {
  const migrated = migrateBudgetState({
    schemaVersion: 2,
    activeGoalId: 'goal-legacy-20260801000000',
    goals: [{ id: 'goal-legacy-20260801000000', name: '演示相机', amount: 5000, demo: false }],
    orders: [{ id: 'demo-saved', demo: true, goalId: 'goal-legacy-20260801000000', amount: 500, status: 'saved' }],
  });
  assert.equal(migrated.goals[0].demo, true);
});

test('旧版演示目标在混入个人订单后仍按演示范围迁移', () => {
  const migrated = migrateBudgetState({
    schemaVersion: 1,
    goal: { name: '演示相机', amount: 5000, createdAt: '2026-08-01T00:00:00.000Z' },
    orders: [
      { id: 'demo-saved', demo: true, amount: 500, status: 'saved', updatedAt: '2026-08-20T00:00:00.000Z' },
      { id: 'personal-cooling', demo: false, amount: 50, status: 'cooling', updatedAt: '2026-08-21T00:00:00.000Z' },
    ],
  });
  assert.equal(migrated.goals[0].demo, true);
  assert.equal(migrated.orders[0].goalId, migrated.activeGoalId);
  assert.equal(migrated.orders[1].goalId, undefined);
});

test('显式个人目标不会因错误关联演示订单而被改成演示目标', () => {
  const migrated = migrateBudgetState({
    schemaVersion: 2,
    activeGoalId: 'personal-goal',
    goals: [{ id: 'personal-goal', name: '个人相机', amount: 5000, demo: false }],
    orders: [{ id: 'demo-saved', demo: true, goalId: 'personal-goal', amount: 500, status: 'saved' }],
  });
  assert.equal(migrated.goals[0].demo, false);
  assert.equal(migrated.orders[0].goalId, undefined);
});

test('旧迁移目标混合关联时按演示范围修复并解除个人订单关联', () => {
  const migrated = migrateBudgetState({
    schemaVersion: 2,
    activeGoalId: 'goal-legacy-20260801000000',
    goals: [{ id: 'goal-legacy-20260801000000', name: '旧演示目标', amount: 5000, demo: false }],
    orders: [
      { id: 'demo-saved', demo: true, goalId: 'goal-legacy-20260801000000', amount: 500, status: 'saved' },
      { id: 'personal-saved', demo: false, goalId: 'goal-legacy-20260801000000', amount: 50, status: 'saved' },
    ],
  });
  assert.equal(migrated.goals[0].demo, true);
  assert.equal(migrated.orders[0].goalId, migrated.activeGoalId);
  assert.equal(migrated.orders[1].goalId, undefined);
});
