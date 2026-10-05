const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { writeJsonFile } = require('./file-store');

const REPO = 'AnonChihaya0908/ubc-assignment-manager';
const PRODUCT = 'UBC作业管理工具';
const VERSION = require('../package.json').version;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'ubc-assignment-manager',
  'X-GitHub-Api-Version': '2022-11-28',
};

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

function releaseAssetUrl(tag, name) {
  return `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}

function safeRelease(release) {
  const tagName = release?.tagName || release?.tag_name;
  const isDraft = release?.isDraft ?? release?.draft;
  const isPrerelease = release?.isPrerelease ?? release?.prerelease;
  if (!release || !parseVersion(tagName) || isDraft || isPrerelease) return null;
  const version = tagName.replace(/^v/, '');
  const assetName = `ubc-assignment-manager-${version}-windows.zip`;
  const checksumName = `${assetName}.sha256`;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  if (!assets.some(asset => asset.name === assetName && !(Number.isFinite(asset.size) && asset.size > 500 * 1024 * 1024)) ||
      !assets.some(asset => asset.name === checksumName)) return null;
  const url = `https://github.com/${REPO}/releases/tag/${encodeURIComponent(tagName)}`;
  return { version, tag: tagName, name: release.name || tagName,
    notes: String(release.body || '').slice(0, 4000), url, assetName, checksumName,
    assetUrl: releaseAssetUrl(tagName, assetName), checksumUrl: releaseAssetUrl(tagName, checksumName) };
}

function publicStatus(status, lastResult = null, canInstall = true) {
  const { kind, checkedAt, release, error, installing } = status;
  return { kind, checkedAt, release, error, installing, currentVersion: VERSION, lastResult, canInstall };
}

function errorDetails(error) {
  return `${error?.code || ''} ${error?.name || ''} ${error?.message || ''} ${error?.cause?.code || ''} ${error?.cause?.message || ''}`;
}

function isTemporary(error) {
  const status = Number(error?.status);
  return status === 429 || status >= 500 || /AbortError|TimeoutError|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|fetch failed|network/i.test(errorDetails(error));
}

async function retry(action, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await action(attempt); }
    catch (error) {
      lastError = error;
      if (!isTemporary(error) || attempt === attempts - 1) throw error;
      await wait(350 * (2 ** attempt));
    }
  }
  throw lastError;
}

function githubErrorMessage(error, action = '访问 GitHub') {
  const detail = errorDetails(error);
  const status = Number(error?.status);
  if (/AbortError|TimeoutError|ETIMEDOUT/i.test(detail)) return `${action}超时，已自动重试。请稍后再试。`;
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(detail)) return '无法解析 GitHub 地址。请检查 DNS 或网络连接后重试。';
  if (/ECONN|fetch failed|network/i.test(detail)) return '无法连接 GitHub。请检查网络后重试；不再需要 GitHub CLI 登录。';
  if (status === 403 || status === 429) return `GitHub 暂时限制了更新请求（HTTP ${status}）。请稍后再试。`;
  if (status) return `GitHub 更新服务返回 HTTP ${status}。请稍后再试。`;
  return `${action}失败。请稍后再试。`;
}

async function latestRelease(fetchImpl, wait) {
  return retry(async () => {
    const response = await fetchImpl(API_URL, {
      headers: API_HEADERS, redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const error = new Error(`GitHub HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }, wait);
}

async function downloadFile(fetchImpl, url, target, wait) {
  const partial = `${target}.part`;
  try {
    await retry(async () => {
      fs.rmSync(partial, { force: true });
      const response = await fetchImpl(url, { headers: { 'User-Agent': API_HEADERS['User-Agent'] },
        redirect: 'follow', signal: AbortSignal.timeout(120_000) });
      if (!response.ok || !response.body) {
        const error = new Error(`GitHub HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial, { flags: 'wx' }));
    }, wait);
    fs.renameSync(partial, target);
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw new Error(githubErrorMessage(error, '下载更新包'));
  }
}

function createUpdater({ fetchImpl = globalThis.fetch, download, start = spawn, directory = updateDirectory(),
  appDirectory = path.resolve(__dirname, '..'), platform = process.platform, now = () => Date.now(),
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let status = { kind: 'idle', checkedAt: null, release: null, error: null, installing: false };
  let checkPromise;
  let installPromise;
  let lastChecked = 0;
  const canInstall = platform === 'win32' && !fs.existsSync(path.join(appDirectory, '.git'));
  const saveDownload = download || ((url, target) => downloadFile(fetchImpl, url, target, wait));
  const expose = () => publicStatus(status, lastResult(), canInstall);
  const cacheFile = path.join(directory, 'release-cache.json');
  function lastResult() {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(directory, 'last-update.json'), 'utf8').replace(/^\uFEFF/, ''));
      if (!['success', 'failed'].includes(data.state) || !parseVersion(data.version)) return null;
      return { state: data.state, version: data.version, detail: String(data.detail || '').slice(0, 500), at: data.at };
    } catch { return null; }
  }

  function readReleaseCache() {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      const checked = Date.parse(cached.checkedAt || '');
      if (!Number.isFinite(checked) || now() - checked >= CHECK_INTERVAL_MS || now() < checked) return null;
      if (cached.release === null) return { checked, release: null };
      const release = safeRelease({
        tagName: cached.release?.tag, name: cached.release?.name, body: cached.release?.notes,
        assets: [{ name: cached.release?.assetName }, { name: cached.release?.checksumName }],
      });
      return release ? { checked, release } : null;
    } catch { return null; }
  }

  function saveReleaseCache(release, checkedAt) {
    try { writeJsonFile(cacheFile, { checkedAt, release }); } catch { }
  }

  async function check(force = false) {
    if (checkPromise) return checkPromise;
    if (!force && lastChecked && now() - lastChecked < CHECK_INTERVAL_MS) return expose();
    if (!force && !lastChecked) {
      const cached = readReleaseCache();
      if (cached) {
        lastChecked = cached.checked;
        status = { ...status, kind: cached.release ? (newerThan(cached.release.version) ? 'available' : 'current') : 'no_package',
          checkedAt: new Date(cached.checked).toISOString(), release: cached.release, error: null };
        return expose();
      }
    }
    status = { ...status, kind: 'checking', error: null };
    checkPromise = (async () => {
      let cacheable = false;
      try {
        const release = safeRelease(await latestRelease(fetchImpl, wait));
        if (!release) status = { ...status, kind: 'no_package', release: null, error: null };
        else status = { ...status, kind: newerThan(release.version) ? 'available' : 'current', release, error: null };
        cacheable = true;
      } catch (error) {
        const noPackage = Number(error?.status) === 404;
        status = { ...status, kind: noPackage ? 'no_package' : 'error', release: null,
          error: noPackage ? null : githubErrorMessage(error, '检查更新') };
      } finally {
        lastChecked = now();
        status.checkedAt = new Date(lastChecked).toISOString();
        if (cacheable) saveReleaseCache(status.release, status.checkedAt);
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
        await saveDownload(release.assetUrl, path.join(stage, release.assetName));
        await saveDownload(release.checksumUrl, path.join(stage, release.checksumName));
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

module.exports = { createUpdater, parseVersion, newerThan, safeRelease, githubErrorMessage, retry, VERSION, REPO };
