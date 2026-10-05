const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { loadState, saveState, normalizePriority, normalizeCourseUrl, coursePlatform, courseAccessConfirmed, requireCourseAccess,
  reviewCourseAccess, mergeRows, mergeWebworkRows } = require('./lib/store');
const { effectiveDue, categoryOf } = require('./lib/deadlines');
const { edgePath, activePort, openCoursePage, readCoursePage, readWebworkPage } = require('./lib/browser');
const { parseCopiedTable } = require('./lib/paste');
const { loadConfig, saveConfig, publicConfig, validateSendKey, localDateKey,
  shouldSendDaily, buildDailyDigest, sendServerChan, normalizeLeadHours, inQuietHours, appendHistory } = require('./lib/wechat');
const { createUpdater, VERSION } = require('./lib/updater');
const { markSyncAttempt, markSyncSuccess, markSyncFailure } = require('./lib/sync-status');
const { startupStatus, setStartupEnabled } = require('./lib/windows-startup');
const { createBackup, validateBackup, writeRestorePoint, applyBackup } = require('./lib/backup');
const { authorizedNativeRequest } = require('./lib/native-auth');

let state = loadState();
let wechatConfig = loadConfig();
const syncingCourseIds = new Set();
let syncAllPromise = null;
let sendingWechat = false;
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
    preferences: state.preferences, startup, platform: process.platform,
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

async function syncAllCourses() {
  const results = [];
  for (const course of [...state.courses]) {
    if (!courseAccessConfirmed(course)) {
      results.push({ courseId: course.id, ok: true, skipped: true, count: 0 });
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

function startAllCoursesSync() {
  if (!syncAllPromise) {
    syncAllPromise = syncAllCourses().finally(() => { syncAllPromise = null; });
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
  // macOS notification delivery is implemented by the native host in issue #63.
  // Do not mark reminders as sent while there is no macOS delivery channel.
  if (process.platform !== 'win32') return;
  if (wechatConfig.remindersPaused || inQuietHours(wechatConfig)) return;
  const now = Date.now();
  let changed = false;
  let configChanged = false;
  const disabledCourses = new Set(wechatConfig.disabledCourseIds || []);
  for (const course of state.courses) if (!courseAccessConfirmed(course)) disabledCourses.add(course.id);
  const options = taskOptions();
  for (const task of state.tasks) {
    if (disabledCourses.has(task.courseId)) continue;
    if (categoryOf(task, now, options) !== 'pending' || task.deadlineKind === 'credit_window' && !task.deadlineOverride) continue;
    const due = effectiveDue(task);
    if (!due) continue;
    const remaining = new Date(due).getTime() - now;
    if (!(remaining > 0)) continue;
    for (const hours of normalizeLeadHours(wechatConfig.leadHours)) {
      const key = `${hours}h`, ms = hours * 3600000, label = `${hours} 小时内截止`;
      if (remaining > ms) continue;
      const notificationKey = `${task.id}:${due}:${key}`;
      if (state.notified[notificationKey]) continue;
      state.notified[notificationKey] = new Date().toISOString();
      changed = true;
      notify(`${task.name} · ${label}`, `${task.code || task.section || '作业'} · ${new Date(due).toLocaleString('zh-CN')}`);
      appendHistory(wechatConfig, { type: 'windows', result: 'shown', detail: `${task.name} · ${label}` });
      configChanged = true;
    }
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
    if (await activePort()) await startAllCoursesSync();
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
  if (request.method === 'GET' && url.pathname === '/ui.js') return serveFile(response, 'ui.js', 'text/javascript; charset=utf-8');
  if (request.method === 'GET' && url.pathname === '/api/state') return json(response, 200, publicState());
  if (request.method === 'GET' && url.pathname === '/api/update') return json(response, 200, updater.status());
  if (!url.pathname.startsWith('/api/') || request.method === 'GET') return json(response, 404, { error: '未找到。' });
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') return json(response, 415, { error: '需要 JSON 请求。' });

  try {
    const body = await readBody(request, url.pathname === '/api/backup/import' ? 5 * 1024 * 1024 : 65536);
    if (request.method === 'POST' && url.pathname === '/api/update/check') {
      return json(response, 200, await updater.check(true));
    }
    if (request.method === 'POST' && url.pathname === '/api/update/install') {
      const result = await updater.install();
      json(response, 200, result);
      setTimeout(() => { if (trayProcess) trayProcess.kill(); server.close(() => process.exit(0)); }, 300);
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
    if (request.method === 'POST' && url.pathname === '/api/wechat/test') {
      if (!wechatConfig.sendKey) throw new Error('请先保存 SCT SendKey。');
      if (sendingWechat) throw new Error('正在发送微信提醒，请稍后重试。');
      sendingWechat = true;
      try {
        await sendServerChan(wechatConfig.sendKey, 'UBC作业管理工具测试', '已成功连接个人微信提醒。每日作业汇总会按设置的电脑当地时间发送。');
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
      await openCoursePage(course.url);
      return json(response, 200, { message: `Edge 已打开。请登录${coursePlatform(course) === 'webwork' ? ' WeBWorK' : ' PrairieLearn'}，然后回到应用点击“同步”。` });
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
      setTimeout(() => { if (trayProcess) trayProcess.kill(); server.close(() => process.exit(0)); }, 100);
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
  updater.check().catch(error => console.error(`更新检查失败：${error.message}`));
});

setInterval(checkReminders, 60_000).unref();
setInterval(() => { checkDailyWechat().catch(error => console.error(`微信提醒检查失败：${error.message}`)); }, 60_000).unref();
setInterval(async () => {
  if (!autoSyncEnabled || syncingCourseIds.size) return;
  if (!(await activePort())) return;
  const results = await startAllCoursesSync();
  for (const result of results.filter(item => !item.ok)) {
    const course = state.courses.find(item => item.id === result.courseId);
    console.error(`自动同步失败：${course?.name || result.courseId}: ${result.error}`);
  }
}, 30 * 60_000).unref();
checkReminders();
checkDailyWechat().catch(error => console.error(`微信提醒检查失败：${error.message}`));
