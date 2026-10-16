let state = null;
let selectedScope = 'all';
let selectedTab = 'pending';
let settingsPanel = 'general';
let settingsCourseId = null;
let editingTaskId = null;
let wechatFormDirty = false;
let emailFormDirty = false;
let reminderFormDirty = false;
let examLeadsDirty = false;
let selectedTaskId = null;
let showArchived = false;
let searchTerm = '';
let calendarCursor = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), 1, 12));
let inspectorTasks = [];
let updateStatus = { kind: 'checking', currentVersion: '1.3.8' };
let promptedUpdate = null;
let onboardingActive = false;
let pendingBackup = null;
let macNotificationStatus = 'checking';
let selectedExamId = null;
let examFilter = 'all';
let showArchivedExams = false;
let editingExamId = null;

const $ = id => document.getElementById(id);
const taskStatus = window.TaskStatus;
const i18n = window.UBCI18n;
const dueOf = taskStatus.effectiveDue;
function completionOptions() {
  return {
    ...(state?.preferences || {}),
    ignoredSectionsByCourse: Object.fromEntries((state?.courses || []).map(course => [course.id, course.ignoredSections || []])),
  };
}
function completionStatus(task) { return taskStatus.completionStatus(task, completionOptions()); }
function isDone(task) { return taskStatus.isComplete(task, completionOptions()); }
function categoryOf(task, now = Date.now()) { return taskStatus.categoryOf(task, now, completionOptions()); }
function needsAttention(task, now = Date.now()) { return taskStatus.needsAttention(task, now, completionOptions()); }
const platformNames = { prairielearn: 'PrairieLearn', webwork: 'WeBWorK', gradescope: 'Gradescope' };
const platformMarks = { prairielearn: ['pl', 'PL'], webwork: ['ww', 'W'], gradescope: ['gs', 'G'] };
const platformFolders = {
  prairielearn: ['pl-count', 'nav-prairielearn', 'pl-folder', 'pl-courses'],
  webwork: ['ww-count', 'nav-webwork', 'ww-folder', 'ww-courses'],
  gradescope: ['gs-count', 'nav-gradescope', 'gs-folder', 'gs-courses'],
};
function sourceMark(platform, extra = '') {
  const [style, label] = platformMarks[platform] || platformMarks.prairielearn;
  return node('span', `source-mark ${extra} ${style}`, label);
}
const settingNames = { general: '常规与窗口', reminders: '提醒与同步', courses: '课程与登录', data: '数据与退出' };
const tabNames = { all: '全部', pending: '待完成', future: '将开放', history: '已过日期', done: '已完成', ignored: '已忽略' };
const priorityNames = { high: '高优先级', medium: '中优先级', low: '低优先级' };
const syncErrorNames = { login: '需要重新登录', network: '网络连接失败', parse: '页面解析失败', page: '页面不匹配', unknown: '同步失败' };
const staleAfterMs = 6 * 60 * 60 * 1000;

async function api(path, method = 'GET', body) {
  const headers = body === undefined ? {} : { 'Content-Type': 'application/json' };
  if (window.UBC_NATIVE_TOKEN) headers['X-UBC-Native-Token'] = window.UBC_NATIVE_TOKEN;
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 404 && path.startsWith('/api/prairietest/')) {
      throw new Error('当前运行的后台不支持 PrairieTest 同步。请完全退出应用后重新打开；若仍出现此提示，请安装包含考试提醒功能的新版。');
    }
    throw new Error(data.error || '操作失败。');
  }
  return data;
}

function message(value, error = false) {
  const element = $('message');
  element.textContent = value;
  element.classList.toggle('error', error);
  element.hidden = false;
  clearTimeout(message.timer);
  message.timer = setTimeout(() => { element.hidden = true; }, 12000);
}

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}

function coursePlatform(course) {
  return course?.platform || (course?.url?.includes('webwork.elearning.ubc.ca') ? 'webwork'
    : course?.url?.includes('gradescope.ca') ? 'gradescope' : 'prairielearn');
}

function courseAccessConfirmed(course) {
  return Boolean(course?.accessConfirmedAt && Number.isFinite(Date.parse(course.accessConfirmedAt)));
}

function courseFor(task) { return state.courses.find(course => course.id === task.courseId); }
const academicTerms = { W1: '冬季 · Term 1', W2: '冬季 · Term 2', WA: '冬季 · 全学期', S1: '夏季 · Term 1', S2: '夏季 · Term 2', SA: '夏季 · 全学期', unknown: '待分类' };
function academicYearLabel(year) { return `${year}/${String(Number(year) + 1).slice(-2)}`; }
function periodAcademicYear(code) { return code ? String(Number(code.slice(0, 4)) - (code[4] === 'S' ? 1 : 0)) : ''; }
function currentAcademicPeriod(now = new Date()) {
  const { month, year } = UBCClock.parts(now);
  return `${month <= 4 ? year - 1 : year}${month <= 4 ? 'W2' : month <= 6 ? 'S1' : month <= 8 ? 'S2' : 'W1'}`;
}
function periodLabel() {
  const year = state.preferences?.academicYear || '';
  const term = state.preferences?.academicTerm || '';
  return [year ? academicYearLabel(year) : '所有学年', academicTerms[term] || '所有学期'].join(' · ');
}
function courseInPeriod(course) {
  if (!showArchived && course.archived) return false;
  const year = state.preferences?.academicYear || '';
  const term = state.preferences?.academicTerm || '';
  const code = course.academicPeriod || null;
  if (year && periodAcademicYear(code) !== year) return false;
  if (term === 'unknown') return !year && !code;
  return !term || code?.slice(4) === term || ['W1', 'W2', 'S1', 'S2'].includes(term) && code?.slice(4) === `${term[0]}A`;
}
function filteredCourses() { return state.courses.filter(courseInPeriod); }
function filteredTasks() {
  const ids = new Set(filteredCourses().map(course => course.id));
  return state.tasks.filter(task => ids.has(task.courseId));
}
function renderAcademicFilter() {
  const year = $('academic-year');
  const selectedYear = state.preferences?.academicYear || '';
  const years = [...new Set(state.courses.map(course => periodAcademicYear(course.academicPeriod)).filter(Boolean))].sort().reverse();
  year.replaceChildren(new Option('所有学年', ''));
  for (const value of years) year.append(new Option(academicYearLabel(value), value));
  if (selectedYear && !years.includes(selectedYear)) year.append(new Option(academicYearLabel(selectedYear), selectedYear));
  year.value = selectedYear;
  const term = $('academic-term');
  term.replaceChildren(new Option('所有学期', ''));
  for (const [code, label] of Object.entries(academicTerms)) {
    if (code !== 'unknown' || !selectedYear) term.append(new Option(label, code));
  }
  term.value = state.preferences?.academicTerm || '';
  $('show-archived').checked = showArchived;
  const exactPeriod = selectedYear && state.preferences?.academicTerm && state.preferences.academicTerm !== 'unknown';
  const periodCourses = exactPeriod ? state.courses.filter(course => periodAcademicYear(course.academicPeriod) === selectedYear &&
    course.academicPeriod?.slice(4) === state.preferences.academicTerm) : [];
  const archiveAction = $('archive-period');
  archiveAction.hidden = !exactPeriod || !periodCourses.length;
  archiveAction.textContent = periodCourses.every(course => course.archived) ? '恢复当前学期' : '归档当前学期';
}
function completionInfo(task) {
  const status = completionStatus(task);
  if (status.source === 'manual') return { ...status, label: status.complete ? '已完成' : '未完成', source: '用户手动设置' };
  if (status.source === 'score') return { ...status, label: '已完成', source: '成绩达到 100%' };
  if (status.source === 'confirmation_required') return { ...status, label: '待确认', source: '成绩达到 100%，等待手动确认' };
  if (status.source === 'website') return { ...status, label: status.complete ? '已完成' : '未完成', source: '课程网站状态' };
  return { ...status, label: '未知', source: '网站未提供可靠状态' };
}

function statusName(task) {
  const category = categoryOf(task);
  if (category === 'ignored') return '已忽略';
  if (category === 'history' && task.sourceStatus === 'past_due') return '已截止';
  if (category === 'pending' && completionStatus(task).source === 'confirmation_required') return '待确认';
  if (category === 'pending' && task.sourceStatus === 'open' && task.sourceComplete === false) return '完成中';
  if (category === 'pending' && completionInfo(task).complete === null) return '待确认';
  if (category === 'pending' && task.doneOverride === false) return '未完成';
  return tabNames[category];
}

function formatDate(iso) {
  if (!iso) return '暂无日期';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '暂无日期';
  return UBCClock.format(i18n.locale(), {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }, date);
}

function localDateInput(iso) {
  if (!iso) return '';
  return UBCClock.inputValue(iso);
}

function examTimeInput(iso) {
  return iso ? localDateInput(iso).replace(/-/g, '/').replace('T', ' ') : '';
}

function parseExamTimeInput(id) {
  const value = $(id).value.trim();
  if (!value) return null;
  const match = /^(20\d{2})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('时间格式应为 YYYY/MM/DD HH:mm。');
  const input = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
  const date = UBCClock.parseInput(input);
  if (!Number.isFinite(date.getTime()) || UBCClock.inputValue(date) !== input) throw new Error('日期或时间无效，请检查输入。');
  return date.toISOString();
}

function shortCourseName(course) {
  const name = course.name || '';
  const match = name.match(/\b([A-Z]{2,5})[_\s]*(?:V[_\s]*)?(\d{3})\b/i);
  const term = course.academicPeriod || name.match(/\b20\d{2}[WS][12A]?\b/i)?.[0];
  if (match) return `${match[1].toUpperCase()} ${match[2]}${term ? ` · ${term}` : ''}`;
  return name.length > 30 ? `${name.slice(0, 29)}…` : name;
}

function courseSyncStatus(course, now = Date.now()) {
  if (course.archived) return { kind: 'archived', text: '已归档' };
  if (!courseAccessConfirmed(course)) return { kind: 'review', text: '等待确认课程归属' };
  if (state.syncingCourseIds?.includes(course.id)) return { kind: 'syncing', text: '正在同步…' };
  const syncedAt = Date.parse(course.lastSyncedAt || '');
  const stale = !Number.isFinite(syncedAt) || now - syncedAt > staleAfterMs;
  if (course.lastSyncError) {
    const label = syncErrorNames[course.lastSyncErrorKind] || syncErrorNames.unknown;
    const cached = Number.isFinite(syncedAt) ? `；保留 ${formatDate(course.lastSyncedAt)} 的数据` : '；尚无可用缓存';
    return { kind: 'error', text: `${label}：${course.lastSyncError}${cached}` };
  }
  if (!Number.isFinite(syncedAt)) return { kind: 'never', text: '尚未成功同步' };
  if (stale) return { kind: 'stale', text: `数据可能过旧 · 上次同步 ${formatDate(course.lastSyncedAt)}` };
  return { kind: 'fresh', text: `上次同步 ${formatDate(course.lastSyncedAt)}` };
}

function visibleTasks() {
  let tasks = filteredTasks();
  if (selectedScope.startsWith('platform:')) {
    const platform = selectedScope.slice('platform:'.length);
    tasks = tasks.filter(task => coursePlatform(courseFor(task)) === platform);
  }
  if (selectedScope.startsWith('course:')) {
    const courseId = selectedScope.slice('course:'.length);
    tasks = tasks.filter(task => task.courseId === courseId);
  }
  if (searchTerm) tasks = tasks.filter(task => [task.name, task.code, task.section, courseFor(task)?.name, platformNames[coursePlatform(courseFor(task))]]
    .filter(Boolean).some(value => value.toLocaleLowerCase().includes(searchTerm)));
  return tasks;
}

function setDot(element, show) { element.hidden = !show; }

function renderFolders() {
  renderAcademicFilter();
  const workRoute = !location.hash.startsWith('#settings') && !location.hash.startsWith('#calendar') && !location.hash.startsWith('#dashboard') && !location.hash.startsWith('#exams');
  const allPending = filteredTasks().filter(task => needsAttention(task)).length;
  $('all-count').textContent = allPending || '';
  $('all-folder').classList.toggle('active', workRoute && selectedScope === 'all');
  $('nav-all').classList.toggle('active', workRoute && selectedScope === 'all');
  $('nav-calendar').classList.toggle('active', location.hash.startsWith('#calendar'));
  $('nav-dashboard').classList.toggle('active', location.hash.startsWith('#dashboard'));
  $('nav-exams').classList.toggle('active', location.hash.startsWith('#exams'));
  $('nav-exams').querySelector('.notification-dot').hidden = !(state.exams || []).some(exam => !exam.archived && !exam.linkedExamId && examCategory(exam) !== 'ended' &&
    (exam.source !== 'prairietest' || state.prairieTest?.lastSyncedAt &&
      Date.parse(exam.lastSyncedAt || '') >= Date.parse(state.prairieTest.lastSyncedAt)));
  for (const platform of Object.keys(platformFolders)) {
    const [countId, railId, groupId, containerId] = platformFolders[platform];
    const courses = filteredCourses().filter(course => coursePlatform(course) === platform);
    const tasks = filteredTasks().filter(task => coursePlatform(courseFor(task)) === platform);
    const hasPending = tasks.some(task => needsAttention(task));
    $(countId).textContent = tasks.filter(task => needsAttention(task)).length || '';
    const rail = $(railId);
    const group = $(groupId);
    setDot(rail.querySelector('.notification-dot'), hasPending);
    setDot(group.querySelector('.notification-dot'), hasPending);
    const selectedCourse = selectedScope.startsWith('course:') ? state.courses.find(course => course.id === selectedScope.slice(7)) : null;
    rail.classList.toggle('active', workRoute && (selectedScope === `platform:${platform}` || coursePlatform(selectedCourse) === platform && Boolean(selectedCourse)));
    group.classList.toggle('active', selectedScope === `platform:${platform}`);
    const container = $(containerId);
    container.replaceChildren();
    for (const course of courses) {
      const button = node('button', 'course-folder');
      button.type = 'button';
      button.dataset.i18nSkip = '';
      button.title = course.name;
      const syncStatus = courseSyncStatus(course);
      button.title = `${course.name} · ${i18n.translate(syncStatus.text)}`;
      button.classList.toggle('sync-warning', ['error', 'stale', 'never', 'review'].includes(syncStatus.kind));
      button.classList.toggle('active', selectedScope === `course:${course.id}`);
      button.append(sourceMark(platform));
      const name = node('span', 'course-name', shortCourseName(course));
      name.dataset.i18nSkip = '';
      button.append(name);
      const dot = node('span', 'notification-dot');
      const pendingCount = tasks.filter(task => task.courseId === course.id && needsAttention(task)).length;
      dot.hidden = pendingCount === 0;
      button.append(dot);
      button.append(node('span', 'course-count', pendingCount || ''));
      button.addEventListener('click', () => navigateWork(`course:${course.id}`));
      container.append(button);
    }
    if (!courses.length) container.append(node('p', 'folder-empty', '尚未添加课程'));
  }
}

