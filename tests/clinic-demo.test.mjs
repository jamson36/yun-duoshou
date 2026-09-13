import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { scorePersonality } from '../personality-scoring.js';
import { resolvePersonaPresentation } from '../persona-presentations.js';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = source.indexOf('function createClinicDemoOrders(');
const end = source.indexOf('function startClinicDemo(', start);
const context = {};
vm.runInNewContext(`${source.slice(start, end)}; this.generate = createClinicDemoOrders;`, context);
test('每轮演示更换消费数据并从样本计算不同人格', () => {
  const now = new Date('2026-09-13T12:00:00Z');
  const names = new Set();
  const totals = new Set();
  for (let round = 1; round <= 3; round += 1) {
    const orders = context.generate(round, now);
    assert(orders.every((order) => order.demo && new Date(order.createdAt) < now));
    const result = scorePersonality({ orders, period: 7, now });
    assert.equal(result.source, 'demo');
    assert(result.eligible);
    names.add(resolvePersonaPresentation(result).card.id);
    totals.add(result.totals.purchased);
  }
  assert.equal(names.size, 3);
  assert.equal(totals.size, 3);
});
