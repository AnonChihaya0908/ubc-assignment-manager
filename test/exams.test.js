const test = require('node:test');
const assert = require('node:assert/strict');
const { emptyState } = require('../lib/store');
const { validateExam, mergePrairieTestExams, examCategory, examReminderEvents, activeExams } = require('../lib/exams');
const { parsePrairieTestPage } = require('../lib/prairietest');
const { emptyConfig } = require('../lib/wechat');
const { createBackup, validateBackup } = require('../lib/backup');
const { buildDailyDigest } = require('../lib/wechat');
const { buildDigest } = require('../lib/email');

const home = 'https://us.prairietest.com/pt/';
const snapshot = rows => ({ pageUrl: home, hasExamSections: true, noExams: false, rows });

test('PrairieTest reserved and available exams remain separate and unreserved has no invented start time', () => {
  const rows = parsePrairieTestPage(snapshot([
    { name: 'Midterm 1', url: `${home}exams/123`, examId: '123', section: 'Exams available for reservation',
      text: 'CPSC 421 Midterm 1 Make a reservation · Reserve now', times: [] },
    { name: 'Final', url: `${home}exams/456`, examId: '456', section: 'Current and future exam reservations',
      text: 'CPSC 421 Final Your reservation duration 120 minutes',
      times: [{ label: 'Exam starts', datetime: '2026-12-10T10:00:00-08:00' }] },
  ]));
  assert.equal(rows[0].status, 'unreserved');
  assert.equal(rows[0].startsAt, null);
  assert.equal(rows[1].status, 'reserved');
  assert.equal(rows[1].startsAt, '2026-12-10T18:00:00.000Z');
  assert.equal(rows[1].durationMinutes, 120);
  const state = emptyState();
  mergePrairieTestExams(state, rows, new Date('2026-10-15T12:00:00Z'));
  mergePrairieTestExams(state, [{ ...rows[0], status: 'reserved', startsAt: '2026-11-01T17:00:00.000Z' }, rows[1]],
    new Date('2026-10-16T12:00:00Z'));
  assert.equal(state.exams.length, 2);
  assert.equal(state.exams[0].status, 'reserved');
  assert.equal(state.exams[0].startsAt, '2026-11-01T17:00:00.000Z');
  mergePrairieTestExams(state, [rows[1]], new Date('2026-10-17T12:00:00Z'));
  assert.equal(state.exams.length, 2);
  assert.equal(activeExams(state, new Date('2026-10-17T13:00:00Z')).some(exam => exam.id === state.exams[0].id), false);
});

test('unexpected page, missing zone and invalid links fail without erasing cached exams', () => {
  const state = emptyState();
  state.exams.push(validateExam({ title: 'Own exam', status: 'unreserved' }));
  assert.throws(() => parsePrairieTestPage({ pageUrl: 'https://us.prairielearn.com/login', hasExamSections: true }), /登录/);
  assert.throws(() => parsePrairieTestPage(snapshot([{ name: 'Midterm', url: `${home}exams/1`, examId: '1',
    section: 'Current reservations', text: 'Reservation 10:00', times: [] }])), /时间及时区/);
  assert.throws(() => parsePrairieTestPage(snapshot([{ name: 'Midterm', url: 'https://evil.example/exams/1',
    section: 'Available exams', text: 'Reserve now' }])), /链接/);
  assert.equal(state.exams.length, 1);
});

test('manual exam validation rejects fabricated reserved time and reminders deduplicate by state and time', () => {
  assert.throws(() => validateExam({ title: 'Midterm', status: 'reserved' }), /开始时间/);
  assert.throws(() => validateExam({ title: 'Midterm', status: 'unreserved', startsAt: '2026-11-01T10:00:00Z' }), /未预约/);
  const state = emptyState();
  const now = new Date('2026-10-15T12:00:00Z');
  const reserved = validateExam({ title: 'Midterm', status: 'reserved', startsAt: '2026-10-16T12:00:00Z',
    sourceTimeZone: 'America/Los_Angeles' }, { now });
  const unreserved = validateExam({ title: 'Final', status: 'unreserved', reservationDeadline: '2026-10-17T12:00:00Z' }, { now });
  state.exams.push(reserved, unreserved);
  const config = emptyConfig();
  const events = examReminderEvents(state, config, new Date('2026-10-15T13:00:00Z'));
  assert.ok(events.some(event => event.examId === reserved.id));
  assert.ok(events.some(event => event.examId === unreserved.id));
  assert.equal(events.filter(event => event.examId === reserved.id).length, 1);
  state.notified[events[0].key] = now.toISOString();
  assert.equal(examReminderEvents(state, config, new Date('2026-10-15T13:00:00Z')).some(event => event.key === events[0].key), false);
  reserved.status = 'cancelled';
  assert.equal(examCategory(reserved), 'ended');
  assert.equal(examReminderEvents(state, config, new Date('2026-10-15T13:00:00Z')).some(event => event.examId === reserved.id), false);
});

test('exam backup keeps local records and strips links while old backup still imports', () => {
  const state = emptyState();
  state.exams.push(validateExam({ title: 'Final', status: 'unreserved', url: 'https://us.prairietest.com/pt/exams/123?secret=abc' }));
  const backup = createBackup(state, emptyConfig());
  assert.equal(backup.data.exams[0].url, 'https://us.prairietest.com/pt/exams/123');
  const restored = validateBackup(backup);
  assert.equal(restored.state.exams[0].title, 'Final');
  delete backup.data.exams;
  assert.deepEqual(validateBackup(backup).state.exams, []);
});

test('daily WeChat and email summaries count exams, while restored PrairieTest records wait for a fresh sync', () => {
  const state = emptyState();
  state.preferences.language = 'en-US';
  const now = new Date('2026-10-15T13:00:00Z');
  const imported = { sourceId: '321', title: 'CPSC 421 Midterm', status: 'reserved',
    startsAt: '2026-10-16T13:00:00Z', sourceTimeZone: 'America/Los_Angeles',
    url: 'https://us.prairietest.com/pt/exams/321' };
  mergePrairieTestExams(state, [imported], now);
  assert.match(buildDailyDigest(state, now).title, /1 exams/);
  assert.match(buildDigest(state, { scope: 'all' }, now).subject, /1 exams/);
  const backup = createBackup(state, emptyConfig(), now);
  const restored = validateBackup(backup).state;
  assert.equal(activeExams(restored, now).length, 0);
  assert.doesNotMatch(buildDailyDigest(restored, now).title, /exams/);
});
