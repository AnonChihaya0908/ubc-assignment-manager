const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Duplex } = require('node:stream');
const { emptyConfig, shouldSend, buildDigest, safeLink, sendSmtp, mimeMessage } = require('../lib/email');
const { saveSecret, readSecret, deleteSecret } = require('../lib/email-secret');

test('daily email respects local schedule, pause, same-day deduplication and retry spacing', () => {
  const config = { ...emptyConfig(), enabled: true, time: '09:00' };
  const day = new Date(2026, 9, 6, 9, 5);
  const options = { connected: true };
  assert.equal(shouldSend(config, new Date(2026, 9, 6, 8, 59), options), false);
  assert.equal(shouldSend(config, day, options), true);
  assert.equal(shouldSend(config, day, { connected: true, paused: true }), false);
  config.attemptDate = '2026-10-06'; config.attemptCount = 1; config.lastAttemptAt = day.toISOString();
  assert.equal(shouldSend(config, new Date(2026, 9, 6, 9, 34), options), false);
  assert.equal(shouldSend(config, new Date(2026, 9, 6, 9, 36), options), true);
  config.lastSentDate = '2026-10-06';
  assert.equal(shouldSend(config, new Date(2026, 9, 6, 11), options), false);
  assert.equal(shouldSend(config, new Date(2026, 9, 7, 9), options), true);
});

test('email digest includes authorized unfinished assignments, due dates and sanitized links in both languages', () => {
  const now = new Date(2026, 9, 6, 9);
  const dueAt = new Date(2026, 9, 7, 23, 59).toISOString();
  const state = { preferences: { language: 'en-US' }, courses: [
    { id: 'c1', name: 'CPSC 310', accessConfirmedAt: now.toISOString(), ignoredSections: [] },
    { id: 'c2', name: 'Unconfirmed', ignoredSections: [] },
  ], tasks: [
    { id: 't1', courseId: 'c1', name: 'Project', code: 'PA1', dueAt, score: '25%', url: 'https://us.prairielearn.com/pl/course_instance/1/assessment/2?effectiveUser=private' },
    { id: 't2', courseId: 'c1', name: 'Done', code: 'PA2', dueAt, score: '100%' },
    { id: 't3', courseId: 'c2', name: 'Other', code: 'PA3', dueAt, score: '0%' },
  ] };
  const digest = buildDigest(state, { scope: 'week' }, now);
  assert.equal(digest.count, 1);
  assert.match(digest.text, /CPSC 310 · PA1 Project/);
  assert.match(digest.text, /Due:/);
  assert.match(digest.text, /https:\/\/us\.prairielearn\.com\/pl\/course_instance\/1\/assessment\/2/);
  assert.doesNotMatch(digest.text, /effectiveUser|Unconfirmed|Done/);
  state.preferences.language = 'zh-CN';
  assert.match(buildDigest(state, { scope: 'week' }, now).subject, /作业/);
  assert.equal(buildDigest(state, { scope: 'today' }, now).count, 0);
  assert.equal(safeLink('https://user:secret@us.prairielearn.com/pl/assessment/2?token=private'),
    'https://us.prairielearn.com/pl/assessment/2');
});

test('SMTP sends a UTF-8 plain-text message over authenticated TLS without accepting malformed addresses', async () => {
  const commands = [];
  class MockSocket extends Duplex {
    constructor() {
      super();
      setImmediate(() => { this.emit('secureConnect'); this.push('220 fixture ready\r\n'); });
    }
    _read() {}
    _write(chunk, _encoding, done) {
      const value = chunk.toString();
      commands.push(value);
      const reply = value.startsWith('EHLO ') ? '250-fixture\r\n250 AUTH PLAIN\r\n' :
        value.startsWith('AUTH PLAIN ') ? '235 authorized\r\n' :
          value.startsWith('DATA\r\n') ? '354 start mail\r\n' :
            value.startsWith('QUIT\r\n') ? '221 bye\r\n' : '250 ok\r\n';
      setImmediate(() => this.push(reply));
      done();
    }
    setTimeout() {}
  }
  assert.equal(await sendSmtp({ from: 'student@gmail.com', to: 'me@example.com', password: 'fixture-app-password',
    subject: '作业提醒', text: 'CPSC 310 · PA1\n截止时间' }, () => new MockSocket()), true);
  assert.ok(commands.some(value => value.startsWith('AUTH PLAIN ')));
  assert.ok(commands.some(value => value.includes('Content-Transfer-Encoding: base64')));
  assert.ok(commands.some(value => value.includes('QUIT')));
  assert.doesNotMatch(mimeMessage({ from: 'student@gmail.com', to: 'me@example.com', subject: '作业提醒', text: '截止' }), /\r\n截止/);
  await assert.rejects(() => sendSmtp({ from: 'other@example.com', to: 'me@example.com', password: 'x', subject: 'Test', text: '' }), /Gmail/);
});

test('Windows email secret is DPAPI encrypted, isolated from plain configuration and removed on disconnect', { skip: process.platform !== 'win32' }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-email-secret-test-'));
  const previous = process.env.PRAIRIELEARN_DATA_DIR;
  process.env.PRAIRIELEARN_DATA_DIR = temporary;
  try {
    saveSecret('fixture-app-password');
    assert.equal(readSecret(), 'fixture-app-password');
    const encrypted = fs.readFileSync(path.join(temporary, 'email-secret.dpapi'), 'utf8');
    assert.doesNotMatch(encrypted, /fixture-app-password/);
    deleteSecret();
    assert.equal(readSecret(), '');
  } finally {
    if (previous === undefined) delete process.env.PRAIRIELEARN_DATA_DIR;
    else process.env.PRAIRIELEARN_DATA_DIR = previous;
    if (path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('ubc-email-secret-test-')) {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
});
