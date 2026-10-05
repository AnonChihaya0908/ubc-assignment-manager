const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseDisplayedDeadline, completionStatus, isComplete } = require('../lib/deadlines');
const { emptyState, loadState, normalizeCourseUrl, mergeRows, mergeWebworkRows } = require('../lib/store');
const { parseCopiedTable } = require('../lib/paste');
const { parseWebworkText, parseWebworkDate, parseWebworkProgress } = require('../lib/webwork');
const { categoryOf, needsAttention } = require('../public/task-status');
const { classifySyncError, markSyncFailure, markSyncSuccess, courseDataStatus } = require('../lib/sync-status');

function addPrairieLearnCourse(state) {
  const course = normalizeCourseUrl('https://us.prairielearn.com/pl/course_instance/231184/assessments');
  state.courses.push({ ...course, name: 'CPSC 310 · 2026W1', lastSyncedAt: null });
  return course;
}

test('CPSC 310 screenshot deadline is parsed in the course year', () => {
  const result = parseDisplayedDeadline('100% until 23:59, Thu, Oct 8', 'CPSC 310, 2026W1', new Date(2026, 9, 2));
  const date = new Date(result.dueAt);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 9);
  assert.equal(date.getDate(), 8);
  assert.equal(date.getHours(), 23);
  assert.equal(date.getMinutes(), 59);
  assert.equal(result.deadlineKind, 'on_time');
});

test('late credit windows are not treated as on-time due dates', () => {
  const result = parseDisplayedDeadline('80% until 18:05, Fri, Oct 16', 'CPSC 310, 2026W1');
  assert.equal(result.deadlineKind, 'credit_window');
  assert.equal(result.creditPercent, 80);
});

test('shared task status covers both platforms, dates, and manual overrides', () => {
  const now = new Date('2026-10-04T12:00:00Z').getTime();
  const pending = { dueAt: '2026-10-05T12:00:00Z', sourceComplete: false };
  const overdue = { dueAt: '2026-10-03T12:00:00Z', sourceComplete: false };
  const undated = { dueAt: null, sourceComplete: null };
  const future = { sourceStatus: 'future', opensAt: '2026-10-06T12:00:00Z' };
  const pastWebwork = { sourceStatus: 'past_due', sourceComplete: false };
  assert.equal(categoryOf(pending, now), 'pending');
  assert.equal(categoryOf(overdue, now), 'history');
  assert.equal(categoryOf(undated, now), 'pending');
  assert.equal(categoryOf(future, now), 'future');
  assert.equal(categoryOf(pastWebwork, now), 'history');
  assert.equal(needsAttention(overdue, now), true);
  assert.equal(needsAttention(pastWebwork, now), true);
  overdue.doneOverride = true;
  assert.equal(categoryOf(overdue, now), 'done');
  pastWebwork.deadlineOverride = '2026-10-06T12:00:00Z';
  assert.equal(categoryOf(pastWebwork, now), 'pending');
  const fullScore = { score: '100%', dueAt: '2026-10-03T12:00:00Z', sourceComplete: null };
  assert.deepEqual(completionStatus(fullScore), { complete: true, source: 'score' });
  assert.equal(categoryOf(fullScore, now), 'done');
  const manualMode = { requireManualCompletion: true };
  assert.deepEqual(completionStatus(fullScore, manualMode), { complete: null, source: 'confirmation_required' });
  assert.equal(categoryOf(fullScore, now, manualMode), 'pending');
  fullScore.doneOverride = true;
  assert.deepEqual(completionStatus(fullScore, manualMode), { complete: true, source: 'manual' });
});

test('ignored categories apply only to the selected course and exclude attention', () => {
  const now = new Date('2026-10-04T12:00:00Z').getTime();
  const options = { ignoredSectionsByCourse: { c317: ['In Class Assignment'] } };
  const ignored = { courseId: 'c317', section: '  in class   assignment ', dueAt: '2026-10-05T12:00:00Z', sourceComplete: false };
  const otherCourse = { ...ignored, courseId: 'c310', section: 'In Class Assignment' };
  const newlySynced = { ...ignored, name: 'ICA 07' };
  assert.equal(categoryOf(ignored, now, options), 'ignored');
  assert.equal(needsAttention(ignored, now, options), false);
  assert.equal(categoryOf(newlySynced, now, options), 'ignored');
  assert.equal(categoryOf(otherCourse, now, options), 'pending');
  assert.equal(needsAttention(otherCourse, now, options), true);
});

test('existing saved data defaults to automatic full-score completion', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-assignment-state-'));
  const file = path.join(directory, 'data.json');
  try {
    fs.writeFileSync(file, JSON.stringify({ version: 1, courses: [], tasks: [], notified: {} }));
    assert.deepEqual(loadState(file).preferences, { requireManualCompletion: false, onboardingDismissed: true });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a new installation starts empty and keeps onboarding available', () => {
  const state = emptyState();
  assert.deepEqual(state.courses, []);
  assert.deepEqual(state.tasks, []);
  assert.equal(state.preferences.onboardingDismissed, false);
});

test('course sync status classifies failures, preserves success time, and detects stale data', () => {
  assert.equal(classifySyncError(new Error('专用 Edge 窗口尚未登录')), 'login');
  assert.equal(classifySyncError(Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' })), 'network');
  assert.equal(classifySyncError(new Error('没有识别到作业表格')), 'parse');
  const course = { lastSyncedAt: '2026-10-04T01:00:00.000Z' };
  markSyncFailure(course, new Error('专用 Edge 窗口尚未登录'), new Date('2026-10-04T02:00:00.000Z'));
  assert.equal(course.lastSyncedAt, '2026-10-04T01:00:00.000Z');
  assert.equal(course.lastSyncErrorKind, 'login');
  markSyncFailure(course, new Error('failed https://example.test/?effectiveUser=private-id&x=1'), new Date('2026-10-04T02:00:00.000Z'));
  assert.doesNotMatch(course.lastSyncError, /private-id/);
  assert.equal(courseDataStatus(course, new Date('2026-10-04T03:00:00.000Z').getTime()).kind, 'error');
  markSyncSuccess(course, new Date('2026-10-04T03:00:00.000Z'));
  assert.equal(course.lastSyncError, null);
  assert.equal(courseDataStatus(course, new Date('2026-10-04T04:00:00.000Z').getTime()).kind, 'fresh');
  assert.equal(courseDataStatus(course, new Date('2026-10-04T10:00:01.000Z').getTime()).kind, 'stale');
});

test('missing deadlines remain undated and student overrides remain after sync', () => {
  const state = emptyState();
  const course = addPrairieLearnCourse(state);
  const rows = [
    { name: 'Refactoring and Testability', code: 'LAB03', section: 'Lab Assignments', url: 'https://us.prairielearn.com/pl/course_instance/231184/assessment/1', creditText: '100% until 23:59, Thu, Oct 8', score: '0%' },
    { name: 'Onboarding', code: 'LAB01', section: 'Lab Assignments', url: 'https://us.prairielearn.com/pl/course_instance/231184/assessment/2', creditText: '', score: '100%' },
  ];
  mergeRows(state, course.id, { courseTitle: 'CPSC 310, 2026W1', rows });
  assert.equal(state.tasks.length, 2);
  assert.equal(state.tasks[1].dueAt, null);
  assert.equal(isComplete(state.tasks[1]), true);
  assert.deepEqual(completionStatus(state.tasks[1]), { complete: true, source: 'score' });
  state.tasks[1].doneOverride = true;
  assert.equal(isComplete(state.tasks[1]), true);
  state.tasks[0].doneOverride = true;
  state.tasks[0].deadlineOverride = new Date(2026, 9, 9, 23, 59).toISOString();
  mergeRows(state, course.id, { courseTitle: 'CPSC 310, 2026W1', rows });
  assert.equal(state.tasks[0].doneOverride, true);
  assert.equal(state.tasks[0].deadlineOverride, new Date(2026, 9, 9, 23, 59).toISOString());
  assert.equal(state.tasks[1].doneOverride, true);
  assert.equal(isComplete(state.tasks[1]), true);
});

test('course URLs are limited to supported student course pages', () => {
  assert.equal(normalizeCourseUrl('https://us.prairielearn.com/pl/course_instance/231184/assessments').instanceId, '231184');
  assert.equal(normalizeCourseUrl('https://webwork.elearning.ubc.ca/webwork2/2026W1_V_STAT_V_251_101_2026W1?effectiveUser=student').platform, 'webwork');
  assert.throws(() => normalizeCourseUrl('https://example.com/pl/course_instance/231184/assessments'));
});

test('WeBWorK due dates and release dates remain distinct', () => {
  const url = 'https://webwork.elearning.ubc.ca/webwork2/2026W1_V_STAT_V_251_101_2026W1';
  const rows = parseWebworkText(`Open Assignments\nAssignment-03\nOpen. Due October 8, 2026, 11:59:00 PM PDT.\nFuture Assignments\nAssignment-04\nWill open on October 6, 2026, 12:00:00 AM PDT.\nAssignment-07\nWill open on November 3, 2026, 12:00:00 AM PST.\nPast Due Assignments\nAssignment-02\nAnswers available for review.`, {}, url);
  assert.equal(rows.length, 4);
  const course = normalizeCourseUrl(url);
  const state = emptyState();
  state.courses.push({ ...course, name: 'STAT 251', lastSyncedAt: null });
  mergeWebworkRows(state, course.id, { courseTitle: 'STAT 251', rows });
  const byName = name => state.tasks.find(task => task.name === name);
  assert.equal(byName('Assignment-03').dueAt, '2026-10-09T06:59:00.000Z');
  assert.equal(byName('Assignment-04').dueAt, null);
  assert.equal(byName('Assignment-04').opensAt, '2026-10-06T07:00:00.000Z');
  assert.equal(byName('Assignment-07').opensAt, '2026-11-03T08:00:00.000Z');
  assert.equal(byName('Assignment-02').sourceStatus, 'past_due');
  assert.equal(byName('Assignment-02').dueAt, null);
  byName('Assignment-03').doneOverride = true;
  mergeWebworkRows(state, course.id, { courseTitle: 'STAT 251', rows });
  assert.equal(byName('Assignment-03').doneOverride, true);
  assert.equal(parseWebworkDate('October 32, 2026, 11:59:00 PM PDT'), null);
});

test('WeBWorK completion requires every problem to reach 100%', () => {
  const headers = ['Name', 'Attempts', 'Remaining', 'Worth', 'Status'];
  const complete = parseWebworkProgress([{ headers, rows: [
    ['Problem 1', '1', '7', '2', '100%'],
    ['Problem 2', '1', '9', '3', '100%'],
  ] }]);
  assert.deepEqual(complete, {
    score: '100%', sourceComplete: true, problemCount: 2, completedProblemCount: 2,
  });

  const inProgress = parseWebworkProgress([{ headers, rows: [
    ['Problem 1', '1', '7', '2', '50%'],
    ['Problem 2', '1', '9', '3', '100%'],
  ] }]);
  assert.deepEqual(inProgress, {
    score: '80%', sourceComplete: false, problemCount: 2, completedProblemCount: 1,
  });

  const notStarted = parseWebworkProgress([{ headers, rows: [
    ['Problem 1', '0', '8', '2', '0%'],
  ] }]);
  assert.equal(notStarted.score, '0%');
  assert.equal(notStarted.sourceComplete, false);
  assert.throws(() => parseWebworkProgress([{ headers, rows: [['Problem 1', '0', '8', '2', 'Not available']] }]));
});

test('WeBWorK progress is merged without losing student overrides', () => {
  const state = emptyState();
  const course = normalizeCourseUrl('https://webwork.elearning.ubc.ca/webwork2/example');
  state.courses.push({ ...course, name: 'STAT 251', lastSyncedAt: null });
  const page = { courseTitle: 'STAT 251', rows: [{
    name: 'Assignment-03', code: 'Assignment-03', section: 'open', url: `${course.url}/Assignment-03`,
    dueText: 'October 8, 2026, 11:59:00 PM PDT.', score: '100%', sourceComplete: true,
    problemCount: 6, completedProblemCount: 6,
  }] };
  mergeWebworkRows(state, course.id, page);
  const task = state.tasks.find(item => item.courseId === course.id);
  assert.equal(task.score, '100%');
  assert.equal(task.sourceComplete, true);
  assert.equal(task.problemCount, 6);
  assert.equal(isComplete(task), true);
  assert.deepEqual(completionStatus(task), { complete: true, source: 'website' });
  task.doneOverride = false;
  mergeWebworkRows(state, course.id, page);
  assert.equal(task.doneOverride, false);
  assert.equal(isComplete(task), false);
  task.doneOverride = null;
  mergeWebworkRows(state, course.id, { courseTitle: 'STAT 251', rows: [{
    name: 'Assignment-03', code: 'Assignment-03', section: 'past_due', url: `${course.url}/Assignment-03`,
  }] });
  assert.equal(task.sourceStatus, 'past_due');
  assert.equal(task.score, '100%');
  assert.equal(task.sourceComplete, true);
  assert.equal(isComplete(task), true);
});

test('copied student table can populate the local dashboard', () => {
  const state = emptyState();
  const course = addPrairieLearnCourse(state);
  const page = parseCopiedTable('Lab Assignments\nLAB03 Refactoring and Testability\t100% until 23:59, Thu, Oct 8\t0%\nLAB04 DIP, LSP & Testability\t100% until 23:59, Thu, Oct 15\tNot started', course);
  assert.equal(page.rows.length, 2);
  mergeRows(state, course.id, page);
  assert.equal(state.tasks[0].code, 'LAB03');
  assert.equal(new Date(state.tasks[0].dueAt).getDate(), 8);
  assert.equal(state.tasks[1].score, 'Not started');
});
