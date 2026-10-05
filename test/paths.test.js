const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dataDir } = require('../lib/paths');

test('Windows user data uses a stable LocalAppData directory', () => {
  const local = path.join('C:', 'Users', 'student', 'AppData', 'Local');
  assert.equal(dataDir({ env: { LOCALAPPDATA: local } }), path.resolve(local, 'UBC作业管理工具', 'data'));
  assert.equal(dataDir({ env: { LOCALAPPDATA: local, PRAIRIELEARN_DATA_DIR: 'D:\\custom-data' } }), path.resolve('D:\\custom-data'));
});

test('resolving the installed data directory never imports adjacent portable data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-paths-'));
  const appRoot = path.join(root, 'download');
  const legacy = path.join(appRoot, '.local-data');
  const local = path.join(root, 'LocalAppData');
  try {
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'data.json'), 'someone-elses-courses');
    const destination = dataDir({ env: { LOCALAPPDATA: local }, appRoot });
    assert.equal(destination, path.join(path.resolve(local), 'UBC作业管理工具', 'data'));
    assert.equal(fs.existsSync(destination), false);
    assert.equal(fs.readFileSync(path.join(legacy, 'data.json'), 'utf8'), 'someone-elses-courses');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the installer does not scan launch folders for portable user data', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'installer', 'Program.cs'), 'utf8');
  assert.doesNotMatch(source, /MigratePortableData|Environment\.CurrentDirectory/);
});
