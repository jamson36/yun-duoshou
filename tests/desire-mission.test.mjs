import assert from 'node:assert/strict';
import test from 'node:test';
import { createMissionState, transitionMission, shellDragCompleted, pointInside,
  validateMissionDraft, matchingMissionOrder, createMissionGestureMapper,
  missionMovementInput, stepMissionMovement, reachableMissionNode, TRACK_NODES, MISSION_WALK_BOUNDS } from '../desire-mission.js';

test('WASD 和方向键控制实际方向，反向按键抵消，同方向别名不加速', () => {
  for (const [keys, expected] of [
    [['KeyW'], { x: 0, z: -0.24 }], [['KeyS'], { x: 0, z: 0.24 }],
    [['KeyA'], { x: -0.24, z: 0 }], [['KeyD'], { x: 0.24, z: 0 }],
    [['KeyW', 'ArrowUp'], { x: 0, z: -0.24 }],
    [['KeyW', 'KeyS', 'ArrowLeft', 'KeyD'], { x: 0, z: 0 }],
  ]) {
    assert.deepEqual(stepMissionMovement({ x: 0, z: 0 }, missionMovementInput(keys), 0, 0.05), expected);
  }
  assert.deepEqual(missionMovementInput(['ArrowUp', 'ArrowLeft']), { strafe: -1, forward: 1 });
  assert.deepEqual(missionMovementInput([]), { strafe: 0, forward: 0 });
});

test('斜走不超速，转动相机后 W 沿新的朝向前进', () => {
  const origin = { x: 0, z: 0 };
  const diagonal = stepMissionMovement(origin, { forward: 1, strafe: 1 }, 0, 0.05);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 0.24) < 1e-10);
  assert.ok(diagonal.x > 0 && diagonal.z < 0);
  const turned = stepMissionMovement(origin, { forward: 1 }, Math.PI / 2, 0.05);
  assert.ok(Math.abs(turned.x + 0.24) < 1e-10);
  assert.ok(Math.abs(turned.z) < 1e-10);
  assert.deepEqual(origin, { x: 0, z: 0 });
});

test('松键立即停下，后台长帧不会瞬移，街道和信号门边界不能穿过', () => {
  const position = { x: 1, z: 3 };
  assert.deepEqual(stepMissionMovement(position, missionMovementInput([]), 0.7, 0.05), position);
  assert.deepEqual(stepMissionMovement(position, { forward: 1 }, 0, 0), position);
  const longFrame = stepMissionMovement(position, { forward: 1 }, 0, 10);
  assert.ok(Math.abs(longFrame.z - (3 - 0.288)) < 1e-10);
  let corner = { x: 0, z: 0 };
  for (let i = 0; i < 200; i++) corner = stepMissionMovement(corner, { forward: -1, strafe: 1 }, 0, 0.06);
  assert.deepEqual(corner, { x: MISSION_WALK_BOUNDS.maxX, z: MISSION_WALK_BOUNDS.maxZ });
  for (let i = 0; i < 200; i++) corner = stepMissionMovement(corner, { forward: 1, strafe: -1 }, 0, 0.06);
  assert.deepEqual(corner, { x: MISSION_WALK_BOUNDS.minX, z: -10.8 });
  assert.deepEqual(stepMissionMovement({ x: 0, z: -11.2 }, { forward: 1 }, 0, 0.06), { x: 0, z: -11.2 });
});

test('手动行走按距离依次触发路标，不能隔空或乱序完成任务', () => {
  let state = createMissionState();
  const initialProduct = structuredClone(state.product);
  assert.equal(reachableMissionNode(state, TRACK_NODES[0]), null);
  assert.equal(transitionMission(state, { type: 'approach', position: TRACK_NODES[3] }), state);
  assert.equal(transitionMission(state, { type: 'approach', position: { x: NaN, z: 2 } }), state);
  for (let node = 1; node <= 3; node++) {
    const far = { ...TRACK_NODES[node], z: TRACK_NODES[node].z + 1.4 };
    assert.equal(transitionMission(state, { type: 'approach', position: far }), state);
    state = transitionMission(state, { type: 'approach', position: { ...far, z: far.z - 0.1 } });
    assert.equal(state.node, node); assert.equal(state.destination, null);
  }
  assert.equal(state.phase, 'peel'); assert.deepEqual(state.product, initialProduct);
  assert.equal(state.savedOrderId, null);
  assert.equal(transitionMission(state, { type: 'approach', position: TRACK_NODES[3] }), state);
});

