const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCourseUrl, emptyState, mergeGradescopeRows } = require('../lib/store');
const { parseGradescopeDate, parseGradescopeStatus, parseGradescopePage } = require('../lib/gradescope');
const { categoryOf } = require('../public/task-status');

const courseUrl = 'https://www.gradescope.ca/courses/12345';

test('Gradescope URLs only accept a Canada course page', () => {
  const course = normalizeCourseUrl('https://gradescope.ca/courses/12345?source=dashboard');
  assert.equal(course.platform, 'gradescope');
  assert.equal(course.url, courseUrl);
  assert.throws(() => normalizeCourseUrl('https://www.gradescope.ca/courses/12345/assignments/1'));
  assert.throws(() => normalizeCourseUrl('https://www.gradescope.ca.evil.test/courses/12345'));
});

test('Gradescope grading means completed even below 100 percent and at zero points', () => {
  assert.deepEqual(parseGradescopeStatus('No Submission'), { sourceComplete: false, score: '', gradeText: '' });
  assert.deepEqual(parseGradescopeStatus('Submitted'), { sourceComplete: true, score: '', gradeText: '' });
  assert.deepEqual(parseGradescopeStatus('45 / 50'), { sourceComplete: true, score: '90%', gradeText: '45 / 50' });
  assert.deepEqual(parseGradescopeStatus('0 / 50'), { sourceComplete: true, score: '0%', gradeText: '0 / 50' });
  assert.equal(categoryOf({ score: '90%', sourceComplete: true }), 'done');
});

test('Gradescope due date uses the source timezone and normal date is distinct from late date', () => {
  assert.equal(parseGradescopeDate('Oct 09 at 11:59PM', 'PDT', 'Example 2026W1'), '2026-10-10T06:59:00.000Z');
  assert.equal(parseGradescopeDate('2026-10-09 23:59:00 -0700', '', ''), '2026-10-10T06:59:00.000Z');
  assert.equal(parseGradescopeDate('Jan 09 at 11:59PM', 'PST', 'Example 2026W2'), '2027-01-10T07:59:00.000Z');
  assert.equal(parseGradescopeDate('Feb 30 at 11:59PM', 'PST', 'Example 2026W2'), null);
  const page = parseGradescopePage({ hasTable: true, courseTitle: 'Example 2026W1', timeZone: 'PDT', rows: [{
    name: 'Homework A', url: `${courseUrl}/assignments/42`, status: 'No Submission',
    released: 'Oct 05 at 1:15PM', due: 'Oct 09 at 11:59PM', lateDue: 'Oct 10 at 2:00AM',
  }] }, courseUrl);
  assert.equal(page.rows[0].dueAt, '2026-10-10T06:59:00.000Z');
  assert.equal(page.rows[0].lateDueAt, '2026-10-10T09:00:00.000Z');
  assert.equal(page.rows[0].sourceComplete, false);
});

test('Gradescope merge preserves manual decisions and accepts a valid empty course', () => {
  const state = emptyState();
  const course = normalizeCourseUrl(courseUrl);
  state.courses.push({ ...course, name: 'Example', accessConfirmedAt: new Date().toISOString() });
  const page = parseGradescopePage({ hasTable: true, courseTitle: 'Example 2026W1', timeZone: 'PDT', rows: [{
    name: 'Homework A', url: `${courseUrl}/assignments/42`, status: '45 / 50',
    released: '', due: 'Oct 09 at 11:59PM', lateDue: '',
  }] }, courseUrl);
  assert.equal(mergeGradescopeRows(state, course.id, page), 1);
  assert.equal(categoryOf(state.tasks[0]), 'done');
  state.tasks[0].doneOverride = false;
  mergeGradescopeRows(state, course.id, page);
  assert.equal(state.tasks[0].doneOverride, false);
  assert.equal(mergeGradescopeRows(state, course.id, { courseTitle: 'Example 2026W1', rows: [] }), 0);
  assert.equal(state.tasks.length, 0);
});

test('Gradescope rejects malformed dates and cross-course assignment links without erasing cached rows', () => {
  assert.throws(() => parseGradescopePage({ hasTable: true, bodyRowCount: 1, rows: [] }, courseUrl), /作业行/);
  assert.throws(() => parseGradescopePage({ hasTable: true, bodyRowCount: 2, rows: [{
    name: 'Homework A', url: `${courseUrl}/assignments/42`, due: 'Oct 09 at 11:59PM', status: 'No Submission',
  }] }, courseUrl), /作业行/);
  assert.throws(() => parseGradescopePage({ hasTable: true, courseTitle: 'Example 2026W1', timeZone: '', rows: [{
    name: 'Homework A', url: `${courseUrl}/assignments/42`, due: 'Oct 09 at 11:59PM', status: 'No Submission',
  }] }, courseUrl), /时区/);
  assert.throws(() => parseGradescopePage({ hasTable: true, courseTitle: 'Example 2026W1', timeZone: 'PDT', rows: [{
    name: 'Homework A', url: 'https://www.gradescope.ca/courses/98765/assignments/42', due: 'Oct 09 at 11:59PM', status: 'No Submission',
  }] }, courseUrl), /链接/);
});