function rowDate(task) {
  if (task.sourceStatus === 'future' && !task.deadlineOverride) {
    return { value: task.opensAt, label: '开放时间' };
  }
  if (task.sourceStatus === 'past_due' && !task.deadlineOverride) {
    return { value: null, label: '网页标记已截止', text: '已截止' };
  }
  if (task.deadlineOverride) return { value: task.deadlineOverride, label: '手动提醒日期' };
  if (task.deadlineKind === 'credit_window') return { value: task.dueAt, label: '当前得分阶段结束' };
  if (task.dueAt) return { value: task.dueAt, label: '截止时间' };
  return { value: null, label: '网页没有显示截止时间' };
}

function scorePercent(task) {
  const match = String(task.score || '').match(/^\s*(\d+(?:\.\d+)?)\s*%/);
  return match ? Math.max(0, Math.min(100, Number(match[1]))) : null;
}

function scoreBar(task) {
  const percent = scorePercent(task);
  const bar = node('div', `score-bar${percent === null ? ' no-score' : ''}`);
  if (percent === null) {
    bar.append(node('span', 'score-value', '暂无成绩'));
  } else {
    const fill = node('span', 'score-fill');
    fill.style.width = `${percent}%`;
    bar.append(fill, node('span', 'score-value', `${percent}%`));
  }
  bar.setAttribute('aria-label', percent === null ? '暂无成绩' : `成绩 ${percent}%`);
  return bar;
}

async function toggleTaskCompletion(task) {
  try {
    state = await api('/api/task', 'PATCH', { id: task.id, doneOverride: !isDone(task) });
    render();
  } catch (error) { message(error.message, true); }
}

async function restoreTaskCompletion(task) {
  try {
    state = await api('/api/task', 'PATCH', { id: task.id, doneOverride: null });
    render();
  } catch (error) { message(error.message, true); }
}

async function setSectionIgnored(courseId, section, ignored) {
  state = await api('/api/course/category', 'PATCH', { courseId, section, ignored });
  render();
}

function taskRow(task) {
  const row = node('article', 'assignment-row');
  row.dataset.taskId = task.id;
  row.tabIndex = 0;
  row.setAttribute('aria-label', `查看 ${task.name} 的详情`);
  const main = node('div', 'assignment-main');
  const course = courseFor(task);
  main.append(sourceMark(coursePlatform(course)));
  const description = node('div', 'assignment-description');
  if (task.code && task.code !== task.name) {
    const code = node('span', 'assignment-code', task.code);
    code.dataset.i18nSkip = '';
    description.append(code);
  }
  const title = node(courseAccessConfirmed(course) ? 'a' : 'span', 'assignment-title', task.name);
  title.dataset.i18nSkip = '';
  if (courseAccessConfirmed(course)) {
    title.href = task.url;
    title.target = '_blank';
    title.rel = 'noopener noreferrer';
  }
  description.append(title);
  if (task.priority) description.append(node('span', `priority-badge ${task.priority}`, priorityNames[task.priority]));
  const meta = node('div', 'assignment-meta', [course ? shortCourseName(course) : '', platformNames[coursePlatform(course)], task.section, task.note ? i18n.translate('有个人备注') : ''].filter(Boolean).join(' · '));
  meta.dataset.i18nSkip = '';
  description.append(meta);
  main.append(description);

  const dateInfo = rowDate(task);
  const date = node('div', 'assignment-date');
  if (dateInfo.value) {
    const time = node('time', '', formatDate(dateInfo.value));
    time.dateTime = dateInfo.value;
    date.append(time);
  } else date.append(node('span', '', dateInfo.text || '暂无日期'));
  date.append(node('small', '', dateInfo.label));
  if (dateInfo.value && !isDone(task) && new Date(dateInfo.value).getTime() - Date.now() < 24 * 3600000 && categoryOf(task) === 'pending') date.classList.add('urgent');
  if (!dateInfo.value) date.classList.add('unknown');

  const category = categoryOf(task);
  const status = node('span', `status-label ${category === 'history' ? 'late' : category}`, statusName(task));
  const actions = node('div', 'row-actions');
  if (category === 'ignored') {
    const restore = node('button', '', '恢复管理');
    restore.type = 'button';
    restore.addEventListener('click', () => setSectionIgnored(task.courseId, task.section, false).catch(error => message(error.message, true)));
    actions.append(restore);
  } else {
    const edit = node('button', '', '改日期');
    edit.type = 'button';
    edit.addEventListener('click', () => editDeadline(task));
    const toggle = node('button', '', isDone(task) ? '标为未完成' : '标为完成');
    toggle.type = 'button';
    toggle.addEventListener('click', () => toggleTaskCompletion(task));
    actions.append(edit, toggle);
  }
  row.append(main, date, status, scoreBar(task), actions);
  row.addEventListener('click', event => {
    if (event.target.closest('a,button')) return;
    selectedTaskId = task.id;
    renderSelection();
  });
  row.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target === row) {
      event.preventDefault();
      selectedTaskId = task.id;
      renderSelection();
    }
  });
  return row;
}

function taskSection(title, tasks, recent = false, category = selectedTab) {
  const section = node('section', 'source-section');
  const heading = node('div', 'source-heading');
  heading.append(node('h2', '', title), node('span', 'source-caption', `${tasks.length} 项`));
  const list = node('div', 'assignment-list');
  const header = node('div', 'list-header');
  for (const label of ['作业', category === 'future' && !recent ? '开放时间' : '日期', '状态', '成绩']) header.append(node('span', '', label));
  list.append(header);
  for (const task of tasks) list.append(taskRow(task));
  section.append(heading, list);
  return section;
}

function calendarEvents(task) {
  const events = [];
  if (task.opensAt && Number.isFinite(Date.parse(task.opensAt))) events.push({ kind: 'open', at: task.opensAt, task });
  if (task.deadlineOverride && Number.isFinite(Date.parse(task.deadlineOverride))) events.push({ kind: 'manual', at: task.deadlineOverride, task });
  else if (task.dueAt && Number.isFinite(Date.parse(task.dueAt))) events.push({ kind: 'due', at: task.dueAt, task });
  return events;
}

function sameLocalDay(first, second) {
  return first.toISOString().slice(0, 10) === UBCClock.dateKey(second);
}

function renderCalendar(tasks, container) {
  const calendar = node('section', 'calendar-view');
  const toolbar = node('div', 'calendar-toolbar');
  const title = node('h2', '', new Intl.DateTimeFormat(i18n.locale(), { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(calendarCursor));
  const legend = node('div', 'calendar-legend');
  for (const [kind, label] of [['due', '截止'], ['open', '开放'], ['manual', '手动日期']]) {
    const item = node('span');
    item.append(node('i', kind), document.createTextNode(label));
    legend.append(item);
  }
  const controls = node('div', 'calendar-controls');
  const todayButton = node('button', '', '今天');
  todayButton.type = 'button';
  todayButton.addEventListener('click', () => {
    const today = new Date();
    const { year, month } = UBCClock.parts(today);
    calendarCursor = new Date(Date.UTC(year, month - 1, 1, 12));
    renderCalendarPage();
  });
  controls.append(todayButton);
  for (const [direction, label, text] of [[-1, '上个月', '‹'], [1, '下个月', '›']]) {
    const button = node('button', '', text);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => {
      calendarCursor = new Date(Date.UTC(calendarCursor.getUTCFullYear(), calendarCursor.getUTCMonth() + direction, 1, 12));
      renderCalendarPage();
    });
    controls.append(button);
  }
  toolbar.append(controls, title, legend);
  calendar.append(toolbar);

  const grid = node('div', 'calendar-grid');
  grid.setAttribute('role', 'grid');
  for (const weekday of ['日', '一', '二', '三', '四', '五', '六']) grid.append(node('div', 'calendar-weekday', weekday));
  const first = new Date(Date.UTC(calendarCursor.getUTCFullYear(), calendarCursor.getUTCMonth(), 1, 12));
  const gridStart = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1 - first.getUTCDay(), 12));
  const events = tasks.flatMap(calendarEvents);
  const today = new Date();
  for (let index = 0; index < 42; index++) {
    const day = new Date(Date.UTC(gridStart.getUTCFullYear(), gridStart.getUTCMonth(), gridStart.getUTCDate() + index, 12));
    const cell = node('div', 'calendar-day');
    cell.setAttribute('role', 'gridcell');
    cell.classList.toggle('outside', day.getUTCMonth() !== calendarCursor.getUTCMonth());
    cell.classList.toggle('today', sameLocalDay(day, today));
    const dateLabel = node('time', 'calendar-date', String(day.getUTCDate()));
    dateLabel.dateTime = day.toISOString().slice(0, 10);
    cell.append(dateLabel);
    for (const event of events.filter(item => sameLocalDay(day, new Date(item.at)))) {
      const typeName = { due: '截止', open: '开放', manual: '手动日期' }[event.kind];
      const time = UBCClock.format(i18n.locale(), { hour: '2-digit', minute: '2-digit', hour12: false }, event.at);
      const button = node('button', `calendar-event ${event.kind}`, `${time}  ${event.task.name}`);
      button.type = 'button';
      button.dataset.i18nSkip = '';
      button.title = `${i18n.translate(typeName)} · ${formatDate(event.at)} · ${event.task.name}`;
      button.setAttribute('aria-label', `${event.task.name}, ${i18n.translate(typeName)} ${formatDate(event.at)}`);
      button.addEventListener('click', () => {
        selectedTaskId = event.task.id;
        renderSelection();
      });
      cell.append(button);
    }
    grid.append(cell);
  }
  calendar.append(grid);
  container.append(calendar);

  const undated = tasks.filter(task => calendarEvents(task).length === 0);
  if (undated.length) container.append(node('div', 'calendar-undated', `${undated.length} 项作业尚未公布有效日期，可在“全部作业”中查看。`));
}

function renderCalendarPage() {
  const tasks = filteredTasks().filter(task => !searchTerm || [task.name, task.code, task.section, courseFor(task)?.name, platformNames[coursePlatform(courseFor(task))]]
    .filter(Boolean).some(value => value.toLocaleLowerCase().includes(searchTerm)));
  $('calendar-breadcrumb').textContent = `日历 / ${new Intl.DateTimeFormat(i18n.locale(), { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(calendarCursor)}`;
  $('calendar-today-label').textContent = UBCClock.format(i18n.locale(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }, new Date());
  inspectorTasks = [...tasks];
  if (!inspectorTasks.some(task => task.id === selectedTaskId)) selectedTaskId = inspectorTasks[0]?.id || null;
  const container = $('calendar-content');
  container.replaceChildren();
  renderCalendar(tasks, container);
  renderSelection();
}

function dashboardMetric(value, label, kind = '') {
  const tile = node('div', `dashboard-metric ${kind}`);
  tile.append(node('strong', '', String(value)), node('span', '', label));
  return tile;
}

