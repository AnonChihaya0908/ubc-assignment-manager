const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dataDir } = require('../lib/paths');
const { edgePath, chromePath, chromiumExecutable } = require('../lib/browser');
const { NativeBrowserBridge } = require('../lib/native-browser');

test('Windows user data uses a stable LocalAppData directory', () => {
  const local = path.join('C:', 'Users', 'student', 'AppData', 'Local');
  assert.equal(dataDir({ platform: 'win32', env: { LOCALAPPDATA: local } }), path.resolve(local, 'UBC作业管理工具', 'data'));
  assert.equal(dataDir({ env: { LOCALAPPDATA: local, PRAIRIELEARN_DATA_DIR: 'D:\\custom-data' } }), path.resolve('D:\\custom-data'));
});

test('macOS stores private state under the user Application Support directory', () => {
  const appRoot = '/Applications/UBC作业管理工具.app/Contents/Resources';
  const directory = dataDir({ platform: 'darwin', env: { HOME: '/Users/student' }, appRoot });
  assert.equal(directory, '/Users/student/Library/Application Support/UBC作业管理工具/data');
  assert.equal(directory.startsWith(appRoot), false);
});

test('macOS finds Edge in system or user Applications', () => {
  const system = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  const user = '/Users/student/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  assert.equal(edgePath({ platform: 'darwin', homeDir: '/Users/student', exists: file => file === system }), system);
  assert.equal(edgePath({ platform: 'darwin', homeDir: '/Users/student', exists: file => file === user }), user);
  assert.throws(() => edgePath({ platform: 'darwin', homeDir: '/Users/student', exists: () => false }), /安装 Edge/);
});

test('Chrome is discovered independently of Edge on both desktop platforms', () => {
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  assert.equal(chromePath({ platform: 'darwin', homeDir: '/Users/student', exists: file => file === mac }), mac);
  const windows = path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
  assert.equal(chromePath({ platform: 'win32', exists: file => file === windows }), windows);
  assert.throws(() => chromePath({ platform: 'darwin', exists: () => false }), /Chrome/);
});

test('automatic browser selection falls back to Chrome when Edge is absent', () => {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const chosen = chromiumExecutable({ preference: 'auto', pathOptions: {
    platform: 'darwin', homeDir: '/Users/student', exists: file => file === chrome,
  } });
  assert.deepEqual(chosen, { name: 'Chrome', executable: chrome, directory: 'chrome-profile' });
});

test('native browser bridge returns one command and completes only its matching request', async () => {
  const bridge = new NativeBrowserBridge();
  const pending = bridge.request('evaluate', { url: 'https://example.edu/course', expression: '1 + 1' });
  const command = bridge.next();
  assert.equal(command.action, 'evaluate');
  assert.equal(bridge.next(), null);
  assert.equal(bridge.complete('unknown', 2), false);
  assert.equal(bridge.complete(command.id, { value: 2 }), true);
  assert.deepEqual(await pending, { value: 2 });
});

test('resolving the installed data directory never imports adjacent portable data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-paths-'));
  const appRoot = path.join(root, 'download');
  const legacy = path.join(appRoot, '.local-data');
  const local = path.join(root, 'LocalAppData');
  try {
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'data.json'), 'someone-elses-courses');
    const destination = dataDir({ platform: 'win32', env: { LOCALAPPDATA: local }, appRoot });
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
