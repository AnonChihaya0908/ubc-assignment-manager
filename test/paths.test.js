const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dataDir, migrateLegacyData } = require('../lib/paths');

test('Windows user data uses a stable LocalAppData directory', () => {
  const local = path.join('C:', 'Users', 'student', 'AppData', 'Local');
  assert.equal(dataDir({ env: { LOCALAPPDATA: local } }), path.resolve(local, 'UBC作业管理工具', 'data'));
  assert.equal(dataDir({ env: { LOCALAPPDATA: local, PRAIRIELEARN_DATA_DIR: 'D:\\custom-data' } }), path.resolve('D:\\custom-data'));
});

test('portable data is copied once without replacing newer installed data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-paths-'));
  const legacy = path.join(root, 'portable', '.local-data');
  const destination = path.join(root, 'installed-data');
  try {
    fs.mkdirSync(path.join(legacy, 'edge-profile'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'data.json'), 'legacy-state');
    fs.writeFileSync(path.join(legacy, 'edge-profile', 'cookie'), 'profile');
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, 'data.json'), 'installed-state');
    const result = migrateLegacyData({ env: {}, legacyDir: legacy, destination });
    assert.equal(result.migrated, true);
    assert.equal(fs.readFileSync(path.join(destination, 'data.json'), 'utf8'), 'installed-state');
    assert.equal(fs.readFileSync(path.join(destination, 'edge-profile', 'cookie'), 'utf8'), 'profile');
    assert.equal(fs.existsSync(path.join(destination, '.migrated-from-portable')), true);
    assert.equal(fs.readFileSync(path.join(legacy, 'data.json'), 'utf8'), 'legacy-state');
    assert.equal(migrateLegacyData({ env: {}, legacyDir: legacy, destination }).reason, 'completed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