function renderDashboardPage() {
  const tasks = filteredTasks().filter(task => categoryOf(task) !== 'ignored');
  const courses = filteredCourses();
  const now = Date.now();
  const pending = tasks.filter(task => needsAttention(task));
  const done = tasks.filter(task => categoryOf(task) === 'done');
  const future = tasks.filter(task => categoryOf(task) === 'future');
  const weekDue = pending.filter(task => { const due = Date.parse(dueOf(task) || ''); return due >= now && due < now + 7 * 86400000; });
  $('dashboard-breadcrumb').textContent = `概览 / ${periodLabel()}`;
  const root = $('dashboard-content');
  root.replaceChildren();
  const context = node('div', 'dashboard-period-context', `当前范围：${periodLabel()} · ${courses.length} 门课程`);
  const manage = node('button', 'secondary-button', '管理学期');
  manage.type = 'button';
  manage.addEventListener('click', () => navigateSettings('courses'));
  context.append(manage);
  const main = node('div', 'dashboard-main');
  const metrics = node('div', 'dashboard-metrics');
  metrics.append(dashboardMetric(pending.length, '需处理', 'attention'), dashboardMetric(weekDue.length, '本周截止'),
    dashboardMetric(future.length, '将开放'), dashboardMetric(done.length, '已完成'));
  main.append(metrics);
  const chart = node('section', 'dashboard-panel');
  chart.append(node('h2', '', '未来 14 天截止分布'));
  const bars = node('div', 'dashboard-bars');
  const today = UBCClock.parts(new Date());
  const dayStart = new Date(Date.UTC(today.year, today.month - 1, today.day, 12));
  const daily = Array.from({ length: 14 }, (_, offset) => {
    const day = new Date(Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), dayStart.getUTCDate() + offset, 12));
    const key = day.toISOString().slice(0, 10);
    return pending.filter(task => { const due = dueOf(task); return due && Number.isFinite(Date.parse(due)) && UBCClock.dateKey(due) === key; });
  });
  const max = Math.max(1, ...daily.map(items => items.length));
  for (let index = 0; index < 14; index++) {
    const day = new Date(Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), dayStart.getUTCDate() + index, 12));
    const column = node('div', 'dashboard-bar-column');
    const stack = node('div', 'dashboard-bar-stack');
    stack.style.height = `${Math.max(2, daily[index].length / max * 100)}%`;
    for (const platform of Object.keys(platformFolders)) {
      const count = daily[index].filter(task => coursePlatform(courseFor(task)) === platform).length;
      if (!count) continue;
      const segment = node('span', `dashboard-bar-segment ${platform}`);
      segment.style.flex = String(count);
      stack.append(segment);
    }
    column.title = `${new Intl.DateTimeFormat(i18n.locale(), { month: 'numeric', day: 'numeric', timeZone: 'UTC' }).format(day)} · ${daily[index].length} 项`;
    column.append(stack, node('small', '', new Intl.DateTimeFormat(i18n.locale(), { month: 'numeric', day: 'numeric', timeZone: 'UTC' }).format(day)));
    bars.append(column);
  }
  chart.append(bars); main.append(chart);
  const status = node('section', 'dashboard-panel dashboard-status');
  status.append(node('h2', '', '任务状态'));
  const statusBody = node('div', 'dashboard-status-body');
  const history = tasks.filter(task => categoryOf(task) === 'history');
  const open = tasks.filter(task => categoryOf(task) === 'pending');
  const total = Math.max(1, tasks.length);
  const doneEnd = done.length / total * 100;
  const pendingEnd = doneEnd + open.length / total * 100;
  const futureEnd = pendingEnd + future.length / total * 100;
  const donut = node('div', 'dashboard-donut');
  donut.style.background = `conic-gradient(#69b68b 0 ${doneEnd}%, #e49763 ${doneEnd}% ${pendingEnd}%, #838893 ${pendingEnd}% ${futureEnd}%, #545965 ${futureEnd}% 100%)`;
  donut.append(node('span', '', String(tasks.length)));
  const legend = node('div', 'dashboard-status-legend');
  for (const [kind, label, count] of [['done', '已完成', done.length], ['pending', '待完成', open.length],
    ['future', '将开放', future.length], ['history', '已过日期', history.length]]) {
    const item = node('div', kind); item.append(node('span', '', label), node('strong', '', String(count))); legend.append(item);
  }
  statusBody.append(donut, legend); status.append(statusBody); main.append(status);
  const workload = node('section', 'dashboard-panel');
  workload.append(node('h2', '', '课程任务负载'));
  for (const course of courses) {
    const items = tasks.filter(task => task.courseId === course.id);
    const row = node('div', 'dashboard-workload-row');
    row.append(sourceMark(coursePlatform(course)), node('span', 'dashboard-course-name', shortCourseName(course)));
    const track = node('div', 'dashboard-progress');
    for (const [kind, count] of [['done', items.filter(task => categoryOf(task) === 'done').length],
      ['pending', items.filter(task => categoryOf(task) === 'pending').length],
      ['future', items.filter(task => categoryOf(task) === 'future').length],
      ['history', items.filter(task => categoryOf(task) === 'history').length]]) {
      if (count) { const part = node('span', kind); part.style.flex = String(count); track.append(part); }
    }
    row.append(track, node('span', '', `${items.filter(task => categoryOf(task) === 'done').length} / ${items.length}`));
    workload.append(row);
  }
  if (!courses.length) workload.append(node('p', 'form-note', '当前学期没有课程，可在课程设置中分类。'));
  main.append(workload);
  const sidebar = node('aside', 'dashboard-highlights');
  sidebar.append(node('h2', '', '近期重点'));
  const highlights = [...weekDue].sort((a, b) => Date.parse(dueOf(a)) - Date.parse(dueOf(b))).slice(0, 4);
  if (!highlights.length) sidebar.append(node('p', 'form-note', '未来七天没有待完成的作业。'));
  for (const task of highlights) {
    const item = node('button', 'dashboard-highlight');
    item.type = 'button';
    item.append(sourceMark(coursePlatform(courseFor(task))), node('span', '', `${task.name} · ${formatDate(dueOf(task))}`));
    item.addEventListener('click', () => { selectedTaskId = task.id; navigateWork(`course:${task.courseId}`); selectedTab = 'all'; render(); });
    sidebar.append(item);
  }
  sidebar.append(node('h2', '', '最近完成'));
  for (const task of done.slice(-3).reverse()) sidebar.append(node('div', 'dashboard-highlight static', `${task.name} · ${shortCourseName(courseFor(task))}`));
  root.append(context, main, sidebar);
}

function examCategory(exam) {
  if (['ended', 'cancelled'].includes(exam.status) || exam.status === 'reserved' && exam.startsAt && exam.durationMinutes &&
      Date.parse(exam.startsAt) + exam.durationMinutes * 60000 < Date.now()) return 'ended';
  return exam.status;
}
function examStatusLabel(exam) {
  return { unreserved: '待预约', reserved: '已预约', ended: '已结束', cancelled: '已取消' }[examCategory(exam) === 'ended' && exam.status === 'cancelled' ? 'cancelled' : examCategory(exam)] || '未知';
}
function visibleExams() {
  const latestSync = Date.parse(state.prairieTest?.lastSyncedAt || '');
  return (state.exams || []).filter(exam => !exam.linkedExamId && (showArchivedExams ||
    !exam.archived && (exam.source !== 'prairietest' || !Number.isFinite(latestSync) ||
      Date.parse(exam.lastSyncedAt || '') >= latestSync)));
}
function examLocalTime(value) {
  if (!value) return '尚未公布';
  const date = new Date(value);
  const zone = UBCClock.label();
  const minutes = UBCClock.offsetMinutes(date);
  const sign = minutes < 0 ? '-' : '+';
  const offset = `UTC${sign}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0')}:${String(Math.abs(minutes) % 60).padStart(2, '0')}`;
  return `${formatDate(value)} · ${zone || offset}`;
}
function examSourceTime(exam) {
  if (!exam.startsAt || !exam.sourceTimeZone) return '未提供';
  try { return `${UBCClock.format(i18n.locale(), { dateStyle: 'medium', timeStyle: 'short' }, exam.startsAt, exam.sourceTimeZone)} · ${exam.sourceTimeZone}`; }
  catch { return '未提供'; }
}
function examDetailField(list, label, value) {
  list.append(node('dt', '', label), node('dd', '', value || '未提供'));
}
function examCourseOptions(select, selected = '') {
  select.replaceChildren(new Option('不关联', ''));
  for (const course of state.courses) select.append(new Option(shortCourseName(course), course.id));
  select.value = selected || '';
}
function examPeriodOptions(select, selected = '') {
  select.replaceChildren(new Option('待分类', ''));
  const years = new Set(state.courses.map(course => course.academicPeriod?.slice(0, 4)).filter(Boolean));
  const now = UBCClock.parts(new Date()).year;
  for (let year = now - 1; year <= now + 2; year++) years.add(String(year));
  if (selected) years.add(selected.slice(0, 4));
  for (const year of [...years].sort().reverse()) for (const [term, label] of Object.entries(academicTerms)) {
    if (term === 'unknown') continue;
    select.append(new Option(`${year} · ${label}`, `${year}${term}`));
  }
  select.value = selected || '';
}
function renderExamPage() {
  const all = visibleExams();
  const counts = { all: all.length, unreserved: 0, reserved: 0, ended: 0 };
  for (const exam of all) counts[examCategory(exam)]++;
  for (const [key, count] of Object.entries(counts)) $('exam-count-' + key).textContent = count;
  for (const button of document.querySelectorAll('[data-exam-filter]')) button.classList.toggle('active', button.dataset.examFilter === examFilter);
  $('show-archived-exams').checked = showArchivedExams;
  const activeCount = (state.exams || []).filter(exam => !exam.archived && !exam.linkedExamId && examCategory(exam) !== 'ended' &&
    (exam.source !== 'prairietest' || state.prairieTest?.lastSyncedAt &&
      Date.parse(exam.lastSyncedAt || '') >= Date.parse(state.prairieTest.lastSyncedAt))).length;
  $('nav-exams').querySelector('.notification-dot').hidden = activeCount === 0;
  const synced = state.prairieTest?.lastSyncedAt;
  $('prairietest-status').textContent = state.syncingPrairieTest ? '正在只读同步 PrairieTest…' :
    `${synced ? `上次同步：${formatDate(synced)}` : '尚未同步 PrairieTest。'}${state.prairieTest?.lastError ? ` · 同步失败，已保留上次数据：${state.prairieTest.lastError}` : ''}`;
  $('prairietest-status').classList.toggle('error', Boolean(state.prairieTest?.lastError));
  $('sync-prairietest').disabled = Boolean(state.syncingPrairieTest);
  const list = $('exam-list'); list.replaceChildren();
  const filtered = all.filter(exam => (examFilter === 'all' || examCategory(exam) === examFilter) &&
    (!searchTerm || [exam.title, exam.courseName, exam.location].some(value => String(value || '').toLocaleLowerCase().includes(searchTerm))))
    .sort((a, b) => (Date.parse(a.startsAt || a.reservationDeadline || '') || Infinity) - (Date.parse(b.startsAt || b.reservationDeadline || '') || Infinity));
  if (!filtered.some(exam => exam.id === selectedExamId)) selectedExamId = filtered[0]?.id || null;
  if (!filtered.length) list.append(node('p', 'form-note', '当前分类暂无考试。可手动添加，或登录 PrairieTest 后只读同步。'));
  for (const exam of filtered) {
    const stale = exam.source === 'prairietest' && (!state.prairieTest?.lastSyncedAt ||
      Date.parse(exam.lastSyncedAt || '') < Date.parse(state.prairieTest.lastSyncedAt));
    const item = node('button', `exam-list-item${exam.id === selectedExamId ? ' active' : ''}`);
    item.type = 'button'; item.setAttribute('aria-current', String(exam.id === selectedExamId));
    item.append(node('span', `exam-status-chip ${examCategory(exam)}`, stale ? '待核实' : examStatusLabel(exam)),
      node('strong', '', exam.title), node('small', '', `${exam.courseName || '未关联课程'} · ${exam.source === 'manual' ? '手动添加' : 'PrairieTest'}`),
      node('small', '', exam.status === 'unreserved' ? exam.startsAt ? `考试时间：${examLocalTime(exam.startsAt)} · 待预约` : exam.reservationDeadline ? `预约截止：${examLocalTime(exam.reservationDeadline)}` : '尚未预约，暂无确定场次'
        : `考试时间：${examLocalTime(exam.startsAt)}`));
    item.addEventListener('click', () => { selectedExamId = exam.id; renderExamPage(); });
    list.append(item);
  }
  const detail = $('exam-detail'); detail.replaceChildren();
  const exam = filtered.find(item => item.id === selectedExamId);
  if (!exam) { detail.append(node('p', 'form-note', '选择考试后可查看预约、时间与提醒信息。')); return; }
  const stale = exam.source === 'prairietest' && (!state.prairieTest?.lastSyncedAt ||
    Date.parse(exam.lastSyncedAt || '') < Date.parse(state.prairieTest.lastSyncedAt));
  detail.append(node('h2', '', exam.title), node('span', `exam-status-chip ${examCategory(exam)}`, examStatusLabel(exam)));
  if (stale) detail.append(node('p', 'exam-error', '这项考试尚未在最近一次 PrairieTest 同步中确认。已保留记录并暂停该项提醒，请在原网站核实。'));
  const fields = node('dl', '');
  examDetailField(fields, '课程', exam.courseName || state.courses.find(course => course.id === exam.courseId)?.name || '未关联');
  examDetailField(fields, '来源', exam.source === 'manual' ? '手动添加' : 'PrairieTest');
  examDetailField(fields, '设备当地时间', examLocalTime(exam.startsAt));
  examDetailField(fields, '来源时区时间', exam.startsAt ? examSourceTime(exam) : '尚未确定场次');
  examDetailField(fields, '时长', exam.durationMinutes ? `${exam.durationMinutes} 分钟` : '未提供');
  examDetailField(fields, '地点或方式', exam.location || '未提供');
  examDetailField(fields, '预约截止', exam.reservationDeadline ? examLocalTime(exam.reservationDeadline) : '未提供');
  examDetailField(fields, '学期', exam.academicPeriod || '待分类');
  examDetailField(fields, '上次同步', exam.lastSyncedAt ? formatDate(exam.lastSyncedAt) : '仅保存在本机');
  detail.append(fields);
  const actions = node('div', 'exam-detail-actions');
  const action = (label, handler, style = 'secondary-button') => {
    const button = node('button', style, label); button.type = 'button'; button.addEventListener('click', handler); actions.append(button); return button;
  };
  if (exam.url) {
    const link = node('a', 'secondary-button', '查看原始页面 ↗'); link.href = exam.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; actions.append(link);
  }
  if (exam.source === 'manual') {
    action('编辑', () => openExamForm(exam));
    action('删除', async () => {
      if (!confirm(i18n.translate(`删除考试 ${exam.title}？`))) return;
      try { state = await api('/api/exam', 'DELETE', { id: exam.id }); selectedExamId = null; render(); }
      catch (error) { message(error.message, true); }
    });
  }
  action(exam.archived ? '恢复考试' : '归档考试', async () => {
    try { state = await api('/api/exam/archive', 'PATCH', { id: exam.id, archived: !exam.archived }); render(); }
    catch (error) { message(error.message, true); }
  });
  detail.append(actions);
  if (exam.source === 'prairietest') {
    const association = node('div', 'exam-association');
    association.append(node('h3', '', '课程与学期'));
    const linkedManual = (state.exams || []).find(item => item.source === 'manual' && item.linkedExamId === exam.id);
    if (linkedManual) {
      association.append(node('p', 'form-note', `已关联手动记录：${linkedManual.title}`));
      const unlink = node('button', 'secondary-button', '解除关联'); unlink.type = 'button';
      unlink.addEventListener('click', async () => {
        try { state = await api('/api/exam/link', 'PATCH', { manualId: linkedManual.id, importedId: null }); render(); }
        catch (error) { message(error.message, true); }
      });
      association.append(unlink);
    }
    const course = document.createElement('select'), period = document.createElement('select');
    course.setAttribute('aria-label', '关联课程'); period.setAttribute('aria-label', '考试学期');
    examCourseOptions(course, exam.courseId); examPeriodOptions(period, exam.academicPeriod);
    const save = node('button', 'secondary-button', '保存分类'); save.type = 'button';
    save.addEventListener('click', async () => {
      try { state = await api('/api/exam/associate', 'PATCH', { id: exam.id, courseId: course.value || null, academicPeriod: period.value || null }); render(); }
      catch (error) { message(error.message, true); }
    });
    association.append(course, period, save);
    const manualCandidates = (state.exams || []).filter(item => item.source === 'manual' && !item.linkedExamId);
    if (manualCandidates.length) {
      const pair = document.createElement('select'); pair.setAttribute('aria-label', '关联手动考试');
      pair.append(new Option('选择手动记录', ''));
      for (const item of manualCandidates) pair.append(new Option(item.title, item.id));
      const link = node('button', 'secondary-button', '确认关联'); link.type = 'button';
      link.addEventListener('click', async () => {
        if (!pair.value || !confirm(i18n.translate('关联后会保留手动记录，但只显示和提醒 PrairieTest 考试。'))) return;
        try { state = await api('/api/exam/link', 'PATCH', { manualId: pair.value, importedId: exam.id }); render(); }
        catch (error) { message(error.message, true); }
      });
      association.append(pair, link);
    }
    detail.append(association);
  }
}

