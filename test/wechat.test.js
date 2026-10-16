const test = require('node:test');
const assert = require('node:assert/strict');
const {
  emptyConfig, publicConfig, validateSendKey, localDateKey, shouldSendDaily,
  buildDailyDigest, sendServerChan, normalizeLeadHours, inQuietHours, nextDailyAt, appendHistory,
} = require('../lib/wechat');

const sendKey = 'SCTabcdefghijklmnop';

test('daily reminder is sent once at or after the local time and retries are spaced out', () => {
  const now = new Date(2026, 9, 2, 9, 1);
  const config = { ...emptyConfig(), enabled: true, sendKey, time: '09:00' };
  assert.equal(shouldSendDaily(config, new Date(2026, 9, 2, 8, 59)), false);
  assert.equal(shouldSendDaily(config, now), true);
  config.remindersPaused = true;
  assert.equal(shouldSendDaily(config, now), false);
  config.remindersPaused = false;
  config.startDate = '2026-10-03';
  assert.equal(shouldSendDaily(config, new Date(2026, 9, 2, 23, 59)), false);
  assert.equal(shouldSendDaily(config, new Date(2026, 9, 3, 9, 1)), true);
  config.startDate = null;
  config.attemptDate = localDateKey(now);
  config.attemptCount = 1;
  config.lastAttemptAt = now.toISOString();
  assert.equal(shouldSendDaily(config, new Date(2026, 9, 2, 9, 29)), false);
  assert.equal(shouldSendDaily(config, new Date(2026, 9, 2, 9, 31)), true);
  config.attemptCount = 3;
  assert.equal(shouldSendDaily(config, new Date(2026, 9, 2, 11)), false);
  config.attemptCount = 1;
  config.lastSentDate = localDateKey(now);
  assert.equal(shouldSendDaily(config, new Date(2026, 9, 2, 11)), false);
  config.lastSentDate = null;
  config.time = 'invalid';
  assert.equal(shouldSendDaily(config, now), false);
});

test('a missed schedule sends the current day on return, without replaying older days', () => {
  const config = { ...emptyConfig(), enabled: true, sendKey, time: '09:00', lastSentDate: '2026-10-02' };
  assert.equal(shouldSendDaily(config, new Date(2026, 9, 3, 8, 30)), false);
  assert.equal(shouldSendDaily(config, new Date(2026, 9, 3, 10, 0)), true);
  assert.equal(shouldSendDaily(config, new Date(2026, 9, 5, 10, 0)), true);
});

test('quiet hours defer the current-day digest and expose the next local schedule', () => {
  const config = { ...emptyConfig(), enabled: true, sendKey, time: '23:00', quietEnabled: true, quietStart: '22:00', quietEnd: '08:00' };
  const late = new Date(2026, 9, 2, 23, 30);
  assert.equal(inQuietHours(config, late), true);
  assert.equal(shouldSendDaily(config, late), false);
  assert.equal(nextDailyAt(config, late).getHours(), 8);
  assert.equal(nextDailyAt(config, late).getDate(), 3);
  assert.equal(shouldSendDaily(config, new Date(2026, 9, 3, 8, 1)), true);
  config.remindersPaused = true;
  assert.equal(nextDailyAt(config, late), null);
  assert.deepEqual(normalizeLeadHours([3, 24, 3, 0, 400]), [24, 3]);
});