test('手动接管取消自动路标导航，旧到达事件失效，还能重新点击自动前往', () => {
  const auto = transitionMission(createMissionState(), { type: 'walk' });
  assert.equal(transitionMission(auto, { type: 'approach', position: TRACK_NODES[1] }), auto);
  const manual = transitionMission(auto, { type: 'steer' });
  assert.equal(manual.destination, null); assert.equal(manual.node, 0);
  assert.equal(transitionMission(manual, { type: 'arrive', node: 1 }), manual);
  const resumed = transitionMission(manual, { type: 'walk' });
  assert.equal(transitionMission(resumed, { type: 'arrive', node: 1 }).node, 1);
});

function throughPeel() {
  let state = createMissionState();
  for (let node = 1; node <= 3; node++) {
    state = transitionMission(state, { type: 'walk' });
    state = transitionMission(state, { type: 'arrive', node });
  }
  for (const id of ['urgency', 'social']) state = transitionMission(state, { type: 'remove-shell', id });
  return state;
}

test('任务必须沿节点抵达；乱序、重复和过期抵达事件不跳关', () => {
  const initial = createMissionState();
  assert.equal(transitionMission(initial, { type: 'arrive', node: 3 }), initial);
  assert.equal(transitionMission(initial, { type: 'push' }), initial);
  const walking = transitionMission(initial, { type: 'walk' });
  assert.equal(walking.destination, 1);
  assert.equal(transitionMission(walking, { type: 'walk' }), walking);
  assert.equal(transitionMission(walking, { type: 'arrive', node: 2 }), walking);
  const arrived = transitionMission(walking, { type: 'arrive', node: 1 });
  assert.equal(arrived.node, 1);
  assert.equal(arrived.destination, null);
  assert.equal(transitionMission(arrived, { type: 'arrive', node: 1 }), arrived);
  assert.equal(initial.node, 0);
});

test('摘下两个不同外壳才到试用，外壳操作不改变商品事实', () => {
  let state = { ...createMissionState(), phase: 'peel' };
  const product = structuredClone(state.product);
  state = transitionMission(state, { type: 'remove-shell', id: 'urgency' });
  assert.equal(state.phase, 'peel');
  assert.equal(transitionMission(state, { type: 'remove-shell', id: 'urgency' }), state);
  assert.equal(transitionMission(state, { type: 'remove-shell', id: 'unknown' }), state);
  state = transitionMission(state, { type: 'remove-shell', id: 'social' });
  assert.equal(state.phase, 'trial');
  assert.deepEqual(state.product, product);
});

test('短拖、取消、坏坐标不会摘壳，拖到区域外不能算放入', () => {
  assert.equal(shellDragCompleted({ dx: 20, dy: 5 }), false);
  assert.equal(shellDragCompleted({ dx: 150, dy: 1, cancelled: true }), false);
  assert.equal(shellDragCompleted({ dx: NaN, dy: 200 }), false);
  assert.equal(shellDragCompleted({ dx: -120, dy: 15 }), true);
  const rect = { left: 100, right: 160, top: 50, bottom: 110 };
  assert.equal(pointInside({ x: 130, y: 85 }, rect), true);
  assert.equal(pointInside({ x: 170, y: 85 }, rect), false);
  assert.equal(pointInside({ x: NaN, y: 80 }, rect), false);
});

test('试用必须落在合法装置，跨装置答案保留且可修正', () => {
  let state = throughPeel();
  assert.equal(transitionMission(state, { type: 'finish-trial' }), state);
  assert.equal(transitionMission(state, { type: 'place', target: 'have' }), state);
  state = transitionMission(state, { type: 'place', target: 'day-5' });
  state = transitionMission(state, { type: 'trial', id: 'alternatives' });
  state = transitionMission(state, { type: 'place', target: 'have' });
  state = transitionMission(state, { type: 'trial', id: 'week' });
  state = transitionMission(state, { type: 'place', target: 'unsure' });
  assert.deepEqual(state.answers, { week: 'unsure', alternatives: 'have' });
  assert.equal(transitionMission(state, { type: 'finish-trial' }).phase, 'deliver');
});