function sortTasks(tasks, category = selectedTab) {
  return tasks.sort((a, b) => {
    if (category === 'pending') {
      const firstNeedsConfirmation = completionStatus(a).source === 'confirmation_required';
      const secondNeedsConfirmation = completionStatus(b).source === 'confirmation_required';
      if (firstNeedsConfirmation !== secondNeedsConfirmation) return firstNeedsConfirmation ? -1 : 1;
    }
    const priorityRank = { high: 0, medium: 1, low: 2 };
    const priorityDifference = (priorityRank[a.priority] ?? 3) - (priorityRank[b.priority] ?? 3);
    if (priorityDifference) return priorityDifference;
    const first = category === 'future' ? a.opensAt : dueOf(a);
    const second = category === 'future' ? b.opensAt : dueOf(b);
    if (first && second) return category === 'history' ? new Date(second) - new Date(first) : new Date(first) - new Date(second);
    if (first) return -1;
    if (second) return 1;
    return a.name.localeCompare(b.name);
  });
}

function taskPersonalEditor(task) {
  const form = node('form', 'task-personal-editor');
  const heading = node('div', 'task-personal-heading');
  heading.append(node('h3', '', '个人安排'), node('span', '', '仅保存在本机'));
  const priorityLabel = node('label');
  priorityLabel.append(node('span', '', '优先级'));
  const priority = document.createElement('select');
  priority.append(new Option('未设置', ''), new Option('高优先级', 'high'), new Option('中优先级', 'medium'), new Option('低优先级', 'low'));
  priority.value = task.priority || '';
  priorityLabel.append(priority);
  const noteLabel = node('label');
  noteLabel.append(node('span', '', '个人备注'));
  const note = document.createElement('textarea');
  note.rows = 4;
  note.maxLength = 1000;
  note.placeholder = '记录准备事项、复习范围或提交说明';
  note.value = task.note || '';
  noteLabel.append(note);
  const actions = node('div', 'task-personal-actions');
  const save = node('button', 'primary-button', '保存安排');
  save.type = 'submit';
  const clear = node('button', 'text-button', '清空备注');
  clear.type = 'button';
  clear.addEventListener('click', () => { note.value = ''; note.focus(); });
  const reset = node('button', 'text-button', '撤销未保存更改');
  reset.type = 'button';
  reset.addEventListener('click', () => { priority.value = task.priority || ''; note.value = task.note || ''; });
  actions.append(save, clear, reset);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    save.disabled = true;
    try {
      state = await api('/api/task', 'PATCH', { id: task.id, priority: priority.value || null, note: note.value });
      render();
      message('个人安排已保存。');
    } catch (error) { message(error.message, true); }
    finally { save.disabled = false; }
  });
  form.append(heading, priorityLabel, noteLabel, actions);
  return form;
}

function renderInspector() {
  const container = $('inspector-content');
  container.replaceChildren();
  const task = inspectorTasks.find(item => item.id === selectedTaskId);
  if (!task) {
    container.append(node('p', 'inspector-empty', '选择一项作业，即可在这里查看日期、成绩和操作。'));
    return;
  }
  const course = courseFor(task);
  const platform = coursePlatform(course);
  container.append(sourceMark(platform, 'inspector-source'));
  const taskName = node('h2', '', task.name);
  taskName.dataset.i18nSkip = '';
  container.append(taskName);
  const courseName = node('p', 'inspector-course', course?.name || platformNames[platform]);
  courseName.dataset.i18nSkip = '';
  container.append(courseName);
  const details = node('dl', 'inspector-details');
  const addDetail = (label, value, raw = false) => {
    const item = node('dd', '', value);
    if (raw) item.dataset.i18nSkip = '';
    details.append(node('dt', '', label), item);
  };
  const dateInfo = rowDate(task);
  addDetail('来源', platformNames[platform]);
  addDetail('列表状态', statusName(task));
  const completion = completionInfo(task);
  addDetail('完成状态', completion.label);
  addDetail('判断来源', completion.source);
  if (Number.isInteger(task.problemCount) && task.problemCount > 0) {
    addDetail('题目完成', `${task.completedProblemCount || 0} / ${task.problemCount}`);
  }
  if (task.section) addDetail('分类', task.section, true);
  if (task.sourceStatus === 'future' && task.opensAt) addDetail('开放时间', formatDate(task.opensAt));
  addDetail(dateInfo.label, dateInfo.value ? formatDate(dateInfo.value) : dateInfo.text || '暂无日期');
  addDetail('成绩', task.score || '暂无成绩', Boolean(task.score));
  if (task.gradeText) addDetail('原始成绩', task.gradeText, true);
  if (task.lateDueAt) addDetail('晚交截止时间', formatDate(task.lateDueAt));
  container.append(details);
  if (completion.source === 'confirmation_required') {
    container.append(node('p', 'inspector-hint', '成绩已达到 100%。当前启用了手动确认模式，请确认后将作业标为完成。'));
  } else if (completion.complete === null) {
    container.append(node('p', 'inspector-hint', '课程网站没有提供可靠的完成结论，请根据实际提交情况手动确认。'));
  }
  const due = dueOf(task);
  if (due && !isDone(task)) {
    const days = Math.ceil((new Date(due).getTime() - Date.now()) / 86400000);
    const hint = days > 0 ? `距离当前日期还有 ${days} 天。` : days === 0 ? '今天到期。' : '网页显示的日期已经过去。';
    container.append(node('p', 'inspector-hint', `${hint}截止信息会随平台同步更新。`));
  } else if (!due && !isDone(task)) {
    container.append(node('p', 'inspector-hint', '网页没有显示明确截止时间。你可以手动设置提醒日期。'));
  }
  container.append(taskPersonalEditor(task));
  if (task.url && courseAccessConfirmed(course)) {
    const link = node('a', 'inspector-open', `在 ${platformNames[platform]} 中打开 ↗`);
    link.href = task.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    container.append(link);
  } else if (task.url && course) {
    container.append(node('p', 'inspector-hint', '确认这门课程属于你之后，才能打开课程网站。'));
  }
  const actions = node('div', 'inspector-actions');
  if (categoryOf(task) === 'ignored') {
    container.append(node('p', 'inspector-hint', `“${task.section}”类别已由你设为忽略。原始成绩、日期和手动设置仍保留。`));
    const restoreSection = node('button', 'primary-button', '恢复管理此类别');
    restoreSection.type = 'button';
    restoreSection.addEventListener('click', () => setSectionIgnored(task.courseId, task.section, false).catch(error => message(error.message, true)));
    actions.append(restoreSection);
    container.append(actions);
    return;
  }
  const edit = node('button', 'secondary-button', '修改提醒日期');
  edit.type = 'button';
  edit.addEventListener('click', () => editDeadline(task));
  const toggle = node('button', 'secondary-button', isDone(task) ? '标为未完成' : '标为完成');
  toggle.type = 'button';
  toggle.addEventListener('click', () => toggleTaskCompletion(task));
  actions.append(edit, toggle);
  if (task.doneOverride === true || task.doneOverride === false) {
    const restore = node('button', 'text-button', '恢复网站判断');
    restore.type = 'button';
    restore.addEventListener('click', () => restoreTaskCompletion(task));
    actions.append(restore);
  }
  container.append(actions);
}

function renderSelection() {
  for (const row of document.querySelectorAll('.assignment-row')) {
    const selected = row.dataset.taskId === selectedTaskId;
    row.classList.toggle('selected', selected);
    row.setAttribute('aria-current', String(selected));
  }
  renderInspector();
}

function renderToolbarContext(settings, calendar = false, dashboard = false, exams = false) {
  const course = selectedScope.startsWith('course:') ? state.courses.find(item => item.id === selectedScope.slice(7)) : null;
  const platform = course ? coursePlatform(course) : selectedScope.startsWith('platform:') ? selectedScope.slice('platform:'.length) : null;
  const context = settings ? 'settings' : calendar ? 'calendar' : dashboard ? 'dashboard' : exams ? 'exam' : platform || 'all';
  const labels = { all: '全部作业', calendar: '作业日历', dashboard: '作业仪表盘', exam: '考试提醒', prairielearn: 'PrairieLearn', webwork: 'WeBWorK', gradescope: 'Gradescope', settings: '设置' };
  const marks = { prairielearn: 'PL', webwork: 'W', gradescope: 'G', dashboard: 'DB', exam: 'E', settings: 'ST' };
  const toolbar = document.querySelector('.window-toolbar');
  const rail = document.querySelector('.app-rail');
  const mark = $('toolbar-scope-mark');
  toolbar.dataset.context = context;
  rail.dataset.context = context;
  mark.dataset.context = context;
  mark.querySelector('.toolbar-mark-text').textContent = marks[context] || '';
  mark.setAttribute('aria-label', `当前界面：${labels[context]}`);
  mark.title = labels[context];
}

function renderWork() {
  const course = selectedScope.startsWith('course:') ? state.courses.find(item => item.id === selectedScope.slice(7)) : null;
  for (const id of ['work-breadcrumb', 'work-heading', 'work-summary']) delete $(id).dataset.i18nSkip;
  if (selectedScope === 'all') {
    $('work-breadcrumb').textContent = '作业 / 全部作业';
    $('work-heading').textContent = '作业概览';
    $('work-summary').textContent = '将各平台的待办和成绩汇总到同一工作区。';
  } else if (course) {
    $('work-breadcrumb').textContent = `${i18n.translate('作业')} / ${platformNames[coursePlatform(course)]} / ${shortCourseName(course)}`;
    $('work-breadcrumb').dataset.i18nSkip = '';
    $('work-heading').textContent = shortCourseName(course);
    $('work-heading').dataset.i18nSkip = '';
    $('work-summary').textContent = `${course.name} · ${i18n.translate(courseSyncStatus(course).text)}`;
    $('work-summary').dataset.i18nSkip = '';
  } else {
    const platform = selectedScope.slice('platform:'.length);
    $('work-breadcrumb').textContent = `作业 / ${platformNames[platform]}`;
    $('work-heading').textContent = platformNames[platform];
    $('work-summary').textContent = '查看这个平台的课程和作业。';
  }
  const tasks = visibleTasks();
  $('today-label').textContent = UBCClock.format(i18n.locale(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }, new Date());
  const pendingCount = tasks.filter(task => needsAttention(task)).length;
  $('pending-badge').querySelector('span:last-child').textContent = `${pendingCount} 项需处理`;
  $('pending-badge').querySelector('.notification-dot').hidden = pendingCount === 0;
  $('overview-pending').textContent = pendingCount;
  $('overview-done').textContent = tasks.filter(task => categoryOf(task) === 'done').length;
  const nearest = tasks.filter(task => categoryOf(task) === 'pending' && dueOf(task))
    .map(task => new Date(dueOf(task)).getTime()).filter(Number.isFinite).sort((a, b) => a - b)[0];
  $('overview-nearest').textContent = nearest === undefined ? '—' : `${Math.max(0, Math.ceil((nearest - Date.now()) / 86400000))} 天`;
  for (const tab of Object.keys(tabNames)) {
    $(`${tab}-tab-count`).textContent = tab === 'all' ? tasks.length : tasks.filter(task => categoryOf(task) === tab).length;
  }
  for (const button of document.querySelectorAll('.tab')) button.classList.toggle('active', button.dataset.tab === selectedTab);
  const shown = selectedTab === 'all' ? [...tasks] : sortTasks(tasks.filter(task => categoryOf(task) === selectedTab), selectedTab);
  const groups = $('task-groups');
  groups.replaceChildren();
  $('work-overview').hidden = false;
  const recentDone = selectedTab === 'pending' ? sortTasks(tasks.filter(task => categoryOf(task) === 'done')).slice(0, 3) : [];
  inspectorTasks = [...shown, ...recentDone];
  if (!inspectorTasks.some(task => task.id === selectedTaskId)) selectedTaskId = inspectorTasks[0]?.id || null;
  if (!shown.length) {
    const empty = node('div', 'empty-state');
    const hasSuccessfulSync = state.courses.some(item => item.lastSyncedAt);
    const allCurrentComplete = selectedTab === 'pending' && !searchTerm && pendingCount === 0 && recentDone.length > 0;
    const futureCount = tasks.filter(task => categoryOf(task) === 'future').length;
    const title = !state.courses.length ? '还没有课程' : !filteredCourses().length ? '当前范围没有课程' : !hasSuccessfulSync ? '还没有完成首次同步' : state.tasks.length === 0 ? '同步完成，但没有发现可见作业' :
      allCurrentComplete ? '所有任务均已完成' : searchTerm ? '没有匹配的作业' : selectedTab !== 'all' ? '当前分类暂无作业' : '暂无作业';
    empty.append(node('h2', '', title));
    const description = !state.courses.length ? '添加 PrairieLearn、WeBWorK 或 Gradescope 课程，即可开始。' :
      !filteredCourses().length ? '请选择其他学年或学期，或在课程设置中调整分类。' :
      !hasSuccessfulSync ? '请打开专用登录窗口，完成学校登录并停留在作业列表页，然后返回应用同步。' :
      state.tasks.length === 0 ? '连接已经成功，但课程页面目前没有可见作业。可检查页面内容和登录状态后再次同步。' :
      allCurrentComplete ? futureCount ? `当前已开放的任务都已完成；另有 ${futureCount} 项尚未开放，可在“将开放”中查看。` : '当前课程的任务均已完成。' :
      searchTerm ? '没有找到符合搜索内容的作业，可以清除搜索后查看当前列表。' : selectedTab !== 'all' ? '当前课程在此分类中没有可显示的作业。' : '课程中暂时没有可显示的作业。';
    empty.append(node('p', '', description));
    if (searchTerm && state.tasks.length) {
      const action = node('button', 'secondary-button', '清除搜索');
      action.type = 'button';
      action.addEventListener('click', clearTaskSearch);
      empty.append(action);
    } else if (!state.courses.length || !hasSuccessfulSync || state.tasks.length === 0) {
      const action = node('button', 'primary-button', !state.courses.length ? '开始添加课程' : !hasSuccessfulSync ? '前往登录与同步' : '重新同步');
      action.type = 'button';
      action.addEventListener('click', () => {
        if (!state.courses.length) openOnboarding();
        else if (!hasSuccessfulSync) navigateSettings('courses');
        else $('sync').click();
      });
      empty.append(action);
    }
    groups.append(empty);
  } else if (selectedTab === 'all') {
    const groupNames = { pending: '即将截止', future: '将开放', history: '已过日期', done: '已完成', ignored: '已忽略的作业' };
    for (const category of ['pending', 'future', 'history', 'done', 'ignored']) {
      const categoryTasks = sortTasks(shown.filter(task => categoryOf(task) === category), category);
      if (categoryTasks.length) groups.append(taskSection(groupNames[category], categoryTasks, false, category));
    }
  } else {
    groups.append(taskSection({ pending: '即将截止', future: '将开放', history: '已过日期', done: '已完成', ignored: '已忽略的作业' }[selectedTab], shown, false, selectedTab));
  }
  if (recentDone.length) groups.append(taskSection('最近完成', recentDone, true));
  renderSelection();
}