test('daily digest contains actionable assignments and does not include private course URLs', () => {
  const now = new Date(2026, 9, 2, 9);
  const state = {
    preferences: { requireManualCompletion: true },
    courses: [{ id: 'c1', name: 'STAT 251', url: 'https://webwork.elearning.ubc.ca/webwork2/course?effectiveUser=private-id',
      lastSyncedAt: new Date(2026, 9, 1, 8).toISOString(), lastSyncError: 'network failed', lastSyncErrorKind: 'network' }],
    tasks: [
      { id: 'a03', courseId: 'c1', name: 'Assignment-03', code: 'A03', score: '0%', sourceStatus: 'open', dueAt: new Date(2026, 9, 8, 23, 59).toISOString() },
      { courseId: 'c1', name: 'Assignment-04', score: '', sourceStatus: 'future', opensAt: new Date(2026, 9, 6).toISOString() },
      { courseId: 'c1', name: 'Assignment-02', score: '', sourceStatus: 'past_due' },
      { courseId: 'c1', name: 'Assignment-01', score: '100%', sourceComplete: true, sourceStatus: 'open' },
      { courseId: 'c1', name: 'Assignment-00', score: '100%', sourceStatus: 'open' },
    ],
    taskPersonal: { a03: { courseId: 'c1', priority: 'high', note: '复习第三章' } },
  };
  const digest = buildDailyDigest(state, now);
  assert.equal(digest.count, 4);
  assert.match(digest.title, /4 项需处理/);
  assert.match(digest.desp, /- WeBWorK\n  - STAT 251\n    - 【100% 待确认】Assignment-00/);
  assert.match(digest.desp, /    - A03 Assignment-03：截止/);
  assert.match(digest.desp, /    - Assignment-02：网页标记已截止/);
  assert.match(digest.desp, /数据状态.*STAT 251.*本次同步失败（网络连接失败）/s);
  assert.match(digest.desp, /【100% 待确认】Assignment-01/);
  assert.doesNotMatch(digest.desp, /Assignment-04|private-id|effectiveUser/);
  assert.doesNotMatch(digest.desp, /复习第三章/);
  const withNotes = buildDailyDigest(state, now, { includeNotes: true });
  assert.match(withNotes.desp, /备注：复习第三章/);
  const filtered = buildDailyDigest(state, now, { disabledCourseIds: ['c1'] });
  assert.equal(filtered.count, 0);
  assert.doesNotMatch(filtered.desp, /Assignment-03/);
  state.courses[0].archived = true;
  assert.equal(buildDailyDigest(state, now).count, 0);
});

test('daily digest groups assignments and nearby exams, then summarizes sync with exceptions', () => {
  const now = new Date(2026, 9, 16, 9, 40);
  const recent = new Date(2026, 9, 16, 9, 26).toISOString();
  const testSync = new Date(2026, 9, 16, 9, 39).toISOString();
  const state = {
    preferences: { language: 'zh-CN' },
    courses: [
      { id: 'pl', name: 'CPSC 317, 2026W1', lastSyncedAt: recent },
      { id: 'ww', name: 'STAT_V 251 101 2026W1', platform: 'webwork', lastSyncedAt: new Date(2026, 9, 16, 9, 26, 30).toISOString() },
      { id: 'gs', name: 'CPSC_V 421 101 2026W1', platform: 'gradescope', lastSyncedAt: recent,
        lastSyncError: 'network failed', lastSyncErrorKind: 'network' },
    ],
    tasks: [
      { courseId: 'pl', code: 'PA3', name: 'A POP3 Server', sourceComplete: false, dueAt: new Date(2026, 9, 25, 23, 59).toISOString() },
      { courseId: 'ww', name: 'Assignment-05', sourceComplete: false, dueAt: new Date(2026, 9, 22, 23, 59).toISOString() },
    ],
    exams: [
      { source: 'prairietest', title: 'CPSC 317 (2026W1): Quiz 2', courseName: 'CPSC 317', status: 'reserved',
        startsAt: new Date(2026, 9, 17, 14).toISOString(), location: 'ORCA ICCS 014', lastSyncedAt: testSync },
      { source: 'manual', title: 'CPSC 421 Midterm', courseName: 'CPSC 421', status: 'reserved',
        startsAt: new Date(2026, 9, 19, 12).toISOString(), location: 'SHRM B1009' },
      { source: 'manual', title: 'CPSC 310 Midterm', courseName: 'CPSC 310', status: 'reserved',
        startsAt: new Date(2026, 9, 29, 20).toISOString() },
      { source: 'manual', title: 'Exam without a date', courseName: 'CPSC 310', status: 'unreserved', startsAt: null },
    ],
    prairieTest: { lastSyncedAt: testSync, lastError: null },
  };
  const digest = buildDailyDigest(state, now);
  assert.equal(digest.count, 4);
  assert.equal(digest.title, 'UBC作业管理工具：2 场考试、2 项作业需关注');
  assert.match(digest.desp, /考试提醒（未来 7 天）\n- PrairieTest\n  - CPSC 317 · 2026W1\n    - Quiz 2：明天 14:00 · 已预约\n      - 地点：ORCA ICCS 014/);
  assert.match(digest.desp, /- 手动添加\n  - CPSC 421\n    - Midterm：10\/19 12:00 · 已预约/);
  assert.match(digest.desp, /作业提醒\n- PrairieLearn\n  - CPSC 317 · 2026W1\n    - PA3 A POP3 Server/);
  assert.match(digest.desp, /- WeBWorK\n  - STAT 251 · 2026W1\n    - Assignment-05/);
  assert.doesNotMatch(digest.desp, /CPSC 310 Midterm|Exam without a date/);
  assert.match(digest.desp, /数据状态：2 门作业课程于今天 09:26 同步；CPSC 421 · 2026W1：本次同步失败（网络连接失败），保留原有数据；PrairieTest 于今天 09:39 同步；CPSC 421 Midterm 为手动添加。/);
  assert.ok(digest.desp.indexOf('数据状态：') > digest.desp.indexOf('Assignment-05'));
  state.preferences.language = 'en-US';
  const english = buildDailyDigest(state, now);
  assert.match(english.title, /2 exams, 2 assignments to handle/);
  assert.match(english.desp, /Exams \(next 7 days\).*Assignments.*Data status:/s);
  assert.doesNotMatch(english.desp, /考试提醒|作业提醒|数据状态/);
});

