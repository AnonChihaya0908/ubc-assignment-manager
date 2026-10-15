const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inferAcademicPeriod, normalizeCoursePeriod, periodMatches } = require('../lib/academic-term');
const { loadState, emptyState, mergeRows } = require('../lib/store');

test('UBC winter terms share the starting academic year and summer belongs to the preceding academic year', () => {
  assert.equal(inferAcademicPeriod('CPSC 310 · 2026W1'), '2026W1');
  assert.equal(inferAcademicPeriod('STAT_V_251_2026W2'), '2026W2');
  assert.equal(inferAcademicPeriod('CPSC 210 2026S1'), '2026S1');
  assert.equal(inferAcademicPeriod('CPSC 310 Fall 2026'), null);
  assert.equal(periodMatches({ academicPeriod: '2026W2' }, '2026', 'W2'), true);
  assert.equal(periodMatches({ academicPeriod: '2026S1' }, '2025', 'S1'), true);
  assert.equal(periodMatches({ academicPeriod: '2026S1' }, '2026', 'S1'), false);
  assert.equal(periodMatches({ academicPeriod: '2026WA' }, '2026', 'W2'), true);
  assert.equal(periodMatches({ academicPeriod: null }, '', 'unknown'), true);
});

test('old course data gets a term without losing tasks or a manual unclassified choice', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-term-test-'));
  try {
    const file = path.join(directory, 'data.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, notified: {}, courses: [
      { id: 'c1', name: 'CPSC 310 2026W1', url: 'https://us.prairielearn.com/pl/course_instance/1/assessments' },
      { id: 'c2', name: 'STAT 251 2026W1', academicPeriod: null, academicPeriodManual: true,
        url: 'https://us.prairielearn.com/pl/course_instance/2/assessments' },
    ], tasks: [{ id: 'task', courseId: 'c1' }] }));
    const saved = loadState(file);
    assert.equal(saved.courses[0].academicPeriod, '2026W1');
    assert.equal(saved.courses[1].academicPeriod, null);
    assert.equal(saved.tasks[0].courseId, 'c1');
    const state = emptyState();
    state.courses.push({ id: 'c1', name: 'CPSC 310', academicPeriod: null, academicPeriodManual: true });
    mergeRows(state, 'c1', { courseTitle: 'CPSC 310 2026W1', rows: [{ name: 'Lab 1', code: 'LAB01',
      url: 'https://us.prairielearn.com/pl/course_instance/1/assessment/1', score: '0%' }] });
    assert.equal(state.courses[0].academicPeriod, null);
    assert.equal(normalizeCoursePeriod({ name: 'CPSC 310 2026W2' }).academicPeriod, '2026W2');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
