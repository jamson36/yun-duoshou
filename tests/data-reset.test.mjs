import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const markup = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function functionSource(name, nextName) {
  const start = appSource.indexOf(`function ${name}(`);
  const end = appSource.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0, `missing function ${name}`);
  assert.ok(end > start, `missing function boundary ${nextName}`);
  return appSource.slice(start, end).trim();
}

function createStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    values,
    removeItem(key) {
      values.delete(key);
    },
  };
}

test('帮助弹窗提供独立的全量重置二次确认，而不是直接清空', () => {
  assert.match(markup, /id="resetAllDataButton"[^>]*>\s*重置全部数据/);
  assert.match(markup, /id="resetDataDialog"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(markup, /id="resetDataCancelButton"[^>]*>\s*先保留/);
  assert.match(markup, /id="resetDataConfirmButton"[^>]*>\s*确认重置/);
  assert.match(markup, /订单、目标、消费报告历史和数据发送同意/);
});

test('重置只删除本产品键，并同时清理业务、报告、同意与一次性会话状态', () => {
  const source = functionSource('clearPersistedExperienceData', 'openResetDataDialog');
  assert.doesNotMatch(source, /\.clear\s*\(/);
  const clearPersistedExperienceData = new Function(
    'STORAGE_KEY',
    'LEGACY_STORAGE_KEYS',
    'AI_REVOCATION_STORAGE_KEY',
    'AI_DIAGNOSIS_STORAGE_KEY',
    'TEST_HISTORY_STORAGE_KEY',
    'SESSION_AI_REVOCATION_KEY',
    'SESSION_AI_CONSENT_KEY',
    'SESSION_AI_DIAGNOSIS_INVALIDATED_KEY',
    'RETURN_TO_ROOM_ON_LOAD_KEY',
    'AI_REVOCATION_COOKIE',
    `return (${source});`,
  )(
    'business',
    ['legacy'],
    'revoked-local',
    'diagnosis',
    'history',
    'revoked-session',
    'consent-session',
    'invalidated-session',
    'return-session',
    'spree_ai_revoked',
  );
  const local = createStorage({
    business: '1',
    legacy: '1',
    'revoked-local': '1',
    diagnosis: '1',
    history: '1',
    unrelated: 'keep',
  });
  const session = createStorage({
    'revoked-session': '1',
    'consent-session': '1',
    'invalidated-session': '1',
    'return-session': '1',
    unrelated: 'keep',
  });
  const cookieWrites = [];
  const cookieDocument = {
    set cookie(value) {
      cookieWrites.push(value);
    },
  };

  const result = clearPersistedExperienceData({ local, session, cookieDocument });

  assert.equal(result.success, true);
  assert.deepEqual([...local.values], [['unrelated', 'keep']]);
  assert.deepEqual([...session.values], [['unrelated', 'keep']]);
  assert.match(cookieWrites.at(-1), /^spree_ai_revoked=; Max-Age=0;/);
});

test('存储删除失败时保留确认页，不伪装成已经重置', () => {
  const source = functionSource('clearPersistedExperienceData', 'openResetDataDialog');
  const clearPersistedExperienceData = new Function(
    'STORAGE_KEY',
    'LEGACY_STORAGE_KEYS',
    'AI_REVOCATION_STORAGE_KEY',
    'AI_DIAGNOSIS_STORAGE_KEY',
    'TEST_HISTORY_STORAGE_KEY',
    'SESSION_AI_REVOCATION_KEY',
    'SESSION_AI_CONSENT_KEY',
    'SESSION_AI_DIAGNOSIS_INVALIDATED_KEY',
    'RETURN_TO_ROOM_ON_LOAD_KEY',
    'AI_REVOCATION_COOKIE',
    `return (${source});`,
  )(
    'business',
    [],
    'revoked-local',
    'diagnosis',
    'history',
    'revoked-session',
    'consent-session',
    'invalidated-session',
    'return-session',
    'spree_ai_revoked',
  );
  const local = {
    removeItem() {
      throw new Error('blocked');
    },
  };

  const result = clearPersistedExperienceData({
    local,
    session: createStorage(),
    cookieDocument: { set cookie(_value) {} },
  });

  assert.equal(result.success, false);
  assert.ok(result.failures.includes('local'));
});
