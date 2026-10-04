const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseDisplayedDeadline } = require('./deadlines');
const { parseWebworkDate } = require('./webwork');
const { dataDir } = require('./paths');

function dataPath() {
  return path.join(dataDir(), 'data.json');
}

function defaultPreferences() {
  return { requireManualCompletion: false, onboardingDismissed: false };
}

function emptyState() {
  return { version: 1, courses: [], tasks: [], notified: {}, preferences: defaultPreferences() };
}

function loadState(file = dataPath()) {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved.version !== 1 || !Array.isArray(saved.courses) || !Array.isArray(saved.tasks)) {
      throw new Error('Unsupported data format');
    }
    saved.notified ||= {};
    const savedPreferences = saved.preferences && typeof saved.preferences === 'object' ? saved.preferences : {};
    saved.preferences = { ...defaultPreferences(), ...savedPreferences };
    // Saved files created before the guide already belong to an existing user.
    if (!Object.hasOwn(savedPreferences, 'onboardingDismissed')) saved.preferences.onboardingDismissed = true;
    return saved;
  } catch (error) {
    if (error.code === 'ENOENT') return emptyState();
    throw error;
  }
}

function saveState(state, file = dataPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

function normalizeCourseUrl(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); }
  catch { throw new Error('请输入有效的 HTTPS 课程网址。'); }
  if (url.username || url.password || url.protocol !== 'https:') throw new Error('请输入有效的 HTTPS 课程网址。');
  if (url.hostname.toLowerCase() === 'webwork.elearning.ubc.ca') {
    const match = url.pathname.match(/^\/webwork2\/([a-z0-9_%-]+)\/?$/i);
    if (!match) throw new Error('请输入 WeBWorK 课程首页网址。');
    const slug = decodeURIComponent(match[1]);
    if (!/^[a-z0-9_-]+$/i.test(slug)) throw new Error('WeBWorK 课程网址无效。');
    url.pathname = `/webwork2/${slug}`;
    url.hash = '';
    // This query parameter is used by the supplied UBC course link; other query values are not needed.
    const effectiveUser = url.searchParams.get('effectiveUser');
    url.search = '';
    if (effectiveUser) url.searchParams.set('effectiveUser', effectiveUser);
    return { id: `${url.hostname}:${slug}`, instanceId: slug, platform: 'webwork', url: url.href };
  }
  if (url.protocol !== 'https:' || !/^(?:[a-z0-9-]+\.)?prairielearn\.com$/i.test(url.hostname)) {
    throw new Error('请使用 PrairieLearn 或 UBC WeBWorK 的 HTTPS 课程网址。');
  }
  const match = url.pathname.match(/^\/pl\/course_instance\/(\d+)\/assessments\/?$/);
  if (!match) throw new Error('网址应以 /pl/course_instance/课程ID/assessments 结尾。');
  url.search = '';
  url.hash = '';
  url.pathname = `/pl/course_instance/${match[1]}/assessments`;
  return { id: `${url.hostname}:${match[1]}`, instanceId: match[1], platform: 'prairielearn', url: url.href };
}

function coursePlatform(course) {
  return course.platform || (new URL(course.url).hostname === 'webwork.elearning.ubc.ca' ? 'webwork' : 'prairielearn');
}

function mergeRows(state, courseId, page, { removeMissing = true } = {}) {
  const course = state.courses.find(item => item.id === courseId);
  if (!course) throw new Error('课程不存在。');
  if (!Array.isArray(page.rows) || page.rows.length === 0) throw new Error('没有读到作业表格，原有数据已保留。');
  const importedAt = new Date().toISOString();
  const incoming = new Set();
  for (const row of page.rows) {
    if (!row.name || !row.url) continue;
    const identity = row.code ? `code:${row.code.toUpperCase()}` : `url:${row.url}`;
    const id = crypto.createHash('sha256').update(`${courseId}\n${identity}`).digest('hex').slice(0, 24);
    incoming.add(id);
    const parsed = parseDisplayedDeadline(`${row.creditText || ''} ${row.creditHint || ''}`, page.courseTitle);
    const existing = state.tasks.find(item => item.id === id);
    const task = {
      id, courseId, name: row.name, code: row.code || '', section: row.section || '',
      url: row.url, creditText: row.creditText || '', score: row.score || '',
      dueAt: parsed.dueAt, creditPercent: parsed.creditPercent,
      deadlineKind: parsed.deadlineKind, sourceComplete: row.sourceComplete ?? existing?.sourceComplete ?? null,
      seenAt: importedAt,
      doneOverride: existing?.doneOverride ?? null,
      deadlineOverride: existing?.deadlineOverride ?? null,
    };
    if (existing) Object.assign(existing, task);
    else state.tasks.push(task);
  }
  // A hidden or unpublished assessment should no longer be shown as current work.
  if (removeMissing) state.tasks = state.tasks.filter(task => task.courseId !== courseId || incoming.has(task.id));
  course.name = page.courseTitle || course.name;
  course.lastSyncedAt = importedAt;
  return incoming.size;
}

function mergeWebworkRows(state, courseId, page) {
  const course = state.courses.find(item => item.id === courseId);
  if (!course) throw new Error('课程不存在。');
  if (!Array.isArray(page.rows) || !page.rows.length) throw new Error('没有读到 WeBWorK 作业，原有数据已保留。');
  const importedAt = new Date().toISOString();
  const incoming = new Set();
  for (const row of page.rows) {
    if (!row.name || !['open', 'future', 'past_due'].includes(row.section)) continue;
    const identity = row.code || row.name;
    const id = crypto.createHash('sha256').update(`${courseId}\nwebwork:${identity.toLowerCase()}`).digest('hex').slice(0, 24);
    incoming.add(id);
    const existing = state.tasks.find(item => item.id === id);
    const dueAt = row.section === 'open' ? parseWebworkDate(row.dueText) : null;
    const opensAt = row.section === 'future' ? parseWebworkDate(row.openText) : null;
    const task = {
      id, courseId, name: row.name, code: row.code || '',
      section: '', url: row.url || course.url, creditText: '', score: row.score ?? existing?.score ?? '',
      dueAt, opensAt, creditPercent: null, deadlineKind: dueAt ? 'on_time' : null,
      sourceStatus: row.section, sourceComplete: row.sourceComplete ?? existing?.sourceComplete ?? null,
      problemCount: row.problemCount ?? existing?.problemCount ?? null,
      completedProblemCount: row.completedProblemCount ?? existing?.completedProblemCount ?? null,
      seenAt: importedAt,
      doneOverride: existing?.doneOverride ?? null,
      deadlineOverride: existing?.deadlineOverride ?? null,
    };
    if (existing) Object.assign(existing, task);
    else state.tasks.push(task);
  }
  if (!incoming.size) throw new Error('没有识别到有效的 WeBWorK 作业，原有数据已保留。');
  state.tasks = state.tasks.filter(task => task.courseId !== courseId || incoming.has(task.id));
  course.name = page.courseTitle || course.name;
  course.platform = 'webwork';
  course.lastSyncedAt = importedAt;
  return incoming.size;
}

module.exports = { dataPath, defaultPreferences, emptyState, loadState, saveState, normalizeCourseUrl, coursePlatform, mergeRows, mergeWebworkRows };
