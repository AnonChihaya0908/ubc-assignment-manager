const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const runFile = promisify(execFile);
const REPO = 'AnonChihaya0908/ubc-assignment-manager';
const PRODUCT = 'UBC作业管理工具';
const VERSION = require('../package.json').version;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value || ''));
  return match ? match.slice(1).map(Number) : null;
}

function newerThan(remote, local = VERSION) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function updateDirectory() {
  return path.join(process.env.LOCALAPPDATA || os.tmpdir(), PRODUCT, 'updates');
}

function safeRelease(release) {
  if (!release || !parseVersion(release.tagName) || release.isDraft || release.isPrerelease) return null;
  const version = release.tagName.replace(/^v/, '');
  const assetName = `${PRODUCT}-${version}.zip`;
  const checksumName = `${assetName}.sha256`;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  if (!assets.some(asset => asset.name === assetName && !(Number.isFinite(asset.size) && asset.size > 500 * 1024 * 1024)) ||
      !assets.some(asset => asset.name === checksumName)) return null;
  const url = `https://github.com/${REPO}/releases/tag/${encodeURIComponent(release.tagName)}`;
  return { version, tag: release.tagName, name: release.name || release.tagName,
    notes: String(release.body || '').slice(0, 4000), url, assetName, checksumName };
}

function publicStatus(status, lastResult = null, canInstall = true) {
  const { kind, checkedAt, release, error, installing } = status;
  return { kind, checkedAt, release, error, installing, currentVersion: VERSION, lastResult, canInstall };
}

function createUpdater({ run = runFile, start = spawn, directory = updateDirectory(), appDirectory = path.resolve(__dirname, '..'),
  platform = process.platform, now = () => Date.now() } = {}) {
  let status = { kind: 'idle', checkedAt: null, release: null, error: null, installing: false };
  let checkPromise;
  let installPromise;
  let lastChecked = 0;
  const canInstall = platform === 'win32' && !fs.existsSync(path.join(appDirectory, '.git'));
  const expose = () => publicStatus(status, lastResult(), canInstall);
  function lastResult() {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(directory, 'last-update.json'), 'utf8').replace(/^\uFEFF/, ''));
      if (!['success', 'failed'].includes(data.state) || !parseVersion(data.version)) return null;
      return { state: data.state, version: data.version, detail: String(data.detail || '').slice(0, 500), at: data.at };
    } catch { return null; }
  }

  async function check(force = false) {
    if (checkPromise) return checkPromise;
    if (!force && lastChecked && now() - lastChecked < CHECK_INTERVAL_MS) return expose();
    status = { ...status, kind: 'checking', error: null };
    checkPromise = (async () => {
      try {
        const { stdout } = await run('gh', ['release', 'view', '--repo', REPO,
          '--json', 'tagName,name,body,url,assets,isDraft,isPrerelease'], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true });
        const release = safeRelease(JSON.parse(stdout));
        if (!release) status = { ...status, kind: 'no_package', release: null, error: null };
        else status = { ...status, kind: newerThan(release.version) ? 'available' : 'current', release, error: null };
      } catch (error) {
        const message = `${error.stderr || ''} ${error.message || ''}`;
        const reason = error.code === 'ENOENT' ? '请安装 GitHub CLI（gh）并登录有权访问此私有仓库的账号。'
          : /release not found/i.test(message) ? '仓库尚未发布可安装的 GitHub Release。'
            : /authentication|not logged|HTTP 401|HTTP 403|could not resolve|network/i.test(message)
              ? '无法访问 GitHub。请检查网络，并确认 GitHub CLI 已登录且有此私有仓库的访问权限。'
              : '更新检查失败。请稍后重试，或在终端运行 gh auth status 检查登录状态。';
        status = { ...status, kind: /release not found/i.test(message) ? 'no_package' : 'error',
          release: null, error: /release not found/i.test(message) ? null : reason };
      } finally {
        lastChecked = now();
        status.checkedAt = new Date(lastChecked).toISOString();
        checkPromise = null;
      }
      return expose();
    })();
    return checkPromise;
  }

  async function install() {
    if (installPromise || status.installing) throw new Error('更新正在进行，请稍等。');
    if (!canInstall) throw new Error('当前在 Git 开发目录运行。请先使用独立的便携包，避免更新覆盖源码。');
    const checked = await check();
    if (checked.kind !== 'available' || !checked.release) throw new Error('当前没有可安装的新版本。');
    if (platform !== 'win32') throw new Error('应用内安装目前仅支持 Windows。');
    const release = checked.release;
    status.installing = true;
    installPromise = (async () => {
      fs.mkdirSync(directory, { recursive: true });
      const stage = fs.mkdtempSync(path.join(directory, 'download-'));
      try {
        for (const name of [release.assetName, release.checksumName]) {
          await run('gh', ['release', 'download', release.tag, '--repo', REPO, '--pattern', name,
            '--dir', stage], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true });
        }
        const archive = path.join(stage, release.assetName);
        const checksum = fs.readFileSync(path.join(stage, release.checksumName), 'utf8').trim();
        const match = /^([a-fA-F0-9]{64})(?:\s+\*?.*)?$/.exec(checksum);
        if (!match) throw new Error('更新包的校验文件格式无效。');
        const hash = require('node:crypto').createHash('sha256');
        await new Promise((resolve, reject) => {
          const stream = fs.createReadStream(archive);
          stream.on('data', chunk => hash.update(chunk));
          stream.on('end', resolve);
          stream.on('error', reject);
        });
        if (hash.digest('hex').toLowerCase() !== match[1].toLowerCase()) throw new Error('更新包校验失败，安装已取消。');
        const script = path.join(appDirectory, 'install-update.ps1');
        const child = start('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
          '-File', script, '-Archive', archive, '-AppDirectory', appDirectory, '-StageDirectory', stage,
          '-Version', release.version, '-ParentPid', String(process.pid)],
        { detached: true, stdio: 'ignore', windowsHide: true });
        child.on('error', () => {});
        if (!child.pid) throw new Error('无法启动更新安装程序。');
        child.unref();
        return { message: '更新包已验证，应用即将关闭、安装并重新启动。' };
      } catch (error) {
        fs.rmSync(stage, { recursive: true, force: true });
        throw error;
      }
    })();
    try { return await installPromise; }
    finally { installPromise = null; status.installing = false; }
  }

  return { check, install, status: expose };
}

module.exports = { createUpdater, parseVersion, newerThan, safeRelease, VERSION, REPO };
