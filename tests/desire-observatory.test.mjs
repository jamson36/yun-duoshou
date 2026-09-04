import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  MAX_OBSERVATORY_DPR,
  MAX_OBSERVATORY_VISIBLE_PRODUCTS,
  OBSERVATORY_PRODUCTS,
  cameraDeltaForSegment,
  modelForOrder,
  nextObservatoryIndex,
  selectObservatoryProducts,
  signalsForProduct,
  swipeDirectionForDistance,
} from '../desire-observatory.js';

test('观察舱提供六类确定性商品展牌且复用现有商城映射', () => {
  assert.equal(OBSERVATORY_PRODUCTS.length, 6);
  assert.equal(new Set(OBSERVATORY_PRODUCTS.map((product) => product.id)).size, 6);
  assert.equal(new Set(OBSERVATORY_PRODUCTS.map((product) => product.model)).size, 6);
  assert.ok(OBSERVATORY_PRODUCTS.every((product) => product.commerceProductId));
  assert.ok(OBSERVATORY_PRODUCTS.every((product) => product.image?.startsWith('./assets/')));
  assert.ok(OBSERVATORY_PRODUCTS.every((product) => signalsForProduct(product).length === 3));
  assert.equal(MAX_OBSERVATORY_DPR, 1.6);
  assert.equal(MAX_OBSERVATORY_VISIBLE_PRODUCTS, 3);
});

test('最近一笔非演示冷静单优先出现，且不会把观察状态写成另一份订单', () => {
  const products = selectObservatoryProducts({
    seed: 'stable-seed',
    orders: [
      { id: 'demo', name: '演示商品', amount: 9, category: '其他', status: 'cooling', demo: true, updatedAt: '2026-09-04T12:00:00Z' },
      { id: 'old', name: '旧耳机', amount: 399, category: '数码家居', status: 'cooling', updatedAt: '2026-09-02T12:00:00Z' },
      { id: 'latest', name: '我的跑步鞋', amount: 699, category: '服饰美妆', status: 'cooling', updatedAt: '2026-09-03T12:00:00Z' },
      { id: 'saved', name: '已省下的相机', amount: 2000, category: '数码家居', status: 'saved', updatedAt: '2026-09-04T13:00:00Z' },
    ],
  });

  assert.equal(products[0].source, 'order');
  assert.equal(products[0].orderId, 'latest');
  assert.equal(products[0].name, '我的跑步鞋');
  assert.equal(products[0].model, 'sneakers');
  assert.equal(products[0].amount, 699);
});

test('同一输入商品顺序可复现，左右切换会首尾循环', () => {
  const first = selectObservatoryProducts({ seed: 'same' }).map((product) => product.id);
  const second = selectObservatoryProducts({ seed: 'same' }).map((product) => product.id);

  assert.deepEqual(first, second);
  assert.equal(nextObservatoryIndex(0, -1, 6), 5);
  assert.equal(nextObservatoryIndex(5, 1, 6), 0);
  assert.equal(nextObservatoryIndex(2, 1, 0), 0);
});

test('订单模型只依据商品文本选择视觉外形，不推断身份或人格', () => {
  assert.equal(modelForOrder({ name: '桌面机械键盘' }), 'keyboard');
  assert.equal(modelForOrder({ name: '冰奶茶' }), 'milk-tea');
  assert.equal(modelForOrder({ category: '服饰美妆', name: '慢跑鞋' }), 'sneakers');
  assert.equal(modelForOrder({ name: '不认识的东西' }), 'package');
});

test('手势片段只产生有上限的镜头视差，非法输入保持静止', () => {
  assert.deepEqual(cameraDeltaForSegment(null), { x: 0, y: 0 });
  const smoothDelta = cameraDeltaForSegment({ from: { x: 0.4, y: 0.5 }, to: { x: 0.45, y: 0.47 } });
  assert.ok(Math.abs(smoothDelta.x + 0.054) < 1e-9);
  assert.ok(Math.abs(smoothDelta.y - 0.13) < 1e-9);
  assert.deepEqual(
    cameraDeltaForSegment({ from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }),
    { x: 0.18, y: 0.28 },
  );
});

test('只有明确横向滑动才切换橱窗，短拖动只保留镜头视差', () => {
  assert.equal(swipeDirectionForDistance(-180, 1000), 1);
  assert.equal(swipeDirectionForDistance(180, 1000), -1);
  assert.equal(swipeDirectionForDistance(90, 1000), 0);
  assert.equal(swipeDirectionForDistance(300, 0), 0);
});

test('科技橱窗街使用本地 Three.js、固定商品屏、信号塔与镜头轨道', async () => {
  const [controllerSource, sceneSource] = await Promise.all([
    readFile(new URL('../desire-observatory.js', import.meta.url), 'utf8'),
    readFile(new URL('../desire-observatory-scene.js', import.meta.url), 'utf8'),
  ]);

  assert.match(controllerSource, /createObservatoryScene/);
  assert.match(sceneSource, /assets\/vendor\/three\/three\.module\.min\.js/);
  assert.match(sceneSource, /TextureLoader/);
  assert.match(sceneSource, /FogExp2/);
  assert.match(sceneSource, /PointLight/);
  assert.match(sceneSource, /ACESFilmicToneMapping/);
  assert.match(sceneSource, /Raycaster/);
  assert.match(sceneSource, /createSignalTower/);
  assert.match(sceneSource, /pickSignal/);
  assert.match(sceneSource, /cameraOffsetX/);
  assert.match(sceneSource, /coolingPortal/);
  assert.doesNotMatch(sceneSource, /panel\.rotation\.(?:x|y)\s*=.*rotation[XY]/);
  assert.doesNotMatch(sceneSource, /\.glb|\.gltf|https?:\/\/|fetch\(/);
});
