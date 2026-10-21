const fs = require('node:fs');
const path = require('node:path');
const { effectiveDue, completionStatus, categoryOf, needsAttention } = require('./deadlines');
const { courseDataStatus, SYNC_ERROR_LABELS } = require('./sync-status');
const { dataDir } = require('./paths');
const { writeJsonFile } = require('./file-store');
const { localeFor } = require('../public/i18n');
const { examDigestEntries } = require('./exams');
const { coursePlatform } = require('./store');

function configPath() {
  return path.join(dataDir(), 'wechat.json');
}

function emptyConfig() {
  return {
    enabled: false,
    remindersPaused: false,
    leadHours: [24, 3],
    quietEnabled: false,
    quietStart: '22:00',
    quietEnd: '08:00',
    disabledCourseIds: [],
    includeNotes: false,
    history: [],
    time: '09:00',
    startDate: null,
    sendKey: '',
    lastSentDate: null,
    lastSentAt: null,
    attemptDate: null,
    attemptCount: 0,
    lastAttemptAt: null,
    lastError: null,
    lastTestAt: null,
  };
}

function loadConfig(file = configPath()) {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('微信提醒设置无效。');
    return { ...emptyConfig(), ...saved };
  } catch (error) {
    if (error.code === 'ENOENT') return emptyConfig();
    throw error;
  }
}

function saveConfig(config, file = configPath()) {
  writeJsonFile(file, config);
}

function publicConfig(config) {
  return {
    enabled: Boolean(config.enabled),
    remindersPaused: Boolean(config.remindersPaused),
    leadHours: normalizeLeadHours(config.leadHours),
    quietEnabled: Boolean(config.quietEnabled),
    quietStart: config.quietStart,
    quietEnd: config.quietEnd,
    disabledCourseIds: Array.isArray(config.disabledCourseIds) ? config.disabledCourseIds.filter(value => typeof value === 'string') : [],
    includeNotes: Boolean(config.includeNotes),
    history: Array.isArray(config.history) ? config.history.slice(0, 30).map(record => ({
      at: record?.at, type: record?.type, result: record?.result, detail: sanitizeDetail(record?.detail),
    })) : [],
    time: config.time,
    startDate: config.startDate,
    hasKey: Boolean(config.sendKey),
    lastSentAt: config.lastSentAt,
    lastError: config.lastError,
    lastTestAt: config.lastTestAt,
    nextSendAt: nextDailyAt(config)?.toISOString() || null,
  };
}

function normalizeLeadHours(value) {
  if (!Array.isArray(value)) return [24, 3];
  const normalized = [...new Set(value.map(Number).filter(item => Number.isFinite(item) && item >= 0.25 && item <= 336))]
    .sort((a, b) => b - a).slice(0, 6);
  return normalized.length ? normalized : [24, 3];
}