function onboardingCourse() {
  return state.courses.find(course => !course.lastSyncedAt) || state.courses[0];
}

function renderOnboarding() {
  const dialog = $('onboarding-dialog');
  if (!onboardingActive && !state.preferences?.onboardingDismissed && state.courses.length === 0) {
    onboardingActive = true;
    if (!dialog.open) dialog.showModal();
  }
  if (!onboardingActive) return;
  if (!dialog.open) dialog.showModal();
  const course = onboardingCourse();
  const hasSync = state.courses.some(item => item.lastSyncedAt);
  const step = !course ? 1 : hasSync ? 3 : 2;
  $('onboarding-step-label').textContent = `第 ${step} 步，共 3 步`;
  $('onboarding-add').hidden = step !== 1;
  $('onboarding-login').hidden = step !== 2;
  $('onboarding-finish-panel').hidden = step !== 3;
  if (course) $('onboarding-login-text').textContent = `下一步连接 ${course.name}。先打开登录窗口，再回到这里同步作业。`;
  if (step === 3) $('onboarding-finish-text').textContent = state.tasks.length ? `已读取 ${state.tasks.length} 项作业，你可以在主界面查看截止时间和成绩。` : '课程连接已经成功，但当前页面没有发现可见作业。你可以完成引导，并在课程发布作业后重新同步。';
  $('onboarding-reminder-note').textContent = state.platform === 'darwin'
    ? 'macOS 截止提醒可在提醒设置中启用；个人微信每日汇总也是可选功能。'
    : 'Windows 截止提醒可以直接使用；个人微信每日汇总是可选功能，稍后也能在设置中配置。';
}

function openOnboarding() {
  onboardingActive = true;
  $('onboarding-error').textContent = '';
  renderOnboarding();
}

async function dismissOnboarding(targetPanel = null) {
  state = await api('/api/preferences', 'PATCH', { onboardingDismissed: true });
  onboardingActive = false;
  if ($('onboarding-dialog').open) $('onboarding-dialog').close();
  if (targetPanel) navigateSettings(targetPanel);
  else render();
}

function renderSettings() {
  $('app-language').value = state.preferences?.language || 'auto';
  $('browser-engine').value = state.preferences?.browserEngine || 'auto';
  $('browser-engine').querySelector('[value="webkit"]').hidden = state.platform !== 'darwin';
  $('app-version').textContent = state.version || '1.3.8';
  document.title = `UBC作业管理工具 ${state.version || '1.3.8'}`;
  document.querySelector('.toolbar-version').textContent = state.version || '1.3.8';
  renderUpdateStatus();
  const startup = state.startup || { supported: false, enabled: false, error: '无法读取开机启动状态。' };
  const mac = state.platform === 'darwin';
  $('startup-row').hidden = mac;
  $('mac-menu-bar-row').hidden = !mac;
  $('mac-menu-bar-visible').checked = window.UBC_NATIVE_MENU_BAR_VISIBLE !== false;
  $('mac-menu-bar-visible').disabled = !window.webkit?.messageHandlers?.nativeHost;
  $('mac-notification-row').hidden = !mac;
  const notificationNames = { checking: '正在检查通知权限…', authorized: '通知已允许，应用运行时可发送截止提醒。',
    denied: '通知已被系统拒绝。请在“系统设置 → 通知”中允许此应用。', notDetermined: '尚未授权通知。请点击“允许通知”。', unsupported: '无法读取系统通知状态。' };
  $('mac-notification-status').textContent = notificationNames[macNotificationStatus] || notificationNames.unsupported;
  $('mac-notification-permission').hidden = macNotificationStatus === 'authorized';
  $('mac-notification-test').disabled = macNotificationStatus !== 'authorized';
  $('reminder-leads-label').textContent = `${mac ? 'macOS' : 'Windows'} 提前提醒（小时，用逗号分隔）`;
  $('quiet-hours-description').textContent = `免打扰期间不会弹出 ${mac ? 'macOS' : 'Windows'} 通知或发送每日微信汇总；应用恢复或时段结束后只补发当天尚未成功的汇总，不补发往日消息。`;
  $('pause-reminders-description').textContent = `暂停 ${mac ? 'macOS' : 'Windows'} 截止提醒和每日微信汇总；课程自动同步仍会继续。`;
  $('course-reminders-description').textContent = `关闭后，该课程不会进入 ${mac ? 'macOS' : 'Windows'} 截止通知或微信每日汇总。`;
  $('local-data-description').textContent = mac
    ? '作业清单、提醒设置与专用浏览器登录资料保存在当前 Mac 账户的“应用程序支持”目录中，覆盖升级不会删除。关闭主窗口不会停止后台提醒。'
    : '作业清单、提醒设置与专用浏览器登录资料保存在当前 Windows 账户的本地应用数据目录中，覆盖升级不会删除。关闭网页不会停止后台提醒。';
  $('quit-description').textContent = mac
    ? '停止后台同步和 macOS 系统通知。下次可从“应用程序”重新打开。'
    : '停止后台同步和 Windows 提醒。下次可双击 UBC作业管理工具.exe 重新打开。';
  $('close-behavior-description').textContent = mac
    ? '关闭主窗口后应用可继续运行，并从菜单栏重新打开。完全退出请使用应用菜单或“数据与退出”。'
    : '关闭主窗口只会隐藏窗口，课程同步与提醒继续运行。请使用系统托盘或“数据与退出”页面退出应用。';
  $('close-behavior-value').textContent = mac ? '菜单栏运行' : '托盘运行';
  $('update-description').textContent = mac
    ? '应用通过 GitHub 公共 HTTPS API 检查更新。Mac 版可下载对应架构的 DMG 或 ZIP 后手动安装；课程、作业与提醒设置保存在独立数据目录。'
    : '应用通过 GitHub 公共 HTTPS API 检查并下载更新，无需安装 GitHub CLI 或登录 GitHub。临时网络错误会自动重试；更新会保留当前 Windows 账户下的课程、作业与提醒数据。';
  $('startup-enabled').checked = Boolean(startup.enabled);
  $('startup-enabled').disabled = !startup.supported;
  $('startup-status').textContent = startup.error || (startup.enabled ? '已为当前 Windows 账户启用。' : '当前未启用。');
  $('startup-status').classList.toggle('error', Boolean(startup.error));
  $('require-manual-completion').checked = Boolean(state.preferences?.requireManualCompletion);
  $('settings-breadcrumb').textContent = `设置 / ${settingNames[settingsPanel]}`;
  for (const panel of Object.keys(settingNames)) $(`settings-${panel}`).hidden = settingsPanel !== panel;
  for (const button of document.querySelectorAll('.settings-link')) button.classList.toggle('active', button.dataset.settings === settingsPanel);
  const select = $('settings-course-select');
  select.dataset.i18nSkip = '';
  const current = settingsCourseId || select.value;
  select.replaceChildren();
  for (const course of state.courses) select.append(new Option(course.name, course.id));
  settingsCourseId = state.courses.some(course => course.id === current) ? current : state.courses[0]?.id || null;
  if (settingsCourseId) select.value = settingsCourseId;
  const settingsCourse = selectedSettingsCourse();
  select.disabled = !state.courses.length;
  $('open-browser').disabled = !courseAccessConfirmed(settingsCourse);
  $('hide-browser').hidden = state.browserMode !== 'visible';
  $('hide-browser').disabled = !courseAccessConfirmed(settingsCourse);
  $('import-text').disabled = !courseAccessConfirmed(settingsCourse);
  $('course-list').replaceChildren();
  if (!state.courses.length) $('course-list').append(node('p', 'setting-intro', '尚未添加课程。'));
  for (const course of state.courses) {
    const row = node('div', 'settings-course');
    const description = node('div', 'settings-course-main');
    const name = node('strong', '', course.name);
    name.dataset.i18nSkip = '';
    description.append(name);
    const syncStatus = courseSyncStatus(course);
    const syncLine = node('small', `course-sync-status ${syncStatus.kind}`, `${platformNames[coursePlatform(course)]} · ${syncStatus.text}`);
    description.append(syncLine);
    const periodControls = node('div', 'course-period-controls');
    const periodYear = document.createElement('select');
    periodYear.setAttribute('aria-label', `${course.name} 学年起始年`);
    periodYear.append(new Option('待分类', ''));
    const currentYear = UBCClock.parts(new Date()).year;
    for (let year = currentYear + 2; year >= currentYear - 12; year--) periodYear.append(new Option(String(year), String(year)));
    if (course.academicPeriod && ![...periodYear.options].some(option => option.value === course.academicPeriod.slice(0, 4))) {
      periodYear.append(new Option(course.academicPeriod.slice(0, 4), course.academicPeriod.slice(0, 4)));
    }
    periodYear.value = course.academicPeriod?.slice(0, 4) || '';
    const periodTerm = document.createElement('select');
    periodTerm.setAttribute('aria-label', `${course.name} 学期`);
    for (const [code, label] of Object.entries(academicTerms)) if (code !== 'unknown') periodTerm.append(new Option(label, code));
    periodTerm.value = course.academicPeriod?.slice(4) || 'W1';
    const savePeriod = async () => {
      try {
        state = await api('/api/course/academic-period', 'PATCH', {
          courseId: course.id, academicPeriod: periodYear.value ? `${periodYear.value}${periodTerm.value}` : null,
        });
        render();
        message('课程学期已保存。');
      } catch (error) { message(error.message, true); render(); }
    };
    periodYear.addEventListener('change', savePeriod);
    periodTerm.addEventListener('change', savePeriod);
    periodControls.append(node('span', '', '学期'), periodYear, periodTerm);
    description.append(periodControls);
    if (course.archived) description.append(node('small', 'course-archived-label', '已归档 · 自动同步和提醒已暂停'));
    const actions = node('div', 'settings-course-actions');
    const archive = node('button', 'course-action', course.archived ? '恢复' : '归档');
    archive.type = 'button';
    archive.setAttribute('aria-label', `${course.archived ? '恢复' : '归档'} ${course.name}`);
    archive.addEventListener('click', async () => {
      if (!course.archived && !confirm(i18n.translate(`归档 ${course.name}？该课程将停止自动同步和提醒，历史记录仍会保留。`))) return;
      try {
        state = await api('/api/course/archive', 'PATCH', { courseIds: [course.id], archived: !course.archived });
        render();
      } catch (error) { message(error.message, true); }
    });
    const login = node('button', 'course-action', course.lastSyncErrorKind === 'login' ? '重新登录' : '打开登录');
    login.type = 'button';
    login.disabled = !courseAccessConfirmed(course);
    login.addEventListener('click', async () => {
      try {
        const result = await api('/api/open-browser', 'POST', { courseId: course.id });
        state = result.state;
        renderSettings();
        message('登录窗口已打开。完成登录后点击“重试同步”。');
      } catch (error) { message(error.message, true); }
    });
    const retry = node('button', 'course-action', '重试同步');
    retry.type = 'button';
    retry.disabled = syncStatus.kind === 'syncing' || !courseAccessConfirmed(course);
    retry.addEventListener('click', async () => {
      retry.disabled = true;
      try {
        const result = await api('/api/sync', 'POST', { courseId: course.id });
        state = result.state;
        message(result.message);
      } catch (error) {
        state = await api('/api/state');
        message(error.message, true);
      }
      render();
    });
    const remove = node('button', '', '移除');
    remove.type = 'button';
    remove.setAttribute('aria-label', `移除 ${course.name}`);
    remove.addEventListener('click', async () => {
      if (!confirm(i18n.translate(`移除 ${course.name} 及其本地作业记录？`))) return;
      try {
        state = await api('/api/course', 'DELETE', { id: course.id });
        if (selectedScope === `course:${course.id}`) selectedScope = 'all';
        if (settingsCourseId === course.id) settingsCourseId = null;
        render();
      } catch (error) { message(error.message, true); }
    });
    actions.append(login, retry, archive, remove);
    row.append(description, actions);
    const sectionMap = new Map();
    for (const value of [...state.tasks.filter(task => task.courseId === course.id).map(task => task.section), ...(course.ignoredSections || [])]) {
      const section = String(value || '').trim().replace(/\s+/g, ' ');
      if (section && !sectionMap.has(section.toLocaleLowerCase())) sectionMap.set(section.toLocaleLowerCase(), section);
    }
    const sections = [...sectionMap.values()].sort((a, b) => a.localeCompare(b));
    const categories = node('div', 'course-categories');
    if (!sections.length) categories.append(node('span', 'form-note', '课程页面尚未提供可区分的作业类别。'));
    const ignoredSections = new Set((course.ignoredSections || []).map(value => value.toLocaleLowerCase()));
    for (const section of sections) {
      const label = node('label', 'check-row');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.checked = !ignoredSections.has(section.toLocaleLowerCase());
      checkbox.setAttribute('aria-label', `${course.name} 管理 ${section}`);
      checkbox.addEventListener('change', async () => {
        checkbox.disabled = true;
        try {
          await setSectionIgnored(course.id, section, !checkbox.checked);
          message(checkbox.checked ? `已恢复管理 ${section}。` : `已忽略 ${section}，该类别不再触发提醒。`);
        } catch (error) { checkbox.checked = !checkbox.checked; message(error.message, true); }
        finally { checkbox.disabled = false; }
      });
      label.append(checkbox, node('span', '', `管理 ${section}`));
      categories.append(label);
    }
    row.append(categories);
    $('course-list').append(row);
  }
  const wechat = state.wechat || { enabled: false, time: '09:00', hasKey: false };
  $('reminders-paused').checked = Boolean(wechat.remindersPaused);
  if (!reminderFormDirty) {
    $('reminder-leads').value = (wechat.leadHours || [24, 3]).join(', ');
    $('quiet-enabled').checked = Boolean(wechat.quietEnabled);
    $('quiet-start').value = wechat.quietStart || '22:00';
    $('quiet-end').value = wechat.quietEnd || '08:00';
  }
  if (!examLeadsDirty) $('exam-leads').value = (state.preferences?.examLeadHours || [168, 24, 3]).join(', ');
  const disabledCourseIds = new Set(wechat.disabledCourseIds || []);
  const reminderCourses = $('reminder-course-list');
  reminderCourses.replaceChildren();
  if (!state.courses.length) reminderCourses.append(node('p', 'form-note', '添加课程后可在这里分别控制提醒。'));
  for (const course of state.courses) {
    const label = node('label', 'check-row');
    const name = node('span', '', `${platformNames[coursePlatform(course)]} · ${shortCourseName(course)}`);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !disabledCourseIds.has(course.id);
    checkbox.setAttribute('aria-label', `${course.name} 提醒`);
    checkbox.addEventListener('change', async () => {
      checkbox.disabled = true;
      try {
        state = await api('/api/reminders', 'PATCH', { courseId: course.id, enabled: checkbox.checked });
        render();
        message(checkbox.checked ? `已启用 ${shortCourseName(course)} 的提醒。` : `已关闭 ${shortCourseName(course)} 的提醒。`);
      } catch (error) { checkbox.checked = !checkbox.checked; message(error.message, true); }
      finally { checkbox.disabled = false; }
    });
    label.append(name, checkbox);
    reminderCourses.append(label);
  }
  if (!wechatFormDirty) {
    $('wechat-time').value = wechat.time || '09:00';
    $('wechat-enabled').checked = Boolean(wechat.enabled);
    $('wechat-include-notes').checked = Boolean(wechat.includeNotes);
  }
  $('wechat-key-status').textContent = wechat.hasKey ? '密钥已保存在本机；留空可保持现有密钥。' : '尚未配置密钥。请使用 Server酱 Turbo 的 SCT SendKey。';
  $('wechat-test').disabled = !wechat.hasKey;
  $('wechat-clear').disabled = !wechat.hasKey;
  const status = [];
  if (wechat.lastSentAt) status.push(`上次每日提醒：${formatDate(wechat.lastSentAt)}`);
  if (wechat.lastTestAt) status.push(`上次测试：${formatDate(wechat.lastTestAt)}`);
  if (wechat.lastError) status.push(`上次发送失败：${wechat.lastError}`);
  if (wechat.enabled && wechat.startDate && localDateInput(new Date().toISOString()).slice(0, 10) < wechat.startDate) {
    status.push(`首次发送不早于 ${wechat.startDate} ${wechat.time}（电脑当地时间）`);
  }
  if (wechat.remindersPaused) status.unshift('全部提醒已暂停。');
  if (!status.length) status.push(wechat.enabled ? '已启用，等待下次发送时间。' : '每日提醒尚未启用。');
  $('wechat-status').textContent = status.join(' · ');
  $('wechat-status').classList.toggle('error', Boolean(wechat.lastError));
  const email = state.email || { enabled: false, connected: false, from: '', to: '', time: '09:00', scope: 'all' };
  if (!emailFormDirty) {
    $('email-from').value = email.from || '';
    $('email-to').value = email.to || '';
    $('email-time').value = email.time || '09:00';
    $('email-scope').value = email.scope || 'all';
    $('email-enabled').checked = Boolean(email.enabled);
  }
  $('email-test').disabled = !email.connected;
  $('email-disconnect').disabled = !email.connected;
  const emailLines = [email.connected ? `已连接发件账户：${email.from}` : '尚未连接 Gmail 发件账户。'];
  if (email.paused) emailLines.push('全部提醒已暂停。');
  if (email.lastSentAt) emailLines.push(`上次邮件发送：${formatDate(email.lastSentAt)}`);
  if (email.lastTestAt) emailLines.push(`上次邮件测试：${formatDate(email.lastTestAt)}`);
  if (email.lastError) emailLines.push(`上次邮件发送失败：${email.lastError}`);
  $('email-status').textContent = emailLines.map(line => i18n.translate(line)).join(' · ');
  $('email-status').classList.toggle('error', Boolean(email.lastError));
  $('next-reminder-time').textContent = wechat.nextSendAt ? formatDate(wechat.nextSendAt) : '—';
  $('next-reminder-detail').textContent = wechat.remindersPaused ? '提醒已暂停；恢复后若仍是当天且计划时间已过，会发送当天尚未成功的汇总。' :
    !wechat.enabled ? '每日微信汇总尚未启用。' : !wechat.hasKey ? '请先保存 Server酱 SendKey。' :
    wechat.quietEnabled ? `免打扰 ${wechat.quietStart}–${wechat.quietEnd}；时段内的当天汇总将在结束后补发。` : '计划按电脑当地时间执行。';
  $('reminder-timezone').textContent = UBCClock.label();
  const history = $('reminder-history');
  history.replaceChildren();
  const typeNames = { daily: '自动汇总', test: '手动测试', windows: 'Windows 通知', macos: 'macOS 通知' };
  const resultNames = { accepted: '服务已接受', failed: '发送失败', shown: '已交给系统显示' };
  if (!wechat.history?.length) history.append(node('p', 'form-note', '尚无发送记录。'));
  for (const record of (wechat.history || []).slice(0, 12)) {
    const row = node('div', `reminder-record ${record.result}`);
    row.append(node('span', '', formatDate(record.at)), node('strong', '', `${typeNames[record.type] || record.type} · ${resultNames[record.result] || record.result}`), node('span', '', record.detail || ''));
    history.append(row);
  }
}

