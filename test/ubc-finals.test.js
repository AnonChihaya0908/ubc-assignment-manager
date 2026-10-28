const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUbcFinalsPage, vancouverInstant, UBC_FINALS_URL } = require('../lib/ubc-finals');
const { mergeUbcFinalsExams, activeExams, examCategory } = require('../lib/exams');
const { emptyState } = require('../lib/store');
const { createBackup, validateBackup } = require('../lib/backup');

const headers = ['Campus', 'Academic Period', 'Section', 'Exam Date', 'Exam Start Time', 'Location', 'Delivery Mode', 'Alpha Split', 'Exam Note'];
const rows = [
  ['Vancouver', '2026-27 Winter Term 1 (UBC-V)', 'CPSC_V 310-101 - Introduction to Software Engineering', '12/18/2026', '12:00:00', '—', 'In Person Learning', '—', '—'],
  ['Vancouver', '2026-27 Winter Term 1 (UBC-V)', 'CPSC_V 421-101 - Introduction to Theory of Computing', '12/11/2026', '08:30:00', 'Room 123', 'In Person Learning', '—', '—'],
  ['Vancouver', '2026-27 Winter Term 1 (UBC-V)', 'STAT_V 251-101 - Introductory Probability and Statistics', '12/14/2026', '15:30:00', '—', 'In Person Learning', '—', '—'],
  ['Vancouver', '2025-26 Winter Term 1 (UBC-V)', 'CPSC_V 314-101 - Computer Graphics', '12/15/2025', '15:30:00', 'Room 1101', 'In Person Learning', '—', 'Location Change'],
];
const page = { pageUrl: UBC_FINALS_URL, headers, rows, totalItems: rows.length };
const courses = [
  { id: '310', name: 'CPSC 310, 2026W1', academicPeriod: '2026W1', accessConfirmedAt: '2026-09-01T00:00:00Z' },
  { id: '421', name: 'CPSC_V 421 101 2026W1', academicPeriod: '2026W1', accessConfirmedAt: '2026-09-01T00:00:00Z' },
  { id: '251-old', name: 'STAT 251, 2025W1', academicPeriod: '2025W1', accessConfirmedAt: '2026-09-01T00:00:00Z' },
  { id: '314-unconfirmed', name: 'CPSC 314, 2025W1', academicPeriod: '2025W1' },
];

test('reads all screenshot rows and links only uniquely confirmed courses in the same term', () => {
  const exams = parseUbcFinalsPage(page, courses);
  assert.equal(exams.length, 4);
  assert.deepEqual(exams.map(exam => exam.courseId), ['310', '421', null, null]);
  assert.equal(exams[0].academicPeriod, '2026W1');
  assert.equal(exams[0].startsAt, '2026-12-18T19:00:00.000Z');
  assert.equal(exams[3].startsAt, '2025-12-15T23:30:00.000Z');
  assert.match(exams[3].location, /Location Change/);
});

test('ambiguous course and incomplete grid do not create a false association', () => {
  assert.equal(parseUbcFinalsPage(page, [...courses, { ...courses[0], id: '310-again' }])[0].courseId, null);
  assert.throws(() => parseUbcFinalsPage({ ...page, totalItems: 8 }, courses), /尚未完整读取/);
  assert.throws(() => parseUbcFinalsPage({ ...page, pageUrl: 'https://example.com/' }, courses), /登录/);
});

test('sync updates the same exam, preserves local association override, and retains past exams', () => {
  const state = emptyState(); state.courses = courses;
  const now = new Date('2026-10-28T17:00:00Z');
  const parsed = parseUbcFinalsPage(page, courses);
  assert.equal(mergeUbcFinalsExams(state, parsed, now), 4);
  const first = state.exams[0];
  const id = first.id;
  first.courseAssociationManual = true; first.courseId = null;
  const changed = [{ ...parsed[0], startsAt: '2026-12-18T20:00:00.000Z' }, ...parsed.slice(1)];
  mergeUbcFinalsExams(state, changed, new Date('2026-10-29T17:00:00Z'));
  assert.equal(state.exams.length, 4);
  assert.equal(state.exams[0].id, id);
  assert.equal(state.exams[0].courseId, null);
  assert.equal(state.exams[0].startsAt, changed[0].startsAt);
  assert.equal(examCategory(state.exams[3], now), 'ended');
  assert.equal(activeExams(state, now).length, 3);
});

test('Vancouver wall clock obeys historic DST and permanent UTC-7', () => {
  assert.equal(vancouverInstant('12/15/2025', '15:30:00'), '2025-12-15T23:30:00.000Z');
  assert.equal(vancouverInstant('12/18/2026', '12:00:00'), '2026-12-18T19:00:00.000Z');
  assert.throws(() => vancouverInstant('02/30/2026', '12:00:00'), /无效/);
});

test('backup retains UBC exams and manual course association without carrying a login', () => {
  const state = emptyState();
  mergeUbcFinalsExams(state, parseUbcFinalsPage(page), new Date('2026-10-28T17:00:00Z'));
  state.exams[0].courseAssociationManual = true;
  const backup = createBackup(state, {}, new Date('2026-10-28T17:00:00Z'));
  const restored = validateBackup(backup).state;
  assert.equal(restored.exams.length, 4);
  assert.equal(restored.exams[0].courseAssociationManual, true);
  assert.equal(restored.exams[0].lastSyncedAt, null);
  assert.equal(restored.ubcFinals.lastSyncedAt, null);
  assert.match(restored.ubcFinals.lastError, /重新登录/);
});
