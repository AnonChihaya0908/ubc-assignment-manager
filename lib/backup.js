const fs = require('node:fs');
const path = require('node:path');
const { normalizeCourseUrl, defaultPreferences } = require('./store');
const { emptyConfig, normalizeLeadHours } = require('./wechat');
const { dataDir } = require('./paths');

const FORMAT = 'ubc-assignment-manager-backup';
const FORMAT_VERSION = 1;

function stripPersonalQuery(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password ||
      !(/^(?:[a-z0-9-]+\.)?prairielearn\.com$/i.test(url.hostname) || url.hostname.toLowerCase() === 'webwork.elearning.ubc.ca')) {
    throw new Error('备份包含不受支持的网址。');
  }
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.href;
}

function plainText(value, name, max = 300) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${name}无效。`);
  return value;
}

function nullableDate(value, name) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${name}无效。`);
  return new Date(value).toISOString();
}

function createBackup(state, config, now = new Date()) {
  const courses = state.courses.map(course => ({
    id: course.id,
    name: String(course.name || '').slice(0, 200),
    platform: course.platform,
    url: stripPersonalQuery(course.url),
    ignoredSections: Array.isArray(course.ignoredSections) ? course.ignoredSections : [],
  }));
  const tasks = state.tasks.map(task => {
    const personal = state.taskPersonal?.[task.id] || task;
    return {
      id: task.id, courseId: task.courseId, name: task.name, code: task.code || '', section: task.section || '',
      url: task.url ? stripPersonalQuery(task.url) : '', creditText: task.creditText || '', score: task.score || '',
      dueAt: task.dueAt || null, opensAt: task.opensAt || null, creditPercent: task.creditPercent ?? null,
      deadlineKind: task.deadlineKind || null, sourceStatus: task.sourceStatus || null,
      sourceComplete: task.sourceComplete ?? null, problemCount: task.problemCount ?? null,
      completedProblemCount: task.completedProblemCount ?? null, seenAt: task.seenAt || null,
      doneOverride: task.doneOverride ?? null, deadlineOverride: task.deadlineOverride || null,
      priority: personal.priority || null, note: personal.note || '',
    };
  });
  const courseIds = new Set(courses.map(course => course.id));
  const taskPersonal = Object.entries(state.taskPersonal || {}).flatMap(([id, personal]) => {
    if (!personal || !courseIds.has(personal.courseId) || !(personal.priority || personal.note)) return [];
    return [{ id, courseId: personal.courseId, priority: personal.priority || null, note: personal.note || '' }];
  });
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    exportedAt: now.toISOString(),
    scope: {
      courses: courses.length, tasks: tasks.length,
      includes: ['课程', '缓存作业', '手动完成状态', '手动提醒日期', '作业优先级', '个人备注', '忽略类别', '普通设置'],
      excludes: ['Server酱 SendKey', 'Cookie', 'Edge 登录资料', '发送记录', '个人网址查询参数'],
      conflictPolicy: '导入时替换当前课程和作业；导入前自动保存本机恢复点。',
    },
    data: {
      courses, tasks, taskPersonal,
      preferences: {
        requireManualCompletion: Boolean(state.preferences?.requireManualCompletion),
        onboardingDismissed: Boolean(state.preferences?.onboardingDismissed),
      },
      reminders: {
        remindersPaused: Boolean(config.remindersPaused),
        leadHours: normalizeLeadHours(config.leadHours),
        quietEnabled: Boolean(config.quietEnabled), quietStart: config.quietStart, quietEnd: config.quietEnd,
        includeNotes: Boolean(config.includeNotes),
        disabledCourseIds: Array.isArray(config.disabledCourseIds) ? config.disabledCourseIds : [],
        dailyEnabled: Boolean(config.enabled), time: config.time,
      },
    },
  };
}

