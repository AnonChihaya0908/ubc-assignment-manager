const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { loadState, saveState, normalizePriority, normalizeCourseUrl, coursePlatform, courseAccessConfirmed, requireCourseAccess,
  reviewCourseAccess, mergeRows, mergeWebworkRows } = require('./lib/store');
const { edgePath, activePort, openCoursePage, hideBrowser, closeBrowser, browserMode, readCoursePage, readWebworkPage } = require('./lib/browser');
const { parseCopiedTable } = require('./lib/paste');
const { loadConfig, saveConfig, publicConfig, validateSendKey, localDateKey,
  shouldSendDaily, buildDailyDigest, sendServerChan, normalizeLeadHours, appendHistory } = require('./lib/wechat');
const { createUpdater, VERSION } = require('./lib/updater');
const { markSyncAttempt, markSyncSuccess, markSyncFailure } = require('./lib/sync-status');
const { startupStatus, setStartupEnabled } = require('./lib/windows-startup');
const { createBackup, validateBackup, writeRestorePoint, applyBackup } = require('./lib/backup');
const { authorizedNativeRequest } = require('./lib/native-auth');
const { pendingReminderEvents } = require('./lib/reminders');
const { localeFor } = require('./public/i18n');
const { loadConfig: loadEmailConfig, saveConfig: saveEmailConfig, publicConfig: publicEmailConfig,
  validateAddress, validateConfig: validateEmailConfig, shouldSend: shouldSendEmail,
  buildDigest: buildEmailDigest, sendSmtp } = require('./lib/email');
const { saveSecret: saveEmailSecret, readSecret: readEmailSecret, deleteSecret: deleteEmailSecret } = require('./lib/email-secret');

let state = loadState();
let wechatConfig = loadConfig();
let emailConfig = loadEmailConfig();
let emailConnected = false;
try { emailConnected = Boolean(readEmailSecret()); }
catch (error) { emailConfig.lastError = error.message; }
const syncingCourseIds = new Set();
let syncAllPromise = null;
let sendingWechat = false;
let sendingEmail = false;
let autoSyncEnabled = state.courses.some(course => courseAccessConfirmed(course) && course.lastSyncedAt);
let server;
let trayProcess = null;
let startup = startupStatus();
const updater = createUpdater();
const nativeToken = process.env.UBC_NATIVE_TOKEN || '';

function taskOptions() {
  return { ...state.preferences, ignoredSectionsByCourse: Object.fromEntries(state.courses.map(course => [course.id, course.ignoredSections || []])) };
}

function sectionKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function publicState() {
  const tasks = state.tasks.map(task => {
    const personal = state.taskPersonal?.[task.id] || {};
    return { ...task, priority: normalizePriority(personal.priority), note: typeof personal.note === 'string' ? personal.note : '' };
  });
  return { version: VERSION, courses: state.courses, tasks, syncing: syncingCourseIds.size > 0,
    syncingCourseIds: [...syncingCourseIds], autoSyncEnabled,
    browserMode: browserMode(),
    preferences: state.preferences, systemLocale: Intl.DateTimeFormat().resolvedOptions().locale, startup, platform: process.platform,
    wechat: publicConfig(wechatConfig), email: publicEmailConfig(emailConfig, emailConnected, wechatConfig.remindersPaused),
    now: new Date().toISOString() };
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

function readBody(request, limit = 65536) {
  return new Promise((resolve, reject) => {
    let data = '';
    request.on('data', chunk => {
      data += chunk;
      if (data.length > limit) {
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
  const course = state.courses.find(item => item.id === courseId);
  if (!course) throw new Error('课程不存在。');
  requireCourseAccess(course);
  if (syncingCourseIds.has(courseId)) throw new Error('这门课程正在同步，请稍等。');
  syncingCourseIds.add(courseId);
  try {
    markSyncAttempt(course);
    saveState(state);
    const webwork = coursePlatform(course) === 'webwork';
    const page = await (webwork ? readWebworkPage(course.url) : readCoursePage(course.url));
    const count = webwork ? mergeWebworkRows(state, courseId, page) : mergeRows(state, courseId, page);
    markSyncSuccess(course);
    saveState(state);
    autoSyncEnabled = true;
    return count;
  } catch (error) {
    markSyncFailure(course, error);
    saveState(state);
    throw error;
  } finally {
    syncingCourseIds.delete(courseId);
  }
}

async function syncAllCourses({ automatic = false } = {}) {
  const results = [];
  for (const course of [...state.courses]) {
    if (!courseAccessConfirmed(course)) {
      results.push({ courseId: course.id, ok: true, skipped: true, count: 0 });
      continue;
    }
    if (automatic && course.lastSyncErrorKind === 'login') {
      results.push({ courseId: course.id, ok: true, skipped: true, needsLogin: true, count: 0 });
      continue;
    }
    try {
      const count = await syncCourse(course.id);
      results.push({ courseId: course.id, ok: true, count });
    } catch (error) {
      results.push({ courseId: course.id, ok: false, error: error.message || '同步失败。' });
    }
  }
  return results;
}

function startAllCoursesSync(options) {
  if (!syncAllPromise) {
    syncAllPromise = syncAllCourses(options).finally(() => { syncAllPromise = null; });
  }
  return syncAllPromise;
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
  if (process.platform !== 'win32') return;
  let changed = false;
  let configChanged = false;
  for (const event of pendingReminderEvents(state, wechatConfig, new Date(), taskOptions())) {
    state.notified[event.key] = new Date().toISOString();
    changed = true;
    notify(event.title, event.message);
    appendHistory(wechatConfig, { type: 'windows', result: 'shown', detail: event.title });
    configChanged = true;
  }
  if (changed) saveState(state);
  if (configChanged) saveConfig(wechatConfig);
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
    if (browserMode() === 'background' && await activePort()) await startAllCoursesSync({ automatic: true });
    const confirmedIds = new Set(state.courses.filter(courseAccessConfirmed).map(course => course.id));
    const digest = buildDailyDigest({ ...state, courses: state.courses.filter(courseAccessConfirmed),
      tasks: state.tasks.filter(task => confirmedIds.has(task.courseId)) }, now, wechatConfig);
    await sendServerChan(wechatConfig.sendKey, digest.title, digest.desp);
    wechatConfig.lastSentDate = today;
    wechatConfig.lastSentAt = new Date().toISOString();
    wechatConfig.lastError = null;
    appendHistory(wechatConfig, { type: 'daily', result: 'accepted', detail: `${wechatConfig.attemptCount > 1 ? `第 ${wechatConfig.attemptCount} 次重试后，` : ''}Server酱已接受每日汇总（${digest.count} 项）` });
  } catch (error) {
    wechatConfig.lastError = error.message || '发送失败。';
    const retry = wechatConfig.attemptCount < 3 ? '，30 分钟后可重试' : '，今日不再自动重试';
    appendHistory(wechatConfig, { type: 'daily', result: 'failed', detail: `第 ${wechatConfig.attemptCount} 次尝试失败${retry}：${wechatConfig.lastError}` });
    console.error(`微信每日提醒发送失败：${wechatConfig.lastError}`);
  } finally {
    saveConfig(wechatConfig);
    sendingWechat = false;
  }
}

async function checkDailyEmail() {
  const now = new Date();
  if (sendingEmail || !shouldSendEmail(emailConfig, now, {
    connected: emailConnected, paused: wechatConfig.remindersPaused, quiet: wechatConfig,
  })) return;
  sendingEmail = true;
  const today = localDateKey(now);
  if (emailConfig.attemptDate !== today) { emailConfig.attemptDate = today; emailConfig.attemptCount = 0; }
  emailConfig.attemptCount += 1;
  emailConfig.lastAttemptAt = now.toISOString();
  try {
    saveEmailConfig(emailConfig);
    const password = readEmailSecret();
    if (!password) { emailConnected = false; throw new Error('发件账户已断开，请重新连接。'); }
    const digest = buildEmailDigest(state, emailConfig, now);
    await sendSmtp({ from: emailConfig.from, to: emailConfig.to, password,
      subject: digest.subject, text: digest.text });
    emailConfig.lastSentDate = today;
    emailConfig.lastSentAt = new Date().toISOString();
    emailConfig.lastError = null;
  } catch (error) {
    emailConfig.lastError = error.message || '邮件发送失败，请稍后重试。';
    console.error(`每日邮件提醒失败：${emailConfig.lastError}`);
  } finally {
    try { saveEmailConfig(emailConfig); }
    finally { sendingEmail = false; }
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
  if (nativeToken && url.pathname.startsWith('/api/')) {
    if (!authorizedNativeRequest(nativeToken, request.headers['x-ubc-native-token'])) {
      return json(response, 403, { error: '需要从应用窗口访问。' });
    }
  }
  if (request.method === 'GET' && url.pathname === '/') return serveFile(response, 'index.html', 'text/html; charset=utf-8');
  if (request.method === 'GET' && url.pathname === '/style.css') return serveFile(response, 'style.css', 'text/css; charset=utf-8');
  if (request.method === 'GET' && url.pathname === '/task-status.js') return serveFile(response, 'task-status.js', 'text/javascript; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/dialogs.js') return serveFile(response, 'dialogs.js', 'text/javascript; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/i18n.js') return serveFile(response, 'i18n.js', 'text/javascript; charset=utf-8');
  if (request.method === 'GET' && url.pathname === '/ui.js') return serveFile(response, 'ui.js', 'text/javascript; charset=utf-8');
  if (request.method === 'GET' && url.pathname === '/api/state') return json(response, 200, publicState());
  if (request.method === 'GET' && url.pathname === '/api/update') return json(response, 200, updater.status());
  if (request.method === 'GET' && url.pathname === '/api/native/reminders' && nativeToken && process.platform === 'darwin') {
    return json(response, 200, { events: pendingReminderEvents(state, wechatConfig, new Date(), taskOptions()) });
  }
  if (!url.pathname.startsWith('/api/') || request.method === 'GET') return json(response, 404, { error: '未找到。' });
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') return json(response, 415, { error: '需要 JSON 请求。' });

  try {
    const body = await readBody(request, url.pathname === '/api/backup/import' ? 5 * 1024 * 1024 : 65536);
    if (request.method === 'POST' && url.pathname === '/api/native/reminders/ack' && nativeToken && process.platform === 'darwin') {
      const event = typeof body.key === 'string' && body.key.length <= 400 &&
        pendingReminderEvents(state, wechatConfig, new Date(), taskOptions()).find(item => item.key === body.key);
      if (!event) {
        throw new Error('提醒项目已过期或无效。');
      }
      state.notified[body.key] = new Date().toISOString();
      saveState(state);
      appendHistory(wechatConfig, { type: 'macos', result: 'shown', detail: event.title });
      saveConfig(wechatConfig);
      return json(response, 200, { message: '提醒已记录。' });
    }
    if (request.method === 'POST' && url.pathname === '/api/update/check') {
      return json(response, 200, await updater.check(true));
    }
    if (request.method === 'POST' && url.pathname === '/api/update/install') {
      const result = await updater.install();
      json(response, 200, result);
      setTimeout(async () => { await closeBrowser().catch(() => {}); if (trayProcess) trayProcess.kill(); server.close(() => process.exit(0)); }, 300);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/backup/export') {
      return json(response, 200, createBackup(state, wechatConfig));
    }
    if (request.method === 'POST' && url.pathname === '/api/backup/import') {
      const validated = validateBackup(body.backup);
      writeRestorePoint(state, wechatConfig);
      const imported = applyBackup(validated, wechatConfig);
      const previousState = state, previousConfig = wechatConfig;
      try {
        saveConfig(imported.config);
        saveState(imported.state);
      } catch (error) {
        try { saveConfig(previousConfig); saveState(previousState); } catch { }
        throw error;
      }
      state = imported.state;
      wechatConfig = imported.config;
      autoSyncEnabled = false;
      return json(response, 200, {
        message: `已恢复 ${validated.summary.courses} 门课程和 ${validated.summary.tasks} 项作业。请重新登录课程${validated.reminders.dailyWasEnabled ? '并重新启用每日微信汇总' : ''}。`,
        restorePointCreated: true, state: publicState(),
      });
    }
    if (request.method === 'PATCH' && url.pathname === '/api/startup') {
      startup = setStartupEnabled(body.enabled);
      return json(response, 200, publicState());
    }
    if (request.method === 'PATCH' && url.pathname === '/api/reminders') {
      let changed = false;
      if (Object.hasOwn(body, 'paused')) {
        if (typeof body.paused !== 'boolean') throw new Error('提醒暂停状态无效。');
        wechatConfig.remindersPaused = body.paused;
        changed = true;
      }
      if (Object.hasOwn(body, 'leadHours')) {
        if (!Array.isArray(body.leadHours) || body.leadHours.some(value => !Number.isFinite(Number(value)) || Number(value) < 0.25 || Number(value) > 336)) throw new Error('提前提醒时间应为 0.25 到 336 小时。');
        wechatConfig.leadHours = normalizeLeadHours(body.leadHours);
        changed = true;
      }
      for (const field of ['quietStart', 'quietEnd']) {
        if (Object.hasOwn(body, field)) {
          if (typeof body[field] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body[field])) throw new Error('免打扰时间无效。');
          wechatConfig[field] = body[field];
          changed = true;
        }
      }
      if (Object.hasOwn(body, 'quietEnabled')) {
        if (typeof body.quietEnabled !== 'boolean') throw new Error('免打扰设置无效。');
        wechatConfig.quietEnabled = body.quietEnabled;
        changed = true;
      }
      if (Object.hasOwn(body, 'courseId')) {
        if (!state.courses.some(course => course.id === body.courseId) || typeof body.enabled !== 'boolean') throw new Error('课程提醒设置无效。');
        const disabled = new Set(wechatConfig.disabledCourseIds || []);
        if (body.enabled) disabled.delete(body.courseId); else disabled.add(body.courseId);
        wechatConfig.disabledCourseIds = [...disabled];
        changed = true;
      }
      if (!changed) throw new Error('没有可保存的提醒设置。');
      saveConfig(wechatConfig);
      return json(response, 200, publicState());
    }
    if (request.method === 'PATCH' && url.pathname === '/api/preferences') {
      let changed = false;
      if (Object.hasOwn(body, 'language')) {
        if (!['auto', 'zh-CN', 'en-US'].includes(body.language)) throw new Error('语言设置无效。');
        state.preferences.language = body.language;
        changed = true;
      }
      if (Object.hasOwn(body, 'requireManualCompletion')) {
        if (typeof body.requireManualCompletion !== 'boolean') throw new Error('完成确认设置无效。');
        state.preferences.requireManualCompletion = body.requireManualCompletion;
        changed = true;
      }
      if (Object.hasOwn(body, 'onboardingDismissed')) {
        if (typeof body.onboardingDismissed !== 'boolean') throw new Error('首次使用引导状态无效。');
        state.preferences.onboardingDismissed = body.onboardingDismissed;
        changed = true;
      }
      if (!changed) throw new Error('没有可保存的设置。');
      saveState(state);
      return json(response, 200, publicState());
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
      if (Object.hasOwn(body, 'includeNotes')) {
        if (typeof body.includeNotes !== 'boolean') throw new Error('微信备注设置无效。');
        next.includeNotes = body.includeNotes;
      }
      if (next.enabled && !next.sendKey) throw new Error('请先保存 SCT SendKey。');
      wechatConfig = next;
      saveConfig(wechatConfig);
      return json(response, 200, publicState());
    }
    if (request.method === 'POST' && url.pathname === '/api/email/connect') {
      const from = validateAddress(body.from);
      if (!from.toLowerCase().endsWith('@gmail.com')) throw new Error('目前仅支持 Gmail 发件账户。');
      saveEmailSecret(body.password);
      emailConnected = true;
      emailConfig.from = from;
      emailConfig.enabled = false;
      emailConfig.lastTestAt = null;
      emailConfig.lastError = null;
      saveEmailConfig(emailConfig);
      return json(response, 200, { message: 'Gmail 发件账户已连接，请发送测试邮件确认。', state: publicState() });
    }
    if (request.method === 'POST' && url.pathname === '/api/email/disconnect') {
      deleteEmailSecret();
      emailConnected = false;
      emailConfig.enabled = false;
      emailConfig.lastTestAt = null;
      emailConfig.lastError = null;
      saveEmailConfig(emailConfig);
      return json(response, 200, { message: '发件账户已断开，本机授权已删除。', state: publicState() });
    }
    if (request.method === 'PATCH' && url.pathname === '/api/email') {
      if (Object.keys(body).some(key => !['from', 'to', 'time', 'scope', 'enabled'].includes(key))) throw new Error('邮件设置包含无效字段。');
      const next = validateEmailConfig({ ...emailConfig, ...body });
      if (next.from.toLowerCase() !== emailConfig.from.toLowerCase()) throw new Error('请先重新连接新的 Gmail 发件账户。');
      if (typeof next.enabled !== 'boolean') throw new Error('邮件启用状态无效。');
      if (next.enabled && (!emailConnected || !emailConfig.lastTestAt)) throw new Error('请先连接发件账户并发送测试邮件。');
      if (next.to !== emailConfig.to) next.lastTestAt = null;
      if (next.enabled && !next.lastTestAt) throw new Error('收件地址已变更，请先发送测试邮件。');
      if (next.enabled && !emailConfig.enabled) next.startDate = localDateKey();
      emailConfig = next;
      saveEmailConfig(emailConfig);
      return json(response, 200, publicState());
    }
    if (request.method === 'POST' && url.pathname === '/api/email/test') {
      if (sendingEmail) throw new Error('邮件正在发送，请稍后重试。');
      if (!emailConnected) throw new Error('请先连接 Gmail 发件账户。');
      const next = validateEmailConfig({ ...emailConfig, to: body.to || emailConfig.to });
      sendingEmail = true;
      try {
        const english = localeFor(state.preferences.language) === 'en-US';
        await sendSmtp({ from: next.from, to: next.to, password: readEmailSecret(),
          subject: english ? 'UBC Assignment Manager email test' : 'UBC作业管理工具邮件测试',
          text: english ? 'Email reminders are connected. Daily messages use your device local time.' : '邮件提醒已连接。每日邮件按设备当地时间发送。' });
        emailConfig.to = next.to;
        emailConfig.lastTestAt = new Date().toISOString();
        emailConfig.lastError = null;
        saveEmailConfig(emailConfig);
        return json(response, 200, { message: '测试邮件已发送，请在收件箱中确认。', state: publicState() });
      } catch (error) {
        emailConfig.lastError = error.message || '测试邮件发送失败。';
        saveEmailConfig(emailConfig);
        throw error;
      } finally { sendingEmail = false; }
    }
    if (request.method === 'POST' && url.pathname === '/api/wechat/test') {
      if (!wechatConfig.sendKey) throw new Error('请先保存 SCT SendKey。');
      if (sendingWechat) throw new Error('正在发送微信提醒，请稍后重试。');
      sendingWechat = true;
      try {
        const english = localeFor(state.preferences.language) === 'en-US';
        await sendServerChan(wechatConfig.sendKey,
          english ? 'UBC Assignment Manager test' : 'UBC作业管理工具测试',
          english ? 'Your personal WeChat reminders are connected. Daily assignment digests will use your device local time.'
            : '已成功连接个人微信提醒。每日作业汇总会按设置的电脑当地时间发送。');
        wechatConfig.lastTestAt = new Date().toISOString();
        wechatConfig.lastError = null;
        appendHistory(wechatConfig, { type: 'test', result: 'accepted', detail: 'Server酱已接受测试消息，请在微信中确认实际接收。' });
        saveConfig(wechatConfig);
        return json(response, 200, { message: 'Server酱已接受测试消息，请在微信中确认实际接收。', state: publicState() });
      } catch (error) {
        wechatConfig.lastError = error.message || '发送失败。';
        appendHistory(wechatConfig, { type: 'test', result: 'failed', detail: wechatConfig.lastError });
        saveConfig(wechatConfig);
        throw error;
      } finally { sendingWechat = false; }
    }
    if (request.method === 'POST' && url.pathname === '/api/course') {
      const parsed = normalizeCourseUrl(body.url);
      if (state.courses.some(item => item.id === parsed.id)) throw new Error('这门课已经添加。');
      state.courses.push({ id: parsed.id, name: parsed.platform === 'webwork' ? `WeBWorK · ${parsed.instanceId}` : `课程 ${parsed.instanceId}`,
        platform: parsed.platform, url: parsed.url, lastSyncedAt: null, lastSyncAttemptAt: null,
        lastSyncError: null, lastSyncErrorKind: null, ignoredSections: [], origin: 'user_added', accessConfirmedAt: new Date().toISOString() });
      saveState(state);
      return json(response, 200, publicState());
    }
    if (request.method === 'POST' && url.pathname === '/api/course/access-review') {
      const result = reviewCourseAccess(state, body.confirmedIds);
      saveState(state);
      const activeCourseIds = new Set(state.courses.map(course => course.id));
      const disabledCourseIds = (wechatConfig.disabledCourseIds || []).filter(id => activeCourseIds.has(id));
      if (disabledCourseIds.length !== (wechatConfig.disabledCourseIds || []).length) {
        wechatConfig.disabledCourseIds = disabledCourseIds;
        saveConfig(wechatConfig);
      }
      autoSyncEnabled = state.courses.some(course => courseAccessConfirmed(course) && course.lastSyncedAt);
      return json(response, 200, { message: `已确认 ${result.kept} 门课程，移除 ${result.removed} 门未选择课程。`, state: publicState() });
    }
    if (request.method === 'DELETE' && url.pathname === '/api/course') {
      if (!state.courses.some(item => item.id === body.id)) throw new Error('课程不存在。');
      const removedTaskIds = state.tasks.filter(item => item.courseId === body.id).map(item => item.id);
      state.courses = state.courses.filter(item => item.id !== body.id);
      state.tasks = state.tasks.filter(item => item.courseId !== body.id);
      state.taskPersonal ||= {};
      for (const [id, personal] of Object.entries(state.taskPersonal)) {
        if (removedTaskIds.includes(id) || personal?.courseId === body.id) delete state.taskPersonal[id];
      }
      saveState(state);
      return json(response, 200, publicState());
    }
    if (request.method === 'PATCH' && url.pathname === '/api/course/category') {
      const course = state.courses.find(item => item.id === body.courseId);
      if (!course || typeof body.section !== 'string' || !body.section.trim() || body.section.length > 200 || typeof body.ignored !== 'boolean') {
        throw new Error('课程类别设置无效。');
      }
      const section = body.section.trim().replace(/\s+/g, ' ');
      const key = sectionKey(section);
      const sectionExists = state.tasks.some(task => task.courseId === course.id && sectionKey(task.section) === key);
      const ruleExists = (course.ignoredSections || []).some(value => sectionKey(value) === key);
      if (!sectionExists && (body.ignored || !ruleExists)) {
        throw new Error('这门课程中没有找到该类别。');
      }
      const ignored = new Map((course.ignoredSections || []).map(value => [sectionKey(value), value]));
      if (body.ignored) ignored.set(key, section); else ignored.delete(key);
      course.ignoredSections = [...ignored.values()];
      saveState(state);
      return json(response, 200, publicState());
    }
    if (request.method === 'POST' && url.pathname === '/api/open-browser') {
      const course = state.courses.find(item => item.id === body.courseId);
      if (!course) throw new Error('课程不存在。');
      requireCourseAccess(course);
      if (syncingCourseIds.size) throw new Error('请等待课程同步完成后再打开登录窗口。');
      await openCoursePage(course.url);
      return json(response, 200, { message: `Edge 已打开。请登录${coursePlatform(course) === 'webwork' ? ' WeBWorK' : ' PrairieLearn'}，然后回到应用点击“同步”。`, state: publicState() });
    }
    if (request.method === 'POST' && url.pathname === '/api/browser/hide') {
      const course = state.courses.find(item => item.id === body.courseId);
      if (!course) throw new Error('课程不存在。');
      requireCourseAccess(course);
      if (syncingCourseIds.size) throw new Error('请等待课程同步完成后再隐藏登录窗口。');
      await hideBrowser(course.url);
      return json(response, 200, { message: '登录窗口已隐藏，后台同步可继续。', state: publicState() });
    }
    if (request.method === 'POST' && url.pathname === '/api/sync') {
      const count = await syncCourse(body.courseId);
      return json(response, 200, { message: `已同步 ${count} 项作业。`, state: publicState() });
    }
    if (request.method === 'POST' && url.pathname === '/api/sync-all') {
      const results = await startAllCoursesSync();
      return json(response, 200, { results, state: publicState() });
    }
    if (request.method === 'POST' && url.pathname === '/api/sync-all/start') {
      const alreadyRunning = Boolean(syncAllPromise);
      startAllCoursesSync().catch(error => console.error(`同步失败：${error.message}`));
      return json(response, 202, { message: alreadyRunning ? '同步已在进行。' : '已开始同步课程。', state: publicState() });
    }
    if (request.method === 'POST' && url.pathname === '/api/window/open') {
      openDashboard(true);
      return json(response, 200, { message: '主窗口已打开。' });
    }
    if (request.method === 'POST' && url.pathname === '/api/import-text') {
      const course = state.courses.find(item => item.id === body.courseId);
      if (!course) throw new Error('课程不存在。');
      requireCourseAccess(course);
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
      if (Object.hasOwn(body, 'priority')) {
        if (body.priority !== null && normalizePriority(body.priority) !== body.priority) throw new Error('作业优先级无效。');
      }
      if (Object.hasOwn(body, 'note')) {
        if (typeof body.note !== 'string' || body.note.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body.note)) throw new Error('个人备注无效。');
      }
      if (Object.hasOwn(body, 'priority') || Object.hasOwn(body, 'note')) {
        state.taskPersonal ||= {};
        const existing = state.taskPersonal[task.id] || {};
        const personal = {
          courseId: task.courseId,
          priority: Object.hasOwn(body, 'priority') ? normalizePriority(body.priority) : normalizePriority(existing.priority),
          note: Object.hasOwn(body, 'note') ? body.note.trim() : typeof existing.note === 'string' ? existing.note : '',
        };
        if (personal.priority || personal.note) state.taskPersonal[task.id] = personal;
        else delete state.taskPersonal[task.id];
      }
      saveState(state);
      return json(response, 200, publicState());
    }
    if (request.method === 'POST' && url.pathname === '/api/shutdown') {
      json(response, 200, { message: '应用已退出。' });
      setTimeout(async () => { await closeBrowser().catch(() => {}); if (trayProcess) trayProcess.kill(); server.close(() => process.exit(0)); }, 100);
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
function openDashboard(force = false) {
  // The macOS host owns the app window; its bundled server runs with --no-open.
  if (process.platform === 'darwin') return;
  if (force || !process.argv.includes('--no-open')) {
    // Keep Edge visible and independent of the short-lived duplicate launcher.
    const browser = spawn(edgePath(), ['--no-first-run', '--no-default-browser-check', `--app=${address}`, ...dashboardWindowArguments()], {
      windowsHide: false, stdio: 'ignore', detached: true,
    });
    browser.on('error', error => console.error(`无法打开应用窗口：${error.message}`));
    browser.unref();
  }
}

function startTray() {
  if (process.platform !== 'win32' || process.argv.includes('--no-tray') || trayProcess) return;
  trayProcess = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-STA',
    '-File', path.join(__dirname, 'tray.ps1'), '-Port', '43873',
  ], { windowsHide: true, stdio: 'ignore' });
  trayProcess.on('error', error => console.error(`系统托盘启动失败：${error.message}`));
  trayProcess.on('exit', () => { trayProcess = null; });
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
  startup = startupStatus();
  startTray();
  openDashboard();
  const firstCourse = state.courses.find(course => courseAccessConfirmed(course) && course.lastSyncedAt);
  if (firstCourse) hideBrowser(firstCourse.url).catch(error => console.error(`后台浏览器启动失败：${error.message}`));
  updater.check().catch(error => console.error(`更新检查失败：${error.message}`));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    closeBrowser().catch(error => console.error(`关闭专用浏览器失败：${error.message}`))
      .finally(() => process.exit(0));
  });
}

setInterval(checkReminders, 60_000).unref();
setInterval(() => { checkDailyWechat().catch(error => console.error(`微信提醒检查失败：${error.message}`)); }, 60_000).unref();
setInterval(() => { checkDailyEmail().catch(error => console.error(`邮件提醒检查失败：${error.message}`)); }, 60_000).unref();
setInterval(async () => {
  if (!autoSyncEnabled || syncingCourseIds.size) return;
  if (browserMode() === 'visible' && await activePort()) return;
  const course = state.courses.find(item => courseAccessConfirmed(item) && item.lastSyncErrorKind !== 'login');
  if (!course) return;
  try { await hideBrowser(course.url); }
  catch (error) { console.error(`后台浏览器恢复失败：${error.message}`); return; }
  const results = await startAllCoursesSync({ automatic: true });
  for (const result of results.filter(item => !item.ok)) {
    const course = state.courses.find(item => item.id === result.courseId);
    console.error(`自动同步失败：${course?.name || result.courseId}: ${result.error}`);
  }
}, 30 * 60_000).unref();
checkReminders();
checkDailyWechat().catch(error => console.error(`微信提醒检查失败：${error.message}`));
checkDailyEmail().catch(error => console.error(`邮件提醒检查失败：${error.message}`));