function renderUpdateStatus() {
  const manual = updateStatus.updateMode === 'manual';
  const labels = {
    idle: '尚未检查更新。', checking: '正在检查 GitHub 更新…', current: '当前已是最新版本。',
    available: `发现新版本 ${updateStatus.release?.version || ''}。`,
    no_package: '暂时没有可安装的发布包。',
    error: updateStatus.error || '更新检查失败。', installing: '正在下载安装更新包…',
  };
  const lastFailure = updateStatus.kind === 'available' && updateStatus.lastResult?.state === 'failed' &&
    updateStatus.lastResult.version === updateStatus.release?.version;
  $('update-status').textContent = lastFailure
    ? `上次更新 ${updateStatus.lastResult.version} 失败，已恢复旧版：${updateStatus.lastResult.detail}`
    : updateStatus.kind === 'available' && manual
      ? '发现新版本。请下载对应架构的 DMG 或 ZIP 并手动安装。'
    : updateStatus.kind === 'available' && updateStatus.canInstall === false
      ? '发现新版本。当前位于 Git 开发目录，请在独立的便携包中使用应用内更新。'
    : labels[updateStatus.kind] || '更新状态未知。';
  $('update-status').classList.toggle('error', updateStatus.kind === 'error' || lastFailure);
  const available = updateStatus.kind === 'available';
  $('install-update').hidden = !available || updateStatus.canInstall === false || manual;
  $('install-update').disabled = !available || updateStatus.canInstall === false || manual;
  $('download-update').hidden = !available || !manual || !updateStatus.release?.assetUrl;
  $('download-update').href = available && manual ? updateStatus.release?.assetUrl || '#' : '#';
  $('download-update-zip').hidden = !available || !manual || !updateStatus.release?.zipUrl;
  $('download-update-zip').href = available && manual ? updateStatus.release?.zipUrl || '#' : '#';
  $('check-update').disabled = updateStatus.kind === 'checking' || updateStatus.kind === 'installing';
  $('update-notes').hidden = !available || !updateStatus.release?.notes;
  $('update-notes').textContent = available ? updateStatus.release?.notes || '' : '';
}

async function checkUpdate(showMessage = false) {
  updateStatus = { ...updateStatus, kind: 'checking' };
  if (state) renderUpdateStatus();
  try {
    updateStatus = await api('/api/update/check', 'POST', {});
    if (state) renderUpdateStatus();
    if (updateStatus.kind === 'available' && updateStatus.updateMode !== 'manual' && updateStatus.canInstall !== false && promptedUpdate !== updateStatus.release.version &&
        !(updateStatus.lastResult?.state === 'failed' && updateStatus.lastResult.version === updateStatus.release.version)) {
      promptedUpdate = updateStatus.release.version;
      $('update-dialog-text').textContent = `已发现 ${updateStatus.release.name}。现在更新会关闭应用，安装完成后自动重新打开；本地作业和提醒设置会保留。`;
      $('update-dialog').showModal();
    } else if (showMessage) message($('update-status').textContent, updateStatus.kind === 'error');
  } catch (error) {
    updateStatus = { kind: 'error', error: error.message };
    if (state) renderUpdateStatus();
    if (showMessage) message(error.message, true);
  }
}

async function installUpdate() {
  if ($('update-dialog').open) $('update-dialog').close();
  updateStatus = { ...updateStatus, kind: 'installing' };
  renderUpdateStatus();
  try {
    const result = await api('/api/update/install', 'POST', {});
    message(result.message);
  } catch (error) {
    updateStatus = { ...updateStatus, kind: 'error', error: error.message };
    renderUpdateStatus();
    message(error.message, true);
  }
}

function render() {
  if (!state) return;
  UBCClock.configure(state.systemTimeZone);
  i18n.setPreference(state.preferences?.language, state.systemLocale);
  if (selectedScope.startsWith('course:') && !state.courses.some(course => course.id === selectedScope.slice(7))) selectedScope = 'all';
  const settings = location.hash.startsWith('#settings');
  const calendar = location.hash.startsWith('#calendar');
  const dashboard = location.hash.startsWith('#dashboard');
  const exams = location.hash.startsWith('#exams');
  document.body.classList.toggle('settings-view', settings);
  document.body.classList.toggle('dashboard-view', dashboard);
  document.body.classList.toggle('exam-view', exams);
  $('work-layout').hidden = settings;
  $('work-page').hidden = settings || calendar || dashboard || exams;
  $('calendar-page').hidden = settings || !calendar;
  $('dashboard-page').hidden = settings || !dashboard;
  $('exam-page').hidden = settings || !exams;
  $('task-inspector').hidden = dashboard || exams;
  $('settings-page').hidden = !settings;
  $('work-navigation').hidden = settings || exams;
  $('exam-navigation').hidden = !exams;
  $('settings-navigation').hidden = !settings;
  $('nav-settings').classList.toggle('active', settings);
  renderToolbarContext(settings, calendar, dashboard, exams);
  renderFolders();
  if (exams) renderExamPage();
  else if (calendar) renderCalendarPage();
  else if (dashboard) renderDashboardPage();
  else if (!settings) renderWork();
  renderSettings();
  renderOnboarding();
  showCourseAccessReview();
  const activeCourses = state.courses.filter(course => !course.archived);
  const last = activeCourses.map(course => course.lastSyncedAt).filter(Boolean).sort().at(-1);
  const failures = activeCourses.filter(course => course.lastSyncError).length;
  const stale = activeCourses.filter(course => ['stale', 'never'].includes(courseSyncStatus(course).kind)).length;
  $('sync-status').textContent = state.syncing ? '正在同步' : failures ? `${failures} 门课程同步失败` : stale ? `${stale} 门课程数据需要更新` : last ? `上次同步：${formatDate(last)}` : '尚未同步';
  $('sync').disabled = state.syncing || !activeCourses.some(courseAccessConfirmed);
  $('footer-sync').textContent = state.syncing ? '正在同步' : failures ? `${failures} 门同步失败` : stale ? `${stale} 门数据可能过旧` : last ? `上次同步 ${formatDate(last)}` : '尚未同步';
  $('footer-sync').title = state.courses.filter(course => course.lastSyncError).map(course => `${shortCourseName(course)}：${course.lastSyncError}`).join('；');
  $('footer-sync').classList.toggle('error', failures > 0);
  const plCount = state.courses.filter(course => coursePlatform(course) === 'prairielearn').length;
  const wwCount = state.courses.filter(course => coursePlatform(course) === 'webwork').length;
  const gsCount = state.courses.filter(course => coursePlatform(course) === 'gradescope').length;
  $('footer-sources').textContent = `PrairieLearn ${plCount} 门课程 · WeBWorK ${wwCount} 门课程 · Gradescope ${gsCount} 门课程`;
  $('footer-reminder').textContent = state.wechat?.remindersPaused ? '提醒已暂停' : state.wechat?.lastError ? '每日提醒发送失败' : state.wechat?.enabled ? '每日提醒已启用' : '每日提醒未启用';
  $('footer-reminder').classList.toggle('error', Boolean(state.wechat?.lastError && !state.wechat?.remindersPaused));
  $('footer-timezone').textContent = UBCClock.label();
}

