const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { loadState, saveState, normalizeCourseUrl, coursePlatform, mergeRows, mergeWebworkRows } = require('./lib/store');
const { effectiveDue, isComplete } = require('./lib/deadlines');
const { edgePath, activePort, openCoursePage, readCoursePage, readWebworkPage } = require('./lib/browser');
const { parseCopiedTable } = require('./lib/paste');
const { loadConfig, saveConfig, publicConfig, validateSendKey, localDateKey,
  shouldSendDaily, buildDailyDigest, sendServerChan } = require('./lib/wechat');
const { createUpdater, VERSION } = require('./lib/updater');

let state = loadState();
let wechatConfig = loadConfig();
let syncing = false;
let sendingWechat = false;
let autoSyncEnabled = state.courses.some(course => course.lastSyncedAt);
let server;
const updater = createUpdater();

function publicState() {
  return { version: VERSION, courses: state.courses, tasks: state.tasks, syncing, autoSyncEnabled,
    wechat: publicConfig(wechatConfig), now: new Date().toISOString() };
}

function json(response, status, body) {
  const content = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(content),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(content);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let data = '';
    request.on('data', chunk => {
      data += chunk;
      if (data.length > 65536) {
        reject(new Error('请求内容过大。'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('JSON 格式错误。')); }
    });
    request.on('error', reject);
  });
}

function serveFile(response, fileName, contentType) {
  const file = path.join(__dirname, 'public', fileName);
  const content = fs.readFileSync(file);
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': content.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'",
  });
  response.end(content);
}

async function syncCourse(courseId) {
  if (syncing) throw new Error('正在同步，请稍等。');
  const course = state.courses.find(item => item.id === courseId);
  if (!course) throw new Error('课程不存在。');
  syncing = true;
  try {
    const webwork = coursePlatform(course) === 'webwork';
    const page = await (webwork ? readWebworkPage(course.url) : readCoursePage(course.url));
    const count = webwork ? mergeWebworkRows(state, courseId, page) : mergeRows(state, courseId, page);
    saveState(state);
    autoSyncEnabled = true;
    return count;
  } finally {
    syncing = false;
  }
}

function notify(title, message) {
  if (process.platform !== 'win32') return;
  const child = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
    '-File', path.join(__dirname, 'notify.ps1'), '-Title', title, '-Message', message,
  ], { windowsHide: true, stdio: 'ignore' });
  child.unref();
}

function checkReminders() {
  const now = Date.now();
  let changed = false;
  for (const task of state.tasks) {
    if (isComplete(task) || task.sourceStatus === 'past_due' && !task.deadlineOverride || task.deadlineKind === 'credit_window' && !task.deadlineOverride) continue;
    const due = effectiveDue(task);
    if (!due) continue;
    const remaining = new Date(due).getTime() - now;
    if (!(remaining > 0)) continue;
    for (const [key, ms, label] of [
      ['24h', 24 * 3600000, '24 小时内截止'],
      ['3h', 3 * 3600000, '3 小时内截止'],
    ]) {
      if (remaining > ms) continue;
      const notificationKey = `${task.id}:${due}:${key}`;
      if (state.notified[notificationKey]) continue;
      state.notified[notificationKey] = new Date().toISOString();
      changed = true;
      notify(`${task.name} · ${label}`, `${task.code || task.section || '作业'} · ${new Date(due).toLocaleString('zh-CN')}`);
    }
  }
  if (changed) saveState(state);
}

async function checkDailyWechat() {
  const now = new Date();
  if (sendingWechat || !shouldSendDaily(wechatConfig, now)) return;
  sendingWechat = true;
  const today = localDateKey(now);
  if (wechatConfig.attemptDate !== today) {
    wechatConfig.attemptDate = today;
    wechatConfig.attemptCount = 0;
  }
  wechatConfig.attemptCount += 1;
  wechatConfig.lastAttemptAt = now.toISOString();
  saveConfig(wechatConfig);
  try {
    const digest = buildDailyDigest(state, now);
    await sendServerChan(wechatConfig.sendKey, digest.title, digest.desp);
    wechatConfig.lastSentDate = today;
    wechatConfig.lastSentAt = new Date().toISOString();
    wechatConfig.lastError = null;
  } catch (error) {
    wechatConfig.lastError = error.message || '发送失败。';
    console.error(`微信每日提醒发送失败：${wechatConfig.lastError}`);
  } finally {
    saveConfig(wechatConfig);
    sendingWechat = false;
  }
}

