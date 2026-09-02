import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PEEL_GAME_STATUS,
  PRODUCT_CATALOG,
  advanceRound,
  applyPeelSegment,
  createPeelGame,
  phaseForElapsed,
  resumeRound,
  selectFocusItem,
  skipTutorial,
  startRound,
  pauseRound,
} from '../peel-game.js';

function crossing(entity) {
  return {
    from: { x: entity.x - entity.radius * 1.5, y: entity.y },
    to: { x: entity.x + entity.radius * 1.5, y: entity.y },
  };
}

test('新游戏从纯 READY 状态开始，首轮不读写浏览器业务数据', () => {
  const game = createPeelGame({ seed: 'ready', tutorialCompleted: false });

  assert.equal(game.status, PEEL_GAME_STATUS.READY);
  assert.equal(game.durationMs, 45_000);
  assert.equal(game.elapsedMs, 0);
  assert.deepEqual(game.entities, []);
  assert.equal(game.score.peeledShells, 0);
  assert.equal(game.score.revealedProducts, 0);
});

test('第一次进入是无计时奶茶教学，切开后才开始正式 45 秒', () => {
  const started = startRound(createPeelGame({ seed: 'tutorial', tutorialCompleted: false }));
  assert.equal(started.status, PEEL_GAME_STATUS.TUTORIAL);
  assert.equal(started.entities.length, 1);
  assert.equal(started.entities[0].item.id, 'milk-tea');
  assert.ok(started.entities[0].y > 1, '教学商品也应从舞台底部抛起');
  assert.ok(started.entities[0].vy < 0);
  assert.equal(started.entities[0].frozen, false);

  const rising = advanceRound(started, 500);
  assert.equal(rising.elapsedMs, 0, '教学运动不消耗正式回合时间');
  assert.ok(rising.entities[0].y < started.entities[0].y);

  const waited = advanceRound(rising, 8_000);
  assert.equal(waited.elapsedMs, 0);
  assert.equal(waited.entities[0].frozen, true, '教学商品到达切割区后应停住等待操作');
  assert.equal(waited.entities[0].vy, 0);
  assert.ok(waited.entities[0].y > 0.35 && waited.entities[0].y < 0.58);

  const peeled = applyPeelSegment(waited, crossing(waited.entities[0]));
  assert.equal(peeled.status, PEEL_GAME_STATUS.PLAYING);
  assert.equal(peeled.elapsedMs, 0);
  assert.equal(peeled.tutorialCompleted, true);
  assert.deepEqual(peeled.entities, []);
  assert.equal(peeled.score.peeledShells, 0, '教学不计入正式成绩');
});

test('直接开始会跳过教学且不计分', () => {
  const tutorial = startRound(createPeelGame({ seed: 'skip', tutorialCompleted: false }));
  const skipped = skipTutorial(tutorial);

  assert.equal(skipped.status, PEEL_GAME_STATUS.PLAYING);
  assert.equal(skipped.elapsedMs, 0);
  assert.equal(skipped.tutorialCompleted, true);
  assert.deepEqual(skipped.entities, []);
  assert.deepEqual(skipped.score, { peeledShells: 0, revealedProducts: 0, missedProducts: 0 });
});

test('正式商品从底部向上抛出并按抛物线受重力下落', () => {
  const started = startRound(createPeelGame({ seed: 'physics', tutorialCompleted: true }));
  const launched = started.entities[0];
  assert.equal(started.status, PEEL_GAME_STATUS.PLAYING);
  assert.ok(launched.y > 1);
  assert.ok(launched.vy < 0);

  const advanced = advanceRound(started, 300);
  const moved = advanced.entities.find((entity) => entity.id === launched.id);
  assert.ok(moved.y < launched.y);
  assert.ok(moved.vy > launched.vy, '重力应让上抛速度逐步转向下落');
});

test('轨迹只逐层剥开话术外壳，商品本体不可继续切割', () => {
  let game = startRound(createPeelGame({ seed: 'peel-once', tutorialCompleted: true }));
  game = advanceRound(game, 360);
  const entity = game.entities[0];
  const first = applyPeelSegment(game, crossing(entity));
  const peeledEntity = first.entities.find((entry) => entry.id === entity.id);

  assert.equal(first.score.peeledShells, 1);
  assert.equal(peeledEntity.shells[0].peeled, true);
  assert.equal(peeledEntity.coreRevealed, peeledEntity.shells.length === 1);
  assert.equal(first.reveals.at(-1).text, peeledEntity.shells[0].copy.reveal);

  let fullyPeeled = first;
  while (!fullyPeeled.entities[0].coreRevealed) {
    fullyPeeled = applyPeelSegment(fullyPeeled, crossing(fullyPeeled.entities[0]));
  }
  const scoreAfterShells = fullyPeeled.score.peeledShells;
  const cutCore = applyPeelSegment(fullyPeeled, crossing(fullyPeeled.entities[0]));
  assert.equal(cutCore.score.peeledShells, scoreAfterShells);
  assert.equal(cutCore.score.revealedProducts, 1);
  assert.equal(cutCore.entities[0].coreRevealed, true);
});