function showCourseAccessReview() {
  const pending = state.courses.filter(course => !courseAccessConfirmed(course));
  if (!pending.length || !window.AppDialog) return;
  window.AppDialog.push({
    id: 'course-access-review-v1',
    level: 'warning',
    title: '确认本机课程',
    body: '检测到旧版本或备份中的课程。为防止打开课程网址时被 PrairieLearn 自动加入课程，请只勾选你当前确实参加的课程。未勾选课程及其本地作业记录会被移除。',
    items: ['确认前，这些课程不会打开网页、同步数据或发送提醒。', '如果暂时无法确认，可以选择“稍后处理”。'],
    choices: pending.map(course => ({
      id: course.id,
      label: course.name,
      description: `${platformNames[coursePlatform(course)]} · ${new URL(course.url).pathname}`,
      checked: false,
    })),
    required: true,
    actions: [
      { id: 'later', label: '稍后处理', kind: 'secondary' },
      { id: 'apply', label: '确认并应用', kind: 'primary', handler: async result => {
        const response = await api('/api/course/access-review', 'POST', { confirmedIds: result.selectedIds });
        state = response.state;
        if (selectedScope.startsWith('course:') && !state.courses.some(course => `course:${course.id}` === selectedScope)) selectedScope = 'all';
        if (settingsCourseId && !state.courses.some(course => course.id === settingsCourseId)) settingsCourseId = null;
        render();
        message(response.message);
      } },
    ],
  }).catch(error => message(error.message, true));
}

function closeMobileMenu() {
  document.querySelector('.folder-pane')?.classList.remove('open');
  $('nav-menu').setAttribute('aria-expanded', 'false');
}

function navigateWork(scope) {
  selectedScope = scope;
  selectedTab = 'pending';
  if (location.hash !== '#work') location.hash = 'work';
  render();
  closeMobileMenu();
}

window.UBC_OPEN_TASK = async taskId => {
  const task = state?.tasks.find(item => item.id === taskId);
  if (!task) return;
  const course = courseFor(task);
  if (course && !courseInPeriod(course)) {
    showArchived = showArchived || course.archived;
    state.preferences.academicYear = '';
    state.preferences.academicTerm = '';
    try { state = await api('/api/preferences', 'PATCH', { academicYear: '', academicTerm: '' }); }
    catch { /* Keep the visible scope open even if saving the filter fails. */ }
  }
  selectedScope = 'all';
  selectedTab = 'all';
  selectedTaskId = taskId;
  searchTerm = '';
  $('task-search').value = '';
  if (location.hash !== '#work') location.hash = 'work';
  render();
  document.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`)?.scrollIntoView({ block: 'center' });
};

window.UBC_SET_NOTIFICATION_STATUS = status => {
  macNotificationStatus = status;
  if (state) renderSettings();
};

function clearTaskSearch() {
  searchTerm = '';
  $('task-search').value = '';
  render();
}

function navigateCalendar() {
  selectedScope = 'all';
  const today = new Date();
  const { year, month } = UBCClock.parts(today);
  calendarCursor = new Date(Date.UTC(year, month - 1, 1, 12));
  if (location.hash !== '#calendar') location.hash = 'calendar';
  render();
  closeMobileMenu();
}

function navigateDashboard() {
  selectedScope = 'all';
  if (location.hash !== '#dashboard') location.hash = 'dashboard';
  render();
  closeMobileMenu();
}

function navigateExams() {
  if (location.hash !== '#exams') location.hash = 'exams';
  render();
  closeMobileMenu();
}

function openExamForm(exam = null) {
  editingExamId = exam?.id || null;
  $('exam-form-title').textContent = exam ? '编辑考试' : '添加考试';
  $('exam-title').value = exam?.title || '';
  $('exam-course-name').value = exam?.courseName || '';
  examCourseOptions($('exam-course-id'), exam?.courseId);
  examPeriodOptions($('exam-period'), exam?.academicPeriod);
  $('exam-status').value = exam?.status || 'unreserved';
  $('exam-start').value = examTimeInput(exam?.startsAt);
  $('exam-booking-deadline').value = examTimeInput(exam?.reservationDeadline);
  $('exam-duration').value = exam?.durationMinutes || '';
  $('exam-location').value = exam?.location || '';
  $('exam-url').value = exam?.url || '';
  $('exam-dialog').showModal();
}

window.UBC_OPEN_EXAM = examId => {
  if (!(state?.exams || []).some(exam => exam.id === examId)) return;
  selectedExamId = examId;
  examFilter = 'all';
  showArchivedExams = true;
  navigateExams();
};

function navigateSettings(panel = 'general') {
  settingsPanel = panel;
  const target = `#settings/${panel}`;
  if (location.hash !== target) location.hash = target;
  render();
  closeMobileMenu();
}

function editDeadline(task) {
  editingTaskId = task.id;
  $('deadline-task-name').textContent = task.name;
  $('deadline-input').value = localDateInput(dueOf(task));
  $('deadline-dialog').showModal();
}

function selectedSettingsCourse() {
  return state.courses.find(course => course.id === settingsCourseId) || state.courses[0];
}

function routeFromHash() {
  if (location.hash.startsWith('#settings/')) {
    const requested = location.hash.slice('#settings/'.length);
    settingsPanel = Object.hasOwn(settingNames, requested) ? requested : 'general';
  } else if (location.hash === '#settings') settingsPanel = 'general';
  render();
}

$('nav-all').addEventListener('click', () => navigateWork('all'));
$('nav-dashboard').addEventListener('click', navigateDashboard);
$('nav-exams').addEventListener('click', navigateExams);
$('nav-calendar').addEventListener('click', navigateCalendar);
for (const button of document.querySelectorAll('[data-exam-filter]')) button.addEventListener('click', () => { examFilter = button.dataset.examFilter; renderExamPage(); });
$('show-archived-exams').addEventListener('change', event => { showArchivedExams = event.target.checked; renderExamPage(); });
$('add-exam').addEventListener('click', () => openExamForm());
$('exam-cancel').addEventListener('click', () => $('exam-dialog').close());
$('exam-course-id').addEventListener('change', () => {
  const course = state.courses.find(item => item.id === $('exam-course-id').value);
  if (course && !$('exam-period').value && course.academicPeriod) $('exam-period').value = course.academicPeriod;
});
$('exam-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const payload = { title: $('exam-title').value, courseName: $('exam-course-name').value,
      courseId: $('exam-course-id').value || null, academicPeriod: $('exam-period').value || null,
      status: $('exam-status').value, startsAt: parseExamTimeInput('exam-start'),
      reservationDeadline: parseExamTimeInput('exam-booking-deadline'), durationMinutes: $('exam-duration').value || null,
      location: $('exam-location').value, url: $('exam-url').value, sourceTimeZone: UBCClock.label() };
    state = await api('/api/exam', editingExamId ? 'PATCH' : 'POST', editingExamId ? { ...payload, id: editingExamId } : payload);
    $('exam-dialog').close(); editingExamId = null; render();
  } catch (error) { message(error.message, true); }
});
$('open-prairietest').addEventListener('click', async () => {
  try { const result = await api('/api/prairietest/open', 'POST', {}); message(result.message); }
  catch (error) { message(error.message, true); }
});
$('sync-prairietest').addEventListener('click', async () => {
  $('sync-prairietest').disabled = true;
  try { const result = await api('/api/prairietest/sync', 'POST', {}); state = result.state; render(); message(result.message); }
  catch (error) { state = await api('/api/state'); render(); message(error.message, true); }
});
$('academic-year').addEventListener('change', async event => {
  try {
    state = await api('/api/preferences', 'PATCH', { academicYear: event.target.value,
      academicTerm: event.target.value && state.preferences.academicTerm === 'unknown' ? '' : state.preferences.academicTerm });
    selectedScope = 'all'; render();
  } catch (error) { message(error.message, true); render(); }
});
$('academic-term').addEventListener('change', async event => {
  try {
    state = await api('/api/preferences', 'PATCH', { academicTerm: event.target.value });
    selectedScope = 'all'; render();
  } catch (error) { message(error.message, true); render(); }
});
$('current-term').addEventListener('click', async () => {
  const code = currentAcademicPeriod();
  try {
    state = await api('/api/preferences', 'PATCH', { academicYear: periodAcademicYear(code), academicTerm: code.slice(4) });
    selectedScope = 'all'; render();
  } catch (error) { message(error.message, true); }
});
$('show-archived').addEventListener('change', event => { showArchived = event.target.checked; selectedScope = 'all'; render(); });
$('archive-period').addEventListener('click', async () => {
  const year = state.preferences?.academicYear;
  const term = state.preferences?.academicTerm;
  if (!year || !term || term === 'unknown') return;
  const courses = state.courses.filter(course => periodAcademicYear(course.academicPeriod) === year && course.academicPeriod?.slice(4) === term);
  if (!courses.length) return;
  const archived = !courses.every(course => course.archived);
  if (archived && !confirm(i18n.translate(`归档 ${periodLabel()} 的 ${courses.length} 门课程？自动同步和提醒将暂停，历史记录仍会保留。`))) return;
  try {
    state = await api('/api/course/archive', 'PATCH', { courseIds: courses.map(course => course.id), archived });
    render();
  } catch (error) { message(error.message, true); }
});
$('nav-prairielearn').addEventListener('click', () => navigateWork('platform:prairielearn'));
$('nav-webwork').addEventListener('click', () => navigateWork('platform:webwork'));
$('nav-gradescope').addEventListener('click', () => navigateWork('platform:gradescope'));
$('nav-settings').addEventListener('click', () => navigateSettings(settingsPanel));
$('app-language').addEventListener('change', async event => {
  const previous = state.preferences?.language || 'auto';
  try {
    state = await api('/api/preferences', 'PATCH', { language: event.target.value });
    render();
    window.webkit?.messageHandlers?.nativeHost?.postMessage({ action: 'setLanguage', language: i18n.locale() });
  } catch (error) {
    event.target.value = previous;
    message(error.message, true);
  }
});
$('browser-engine').addEventListener('change', async event => {
  const previous = state.preferences?.browserEngine || 'auto';
  try {
    state = await api('/api/preferences', 'PATCH', { browserEngine: event.target.value });
    render();
  } catch (error) {
    event.target.value = previous;
    message(error.message, true);
  }
});
$('check-update').addEventListener('click', () => checkUpdate(true));
$('install-update').addEventListener('click', installUpdate);
$('update-now').addEventListener('click', installUpdate);
$('update-later').addEventListener('click', () => $('update-dialog').close());
$('restart-onboarding').addEventListener('click', async () => {
  try {
    state = await api('/api/preferences', 'PATCH', { onboardingDismissed: false });
    openOnboarding();
  } catch (error) { message(error.message, true); }
});
$('onboarding-add-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    state = await api('/api/course', 'POST', { url: $('onboarding-course-url').value });
    $('onboarding-course-url').value = '';
    $('onboarding-error').textContent = '';
    render();
  } catch (error) { $('onboarding-error').textContent = error.message; }
});
$('onboarding-skip').addEventListener('click', () => dismissOnboarding().catch(error => message(error.message, true)));
$('onboarding-open-login').addEventListener('click', async () => {
  const course = onboardingCourse();
  if (!course) return;
  try {
    const result = await api('/api/open-browser', 'POST', { courseId: course.id });
    state = result.state;
    $('onboarding-error').textContent = result.message;
  } catch (error) { $('onboarding-error').textContent = error.message; }
});
$('onboarding-sync').addEventListener('click', async event => {
  const course = onboardingCourse();
  if (!course) return;
  event.target.disabled = true;
  event.target.textContent = '正在同步…';
  $('onboarding-error').textContent = '';
  try {
    const result = await api('/api/sync', 'POST', { courseId: course.id });
    state = result.state;
    render();
  } catch (error) {
    $('onboarding-error').textContent = `${error.message} 请确认专用窗口已登录并停留在作业列表页，然后重试。`;
  } finally {
    event.target.disabled = false;
    event.target.textContent = '我已登录，立即同步';
  }
});
$('onboarding-complete').addEventListener('click', () => dismissOnboarding().catch(error => message(error.message, true)));
$('onboarding-reminders').addEventListener('click', () => dismissOnboarding('reminders').catch(error => message(error.message, true)));
$('all-folder').addEventListener('click', () => navigateWork('all'));
$('pl-folder').addEventListener('click', () => navigateWork('platform:prairielearn'));
$('ww-folder').addEventListener('click', () => navigateWork('platform:webwork'));
$('gs-folder').addEventListener('click', () => navigateWork('platform:gradescope'));
$('nav-menu').addEventListener('click', () => {
  const open = document.querySelector('.folder-pane').classList.toggle('open');
  $('nav-menu').setAttribute('aria-expanded', String(open));
});
$('toolbar-menu').addEventListener('click', () => {
  if (window.innerWidth <= 760) {
    $('nav-menu').click();
    return;
  }
  const collapsed = document.querySelector('.app-shell').classList.toggle('sidebar-collapsed');
  $('toolbar-menu').setAttribute('aria-expanded', String(!collapsed));
});
$('task-search').addEventListener('input', event => {
  searchTerm = event.target.value.trim().toLocaleLowerCase();
  if (state) {
    if (location.hash.startsWith('#exams')) renderExamPage();
    else if (location.hash.startsWith('#calendar')) renderCalendarPage();
    else renderWork();
  }
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    $('task-search').focus();
  }
});
document.querySelector('.content').addEventListener('click', () => { if (window.innerWidth <= 760) closeMobileMenu(); });
for (const button of document.querySelectorAll('.settings-link')) button.addEventListener('click', () => navigateSettings(button.dataset.settings));
for (const button of document.querySelectorAll('.tab')) button.addEventListener('click', () => { selectedTab = button.dataset.tab; renderWork(); });
window.addEventListener('hashchange', routeFromHash);