async function handle(request, response) {
  if (!/^127\.0\.0\.1(?::\d+)?$/.test(request.headers.host || '')) {
    return json(response, 403, { error: '只接受本机访问。' });
  }
  const origin = request.headers.origin;
  if (origin && origin !== `http://${request.headers.host}`) {
    return json(response, 403, { error: '来源不匹配。' });
  }
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (request.method === 'GET' && url.pathname === '/') return serveFile(response, 'index.html', 'text/html; charset=utf-8');
  if (request.method === 'GET' && url.pathname === '/style.css') return serveFile(response, 'style.css', 'text/css; charset=utf-8');
  if (request.method === 'GET' && url.pathname === '/ui.js') return serveFile(response, 'ui.js', 'text/javascript; charset=utf-8');
  if (request.method === 'GET' && url.pathname === '/api/state') return json(response, 200, publicState());
  if (request.method === 'GET' && url.pathname === '/api/update') return json(response, 200, updater.status());
  if (!url.pathname.startsWith('/api/') || request.method === 'GET') return json(response, 404, { error: '未找到。' });
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') return json(response, 415, { error: '需要 JSON 请求。' });

  try {
    const body = await readBody(request);
    if (request.method === 'POST' && url.pathname === '/api/update/check') {
      return json(response, 200, await updater.check(true));
    }
    if (request.method === 'POST' && url.pathname === '/api/update/install') {
      const result = await updater.install();
      json(response, 200, result);
      setTimeout(() => server.close(() => process.exit(0)), 300);
      return;
    }
    if (request.method === 'PATCH' && url.pathname === '/api/wechat') {
      const next = { ...wechatConfig };
      if (Object.hasOwn(body, 'time')) {
        if (typeof body.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)) throw new Error('请输入有效的每日提醒时间。');
        next.time = body.time;
      }
      if (Object.hasOwn(body, 'sendKey') && String(body.sendKey || '').trim()) next.sendKey = validateSendKey(body.sendKey);
      if (body.clearKey === true) { next.sendKey = ''; next.enabled = false; }
      if (Object.hasOwn(body, 'enabled')) {
        if (typeof body.enabled !== 'boolean') throw new Error('启用状态无效。');
        next.enabled = body.enabled;
      }
      if (next.enabled && !next.sendKey) throw new Error('请先保存 SCT SendKey。');
      wechatConfig = next;
      saveConfig(wechatConfig);
      return json(response, 200, publicState());
    }
    if (request.method === 'POST' && url.pathname === '/api/wechat/test') {
      if (!wechatConfig.sendKey) throw new Error('请先保存 SCT SendKey。');
      if (sendingWechat) throw new Error('正在发送微信提醒，请稍后重试。');
      sendingWechat = true;
      try {
        await sendServerChan(wechatConfig.sendKey, 'UBC作业管理工具测试', '已成功连接个人微信提醒。每日作业汇总会按设置的电脑当地时间发送。');
        wechatConfig.lastTestAt = new Date().toISOString();
        wechatConfig.lastError = null;
        saveConfig(wechatConfig);
        return json(response, 200, { message: '测试消息已发送，请查看微信。', state: publicState() });
      } catch (error) {
        wechatConfig.lastError = error.message || '发送失败。';
        saveConfig(wechatConfig);
        throw error;
      } finally { sendingWechat = false; }
    }
    if (request.method === 'POST' && url.pathname === '/api/course') {
      const parsed = normalizeCourseUrl(body.url);
      if (state.courses.some(item => item.id === parsed.id)) throw new Error('这门课已经添加。');
      state.courses.push({ id: parsed.id, name: parsed.platform === 'webwork' ? `WeBWorK · ${parsed.instanceId}` : `课程 ${parsed.instanceId}`,
        platform: parsed.platform, url: parsed.url, lastSyncedAt: null });
      saveState(state);
      return json(response, 200, publicState());
    }
    if (request.method === 'DELETE' && url.pathname === '/api/course') {
      if (!state.courses.some(item => item.id === body.id)) throw new Error('课程不存在。');
      state.courses = state.courses.filter(item => item.id !== body.id);
      state.tasks = state.tasks.filter(item => item.courseId !== body.id);
      saveState(state);
      return json(response, 200, publicState());
    }
    if (request.method === 'POST' && url.pathname === '/api/open-browser') {
      const course = state.courses.find(item => item.id === body.courseId);
      if (!course) throw new Error('课程不存在。');
      await openCoursePage(course.url);
      return json(response, 200, { message: `Edge 已打开。请登录${coursePlatform(course) === 'webwork' ? ' WeBWorK' : ' PrairieLearn'}，然后回到应用点击“同步”。` });
    }
    if (request.method === 'POST' && url.pathname === '/api/sync') {
      const count = await syncCourse(body.courseId);
      return json(response, 200, { message: `已同步 ${count} 项作业。`, state: publicState() });
    }
    if (request.method === 'POST' && url.pathname === '/api/import-text') {
      const course = state.courses.find(item => item.id === body.courseId);
      if (!course) throw new Error('课程不存在。');
      if (coursePlatform(course) === 'webwork') throw new Error('WeBWorK 请使用登录窗口同步；此处的文字导入仅支持 PrairieLearn。');
      const page = parseCopiedTable(body.text, course);
      if (!page.rows.length) throw new Error('未识别到作业。请从作业表格复制包含 LAB03 等代码的行。');
      const count = mergeRows(state, course.id, page, { removeMissing: false });
      saveState(state);
      return json(response, 200, { message: `已从复制的表格导入 ${count} 项作业。`, state: publicState() });
    }
    if (request.method === 'PATCH' && url.pathname === '/api/task') {
      const task = state.tasks.find(item => item.id === body.id);
      if (!task) throw new Error('作业不存在。');
      if (Object.hasOwn(body, 'doneOverride')) {
        if (![true, false, null].includes(body.doneOverride)) throw new Error('完成状态无效。');
        task.doneOverride = body.doneOverride;
      }
      if (Object.hasOwn(body, 'deadlineOverride')) {
        if (body.deadlineOverride !== null && (!Number.isFinite(Date.parse(body.deadlineOverride)))) {
          throw new Error('日期格式无效。');
        }
        task.deadlineOverride = body.deadlineOverride;
      }
      saveState(state);
      return json(response, 200, publicState());
    }
    if (request.method === 'POST' && url.pathname === '/api/shutdown') {
      json(response, 200, { message: '应用已退出。' });
      setTimeout(() => server.close(() => process.exit(0)), 100);
      return;
    }
    return json(response, 404, { error: '未找到。' });
  } catch (error) {
    return json(response, 400, { error: error.message || '操作失败。' });
  }
}

