import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCalendarDays, formatDateLabel, isDateOnOrAfter, normalizeDateValue } from '../goal-date-picker.js';

const pickerSource = await readFile(new URL('../goal-date-picker.js', import.meta.url), 'utf8');

test('日期值只接受真实存在的 ISO 日期', () => {
  assert.equal(normalizeDateValue('2028-02-29'), '2028-02-29');
  assert.equal(normalizeDateValue('2027-02-29'), '');
  assert.equal(normalizeDateValue('2027-13-01'), '');
  assert.equal(normalizeDateValue('2027/06/01'), '');
});

test('日期展示为适合直接阅读的中文格式', () => {
  assert.equal(formatDateLabel('2027-06-01'), '2027年6月1日');
  assert.equal(formatDateLabel(''), '选择目标日期');
});

test('日历固定生成六周并以周一开始', () => {
  const days = buildCalendarDays(2026, 7, new Date(2026, 7, 26));
  assert.equal(days.length, 42);
  assert.equal(days[0].value, '2026-07-27');
  assert.equal(days.at(-1).value, '2026-09-06');
  assert.equal(days.find((day) => day.isToday)?.value, '2026-08-26');
  assert.equal(days.find((day) => day.value === '2026-08-25')?.isPast, true);
  assert.equal(days.find((day) => day.value === '2026-08-26')?.isPast, false);
  assert.equal(days.filter((day) => day.inMonth).length, 31);
});

test('目标日期不得早于设备当天', () => {
  const today = new Date(2026, 7, 30, 18, 30);
  assert.equal(isDateOnOrAfter('2026-08-29', today), false);
  assert.equal(isDateOnOrAfter('2026-08-30', today), true);
  assert.equal(isDateOnOrAfter('2026-08-31', today), true);
  assert.equal(isDateOnOrAfter('', today), false);
});

test('日期弹层的 Escape 只关闭弹层，不继续关闭后方功能面板', () => {
  assert.match(pickerSource, /event\.stopImmediatePropagation\(\);\s*this\.close\(\);/);
});