function timeMinutes(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function inQuietHours(config, now = new Date()) {
  if (!config.quietEnabled) return false;
  const start = timeMinutes(config.quietStart), end = timeMinutes(config.quietEnd);
  if (start === null || end === null || start === end) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function nextQuietEnd(config, now) {
  const end = timeMinutes(config.quietEnd);
  if (end === null) return now;
  const result = new Date(now);
  result.setHours(Math.floor(end / 60), end % 60, 0, 0);
  if (result <= now) result.setDate(result.getDate() + 1);
  return result;
}

function nextDailyAt(config, now = new Date()) {
  if (config.remindersPaused || !config.enabled || !config.sendKey) return null;
  const minutes = timeMinutes(config.time);
  if (minutes === null) return null;
  if (shouldSendDaily(config, now)) return new Date(now);
  if (config.attemptDate === localDateKey(now) && config.attemptCount > 0 && config.attemptCount < 3 && config.lastAttemptAt) {
    const retryAt = new Date(new Date(config.lastAttemptAt).getTime() + 30 * 60_000);
    if (retryAt > now) return inQuietHours(config, retryAt) ? nextQuietEnd(config, retryAt) : retryAt;
  }
  const candidate = new Date(now);
  candidate.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  if (config.startDate) {
    const start = new Date(`${config.startDate}T00:00:00`);
    if (candidate < start) candidate.setTime(start.getTime() + minutes * 60_000);
  }
  if (config.lastSentDate === localDateKey(now)) candidate.setDate(candidate.getDate() + 1);
  else if (candidate <= now) {
    if (inQuietHours(config, now)) return nextQuietEnd(config, now);
    return new Date(now);
  }
  if (inQuietHours(config, candidate)) return nextQuietEnd(config, candidate);
  return candidate;
}

function appendHistory(config, entry) {
  const allowedTypes = new Set(['daily', 'test', 'windows']);
  const allowedResults = new Set(['accepted', 'failed', 'shown']);
  const record = {
    at: new Date(entry.at || Date.now()).toISOString(),
    type: allowedTypes.has(entry.type) ? entry.type : 'daily',
    result: allowedResults.has(entry.result) ? entry.result : 'failed',
    detail: sanitizeDetail(entry.detail),
  };
  config.history = [record, ...(Array.isArray(config.history) ? config.history : [])].slice(0, 50);
  return record;
}

function sanitizeDetail(value) {
  return cleanLine(value).replace(/SCT[A-Za-z0-9_-]{8,253}/g, '[密钥已隐藏]').slice(0, 180);
}

function validateSendKey(value) {
  const key = String(value || '').trim();
  if (!/^SCT[A-Za-z0-9_-]{8,253}$/.test(key)) {
    throw new Error('请输入 Server酱 Turbo 的 SCT SendKey。');
  }
  return key;
}

function localDateKey(now = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function shouldSendDaily(config, now = new Date()) {
  if (config.remindersPaused || !config.enabled || !config.sendKey || config.lastSentDate === localDateKey(now)) return false;
  if (inQuietHours(config, now)) return false;
  if (config.startDate && localDateKey(now) < config.startDate) return false;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.time || '')) return false;
  const [hour, minute] = config.time.split(':').map(Number);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const scheduledMinutes = hour * 60 + minute;
  if (currentMinutes < scheduledMinutes) {
    const quietStart = timeMinutes(config.quietStart), quietEnd = timeMinutes(config.quietEnd);
    const overnightQuiet = config.quietEnabled && quietStart !== null && quietEnd !== null && quietStart > quietEnd;
    const scheduleWasDeferred = overnightQuiet && (scheduledMinutes >= quietStart || scheduledMinutes < quietEnd) && currentMinutes >= quietEnd;
    if (!scheduleWasDeferred) return false;
  }
  if (config.attemptDate === localDateKey(now)) {
    if (config.attemptCount >= 3) return false;
    if (config.lastAttemptAt && now.getTime() - new Date(config.lastAttemptAt).getTime() < 30 * 60_000) return false;
  }
  return true;
}

function cleanLine(value) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function shortCourseName(course) {
  const name = cleanLine(course?.name);
  const match = name.match(/\b([A-Z]{2,5})[_\s]*(?:V[_\s]*)?(\d{3})\b/i);
  const term = course?.academicPeriod || name.match(/\b20\d{2}[WS][12A]?\b/i)?.[0];
  return match ? `${match[1].toUpperCase()} ${match[2]}${term ? ` · ${term}` : ''}` : name;
}

function digestDate(value, now, copy) {
  const date = new Date(value);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const day = localDateKey(date);
  if (day === localDateKey(now)) return { text: `${copy.today} ${time}`, relative: true };
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (day === localDateKey(tomorrow)) return { text: `${copy.tomorrow} ${time}`, relative: true };
  return { text: `${date.getMonth() + 1}/${date.getDate()} ${time}`, relative: false };
}

function examCourseName(exam, courses) {
  const title = cleanLine(exam.title);
  const name = cleanLine(exam.courseName) || cleanLine(courses.find(course => course.id === exam.courseId)?.name);
  const term = exam.academicPeriod || title.match(/\b20\d{2}[WS][12A]?\b/i)?.[0];
  return shortCourseName({ name: name || title, academicPeriod: term });
}

function examShortTitle(exam) {
  const title = cleanLine(exam.title);
  const course = cleanLine(exam.courseName);
  if (!course || !title.toLowerCase().startsWith(course.toLowerCase())) return title;
  const rest = title.slice(course.length).replace(/^\s*(?:\(20\d{2}[WS][12A]?\))?\s*[:：-]?\s*/i, '');
  return rest || title;
}

function syncTime(value, now, copy) {
  const date = new Date(value);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return localDateKey(date) === localDateKey(now) ? `${copy.today} ${time}` : `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

function buildDailyDigest(state, now = new Date(), config = {}) {
  const locale = state.preferences?.language === undefined ? 'zh-CN' : localeFor(state.preferences.language);
  const copy = locale === 'en-US' ? {
    title: count => count ? `UBC Assignment Manager: ${count} ${count === 1 ? 'assignment' : 'assignments'} to handle` : 'UBC Assignment Manager: nothing to handle today',
    reminder: 'Reminder', exams: 'Exams (next 7 days)', assignments: 'Assignments', data: 'Data status:',
    today: 'Today', tomorrow: 'Tomorrow', reserved: 'Reserved', unreserved: 'Reservation needed',
    location: 'Location', manual: 'Manually added',
    never: 'never synced successfully', stale: 'data may be stale', synced: 'synced at',
    coursesSynced: count => `${count} assignment courses`,
    manualSource: 'Manually added', unknownSource: 'Other source',
    empty: 'No assignments need attention right now.', closed: 'Website marked closed',
    noDate: 'No clear due date', credit: 'Credit window ends', passed: 'Page date passed', due: 'Due',
    confirm: '[100% awaiting confirmation] ', course: 'Course', note: 'Note', reservationDue: 'Reservation due', examStarts: 'Exam',
    more: count => `- View ${count} more in the desktop app.`,
  } : {
    title: count => count ? `UBC作业管理工具：${count} 项需处理` : 'UBC作业管理工具：今日无待处理',
    reminder: '提醒', exams: '考试提醒（未来 7 天）', assignments: '作业提醒', data: '数据状态：',
    today: '今天', tomorrow: '明天', reserved: '已预约', unreserved: '待预约',
    location: '地点', manual: '手动添加',
    never: '从未成功同步', stale: '数据可能过旧', synced: '同步于',
    coursesSynced: count => `${count} 门作业课程`,
    manualSource: '手动添加', unknownSource: '其他来源',
    empty: '目前没有需要处理的作业。', closed: '网页标记已截止',
    noDate: '暂无明确截止时间', credit: '得分阶段结束', passed: '已过页面日期', due: '截止',
    confirm: '【100% 待确认】', course: '课程', note: '备注', reservationDue: '预约截止', examStarts: '考试',
    more: count => `- 其余 ${count} 项请在电脑应用中查看。`,
  };
  const options = {
    ...(state.preferences || {}),
    ignoredSectionsByCourse: Object.fromEntries(state.courses.map(course => [course.id, course.ignoredSections || []])),
  };
  const disabled = new Set(Array.isArray(config.disabledCourseIds) ? config.disabledCourseIds : []);
  for (const course of state.courses) if (course.archived) disabled.add(course.id);
  const pending = state.tasks
    .filter(task => !disabled.has(task.courseId) && needsAttention(task, now.getTime(), options))
    .map(task => {
      const personal = state.taskPersonal?.[task.id] || {};
      return { ...task, priority: personal.priority || null, note: typeof personal.note === 'string' ? personal.note : '' };
    });
  pending.sort((a, b) => {
    const firstNeedsConfirmation = completionStatus(a, options).source === 'confirmation_required';
    const secondNeedsConfirmation = completionStatus(b, options).source === 'confirmation_required';
    if (firstNeedsConfirmation !== secondNeedsConfirmation) return firstNeedsConfirmation ? -1 : 1;
    const first = effectiveDue(a), second = effectiveDue(b);
    if (first && second) return new Date(first) - new Date(second);
    if (first) return -1;
    if (second) return 1;
    return a.name.localeCompare(b.name);
  });
  const sevenDays = now.getTime() + 7 * 86400000;
  const exams = examDigestEntries(state, now, 7).filter(exam => exam.status === 'reserved' ||
    exam.reservationDeadline && Date.parse(exam.reservationDeadline) > now.getTime() && Date.parse(exam.reservationDeadline) <= sevenDays ||
    exam.startsAt && Date.parse(exam.startsAt) >= now.getTime() && Date.parse(exam.startsAt) <= sevenDays);
  const title = exams.length ? locale === 'en-US'
    ? `UBC Assignment Manager: ${exams.length} ${exams.length === 1 ? 'exam' : 'exams'}${pending.length ? `, ${pending.length} ${pending.length === 1 ? 'assignment' : 'assignments'}` : ''} to handle`
    : `UBC作业管理工具：${exams.length} 场考试${pending.length ? `、${pending.length} 项作业` : ''}需关注`
    : copy.title(pending.length);
  const lines = [`${new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'numeric', day: 'numeric' }).format(now)} ${copy.reminder}`];
  if (exams.length) {
    lines.push('', copy.exams);
    const groups = new Map();
    for (const exam of exams.slice(0, 20)) {
      const source = exam.source === 'prairietest' ? 'PrairieTest' : exam.source === 'manual' ? copy.manualSource : copy.unknownSource;
      if (!groups.has(source)) groups.set(source, new Map());
      const course = examCourseName(exam, state.courses);
      if (!groups.get(source).has(course)) groups.get(source).set(course, []);
      groups.get(source).get(course).push(exam);
    }
    for (const source of ['PrairieTest', copy.manualSource, copy.unknownSource]) {
      const courses = groups.get(source);
      if (!courses) continue;
      lines.push(`- ${source}`);
      for (const [course, items] of courses) {
        lines.push(`  - ${course}`);
        for (const exam of items) {
          const bookingSoon = exam.status === 'unreserved' && exam.reservationDeadline &&
            Date.parse(exam.reservationDeadline) > now.getTime() && Date.parse(exam.reservationDeadline) <= sevenDays;
          const target = bookingSoon ? exam.reservationDeadline : exam.startsAt;
          const date = target ? digestDate(target, now, copy) : null;
          const status = exam.status === 'reserved' ? copy.reserved : copy.unreserved;
          const timing = date ? bookingSoon ? `${copy.reservationDue} ${date.text}` :
            exam.status === 'unreserved' ? `${copy.examStarts} ${date.text}` : date.text : '';
          lines.push(`    - ${examShortTitle(exam)}${locale === 'en-US' ? ': ' : '：'}${timing ? `${timing} · ` : ''}${status}`);
          if (exam.location) lines.push(`      - ${copy.location}${locale === 'en-US' ? ': ' : '：'}${cleanLine(exam.location)}`);
        }
      }
      lines.push('');
    }
    if (exams.length > 20) lines.push(copy.more(exams.length - 20));
    if (lines.at(-1) === '') lines.pop();
  }
  if (pending.length) {
    lines.push('', copy.assignments);
    const groups = new Map();
    const platformNames = { prairielearn: 'PrairieLearn', webwork: 'WeBWorK', gradescope: 'Gradescope' };
    for (const task of pending.slice(0, 20)) {
      const course = state.courses.find(item => item.id === task.courseId);
      const source = course?.platform || (course?.url ? coursePlatform(course) : 'prairielearn');
      const platform = platformNames[source] || copy.unknownSource;
      if (!groups.has(platform)) groups.set(platform, new Map());
      const key = course?.id || '';
      if (!groups.get(platform).has(key)) groups.get(platform).set(key, { course, tasks: [] });
      groups.get(platform).get(key).tasks.push(task);
    }
    const orderedPlatforms = ['PrairieLearn', 'WeBWorK', 'Gradescope', copy.unknownSource];
    for (const platform of orderedPlatforms) {
      const courses = groups.get(platform);
      if (!courses) continue;
      lines.push(`- ${platform}`);
      for (const { course, tasks } of courses.values()) {
        lines.push(`  - ${shortCourseName(course) || copy.course}`);
        for (const task of tasks) {
          const due = effectiveDue(task);
          let dateText = categoryOf(task, now.getTime(), options) === 'history' && task.sourceStatus === 'past_due'
            ? copy.closed : copy.noDate;
          if (due) {
            const prefix = task.deadlineKind === 'credit_window' && !task.deadlineOverride ? copy.credit :
              new Date(due) < now ? copy.passed : copy.due;
            const date = digestDate(due, now, copy);
            dateText = `${prefix}${date.relative ? '' : ' '}${date.text}`;
          }
          const confirmation = completionStatus(task, options).source === 'confirmation_required' ? copy.confirm : '';
          const name = cleanLine(task.code && task.code !== task.name ? `${task.code} ${task.name}` : task.name);
          lines.push(`    - ${confirmation}${name}${locale === 'en-US' ? ': ' : '：'}${dateText}`);
          if (config.includeNotes && task.note) lines.push(`      - ${copy.note}${locale === 'en-US' ? ': ' : '：'}${cleanLine(task.note)}`);
        }
      }
      lines.push('');
    }
    if (pending.length > 20) lines.push(copy.more(pending.length - 20));
    if (lines.at(-1) === '') lines.pop();
  }
  if (!pending.length && !exams.length) lines.push('', copy.empty);

  const activeCourses = state.courses.filter(course => !course.archived && !disabled.has(course.id));
  const successful = activeCourses.filter(course => course.lastSyncedAt && !course.lastSyncError);
  const latest = Math.max(...successful.map(course => Date.parse(course.lastSyncedAt)).filter(Number.isFinite));
  const common = successful.filter(course => latest - Date.parse(course.lastSyncedAt) <= 5 * 60000);
  const syncParts = [];
  if (common.length) {
    const status = common.some(course => courseDataStatus(course, now.getTime()).stale);
    syncParts.push(locale === 'en-US'
      ? `${copy.coursesSynced(common.length)} ${copy.synced} ${syncTime(new Date(latest), now, copy)}${status ? `; ${copy.stale}` : ''}`
      : `${copy.coursesSynced(common.length)}于${syncTime(new Date(latest), now, copy)} 同步${status ? `，${copy.stale}` : ''}`);
  }
  for (const course of activeCourses.filter(course => !common.includes(course))) {
    const status = courseDataStatus(course, now.getTime());
    const name = shortCourseName(course);
    const errorName = locale === 'en-US' ? { login: 'sign-in required', network: 'network error', parse: 'page read error', page: 'unexpected page', unknown: 'sync failed' }[course.lastSyncErrorKind] || 'sync failed'
      : SYNC_ERROR_LABELS[course.lastSyncErrorKind] || SYNC_ERROR_LABELS.unknown;
    if (status.kind === 'error') syncParts.push(locale === 'en-US' ? `${name}: latest sync failed (${errorName}); previous data kept` : `${name}：本次同步失败（${errorName}），保留原有数据`);
    else if (status.kind === 'never') syncParts.push(`${name}：${copy.never}`);
    else syncParts.push(locale === 'en-US' ? `${name}: ${copy.synced} ${syncTime(course.lastSyncedAt, now, copy)}${status.stale ? `; ${copy.stale}` : ''}`
      : `${name}：${copy.synced}${syncTime(course.lastSyncedAt, now, copy)}${status.stale ? `，${copy.stale}` : ''}`);
  }
  if (state.prairieTest?.lastSyncedAt || state.prairieTest?.lastError) {
    const test = state.prairieTest;
    if (test.lastError) syncParts.push(locale === 'en-US' ? 'PrairieTest: latest sync failed; previous data kept' : 'PrairieTest：本次同步失败，保留原有数据');
    else syncParts.push(locale === 'en-US' ? `PrairieTest ${copy.synced} ${syncTime(test.lastSyncedAt, now, copy)}` : `PrairieTest 于${syncTime(test.lastSyncedAt, now, copy)} 同步`);
  }
  if (config.syncSkippedBecauseLogin && (activeCourses.length || state.prairieTest?.lastSyncedAt)) {
    syncParts.push(locale === 'en-US' ? 'Sign-in window open; refresh skipped and previous data shown' :
      '登录窗口仍打开，本次未刷新，显示上次数据');
  }
  const manual = exams.filter(exam => exam.source === 'manual').map(exam => cleanLine(exam.title));
  if (manual.length) syncParts.push(locale === 'en-US' ? `${manual.join(', ')}: ${copy.manual}` : `${manual.join('、')} 为${copy.manual}`);
  if (syncParts.length) lines.push('', `${copy.data}${locale === 'en-US' ? ' ' : ''}${syncParts.join(locale === 'en-US' ? '; ' : '；')}${locale === 'en-US' ? '.' : '。'}`);
  return { title, desp: lines.join('\n'), count: pending.length + exams.length };
}

function connectionError(error) {
  const code = error?.cause?.code || error?.code;
  if (code === 'EACCES' || code === 'EPERM') {
    return new Error('无法连接 Server酱：当前应用的网络访问被系统或运行环境拒绝。请检查防火墙或从桌面重新启动应用。');
  }
  if (error?.name === 'TimeoutError' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return new Error('连接 Server酱超时，请检查网络后重试。');
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new Error('无法解析 Server酱域名，请检查 DNS 或网络连接。');
  }
  return new Error('无法连接 Server酱，请检查网络后重试。');
}

async function sendServerChan(sendKey, title, desp, fetchImpl = fetch) {
  const key = validateSendKey(sendKey);
  const payload = new URLSearchParams({ title, desp });
  let response;
  try {
    response = await fetchImpl(`https://sctapi.ftqq.com/${key}.send`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: payload,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw connectionError(error);
  }
  if (!response.ok) throw new Error(`Server酱请求失败（HTTP ${response.status}）。`);
  let result;
  try { result = await response.json(); }
  catch { throw new Error('Server酱返回了无法识别的结果。'); }
  if (Number(result.code) !== 0) throw new Error(`Server酱未接受消息（代码 ${String(result.code ?? '未知').replace(/[^\w-]/g, '').slice(0, 20)}）。`);
  return true;
}

module.exports = {
  configPath, emptyConfig, loadConfig, saveConfig, publicConfig, validateSendKey,
  localDateKey, shouldSendDaily, buildDailyDigest, sendServerChan, normalizeLeadHours,
  inQuietHours, nextDailyAt, appendHistory,
};