server = http.createServer((request, response) => {
  handle(request, response).catch(error => json(response, 500, { error: error.message || '服务器错误。' }));
});

const address = 'http://127.0.0.1:43873';
function dashboardWindowArguments() {
  const idealWidth = 1440;
  const idealHeight = 810;
  const args = [`--window-size=${idealWidth},${idealHeight}`];
  try {
    const script = 'Add-Type -AssemblyName System.Windows.Forms; $r = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea; Write-Output "$($r.X),$($r.Y),$($r.Width),$($r.Height)"';
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', windowsHide: true, timeout: 3000,
    });
    const bounds = result.status === 0 ? result.stdout.trim().split(',').map(Number) : [];
    if (bounds.length === 4 && bounds.every(Number.isFinite) && bounds[2] > 0 && bounds[3] > 0) {
      const [x, y, availableWidth, availableHeight] = bounds;
      const scale = Math.min(1, (availableWidth - 24) / idealWidth, (availableHeight - 24) / idealHeight);
      if (scale > 0) {
        const width = Math.floor(idealWidth * scale);
        const height = Math.floor(idealHeight * scale);
        return [`--window-size=${width},${height}`, `--window-position=${Math.floor(x + (availableWidth - width) / 2)},${Math.floor(y + (availableHeight - height) / 2)}`];
      }
    }
  } catch { /* Keep the 16:9 default when screen information is unavailable. */ }
  return args;
}
function openDashboard() {
  if (!process.argv.includes('--no-open')) {
    const browser = spawn(edgePath(), [`--app=${address}`, ...dashboardWindowArguments()], {
      windowsHide: true, stdio: 'ignore', detached: true,
    });
    browser.unref();
  }
}

server.on('error', async error => {
  if (error.code === 'EADDRINUSE') {
    try {
      const response = await fetch(`${address}/api/state`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) { openDashboard(); process.exit(0); }
    } catch {}
    console.error('端口 43873 已被其他程序占用，应用无法启动。');
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});

server.listen(43873, '127.0.0.1', () => {
  console.log(`UBC作业管理工具已启动：${address}`);
  openDashboard();
  updater.check().catch(error => console.error(`更新检查失败：${error.message}`));
});

setInterval(checkReminders, 60_000).unref();
setInterval(() => { checkDailyWechat().catch(error => console.error(`微信提醒检查失败：${error.message}`)); }, 60_000).unref();
setInterval(async () => {
  if (!autoSyncEnabled || syncing) return;
  if (!(await activePort())) return;
  for (const course of state.courses) {
    try { await syncCourse(course.id); } catch (error) { console.error(`自动同步失败：${course.name}: ${error.message}`); }
  }
}, 30 * 60_000).unref();
checkReminders();
checkDailyWechat().catch(error => console.error(`微信提醒检查失败：${error.message}`));