test('ignored category is removed only from its course digest', () => {
  const now = new Date(2026, 9, 2, 9);
  const dueAt = new Date(2026, 9, 8, 23, 59).toISOString();
  const state = {
    preferences: {},
    courses: [
      { id: 'c317', name: 'CPSC 317', ignoredSections: ['In Class Assignment'] },
      { id: 'c310', name: 'CPSC 310', ignoredSections: [] },
    ],
    tasks: [
      { courseId: 'c317', section: 'In Class Assignment', name: 'ICA 03', sourceComplete: false, dueAt },
      { courseId: 'c310', section: 'In Class Assignment', name: 'Practice 03', sourceComplete: false, dueAt },
    ],
  };
  const digest = buildDailyDigest(state, now);
  assert.equal(digest.count, 1);
  assert.doesNotMatch(digest.desp, /ICA 03/);
  assert.match(digest.desp, /Practice 03/);
});

test('the public reminder state does not expose SendKey', () => {
  assert.equal(validateSendKey(` ${sendKey} `), sendKey);
  assert.throws(() => validateSendKey('bad-key'));
  const publicState = publicConfig({ ...emptyConfig(), sendKey });
  assert.equal(publicState.hasKey, true);
  assert.equal(JSON.stringify(publicState).includes(sendKey), false);
  const config = { ...emptyConfig(), sendKey };
  appendHistory(config, { type: 'test', result: 'failed', detail: `request ${sendKey} failed` });
  config.history[0].sendKey = sendKey;
  assert.equal(JSON.stringify(publicConfig(config)).includes(sendKey), false);
  assert.match(publicConfig(config).history[0].detail, /密钥已隐藏/);
});

test('Server酱 request uses form fields and requires code zero', async () => {
  let requestUrl;
  let requestOptions;
  const fakeFetch = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return { ok: true, json: async () => ({ code: 0 }) };
  };
  assert.equal(await sendServerChan(sendKey, '测试', '作业列表', fakeFetch), true);
  assert.equal(requestUrl, `https://sctapi.ftqq.com/${sendKey}.send`);
  assert.equal(requestOptions.method, 'POST');
  assert.equal(requestOptions.redirect, 'error');
  assert.equal(requestOptions.body.get('title'), '测试');
  assert.equal(requestOptions.body.get('desp'), '作业列表');
  await assert.rejects(sendServerChan(sendKey, '测试', '内容', async () => ({ ok: true, json: async () => ({ code: 1024 }) })), /未接受消息/);
  await assert.rejects(sendServerChan(sendKey, '测试', '内容', async () => {
    throw Object.assign(new Error('fetch failed'), { cause: { code: 'EACCES' } });
  }), /网络访问被系统或运行环境拒绝/);
});
