const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const SYNC_ERROR_LABELS = {
  login: '需要重新登录',
  network: '网络连接失败',
  parse: '页面解析失败',
  page: '页面不匹配',
  unknown: '未知原因',
};

function classifySyncError(error) {
  const text = `${error?.code || ''} ${error?.message || error || ''}`;
  if (/尚未登录|重新登录|登录跳转|学校登录|login|authentication|unauthorized/i.test(text)) return 'login';
  if (/ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|network|网络|连接|超时|timeout|fetch failed/i.test(text)) return 'network';
  if (/没有识别|没有读到|未识别|表格|Status 列|页面结构|作业列表已加载/i.test(text)) return 'parse';
  if (/页面不匹配|不是.+页面|课程首页|网址/i.test(text)) return 'page';
  return 'unknown';
}

function markSyncAttempt(course, now = new Date()) {
  course.lastSyncAttemptAt = now.toISOString();
}

function markSyncSuccess(course, now = new Date()) {
  course.lastSyncedAt = now.toISOString();
  course.lastSyncError = null;
  course.lastSyncErrorKind = null;
}

function markSyncFailure(course, error, now = new Date()) {
  course.lastSyncAttemptAt = now.toISOString();
  course.lastSyncErrorKind = classifySyncError(error);
  course.lastSyncError = String(error?.message || error || '同步失败。')
    .replace(/([?&]effectiveUser=)[^&\s]+/gi, '$1[已隐藏]')
    .replace(/[\r\n\t]+/g, ' ').trim().slice(0, 300);
}

function courseDataStatus(course, now = Date.now()) {
  const syncedAt = Date.parse(course.lastSyncedAt || '');
  const age = Number.isFinite(syncedAt) ? Number(now) - syncedAt : Infinity;
  const stale = age > STALE_AFTER_MS;
  if (course.lastSyncError) return { kind: 'error', stale, age, syncedAt: Number.isFinite(syncedAt) ? syncedAt : null };
  if (!Number.isFinite(syncedAt)) return { kind: 'never', stale: true, age: Infinity, syncedAt: null };
  if (stale) return { kind: 'stale', stale: true, age, syncedAt };
  return { kind: 'fresh', stale: false, age, syncedAt };
}

module.exports = { STALE_AFTER_MS, SYNC_ERROR_LABELS, classifySyncError, markSyncAttempt, markSyncSuccess, markSyncFailure, courseDataStatus };
