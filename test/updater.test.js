const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const { createUpdater, newerThan, safeRelease, githubErrorMessage } = require('../lib/updater');

const release = {
  tagName: 'v1.3.0', name: '1.3.0', body: '修复同步问题', isDraft: false, isPrerelease: false,
  assets: [{ name: 'ubc-assignment-manager-1.3.0-windows.zip' }, { name: 'ubc-assignment-manager-1.3.0-windows.zip.sha256' }],
};

test('only a newer stable release with the matching Windows package and checksum is offered', () => {
  assert.equal(newerThan('v1.2.0', '1.1.0'), true);
  assert.equal(newerThan('v1.1.0', '1.1.0'), false);
  assert.equal(newerThan('v1.0.9', '1.1.0'), false);
  assert.equal(newerThan('main', '1.1.0'), false);
  assert.equal(safeRelease(release).version, '1.3.0');
  assert.equal(safeRelease({ tag_name: 'v1.3.0', name: '1.3.0', body: 'API response', draft: false, prerelease: false,
    assets: release.assets }).version, '1.3.0');
  assert.equal(safeRelease({ ...release, isPrerelease: true }), null);
  assert.equal(safeRelease({ ...release, assets: [release.assets[0]] }), null);
});

test('startup check reports no package, then detects an update without sending credentials to the UI', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-update-check-'));
  let calls = 0;
  const updater = createUpdater({ fetchImpl: async () => {
    calls++;
    if (calls === 1) return new Response('', { status: 404 });
    return Response.json(release);
  }, directory, now: () => 1000 });
  try {
    assert.equal((await updater.check()).kind, 'no_package');
    assert.equal((await updater.check()).kind, 'no_package');
    assert.equal(calls, 1);
    const result = await updater.check(true);
    assert.equal(result.kind, 'available');
    assert.equal(result.release.version, '1.3.0');
    assert.equal(JSON.stringify(result).includes('token'), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('temporary GitHub failures retry and error messages distinguish timeout from DNS', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-update-retry-'));
  let calls = 0;
  const updater = createUpdater({ fetchImpl: async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error('request timed out'), { code: 'ETIMEDOUT' });
    return Response.json(release);
  }, directory, wait: async () => {}, now: () => 1000 });
  try {
    assert.equal((await updater.check()).kind, 'available');
    assert.equal(calls, 3);
    assert.match(githubErrorMessage(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }), '检查更新'), /超时.*自动重试/);
    assert.match(githubErrorMessage(Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' })), /DNS/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('a successful release check is reused across app restarts for six hours', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-update-cache-'));
  const checkedAt = Date.parse('2026-10-04T12:00:00.000Z');
  try {
    const first = createUpdater({ fetchImpl: async () => Response.json(release), directory, now: () => checkedAt });
    assert.equal((await first.check()).kind, 'available');
    const second = createUpdater({ fetchImpl: async () => { throw new Error('network should not be used'); },
      directory, now: () => checkedAt + 60_000 });
    const cached = await second.check();
    assert.equal(cached.kind, 'available');
    assert.equal(cached.release.version, '1.3.0');
    assert.equal(cached.checkedAt, '2026-10-04T12:00:00.000Z');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('verified archive is handed to the detached installer, invalid checksum blocks installation', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-update-test-'));
  let valid = true;
  let launched = false;
  const download = async (url, target) => {
    assert.match(url, /^https:\/\/github\.com\/AnonChihaya0908\/ubc-assignment-manager\/releases\/download\//);
    assert.doesNotMatch(url, /token|PRIVATE/i);
    const filename = path.basename(target);
    const bytes = Buffer.from('test package bytes');
    fs.writeFileSync(target, filename.endsWith('.sha256')
      ? `${valid ? crypto.createHash('sha256').update(bytes).digest('hex') : '0'.repeat(64)}  ubc-assignment-manager-1.3.0-windows.zip`
      : bytes);
  };
  const start = (program, args) => {
    assert.equal(program, 'powershell.exe');
    assert.ok(args.includes('install-update.ps1') === false);
    assert.ok(args.some(arg => String(arg).endsWith('install-update.ps1')));
    launched = true;
    const child = new EventEmitter();
    child.pid = 1234;
    child.unref = () => {};
    return child;
  };
  try {
    const updater = createUpdater({ fetchImpl: async () => Response.json(release), download, start,
      directory: temporary, appDirectory: temporary, platform: 'win32' });
    await updater.check();
    await updater.install();
    assert.equal(launched, true);
    valid = false;
    launched = false;
    await assert.rejects(updater.install(), /校验失败/);
    assert.equal(launched, false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('Windows installer restores the old program and user data when the new app fails health check',
  { skip: process.platform !== 'win32', timeout: 45000 }, () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-rollback-test-'));
    const app = path.join(temporary, 'app');
    const source = path.join(temporary, 'package', 'UBC作业管理工具');
    const updates = path.join(temporary, 'updates');
    const stage = path.join(updates, 'download-fixture');
    const executable = path.join(process.env.WINDIR, 'System32', 'whoami.exe');
    try {
      for (const root of [app, source]) {
        fs.mkdirSync(root, { recursive: true });
        for (const folder of ['lib', 'public', 'runtime']) {
          fs.mkdirSync(path.join(root, folder));
          fs.writeFileSync(path.join(root, folder, 'marker.txt'), root === app ? 'old' : 'new');
        }
        for (const file of ['notify.ps1', 'README.md', 'install-update.ps1']) fs.writeFileSync(path.join(root, file), root === app ? 'old' : 'new');
        fs.copyFileSync(executable, path.join(root, 'UBC作业管理工具.exe'));
        fs.writeFileSync(path.join(root, 'app.js'), root === app ? 'old' : 'new');
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: root === app ? '1.1.0' : '1.2.0' }));
      }
      fs.mkdirSync(path.join(app, '.local-data'));
      fs.writeFileSync(path.join(app, '.local-data', 'private.txt'), 'preserve me');
      fs.mkdirSync(stage, { recursive: true });
      const archive = path.join(stage, 'ubc-assignment-manager-1.2.0-windows.zip');
      const packer = path.join(temporary, 'pack.ps1');
      fs.writeFileSync(packer, 'param([string]$SourceDir,[string]$Archive)\nCompress-Archive -LiteralPath $SourceDir -DestinationPath $Archive -Force\n');
      const packed = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', packer,
        '-SourceDir', source, '-Archive', archive],
      { encoding: 'utf8', timeout: 15000, windowsHide: true });
      assert.equal(packed.status, 0, packed.stderr);
      const installer = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(__dirname, '..', 'install-update.ps1'), '-Archive', archive, '-AppDirectory', app,
        '-StageDirectory', stage, '-Version', '1.2.0', '-ParentPid', '2147483647',
        '-HealthUrl', 'http://127.0.0.1:65534/api/state', '-HealthAttempts', '1'],
      { encoding: 'utf8', timeout: 30000, windowsHide: true });
      assert.equal(installer.status, 0, installer.stderr);
      const result = JSON.parse(fs.readFileSync(path.join(updates, 'last-update.json'), 'utf8').replace(/^\uFEFF/, ''));
      assert.equal(result.state, 'failed');
      assert.equal(fs.readFileSync(path.join(app, 'app.js'), 'utf8'), 'old');
      assert.equal(fs.readFileSync(path.join(app, 'lib', 'marker.txt'), 'utf8'), 'old');
      assert.equal(fs.readFileSync(path.join(app, '.local-data', 'private.txt'), 'utf8'), 'preserve me');
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });
