import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPROVED_DOUBLE_SHELLS,
  NEUTRAL_QUESTION_SHELLS,
  PEEL_COPY_VERSION,
  PEEL_COPY_FAMILIES,
  PEEL_COPY_CATALOG,
  selectShellSequence,
} from '../peel-copy-catalog.js';

test('剥壳词库以版本化的 13 类 65 对文案作为唯一事实源', () => {
  assert.equal(PEEL_COPY_VERSION, 'peel-copy-v1');
  assert.equal(PEEL_COPY_FAMILIES.length, 13);
  assert.equal(PEEL_COPY_CATALOG.length, 65);

  const familyCounts = new Map();
  const ids = new Set();
  for (const copy of PEEL_COPY_CATALOG) {
    ids.add(copy.id);
    familyCounts.set(copy.family, (familyCounts.get(copy.family) || 0) + 1);
    assert.ok(copy.lure.length > 0 && copy.lure.length <= 10);
    assert.ok(copy.reveal.length > 0 && copy.reveal.length <= 16);
    assert.equal(copy.version, PEEL_COPY_VERSION);
    assert.equal(copy.isFictionalClaim, true);
  }

  assert.equal(ids.size, 65);
  assert.deepEqual([...familyCounts.values()], Array(13).fill(5));
});

test('词库保持 40/40/20 语气比例且不包含品牌或羞辱诊断词', () => {
  const toneCounts = PEEL_COPY_CATALOG.reduce((counts, copy) => ({
    ...counts,
    [copy.tone]: (counts[copy.tone] || 0) + 1,
  }), {});
  assert.deepEqual(toneCounts, { direct: 26, meme: 26, gentle: 13 });

  const forbidden = /淘宝|京东|拼多多|抖音|小红书|支付宝|微信支付|OpenAI|DeepSeek|败家|智商税|没救|成瘾|病态/u;
  for (const copy of PEEL_COPY_CATALOG) {
    assert.notEqual(copy.lure, copy.reveal);
    assert.doesNotMatch(`${copy.lure}${copy.reveal}`, forbidden);
    if (/\d/u.test(copy.lure)) assert.equal(copy.isFictionalClaim, true);
  }
});

test('同一种子得到相同单层壳，并避开已出现文案与连续两次同家族', () => {
  const first = selectShellSequence({
    seed: 'round-a:0',
    phase: 'single',
    history: [],
    item: { source: 'catalog', category: 'digital' },
  });
  const repeated = selectShellSequence({
    seed: 'round-a:0',
    phase: 'single',
    history: [],
    item: { source: 'catalog', category: 'digital' },
  });
  assert.deepEqual(first, repeated);
  assert.equal(first.length, 1);

  const familyCopies = PEEL_COPY_CATALOG.filter((copy) => copy.family === first[0].family);
  const next = selectShellSequence({
    seed: 'round-a:1',
    phase: 'single',
    history: [familyCopies[0], familyCopies[1]],
    item: { source: 'catalog', category: 'digital' },
  });
  assert.equal(next.length, 1);
  assert.notEqual(next[0].family, first[0].family);
  assert.notEqual(next[0].id, familyCopies[0].id);
  assert.notEqual(next[0].id, familyCopies[1].id);
});

test('双层壳只从人工审核组合中选择', () => {
  const shells = selectShellSequence({
    seed: 'double-shell',
    phase: 'mixed',
    layers: 2,
    history: [],
    item: { source: 'catalog', category: 'fashion' },
  });
  assert.equal(shells.length, 2);
  assert.ok(APPROVED_DOUBLE_SHELLS.some((pair) => (
    pair[0] === shells[0].id && pair[1] === shells[1].id
  )));
});

test('无结构化触发原因的个人订单只能进入中性问号壳', () => {
  const shells = selectShellSequence({
    seed: 'personal-order',
    phase: 'focus',
    layers: 2,
    history: [],
    item: { source: 'order', category: 'digital', structuredTriggers: [] },
  });
  const neutralIds = new Set(NEUTRAL_QUESTION_SHELLS.map((copy) => copy.id));

  assert.equal(shells.length, 1);
  assert.ok(neutralIds.has(shells[0].id));
  assert.equal(shells[0].isFictionalClaim, false);
});