test('暂停期间物理和计时冻结，恢复后从原状态继续', () => {
  const playing = startRound(createPeelGame({ seed: 'pause', tutorialCompleted: true }));
  const paused = pauseRound(playing);
  const waited = advanceRound(paused, 2_000);
  assert.equal(waited.status, PEEL_GAME_STATUS.PAUSED);
  assert.equal(waited.elapsedMs, paused.elapsedMs);
  assert.deepEqual(waited.entities, paused.entities);
  assert.equal(resumeRound(waited).status, PEEL_GAME_STATUS.PLAYING);
});

test('局内实体始终不超过 8 个，减少动态时取消高速和旋转', () => {
  let game = startRound(createPeelGame({ seed: 'cap', tutorialCompleted: true }));
  for (let index = 0; index < 20; index += 1) game = advanceRound(game, 1_150);
  assert.ok(game.entities.length <= 8);

  const reduced = startRound(createPeelGame({
    seed: 'reduced',
    tutorialCompleted: true,
    reducedMotion: true,
  }));
  assert.equal(reduced.entities[0].rotationVelocity, 0);
  assert.ok(Math.abs(reduced.entities[0].vy) < 0.6);
});

test('回合阶段固定为单层、混合和聚焦商品三个时段', () => {
  assert.equal(phaseForElapsed(0), 'single');
  assert.equal(phaseForElapsed(19_999), 'single');
  assert.equal(phaseForElapsed(20_000), 'mixed');
  assert.equal(phaseForElapsed(37_999), 'mixed');
  assert.equal(phaseForElapsed(38_000), 'focus');
  assert.equal(phaseForElapsed(45_000), 'complete');
});

test('聚焦商品优先最近的非演示冷静中订单，否则稳定回退本地商品池', () => {
  const orders = [
    { id: 'old', name: '旧耳机', status: 'cooling', updatedAt: '2026-09-01T08:00:00Z' },
    { id: 'demo', name: '演示相机', status: 'cooling', demo: true, updatedAt: '2026-09-02T10:00:00Z' },
    { id: 'bought', name: '已买键盘', status: 'purchased', updatedAt: '2026-09-02T11:00:00Z' },
    { id: 'new', name: '想买的咖啡机', category: 'home', status: 'cooling', updatedAt: '2026-09-02T09:00:00Z' },
  ];

  const focus = selectFocusItem({ orders, seed: 'focus' });
  assert.equal(focus.source, 'order');
  assert.equal(focus.orderId, 'new');
  assert.equal(focus.name, '想买的咖啡机');

  const fallbackA = selectFocusItem({ orders: [], seed: 'same-seed' });
  const fallbackB = selectFocusItem({ orders: [], seed: 'same-seed' });
  assert.deepEqual(fallbackA, fallbackB);
  assert.ok(PRODUCT_CATALOG.some((item) => item.id === fallbackA.id));
});

test('个人冷静单只把用户明确选择的原因映射为话术家族', () => {
  const focus = selectFocusItem({
    orders: [{
      id: 'mapped',
      name: '新耳机',
      category: '数码家居',
      reason: '限时优惠',
      decisionSignals: ['creator', 'deal'],
      status: 'cooling',
      updatedAt: '2026-09-02T09:00:00Z',
    }],
  });

  assert.equal(focus.category, 'digital');
  assert.deepEqual(focus.structuredTriggers, ['algorithm', 'coupon', 'bundle', 'urgency']);
});

test('没有可归因结构化原因的个人冷静单只使用中性问号外壳', () => {
  let game = startRound(createPeelGame({
    seed: 'neutral-order',
    tutorialCompleted: true,
    orders: [{
      id: 'neutral',
      name: '还没想清楚的东西',
      category: '其他',
      reason: '其他',
      decisionSignals: ['wait', 'research'],
      status: 'cooling',
      updatedAt: '2026-09-02T09:00:00Z',
    }],
  }));
  game = advanceRound(game, 38_000);
  const focusEntity = game.entities.find((entity) => entity.item.orderId === 'neutral');

  assert.ok(focusEntity);
  assert.equal(focusEntity.shells.length, 1);
  assert.equal(focusEntity.shells[0].copy.family, 'reflection');
  assert.match(focusEntity.shells[0].copy.lure, /\?|？/);
});

test('45 秒只结算一次，漏接商品不扣分也不生成排行榜或奖励', () => {
  const started = startRound(createPeelGame({ seed: 'summary', tutorialCompleted: true }));
  const completed = advanceRound(started, 45_000);
  const advancedAgain = advanceRound(completed, 5_000);

  assert.equal(completed.status, PEEL_GAME_STATUS.SUMMARY);
  assert.equal(completed.elapsedMs, 45_000);
  assert.equal(completed.summary.missesArePenalized, false);
  assert.equal(completed.summary.leaderboard, null);
  assert.equal(completed.summary.reward, null);
  assert.deepEqual(advancedAgain, completed);
});
