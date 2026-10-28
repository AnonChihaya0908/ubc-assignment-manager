const crypto = require('node:crypto');
const { localeFor } = require('../public/i18n');
const { normalizeAcademicPeriod } = require('./academic-term');

const STATUSES = new Set(['unreserved', 'reserved', 'ended', 'cancelled']);
const DEFAULT_LEADS = [168, 24, 3];
const PRAIRIETEST_HOME = 'https://us.prairietest.com/';
const UBC_FINALS_SOURCE = 'ubc_finals';

function text(value, field, limit = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u001f]/.test(value)) throw new Error(`${field}无效。`);
  return value.trim().replace(/\s+/g, ' ');
}
function optionalText(value, field, limit = 200) { return value == null || value === '' ? '' : text(value, field, limit); }
function instant(value, field) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/20\d\d-\d\d-\d\dT/.test(value) || !/(?:Z|[+-]\d\d:\d\d)$/i.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${field}无效，请填写带时区的时间。`);
  return new Date(value).toISOString();
}
function timeZone(value) {
  if (!value) return null;
  if (typeof value !== 'string' || value.length > 100) throw new Error('考试时区无效。');
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return value; }
  catch { throw new Error('考试时区无效。'); }
}
function examUrl(value, source) {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { throw new Error('考试链接无效。'); }
  if (url.protocol !== 'https:' || url.username || url.password || source === 'prairietest' && url.hostname !== 'us.prairietest.com' ||
      source === UBC_FINALS_SOURCE && (url.hostname !== 'ubc.appiancloud.com' || url.pathname !== '/suite/sites/irps/group/student/page/final-exams')) throw new Error('考试链接无效。');
  url.search = ''; url.hash = '';
  return url.href;
}
function validateExam(input, { source = 'manual', id = null, old = null, now = new Date() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('考试内容无效。');
  const status = input.status;
  if (!STATUSES.has(status)) throw new Error('考试状态无效。');
  const startsAt = instant(input.startsAt, '考试开始时间');
  const reservationDeadline = instant(input.reservationDeadline, '预约截止时间');
  if (status === 'reserved' && !startsAt && source === 'manual') throw new Error('已预约考试需要开始时间。');
  if (status === 'unreserved' && startsAt && source !== 'manual') throw new Error('PrairieTest 未预约考试不能保存为已确定的场次时间。');
  const durationMinutes = input.durationMinutes == null || input.durationMinutes === '' ? null : Number(input.durationMinutes);
  if (durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440)) throw new Error('考试时长无效。');
  const academicPeriod = input.academicPeriod == null || input.academicPeriod === '' ? null : normalizeAcademicPeriod(input.academicPeriod);
  if (input.academicPeriod && !academicPeriod) throw new Error('考试学期无效。');
  const courseId = input.courseId == null || input.courseId === '' ? null : text(input.courseId, '关联课程', 300);
  return {
    id: id || `manual:${crypto.randomUUID()}`, source, sourceId: source !== 'manual' ? text(input.sourceId, '来源编号', 300) : null,
    title: text(input.title, '考试名称'), courseName: optionalText(input.courseName, '课程名称'), courseId, academicPeriod,
    status, startsAt, sourceTimeZone: timeZone(input.sourceTimeZone), durationMinutes,
    location: optionalText(input.location, '地点', 300), reservationDeadline, url: examUrl(input.url, source),
    archived: input.archived === undefined ? old?.archived === true : input.archived === true,
    linkedExamId: source === 'manual' ? old?.linkedExamId || null : null,
    createdAt: old?.createdAt || now.toISOString(), updatedAt: now.toISOString(),
    lastSyncedAt: source !== 'manual' ? now.toISOString() : null,
    courseAssociationManual: source === UBC_FINALS_SOURCE ? old?.courseAssociationManual === true : false,
  };
}
function normalizeStoredExams(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    try {
      const source = item?.source === 'prairietest' ? 'prairietest' : item?.source === UBC_FINALS_SOURCE ? UBC_FINALS_SOURCE : 'manual';
      const normalized = validateExam(item, { source, id: String(item.id || ''), old: item, now: new Date(item.updatedAt || Date.now()) });
      normalized.createdAt = Number.isFinite(Date.parse(item.createdAt)) ? new Date(item.createdAt).toISOString() : normalized.createdAt;
      normalized.lastSyncedAt = source !== 'manual' && Number.isFinite(Date.parse(item.lastSyncedAt)) ? new Date(item.lastSyncedAt).toISOString() : null;
      return [normalized];
    } catch { return []; }
  }).slice(0, 1000);
}
function mergePrairieTestExams(state, rows, now = new Date()) {
  if (!Array.isArray(rows) || rows.length > 500) throw new Error('PrairieTest 考试列表无效。');
  const next = rows.map(row => validateExam(row, { source: 'prairietest', id: `prairietest:${row.sourceId}`, now }));
  if (new Set(next.map(item => item.id)).size !== next.length) throw new Error('PrairieTest 页面包含重复考试编号，原有数据已保留。');
  const existing = new Map((state.exams || []).map(item => [item.id, item]));
  state.exams ||= [];
  for (const exam of next) {
    const old = existing.get(exam.id);
    if (old) Object.assign(old, exam, { courseId: old.courseId || exam.courseId, academicPeriod: old.academicPeriod || exam.academicPeriod,
      archived: old.archived, createdAt: old.createdAt });
    else state.exams.push(exam);
  }
  state.prairieTest ||= {};
  state.prairieTest.lastSyncedAt = now.toISOString();
  state.prairieTest.lastError = null;
  return next.length;
}
function mergeUbcFinalsExams(state, rows, now = new Date()) {
  if (!Array.isArray(rows) || rows.length > 500) throw new Error('UBC 考试列表无效。');
  const existing = new Map((state.exams || []).map(item => [item.id, item]));
  const next = rows.map(row => {
    const id = `ubc_finals:${row.sourceId}`;
    const old = existing.get(id);
    const exam = validateExam(row, { source: UBC_FINALS_SOURCE, id, old, now });
    if (old?.courseAssociationManual) exam.courseId = old.courseId;
    return exam;
  });
  if (new Set(next.map(exam => exam.id)).size !== next.length) throw new Error('UBC 考试列表有重复考试，原有数据已保留。');
  state.exams ||= [];
  for (const exam of next) {
    const old = existing.get(exam.id);
    if (old) Object.assign(old, exam);
    else state.exams.push(exam);
  }
  state.ubcFinals ||= {};
  state.ubcFinals.lastSyncedAt = now.toISOString();
  state.ubcFinals.lastError = null;
  return next.length;
}
function examCategory(exam, now = new Date()) {
  if (exam.status === 'ended' || exam.status === 'cancelled') return 'ended';
  if (exam.status === 'reserved' && exam.startsAt && exam.durationMinutes && Date.parse(exam.startsAt) + exam.durationMinutes * 60000 < now.getTime()) return 'ended';
  if (exam.source === UBC_FINALS_SOURCE && exam.startsAt && Date.parse(exam.startsAt) + 24 * 3600000 < now.getTime()) return 'ended';
  return exam.status;
}
function activeExams(state, now = new Date()) {
  const latestPrairieTestSync = Date.parse(state.prairieTest?.lastSyncedAt || '');
  const latestUbcFinalsSync = Date.parse(state.ubcFinals?.lastSyncedAt || '');
  return (state.exams || []).filter(exam => !exam.archived && !exam.linkedExamId && !['ended', 'cancelled'].includes(examCategory(exam, now)) &&
    (exam.source !== 'prairietest' || Number.isFinite(latestPrairieTestSync) && Date.parse(exam.lastSyncedAt || '') >= latestPrairieTestSync) &&
    (exam.source !== UBC_FINALS_SOURCE || Number.isFinite(latestUbcFinalsSync) && Date.parse(exam.lastSyncedAt || '') >= latestUbcFinalsSync));
}
function normalizeExamLeads(value) {
  if (!Array.isArray(value) || !value.length || value.length > 6 || value.some(item => typeof item !== 'number' || !Number.isFinite(item) || item < 0.25 || item > 720)) throw new Error('考试提前提醒时间无效。');
  return [...new Set(value)].sort((a, b) => b - a);
}
function examReminderEvents(state, config, now = new Date()) {
  const { inQuietHours } = require('./wechat');
  if (config.remindersPaused || inQuietHours(config, now)) return [];
  const locale = localeFor(state.preferences?.language);
  const english = locale === 'en-US';
  const leads = normalizeExamLeads(state.preferences?.examLeadHours || DEFAULT_LEADS);
  const result = [];
  for (const exam of activeExams(state, now)) {
    const target = exam.status === 'reserved' ? exam.startsAt : exam.reservationDeadline;
    if (target) {
      const remaining = Date.parse(target) - now.getTime();
      if (remaining <= 0) continue;
      const dueLeads = leads.filter(hours => remaining <= hours * 3600000);
      const currentLead = dueLeads.at(-1);
      if (currentLead !== undefined) {
        const key = `exam:${exam.id}:${exam.status}:${target}:${currentLead}h`;
        if (state.notified?.[key]) continue;
        result.push({ key, examId: exam.id, title: english ? `${exam.title} · ${exam.status === 'reserved' ? 'exam soon' : 'reservation due'}`
          : `${exam.title} · ${exam.status === 'reserved' ? '考试即将开始' : '预约即将截止'}`,
        message: `${exam.courseName || (english ? 'Exam' : '考试')} · ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(target))}` });
      }
    } else if (exam.status === 'unreserved' && now.getHours() >= 9) {
      const period = Math.floor((now.getTime() - Date.parse(exam.createdAt)) / (7 * 86400000));
      if (period < 0) continue;
      const key = `exam:${exam.id}:book:${period}`;
      if (!state.notified?.[key]) result.push({ key, examId: exam.id,
        title: english ? `Reserve ${exam.title}` : `请预约 ${exam.title}`,
        message: english ? 'No exam time is confirmed yet.' : '尚未确定考试场次。' });
    }
  }
  return result;
}
function examDigestEntries(state, now = new Date(), days = 7) {
  return activeExams(state, now).filter(exam => {
    if (exam.status === 'unreserved') return !exam.reservationDeadline || Date.parse(exam.reservationDeadline) > now.getTime() ||
      exam.startsAt && Date.parse(exam.startsAt) > now.getTime();
    return exam.startsAt && Date.parse(exam.startsAt) >= now.getTime() &&
      Date.parse(exam.startsAt) <= now.getTime() + days * 86400000;
  }).sort((a, b) => (Date.parse(a.startsAt || a.reservationDeadline || '') || Infinity) -
    (Date.parse(b.startsAt || b.reservationDeadline || '') || Infinity));
}
module.exports = { PRAIRIETEST_HOME, UBC_FINALS_SOURCE, DEFAULT_LEADS, validateExam, normalizeStoredExams, mergePrairieTestExams, mergeUbcFinalsExams,
  examCategory, activeExams, normalizeExamLeads, examReminderEvents, examDigestEntries };
