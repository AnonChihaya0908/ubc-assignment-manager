const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { defaultPreferences, emptyState, loadState, saveState } = require('../lib/store');
const { localeFor, translateFor } = require('../public/i18n');
const { pendingReminderEvents } = require('../lib/reminders');
const { buildDailyDigest } = require('../lib/wechat');

test('system language, explicit choice, and saved preference resolve consistently', () => {
  assert.equal(defaultPreferences().language, 'auto');
  assert.equal(localeFor('auto', 'en-CA'), 'en-US');
  assert.equal(localeFor('auto', 'zh-Hans-CN'), 'zh-CN');
  assert.equal(localeFor('zh-CN', 'en-CA'), 'zh-CN');
  assert.equal(localeFor('en-US', 'zh-CN'), 'en-US');
  assert.equal(translateFor('立即同步', 'en-US'), 'Sync now');
  assert.equal(translateFor('立即同步', 'zh-CN'), '立即同步');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-language-test-'));
  const file = path.join(temporary, 'data.json');
  try {
    const state = emptyState();
    state.preferences.language = 'en-US';
    saveState(state, file);
    assert.equal(loadState(file).preferences.language, 'en-US');
    state.preferences.language = 'zh-CN';
    saveState(state, file);
    assert.equal(loadState(file).preferences.language, 'zh-CN');
    state.preferences.language = 'invalid';
    saveState(state, file);
    assert.equal(loadState(file).preferences.language, 'auto');
  } finally {
    if (path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('ubc-language-test-')) {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
});

test('reminder content follows language without changing due instants or raw assignment names', () => {
  const dueAt = '2026-10-08T22:00:00.000Z';
  const now = new Date('2026-10-08T21:00:00.000Z');
  const state = {
    preferences: { language: 'en-US' }, notified: {},
    courses: [{ id: 'c1', name: 'STAT 251', accessConfirmedAt: '2026-10-01T00:00:00.000Z', ignoredSections: [] }],
    tasks: [{ id: 't1', courseId: 'c1', name: '复习作业 03', code: 'A03', dueAt, sourceStatus: 'open', score: '50%' }],
    taskPersonal: {},
  };
  const config = { leadHours: [3], disabledCourseIds: [] };
  const english = pendingReminderEvents(state, config, now);
  assert.equal(english.length, 1);
  assert.match(english[0].title, /复习作业 03 · due within 3 hours/);
  assert.doesNotMatch(english[0].message, /[\u3400-\u9fff]/);
  assert.match(buildDailyDigest(state, now, config).title, /UBC Assignment Manager/);
  state.preferences.language = 'zh-CN';
  const chinese = pendingReminderEvents(state, config, now);
  assert.equal(chinese[0].key, english[0].key);
  assert.match(chinese[0].title, /小时内截止/);
  assert.match(buildDailyDigest(state, now, config).title, /UBC作业管理工具/);
  assert.equal(state.tasks[0].dueAt, dueAt);
});