$('sync').addEventListener('click', async () => {
  const button = $('sync');
  button.disabled = true;
  button.textContent = '正在同步…';
  try {
    const result = await api('/api/sync-all', 'POST', {});
    state = result.state;
    const total = result.results.filter(item => item.ok).reduce((sum, item) => sum + item.count, 0);
    const errors = result.results.filter(item => !item.ok);
    message(`${total ? `已读取 ${total} 项。` : ''}${errors.length ? `${errors.length} 门课程同步失败，请在课程设置中查看。` : '同步完成。'}`, errors.length > 0);
    render();
  } finally {
    button.textContent = '立即同步';
    button.disabled = !state.courses.some(courseAccessConfirmed);
  }
});

$('settings-course-select').addEventListener('change', event => { settingsCourseId = event.target.value; renderSettings(); });
$('open-browser').addEventListener('click', async () => {
  const course = selectedSettingsCourse();
  if (!course) return;
  try {
    const result = await api('/api/open-browser', 'POST', { courseId: course.id });
    state = result.state;
    renderSettings();
    message(result.message);
  } catch (error) { message(error.message, true); }
});
$('hide-browser').addEventListener('click', async () => {
  const course = selectedSettingsCourse();
  if (!course) return;
  try {
    const result = await api('/api/browser/hide', 'POST', { courseId: course.id });
    state = result.state;
    renderSettings();
    message(result.message);
  } catch (error) { message(error.message, true); }
});
$('add-course').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const before = new Set(state.courses.map(course => course.id));
    state = await api('/api/course', 'POST', { url: $('course-url').value });
    settingsCourseId = state.courses.find(course => !before.has(course.id))?.id || null;
    $('course-url').value = '';
    render();
    message('课程已添加。请打开登录窗口，完成登录后同步。');
  } catch (error) { message(error.message, true); }
});
$('import-text').addEventListener('click', async () => {
  const course = selectedSettingsCourse();
  if (!course) return;
  try {
    const result = await api('/api/import-text', 'POST', { courseId: course.id, text: $('paste-data').value });
    state = result.state;
    $('paste-data').value = '';
    render();
    message(result.message);
  } catch (error) { message(error.message, true); }
});
for (const id of ['wechat-key', 'wechat-time', 'wechat-enabled', 'wechat-include-notes']) {
  $(id).addEventListener('input', () => { wechatFormDirty = true; });
  $(id).addEventListener('change', () => { wechatFormDirty = true; });
}
for (const id of ['reminder-leads', 'quiet-enabled', 'quiet-start', 'quiet-end']) {
  $(id).addEventListener('input', () => { reminderFormDirty = true; });
  $(id).addEventListener('change', () => { reminderFormDirty = true; });
}
$('exam-leads').addEventListener('input', () => { examLeadsDirty = true; });
$('exam-leads-form').addEventListener('submit', async event => {
  event.preventDefault();
  const leadHours = $('exam-leads').value.split(/[,，\s]+/).filter(Boolean).map(Number);
  try {
    state = await api('/api/preferences', 'PATCH', { examLeadHours: leadHours });
    examLeadsDirty = false; render(); message('考试提醒时间已保存。');
  } catch (error) { message(error.message, true); }
});
$('reminder-form').addEventListener('submit', async event => {
  event.preventDefault();
  const leadHours = $('reminder-leads').value.split(/[,，\s]+/).filter(Boolean).map(Number);
  if (!leadHours.length || leadHours.some(value => !Number.isFinite(value))) { message('请输入有效的提前小时数。', true); return; }
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    state = await api('/api/reminders', 'PATCH', {
      leadHours, quietEnabled: $('quiet-enabled').checked, quietStart: $('quiet-start').value, quietEnd: $('quiet-end').value,
    });
    reminderFormDirty = false;
    render();
    message('提醒规则已保存，下次发送时间已更新。');
  } catch (error) { message(error.message, true); }
  finally { button.disabled = false; }
});
$('startup-enabled').addEventListener('change', async event => {
  const enabled = event.target.checked;
  event.target.disabled = true;
  try {
    state = await api('/api/startup', 'PATCH', { enabled });
    render();
    message(enabled ? '已启用登录 Windows 后自动启动。' : '已关闭登录 Windows 后自动启动。');
  } catch (error) {
    event.target.checked = !enabled;
    message(error.message, true);
  } finally { event.target.disabled = !state?.startup?.supported; }
});
$('mac-menu-bar-visible').addEventListener('change', event => {
  const bridge = window.webkit?.messageHandlers?.nativeHost;
  if (!bridge) { event.target.checked = !event.target.checked; return; }
  window.UBC_NATIVE_MENU_BAR_VISIBLE = event.target.checked;
  bridge.postMessage({ action: 'setMenuBarVisible', visible: event.target.checked });
});
$('mac-notification-permission').addEventListener('click', () => {
  window.webkit?.messageHandlers?.nativeHost?.postMessage({ action: 'requestNotificationPermission' });
});
$('mac-notification-test').addEventListener('click', () => {
  window.webkit?.messageHandlers?.nativeHost?.postMessage({ action: 'testNotification' });
  message('已提交 macOS 测试通知，请查看系统通知中心。');
});
$('require-manual-completion').addEventListener('change', async event => {
  const requireManualCompletion = event.target.checked;
  event.target.disabled = true;
  try {
    state = await api('/api/preferences', 'PATCH', { requireManualCompletion });
    render();
    message(requireManualCompletion ? '已启用手动确认，100% 作业会置顶等待确认。' : '已恢复自动判断，100% 作业会自动完成。');
  } catch (error) {
    event.target.checked = !requireManualCompletion;
    message(error.message, true);
  } finally { event.target.disabled = false; }
});
$('reminders-paused').addEventListener('change', async event => {
  const paused = event.target.checked;
  event.target.disabled = true;
  try {
    state = await api('/api/reminders', 'PATCH', { paused });
    render();
    message(paused ? '全部提醒已暂停，课程同步会继续。' : '提醒已恢复。');
  } catch (error) {
    event.target.checked = !paused;
    message(error.message, true);
  } finally { event.target.disabled = false; }
});
$('wechat-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('wechat-form').querySelector('button[type="submit"]');
  const body = { time: $('wechat-time').value, enabled: $('wechat-enabled').checked, includeNotes: $('wechat-include-notes').checked };
  if ($('wechat-key').value.trim()) body.sendKey = $('wechat-key').value.trim();
  button.disabled = true;
  try {
    state = await api('/api/wechat', 'PATCH', body);
    $('wechat-key').value = '';
    wechatFormDirty = false;
    render();
    message('微信提醒设置已保存。');
  } catch (error) { message(error.message, true); }
  finally { button.disabled = false; }
});
$('wechat-test').addEventListener('click', async () => {
  const button = $('wechat-test');
  button.disabled = true;
  button.textContent = '正在发送…';
  try {
    const result = await api('/api/wechat/test', 'POST', {});
    state = result.state;
    render();
    message(result.message);
  } catch (error) { message(error.message, true); }
  finally { button.textContent = '发送测试消息'; button.disabled = !state?.wechat?.hasKey; }
});
$('wechat-clear').addEventListener('click', async () => {
  if (!confirm(i18n.translate('清除本机保存的微信推送密钥，并关闭每日提醒？'))) return;
  try {
    state = await api('/api/wechat', 'PATCH', { clearKey: true });
    $('wechat-key').value = '';
    wechatFormDirty = false;
    render();
    message('密钥已清除，每日微信提醒已关闭。');
  } catch (error) { message(error.message, true); }
});
for (const id of ['email-from', 'email-to', 'email-time', 'email-scope', 'email-enabled', 'email-password']) {
  $(id).addEventListener('input', () => { emailFormDirty = true; });
  $(id).addEventListener('change', () => { emailFormDirty = true; });
}
$('email-connect').addEventListener('click', async () => {
  const button = $('email-connect');
  button.disabled = true;
  try {
    const result = await api('/api/email/connect', 'POST', { from: $('email-from').value, password: $('email-password').value });
    $('email-password').value = '';
    state = result.state;
    renderSettings();
    message(result.message);
  } catch (error) { message(error.message, true); }
  finally { button.disabled = false; }
});
$('email-test').addEventListener('click', async () => {
  if ($('email-from').value.trim().toLowerCase() !== state.email?.from?.toLowerCase()) return message('请先连接新的 Gmail 发件账户。', true);
  const button = $('email-test');
  button.disabled = true;
  try {
    const result = await api('/api/email/test', 'POST', { to: $('email-to').value });
    state = result.state;
    renderSettings();
    message(result.message);
  } catch (error) { message(error.message, true); }
  finally { button.disabled = !state.email?.connected; }
});
$('email-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('email-form').querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    state = await api('/api/email', 'PATCH', { from: $('email-from').value, to: $('email-to').value,
      time: $('email-time').value, scope: $('email-scope').value, enabled: $('email-enabled').checked });
    emailFormDirty = false;
    renderSettings();
    message('邮件提醒设置已保存。');
  } catch (error) { message(error.message, true); }
  finally { button.disabled = false; }
});
$('email-disconnect').addEventListener('click', async () => {
  if (!confirm(i18n.translate('断开 Gmail 发件账户并删除本机授权？'))) return;
  try {
    const result = await api('/api/email/disconnect', 'POST', {});
    state = result.state;
    $('email-password').value = '';
    emailFormDirty = false;
    renderSettings();
    message(result.message);
  } catch (error) { message(error.message, true); }
});
$('cancel-deadline').addEventListener('click', () => $('deadline-dialog').close());
$('clear-deadline').addEventListener('click', async () => {
  try {
    state = await api('/api/task', 'PATCH', { id: editingTaskId, deadlineOverride: null });
    $('deadline-dialog').close();
    render();
  } catch (error) { message(error.message, true); }
});
$('backup-export').addEventListener('click', async () => {
  const button = $('backup-export');
  button.disabled = true;
  try {
    const backup = await api('/api/backup/export', 'POST', {});
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `UBC作业管理工具-备份-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    message(`已导出 ${backup.scope.courses} 门课程和 ${backup.scope.tasks} 项作业；凭证和个人查询参数未写入文件。`);
  } catch (error) { message(error.message, true); }
  finally { button.disabled = false; }
});
$('backup-file').addEventListener('change', async event => {
  pendingBackup = null;
  $('backup-import').disabled = true;
  const file = event.target.files?.[0];
  $('backup-file-name').textContent = file?.name || '未选择文件';
  if (file) $('backup-file-name').dataset.i18nSkip = '';
  else delete $('backup-file-name').dataset.i18nSkip;
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { $('backup-summary').textContent = '文件超过 5 MB，无法导入。'; return; }
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.format !== 'ubc-assignment-manager-backup' || parsed.formatVersion !== 1 || !parsed.scope) throw new Error('文件格式或版本不受支持。');
    pendingBackup = parsed;
    $('backup-summary').textContent = `文件包含 ${Number(parsed.scope.courses) || 0} 门课程、${Number(parsed.scope.tasks) || 0} 项作业。恢复会替换当前课程和作业，并先创建本机恢复点；SendKey、Cookie、浏览器登录资料不会从文件导入。`;
    $('backup-import').disabled = false;
  } catch (error) { $('backup-summary').textContent = `无法读取备份：${error.message}`; }
});
$('backup-import').addEventListener('click', async () => {
  if (!pendingBackup || !confirm(i18n.translate('确认用这份备份替换当前课程、作业和普通设置？应用会先创建本机恢复点。'))) return;
  const button = $('backup-import');
  button.disabled = true;
  try {
    const result = await api('/api/backup/import', 'POST', { backup: pendingBackup });
    state = result.state;
    selectedScope = 'all'; selectedTaskId = null; settingsCourseId = null;
    wechatFormDirty = false; reminderFormDirty = false; examLeadsDirty = false;
    pendingBackup = null; $('backup-file').value = '';
    delete $('backup-file-name').dataset.i18nSkip;
    $('backup-file-name').textContent = '未选择文件';
    $('backup-summary').textContent = '恢复完成。本机已保留导入前恢复点。请重新登录课程；微信凭证未从备份导入。';
    render();
    message(result.message);
  } catch (error) { message(error.message, true); }
  finally { button.disabled = !pendingBackup; }
});
$('deadline-form').addEventListener('submit', async event => {
  event.preventDefault();
  const value = $('deadline-input').value;
  if (!value) { message('请先选择日期和时间。', true); return; }
  try {
    state = await api('/api/task', 'PATCH', { id: editingTaskId, deadlineOverride: UBCClock.parseInput(value).toISOString() });
    $('deadline-dialog').close();
    render();
  } catch (error) { message(error.message, true); }
});
$('quit').addEventListener('click', async () => {
  if (window.webkit?.messageHandlers?.nativeHost) {
    window.webkit.messageHandlers.nativeHost.postMessage({ action: 'quitApp' });
    return;
  }
  try { await api('/api/shutdown', 'POST', {}); window.close(); }
  catch (error) { message(error.message, true); }
});

api('/api/state').then(result => {
  state = result;
  UBCClock.configure(state.systemTimeZone);
  const { year, month } = UBCClock.parts(new Date());
  calendarCursor = new Date(Date.UTC(year, month - 1, 1, 12));
  routeFromHash();
  window.webkit?.messageHandlers?.nativeHost?.postMessage({ action: 'setLanguage', language: i18n.locale() });
  checkUpdate();
  window.webkit?.messageHandlers?.nativeHost?.postMessage({ action: 'notificationStatus' });
}).catch(error => message(error.message, true));
setInterval(() => api('/api/state').then(result => { state = result; render(); }).catch(() => {}), 60_000);
