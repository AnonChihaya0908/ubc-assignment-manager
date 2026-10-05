const test = require('node:test');
const assert = require('node:assert/strict');
const { replaceFile } = require('../lib/file-store');

test('file replacement falls back to copy and cleanup across Windows file-system boundaries', () => {
  const calls = [];
  const fileSystem = {
    renameSync() {
      const error = new Error('cross-device link not permitted');
      error.code = 'EXDEV';
      throw error;
    },
    copyFileSync(from, to) { calls.push(['copy', from, to]); },
    unlinkSync(file) { calls.push(['unlink', file]); },
  };

  replaceFile('data.json.tmp', 'data.json', fileSystem);

  assert.deepEqual(calls, [
    ['copy', 'data.json.tmp', 'data.json'],
    ['unlink', 'data.json.tmp'],
  ]);
});

test('file replacement does not hide unrelated write failures', () => {
  const fileSystem = {
    renameSync() {
      const error = new Error('access denied');
      error.code = 'EACCES';
      throw error;
    },
  };

  assert.throws(() => replaceFile('data.json.tmp', 'data.json', fileSystem), /access denied/);
});
