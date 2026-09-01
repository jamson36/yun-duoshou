import { normalizeGoalNote } from './budget-whiteboard.js';
import { normalizeDateValue } from './goal-date-picker.js';

export const MAX_BUDGET_GOAL_AMOUNT = 10_000;

const NOTE_POSITIONS = Object.freeze([
  { x: 0.34, y: 0.33, rotation: -3 },
  { x: 0.66, y: 0.31, rotation: 2 },
  { x: 0.50, y: 0.60, rotation: -1 },
  { x: 0.27, y: 0.68, rotation: 2 },
  { x: 0.73, y: 0.66, rotation: -2 },
  { x: 0.50, y: 0.43, rotation: 3 },
]);

function validDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function stableLegacyGoalId(goal) {
  const suffix = String(goal?.createdAt || 'first').replace(/[^0-9]/g, '').slice(0, 14) || 'first';
  return `goal-legacy-${suffix}`;
}

export function validateBudgetGoalAmount(rawAmount, existingAmount = null) {
  const amount = Number(rawAmount);
  const previousAmount = Number(existingAmount);
  const preservesLegacyAmount = Number.isFinite(previousAmount)
    && previousAmount > MAX_BUDGET_GOAL_AMOUNT
    && amount === previousAmount;
  let reason = 'valid';
  if (!Number.isFinite(amount) || amount <= 0) reason = 'invalid';
  else if (amount > MAX_BUDGET_GOAL_AMOUNT && !preservesLegacyAmount) reason = 'over-limit';
  else if (preservesLegacyAmount) reason = 'legacy-preserved';
  return {
    amount,
    valid: reason === 'valid' || reason === 'legacy-preserved',
    reason,
    preservesLegacyAmount,
  };
}

export function nextGoalNote(goals = [], color = 'yellow') {
  const base = NOTE_POSITIONS[goals.length % NOTE_POSITIONS.length];
  const lap = Math.floor(goals.length / NOTE_POSITIONS.length);
  const offset = Math.min(0.06, lap * 0.018);
  return normalizeGoalNote({
    ...base,
    x: base.x + (lap % 2 ? -offset : offset),
    y: base.y + offset,
    color,
  });
}

export function normalizeBudgetGoal(goal, fallbackId = '') {
  const amount = Number(goal?.amount);
  const createdAt = validDate(goal?.createdAt)?.toISOString() || new Date().toISOString();
  return {
    id: String(goal?.id || fallbackId).slice(0, 80),
    name: String(goal?.name || '').trim().slice(0, 20),
    amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
    deadline: normalizeDateValue(goal?.deadline),
    noteText: String(goal?.noteText || '').trim().slice(0, 36),
    note: normalizeGoalNote(goal?.note),
    demo: Boolean(goal?.demo),
    createdAt,
    updatedAt: validDate(goal?.updatedAt)?.toISOString() || createdAt,
  };
}

export function activeBudgetGoal(state) {
  const goals = Array.isArray(state?.goals) ? state.goals : [];
  return goals.find((goal) => goal.id === state?.activeGoalId) || goals[0] || null;
}

export function migrateBudgetState(rawState = {}) {
  const sourceOrders = Array.isArray(rawState.orders) ? rawState.orders : [];
  const sourceGoals = Array.isArray(rawState.goals) ? rawState.goals : [];
  const legacyGoal = rawState.goal && typeof rawState.goal === 'object' ? rawState.goal : null;
  const normalizeMigratedGoal = (goal, fallbackId) => {
    const goalId = String(goal?.id || fallbackId);
    const linkedOrders = sourceOrders.filter((order) => String(order?.goalId || '') === goalId);
    const linkedOnlyToDemoOrders = linkedOrders.length > 0 && linkedOrders.every((order) => Boolean(order?.demo));
    const isLegacyMigrationArtifact = goalId.startsWith('goal-legacy-') && linkedOrders.some((order) => Boolean(order?.demo));
    const inferredDemo = Boolean(goal?.demo)
      || (!Object.hasOwn(goal || {}, 'demo') && linkedOnlyToDemoOrders)
      || isLegacyMigrationArtifact;
    return normalizeBudgetGoal({ ...goal, demo: inferredDemo }, fallbackId);
  };
  const legacyGoalIsDemo = Boolean(legacyGoal?.demo)
    || Boolean(legacyGoal && !Object.hasOwn(legacyGoal, 'demo') && sourceOrders.some((order) => Boolean(order?.demo)));
  const goals = sourceGoals.length
    ? sourceGoals.map((goal, index) => normalizeMigratedGoal(goal, `goal-${index + 1}`)).filter((goal) => goal.id && goal.name && goal.amount > 0)
    : (legacyGoal ? [normalizeBudgetGoal({ ...legacyGoal, demo: legacyGoalIsDemo }, stableLegacyGoalId(legacyGoal))] : []);
  const uniqueGoals = goals.filter((goal, index) => goals.findIndex((item) => item.id === goal.id) === index);
  const requestedActiveId = String(rawState.activeGoalId || '');
  const activeGoalId = uniqueGoals.some((goal) => goal.id === requestedActiveId)
    ? requestedActiveId
    : (uniqueGoals[0]?.id || null);
  const legacyMigrated = Boolean(legacyGoal && !sourceGoals.length && uniqueGoals.length);
  const migratedGoal = legacyMigrated ? uniqueGoals[0] : null;
  const goalCreatedAt = migratedGoal ? validDate(migratedGoal.createdAt) : null;
  const orders = sourceOrders.map((sourceOrder) => {
    let order = sourceOrder;
    if (legacyMigrated && !order.goalId && order.status === 'saved') {
      const decisionDate = validDate(order.updatedAt) || validDate(order.decidedAt) || validDate(order.createdAt);
      if (Boolean(order.demo) === Boolean(migratedGoal.demo)
        && decisionDate && goalCreatedAt && decisionDate >= goalCreatedAt) {
        order = { ...order, goalId: migratedGoal.id };
      }
    }
    if (!order.goalId) return order;
    const assignedGoal = uniqueGoals.find((goal) => goal.id === order.goalId);
    if (!assignedGoal || Boolean(order.demo) === Boolean(assignedGoal.demo)) return order;
    const cleanedOrder = { ...order };
    delete cleanedOrder.goalId;
    return cleanedOrder;
  });

  const migrated = {
    ...rawState,
    schemaVersion: 2,
    goals: uniqueGoals,
    activeGoalId,
    orders,
  };
  delete migrated.goal;
  return migrated;
}

export function goalForSavedOrder(order, goals = [], activeGoalId = null) {
  const matchingGoals = goals.filter((goal) => Boolean(goal?.demo) === Boolean(order?.demo));
  const existing = matchingGoals.find((goal) => goal.id === order?.goalId);
  if (existing) return existing.id;
  return matchingGoals.some((goal) => goal.id === activeGoalId) ? activeGoalId : null;
}
