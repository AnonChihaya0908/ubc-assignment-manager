const fs = require('node:fs');
const path = require('node:path');
const { effectiveDue, completionStatus, categoryOf, needsAttention } = require('./deadlines');
const { courseDataStatus, SYNC_ERROR_LABELS } = require('./sync-status');
const { dataDir } = require('./paths');

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
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
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

function localTime(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function buildDailyDigest(state, now = new Date(), config = {}) {
  const options = state.preferences || {};
  const disabled = new Set(Array.isArray(config.disabledCourseIds) ? config.disabledCourseIds : []);
  const pending = state.tasks.filter(task => !disabled.has(task.courseId) && needsAttention(task, now.getTime(), options));
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
  const title = pending.length ? `UBC作业管理工具：${pending.length} 项需处理` : 'UBC作业管理工具：今日无待处理';
  const lines = [`${localTime(now).split(' ')[0]} 作业清单`, ''];
  const relatedCourseIds = new Set(pending.map(task => task.courseId));
  const relatedCourses = state.courses.filter(course => relatedCourseIds.has(course.id));
  if (relatedCourses.length) {
    lines.push('数据状态：');
    for (const course of relatedCourses) {
      const dataStatus = courseDataStatus(course, now.getTime());
      const updated = course.lastSyncedAt ? localTime(course.lastSyncedAt) : '从未成功同步';
      const suffix = dataStatus.kind === 'error' ? `；最近刷新失败（${SYNC_ERROR_LABELS[course.lastSyncErrorKind] || SYNC_ERROR_LABELS.unknown}）` :
        dataStatus.kind === 'stale' || dataStatus.kind === 'never' ? '；数据可能过旧' : '';
      lines.push(`- ${cleanLine(course.name)}：${updated}${suffix}`);
    }
    lines.push('');
  }
  if (!pending.length) lines.push('目前没有需要处理的作业。');
  for (const task of pending.slice(0, 20)) {
    const course = state.courses.find(item => item.id === task.courseId);
    const due = effectiveDue(task);
    let dateText = categoryOf(task, now.getTime(), options) === 'history' && task.sourceStatus === 'past_due'
      ? '网页标记已截止' : '暂无明确截止时间';
    if (due) {
      const prefix = task.deadlineKind === 'credit_window' && !task.deadlineOverride ? '得分阶段结束' :
        new Date(due) < now ? '已过页面日期' : '截止';
      dateText = `${prefix} ${localTime(due)}`;
    }
    const confirmation = completionStatus(task, options).source === 'confirmation_required' ? '【100% 待确认】' : '';
    lines.push(`- ${confirmation}${cleanLine(course?.name || '课程')} · ${cleanLine(task.code && task.code !== task.name ? `${task.code} ${task.name}` : task.name)}：${dateText}`);
  }
  if (pending.length > 20) lines.push(`- 其余 ${pending.length - 20} 项请在电脑应用中查看。`);
  lines.push('', '日期以最近一次课程同步结果为准。');
  return { title, desp: lines.join('\n'), count: pending.length };
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