function validateBackup(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) throw new Error('备份文件不是有效对象。');
  if (backup.format !== FORMAT || backup.formatVersion !== FORMAT_VERSION) throw new Error('备份格式或版本不受支持。');
  const data = backup.data;
  if (!data || typeof data !== 'object' || !Array.isArray(data.courses) || !Array.isArray(data.tasks)) throw new Error('备份缺少课程或作业数据。');
  if (data.courses.length > 200 || data.tasks.length > 20000) throw new Error('备份内容超出允许范围。');
  const courses = data.courses.map((course, index) => {
    if (!course || typeof course !== 'object') throw new Error(`第 ${index + 1} 门课程无效。`);
    const url = stripPersonalQuery(plainText(course.url, '课程网址', 2000));
    const parsed = normalizeCourseUrl(url);
    if (plainText(course.id, '课程编号', 300) !== parsed.id) throw new Error('课程编号与网址不一致。');
    const ignoredSections = Array.isArray(course.ignoredSections)
      ? [...new Set(course.ignoredSections.map(value => plainText(value, '忽略类别', 200).trim()).filter(Boolean))].slice(0, 100) : [];
    return { id: parsed.id, name: plainText(course.name, '课程名称', 200), platform: parsed.platform, url, ignoredSections,
      lastSyncedAt: null, lastSyncAttemptAt: null, lastSyncError: null, lastSyncErrorKind: null,
      origin: 'backup', accessConfirmedAt: null };
  });
  const courseIds = new Set(courses.map(course => course.id));
  if (courseIds.size !== courses.length) throw new Error('备份包含重复课程。');
  const tasks = data.tasks.map((task, index) => {
    if (!task || typeof task !== 'object') throw new Error(`第 ${index + 1} 项作业无效。`);
    const courseId = plainText(task.courseId, '作业课程编号', 300);
    if (!courseIds.has(courseId)) throw new Error('作业引用了不存在的课程。');
    const id = plainText(task.id, '作业编号', 100);
    if (!/^[a-f0-9]{16,64}$/i.test(id)) throw new Error('作业编号无效。');
    if (![true, false, null, undefined].includes(task.doneOverride)) throw new Error('手动完成状态无效。');
    const sourceComplete = [true, false, null, undefined].includes(task.sourceComplete) ? task.sourceComplete ?? null : (() => { throw new Error('网站完成状态无效。'); })();
    const creditPercent = task.creditPercent === null || task.creditPercent === undefined ? null : Number(task.creditPercent);
    if (creditPercent !== null && (!Number.isFinite(creditPercent) || creditPercent < 0 || creditPercent > 100)) throw new Error('得分比例无效。');
    const deadlineKind = task.deadlineKind || null;
    if (![null, 'on_time', 'credit_window'].includes(deadlineKind)) throw new Error('截止类型无效。');
    const sourceStatus = task.sourceStatus || null;
    if (![null, 'open', 'future', 'past_due'].includes(sourceStatus)) throw new Error('作业来源状态无效。');
    const problemCount = Number.isInteger(task.problemCount) && task.problemCount >= 0 ? task.problemCount : null;
    const completedProblemCount = Number.isInteger(task.completedProblemCount) && task.completedProblemCount >= 0 ? task.completedProblemCount : null;
    const priority = task.priority === null || task.priority === undefined ? null : plainText(task.priority, '作业优先级', 20);
    if (![null, 'high', 'medium', 'low'].includes(priority)) throw new Error('作业优先级无效。');
    return {
      id, courseId, name: plainText(task.name, '作业名称', 300), code: plainText(task.code || '', '作业代码', 100),
      section: plainText(task.section || '', '作业分组', 200), url: task.url ? stripPersonalQuery(plainText(task.url, '作业网址', 2000)) : '',
      creditText: plainText(task.creditText || '', '得分说明', 500), score: plainText(task.score || '', '成绩', 100),
      dueAt: nullableDate(task.dueAt, '截止时间'), opensAt: nullableDate(task.opensAt, '开放时间'),
      creditPercent, deadlineKind, sourceStatus, sourceComplete, problemCount, completedProblemCount,
      seenAt: nullableDate(task.seenAt, '读取时间'), doneOverride: task.doneOverride ?? null,
      deadlineOverride: nullableDate(task.deadlineOverride, '手动提醒时间'),
      priority, note: plainText(task.note || '', '个人备注', 1000).trim(),
    };
  });
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error('备份包含重复作业。');
  const taskPersonal = {};
  for (const task of tasks) {
    if (task.priority || task.note) taskPersonal[task.id] = { courseId: task.courseId, priority: task.priority, note: task.note };
    delete task.priority;
    delete task.note;
  }
  if (data.taskPersonal !== undefined && !Array.isArray(data.taskPersonal)) throw new Error('个人作业数据无效。');
  if ((data.taskPersonal || []).length > 20000) throw new Error('个人作业数据超出允许范围。');
  for (const entry of data.taskPersonal || []) {
    if (!entry || typeof entry !== 'object') throw new Error('个人作业数据无效。');
    const id = plainText(entry.id, '个人作业编号', 100);
    const courseId = plainText(entry.courseId, '个人作业课程编号', 300);
    if (!/^[a-f0-9]{16,64}$/i.test(id) || !courseIds.has(courseId)) throw new Error('个人作业数据引用无效。');
    const priority = entry.priority === null || entry.priority === undefined ? null : plainText(entry.priority, '作业优先级', 20);
    if (![null, 'high', 'medium', 'low'].includes(priority)) throw new Error('作业优先级无效。');
    const note = plainText(entry.note || '', '个人备注', 1000).trim();
    if (priority || note) taskPersonal[id] = { courseId, priority, note };
  }
  const preferences = { ...defaultPreferences() };
  if (data.preferences && typeof data.preferences === 'object') {
    if (typeof data.preferences.requireManualCompletion === 'boolean') preferences.requireManualCompletion = data.preferences.requireManualCompletion;
    if (typeof data.preferences.onboardingDismissed === 'boolean') preferences.onboardingDismissed = data.preferences.onboardingDismissed;
  }
  const defaults = emptyConfig();
  const reminders = data.reminders && typeof data.reminders === 'object' ? data.reminders : {};
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(reminders.time || '') ? reminders.time : defaults.time;
  const quietStart = /^([01]\d|2[0-3]):[0-5]\d$/.test(reminders.quietStart || '') ? reminders.quietStart : defaults.quietStart;
  const quietEnd = /^([01]\d|2[0-3]):[0-5]\d$/.test(reminders.quietEnd || '') ? reminders.quietEnd : defaults.quietEnd;
  return {
    state: { version: 1, courses, tasks, taskPersonal, notified: {}, preferences },
    reminders: {
      remindersPaused: Boolean(reminders.remindersPaused), leadHours: normalizeLeadHours(reminders.leadHours),
      quietEnabled: Boolean(reminders.quietEnabled), quietStart, quietEnd,
      includeNotes: Boolean(reminders.includeNotes),
      disabledCourseIds: Array.isArray(reminders.disabledCourseIds) ? reminders.disabledCourseIds.filter(id => courseIds.has(id)) : [],
      time, dailyWasEnabled: Boolean(reminders.dailyEnabled),
    },
    summary: { courses: courses.length, tasks: tasks.length, exportedAt: nullableDate(backup.exportedAt, '导出时间') },
  };
}

function writeRestorePoint(state, config, now = new Date(), directory = path.join(dataDir(), 'restore-points')) {
  fs.mkdirSync(directory, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const file = path.join(directory, `before-import-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ createdAt: now.toISOString(), state, config }, null, 2), { encoding: 'utf8', mode: 0o600 });
  return file;
}

function applyBackup(validated, currentConfig) {
  const { dailyWasEnabled, ...reminderSettings } = validated.reminders;
  return {
    state: validated.state,
    config: {
      ...emptyConfig(), ...reminderSettings,
      enabled: false, sendKey: currentConfig.sendKey || '', history: currentConfig.history || [],
      lastSentDate: null, lastSentAt: null, lastError: null, attemptDate: null, attemptCount: 0, lastAttemptAt: null,
    },
  };
}

module.exports = { FORMAT, FORMAT_VERSION, stripPersonalQuery, createBackup, validateBackup, writeRestorePoint, applyBackup };