test('传送只到确认页，只有 cooling 订单事实能点亮已保存场景', () => {
  let state = transitionMission(throughPeel(), { type: 'place', target: 'day-2' });
  state = transitionMission(state, { type: 'finish-trial' });
  state = transitionMission(state, { type: 'push' });
  assert.equal(state.phase, 'review');
  assert.equal(state.savedOrderId, null);
  assert.equal(transitionMission(state, { type: 'saved', order: { id: 'x', status: 'purchased' } }), state);
  const done = transitionMission(state, { type: 'saved', order: { id: 'a', status: 'cooling', name: '我的耳机', amount: 799 }, persisted: false });
  assert.equal(done.phase, 'done');
  assert.equal(done.product.amount, 799);
  assert.equal(done.persisted, false);
  assert.equal(transitionMission(done, { type: 'push' }), done);
});

test('重新打开只从真实冷静订单派生，演示、已购和无关记录不会伪装任务结果', () => {
  const orders = [
    { id: 'a', name: '我的耳机', amount: 399, status: 'cooling', updatedAt: '2026-09-01' },
    { id: 'b', name: '别的耳机', amount: 699, status: 'purchased', updatedAt: '2026-09-03' },
    { id: 'c', name: '演示耳机', amount: 999, status: 'cooling', demo: true, updatedAt: '2026-09-04' },
    { id: 'd', name: '奶茶', amount: 20, status: 'cooling', updatedAt: '2026-09-05' },
  ];
  const before = structuredClone(orders);
  const state = createMissionState({ orders });
  assert.equal(state.phase, 'done'); assert.equal(state.savedOrderId, 'a'); assert.equal(state.product.amount, 399);
  assert.deepEqual(orders, before);
  const replay = transitionMission(state, { type: 'replay' });
  assert.equal(replay.phase, 'track'); assert.equal(replay.savedOrderId, 'a');
  assert.equal(createMissionState({ orders: orders.slice(1) }).phase, 'track');
  assert.equal(createMissionState({ orders, persisted: false }).persisted, false);
});

test('金额严格校验，两位小数，不能空白、零、负数或科学计数', () => {
  assert.deepEqual(validateMissionDraft({ name: ' 耳机 ', amount: '1299.50' }), { name: '耳机', amount: 1299.5 });
  for (const amount of ['', '0', '-2', '0.001', 'NaN', 'Infinity', '1e3', '100000000']) {
    assert.ok(validateMissionDraft({ name: '耳机', amount }).error, amount);
  }
  assert.ok(validateMissionDraft({ name: ' ', amount: 12 }).error);
});

test('幂等匹配只复用同名称同金额的个人冷静单', () => {
  const orders = [
    { id: 'demo', name: '耳机', amount: 12, status: 'cooling', demo: true },
    { id: 'saved', name: '耳机', amount: 12, status: 'saved' },
    { id: 'a', name: '耳机', amount: 12, status: 'cooling' },
  ];
  assert.equal(matchingMissionOrder(orders, { name: '耳机', amount: 12 }).id, 'a');
  assert.equal(matchingMissionOrder(orders, { name: '耳机', amount: 15 }), null);
});

test('手势捏合有迟滞，只有抓取/移动/释放，丢手取消且不生成保存命令', () => {
  const mapper = createMissionGestureMapper();
  const frame = (gap) => ({ score: 0.9, landmarks: Array.from({ length: 21 }, (_, index) => ({ x: index === 4 ? 0.5 + gap : 0.5, y: 0.5 })) });
  assert.equal(mapper.update(frame(0.12), 0).type, 'move');
  assert.equal(mapper.update(frame(0.03), 100).type, 'grab');
  assert.equal(mapper.update(frame(0.07), 150).type, 'move');
  assert.equal(mapper.update(frame(0.12), 200).type, 'release');
  mapper.update(frame(0.03), 250);
  assert.equal(mapper.update(null, 950).type, 'lost');
  assert.equal(mapper.update(frame(0.12), 1000).type, 'move');
  mapper.reset(); assert.equal(mapper.update(null, 3000), null);
});
