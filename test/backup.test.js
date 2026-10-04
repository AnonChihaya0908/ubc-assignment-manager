const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBackup, validateBackup, writeRestorePoint, applyBackup } = require('../lib/backup');
const { emptyConfig } = require('../lib/wechat');

function fixture() {
  const courseId = 'webwork.elearning.ubc.ca:STAT_251';
  return {
    state: {
      version: 1, notified: { private: true }, preferences: { requireManualCompletion: true, onboardingDismissed: true },
      courses: [{ id: courseId, platform: 'webwork', name: 'STAT 251', url: 'https://webwork.elearning.ubc.ca/webwork2/STAT_251?effectiveUser=PRIVATE123' }],
      tasks: [{ id: 'abcdef0123456789abcdef01', courseId, name: 'Assignment-03', code: 'A03', section: '',
        url: 'https://webwork.elearning.ubc.ca/webwork2/STAT_251/Assignment-03?effectiveUser=PRIVATE123&token=secret',
        creditText: '', score: '80%', dueAt: '2026-10-09T06:59:00.000Z', opensAt: null, creditPercent: null,
        deadlineKind: 'on_time', sourceStatus: 'open', sourceComplete: false, problemCount: 6, completedProblemCount: 5,
        seenAt: '2026-10-04T12:00:00.000Z', doneOverride: false, deadlineOverride: '2026-10-09T05:00:00.000Z' }],
    },
    config: { ...emptyConfig(), enabled: true, sendKey: 'SCTabcdefghijklmnop', history: [{ detail: 'private history' }],
      leadHours: [48, 6], disabledCourseIds: [courseId] },
  };
}

test('exported backup restores managed data without credentials or personal query parameters', () => {
  const { state, config } = fixture();
  const backup = createBackup(state, config, new Date('2026-10-04T12:00:00.000Z'));
  const serialized = JSON.stringify(backup);
  assert.equal(backup.formatVersion, 1);
  assert.doesNotMatch(serialized, /PRIVATE123|effectiveUser|token=secret|SCTabcdefghijklmnop|private history/);
  assert.equal(backup.scope.courses, 1);
  assert.equal(backup.scope.tasks, 1);
  const validated = validateBackup(backup);
  const restored = applyBackup(validated, { ...emptyConfig(), sendKey: 'SCTexistingkey123', history: [{ type: 'test' }] });
  assert.equal(restored.state.tasks[0].doneOverride, false);
  assert.equal(restored.state.tasks[0].deadlineOverride, '2026-10-09T05:00:00.000Z');
  assert.deepEqual(restored.config.leadHours, [48, 6]);
  assert.equal(restored.config.enabled, false);
  assert.equal(restored.config.sendKey, 'SCTexistingkey123');
  assert.equal(validated.reminders.dailyWasEnabled, true);
  assert.equal(Object.hasOwn(restored.config, 'dailyWasEnabled'), false);
});

test('unsupported and damaged backups fail validation before state replacement', () => {
  const { state, config } = fixture();
  const current = JSON.stringify(state);
  const backup = createBackup(state, config);
  assert.throws(() => validateBackup({ ...backup, formatVersion: 99 }), /版本不受支持/);
  backup.data.tasks[0].deadlineOverride = 'not-a-date';
  assert.throws(() => validateBackup(backup), /手动提醒时间无效/);
  assert.equal(JSON.stringify(state), current);
});

test('a local restore point contains the pre-import state and settings', () => {
  const { state, config } = fixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-restore-point-'));
  try {
    const file = writeRestorePoint(state, config, new Date('2026-10-04T12:00:00.000Z'), directory);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.state.courses[0].name, 'STAT 251');
    assert.equal(saved.config.sendKey, config.sendKey);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
