let state = null;
let selectedScope = 'all';
let selectedTab = 'pending';
let settingsPanel = 'general';
let settingsCourseId = null;
let editingTaskId = null;
let wechatFormDirty = false;
let emailFormDirty = false;
let reminderFormDirty = false;
let selectedTaskId = null;
let searchTerm = '';
let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let inspectorTasks = [];
let updateStatus = { kind: 'checking', currentVersion: '1.3.0' };
let promptedUpdate = null;
let onboardingActive = false;
let pendingBackup = null;
let macNotificationStatus = 'checking';

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
const platformNames = { prairielearn: 'PrairieLearn', webwork: 'WeBWorK' };
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
  if (!response.ok) throw new Error(data.error || '操作失败。');
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
  return course?.platform || (course?.url?.includes('webwork.elearning.ubc.ca') ? 'webwork' : 'prairielearn');
}

function courseAccessConfirmed(course) {
  return Boolean(course?.accessConfirmedAt && Number.isFinite(Date.parse(course.accessConfirmedAt)));
}

function courseFor(task) { return state.courses.find(course => course.id === task.courseId); }
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
  return new Intl.DateTimeFormat(i18n.locale(), {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function localDateInput(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function shortCourseName(course) {
  const name = course.name || '';
  const match = name.match(/\b([A-Z]{2,5})[_\s]*(?:V[_\s]*)?(\d{3})\b/i);
  const term = name.match(/\b20\d{2}W[12]\b/i);
  if (match) return `${match[1].toUpperCase()} ${match[2]}${term ? ` · ${term[0]}` : ''}`;
  return name.length > 30 ? `${name.slice(0, 29)}…` : name;
}

function courseSyncStatus(course, now = Date.now()) {
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
  let tasks = state.tasks;
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
  const workRoute = !location.hash.startsWith('#settings') && !location.hash.startsWith('#calendar');
  const allPending = state.tasks.filter(task => needsAttention(task)).length;
  $('all-count').textContent = allPending || '';
  $('all-folder').classList.toggle('active', workRoute && selectedScope === 'all');
  $('nav-all').classList.toggle('active', workRoute && selectedScope === 'all');
  $('nav-calendar').classList.toggle('active', location.hash.startsWith('#calendar'));
  for (const platform of ['prairielearn', 'webwork']) {
    const courses = state.courses.filter(course => coursePlatform(course) === platform);
    const tasks = state.tasks.filter(task => coursePlatform(courseFor(task)) === platform);
    const hasPending = tasks.some(task => needsAttention(task));
    $(`${platform === 'webwork' ? 'ww' : 'pl'}-count`).textContent = tasks.filter(task => needsAttention(task)).length || '';
    const rail = $(platform === 'webwork' ? 'nav-webwork' : 'nav-prairielearn');
    const group = $(platform === 'webwork' ? 'ww-folder' : 'pl-folder');
    setDot(rail.querySelector('.notification-dot'), hasPending);
    setDot(group.querySelector('.notification-dot'), hasPending);
    const selectedCourse = selectedScope.startsWith('course:') ? state.courses.find(course => course.id === selectedScope.slice(7)) : null;
    rail.classList.toggle('active', workRoute && (selectedScope === `platform:${platform}` || coursePlatform(selectedCourse) === platform && Boolean(selectedCourse)));
    group.classList.toggle('active', selectedScope === `platform:${platform}`);
    const container = $(platform === 'webwork' ? 'ww-courses' : 'pl-courses');
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
      button.append(node('span', `source-mark ${platform === 'webwork' ? 'ww' : 'pl'}`, platform === 'webwork' ? 'W' : 'PL'));
      const name = node('span', 'course-name', shortCourseName(course));
      name.dataset.i18nSkip = '';
      button.append(name);
      const dot = node('span', 'notification-dot');
      const pendingCount = state.tasks.filter(task => task.courseId === course.id && needsAttention(task)).length;
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
  main.append(node('span', `source-mark ${coursePlatform(course) === 'webwork' ? 'ww' : 'pl'}`, coursePlatform(course) === 'webwork' ? 'W' : 'PL'));
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
  return first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth() && first.getDate() === second.getDate();
}

function renderCalendar(tasks, container) {
  const calendar = node('section', 'calendar-view');
  const toolbar = node('div', 'calendar-toolbar');
  const title = node('h2', '', new Intl.DateTimeFormat(i18n.locale(), { year: 'numeric', month: 'long' }).format(calendarCursor));
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
    calendarCursor = new Date(today.getFullYear(), today.getMonth(), 1);
    renderCalendarPage();
  });
  controls.append(todayButton);
  for (const [direction, label, text] of [[-1, '上个月', '‹'], [1, '下个月', '›']]) {
    const button = node('button', '', text);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => {
      calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + direction, 1);
      renderCalendarPage();
    });
    controls.append(button);
  }
  toolbar.append(controls, title, legend);
  calendar.append(toolbar);

  const grid = node('div', 'calendar-grid');
  grid.setAttribute('role', 'grid');
  for (const weekday of ['日', '一', '二', '三', '四', '五', '六']) grid.append(node('div', 'calendar-weekday', weekday));
  const first = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  const events = tasks.flatMap(calendarEvents);
  const today = new Date();
  for (let index = 0; index < 42; index++) {
    const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    const cell = node('div', 'calendar-day');
    cell.setAttribute('role', 'gridcell');
    cell.classList.toggle('outside', day.getMonth() !== calendarCursor.getMonth());
    cell.classList.toggle('today', sameLocalDay(day, today));
    const dateLabel = node('time', 'calendar-date', String(day.getDate()));
    dateLabel.dateTime = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    cell.append(dateLabel);
    for (const event of events.filter(item => sameLocalDay(day, new Date(item.at)))) {
      const typeName = { due: '截止', open: '开放', manual: '手动日期' }[event.kind];
      const time = new Intl.DateTimeFormat(i18n.locale(), { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(event.at));
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
  const tasks = state.tasks.filter(task => !searchTerm || [task.name, task.code, task.section, courseFor(task)?.name, platformNames[coursePlatform(courseFor(task))]]
    .filter(Boolean).some(value => value.toLocaleLowerCase().includes(searchTerm)));
  $('calendar-breadcrumb').textContent = `日历 / ${new Intl.DateTimeFormat(i18n.locale(), { year: 'numeric', month: 'long' }).format(calendarCursor)}`;
  $('calendar-today-label').textContent = new Intl.DateTimeFormat(i18n.locale(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  inspectorTasks = [...tasks];
  if (!inspectorTasks.some(task => task.id === selectedTaskId)) selectedTaskId = inspectorTasks[0]?.id || null;
  const container = $('calendar-content');
  container.replaceChildren();
  renderCalendar(tasks, container);
  renderSelection();
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
  container.append(node('span', `source-mark inspector-source ${platform === 'webwork' ? 'ww' : 'pl'}`, platform === 'webwork' ? 'W' : 'PL'));
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

function renderToolbarContext(settings, calendar = false) {
  const course = selectedScope.startsWith('course:') ? state.courses.find(item => item.id === selectedScope.slice(7)) : null;
  const platform = course ? coursePlatform(course) : selectedScope.startsWith('platform:') ? selectedScope.slice('platform:'.length) : null;
  const context = settings ? 'settings' : calendar ? 'calendar' : platform || 'all';
  const labels = { all: '全部作业', calendar: '作业日历', prairielearn: 'PrairieLearn', webwork: 'WeBWorK', settings: '设置' };
  const marks = { prairielearn: 'PL', webwork: 'W', settings: 'ST' };
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
    $('work-summary').textContent = '将两个平台的待办和成绩汇总到同一工作区。';
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
  $('today-label').textContent = new Intl.DateTimeFormat(i18n.locale(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
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
    const title = !state.courses.length ? '还没有课程' : !hasSuccessfulSync ? '还没有完成首次同步' : state.tasks.length === 0 ? '同步完成，但没有发现可见作业' :
      allCurrentComplete ? '所有任务均已完成' : searchTerm ? '没有匹配的作业' : selectedTab !== 'all' ? '当前分类暂无作业' : '暂无作业';
    empty.append(node('h2', '', title));
    const description = !state.courses.length ? '添加 PrairieLearn Assessments 页面或 UBC WeBWorK 课程首页，即可开始。' :
      !hasSuccessfulSync ? '请打开专用 Edge 登录窗口，完成学校登录并停留在作业列表页，然后返回应用同步。' :
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
  $('app-version').textContent = state.version || '1.3.0';
  document.title = `UBC作业管理工具 ${state.version || '1.3.0'}`;
  document.querySelector('.toolbar-version').textContent = state.version || '1.3.0';
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
    ? '作业清单、提醒设置与专用 Edge 登录资料保存在当前 Mac 账户的“应用程序支持”目录中，覆盖升级不会删除。关闭主窗口不会停止后台提醒。'
    : '作业清单、提醒设置与专用 Edge 登录资料保存在当前 Windows 账户的本地应用数据目录中，覆盖升级不会删除。关闭网页不会停止后台提醒。';
  $('quit-description').textContent = mac
    ? '停止后台同步和 macOS 系统通知。下次可从“应用程序”重新打开。'
    : '停止后台同步和 Windows 提醒。下次可双击 UBC作业管理工具.exe 重新打开。';
  $('close-behavior-description').textContent = mac
    ? '关闭主窗口后应用可继续运行，并从菜单栏重新打开。完全退出请使用应用菜单或“数据与退出”。'
    : '关闭主窗口只会隐藏窗口，课程同步与提醒继续运行。请使用系统托盘或“数据与退出”页面退出应用。';
  $('close-behavior-value').textContent = mac ? '菜单栏运行' : '托盘运行';
  $('update-description').textContent = mac
    ? '应用通过 GitHub 公共 HTTPS API 检查更新。Mac 版下载对应架构的 .pkg 后手动安装；课程、作业与提醒设置保存在独立数据目录。'
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
    const actions = node('div', 'settings-course-actions');
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
    actions.append(login, retry, remove);
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
  $('reminder-timezone').textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;
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
      ? '发现新版本。请下载对应架构的 .pkg 并手动安装。'
    : updateStatus.kind === 'available' && updateStatus.canInstall === false
      ? '发现新版本。当前位于 Git 开发目录，请在独立的便携包中使用应用内更新。'
    : labels[updateStatus.kind] || '更新状态未知。';
  $('update-status').classList.toggle('error', updateStatus.kind === 'error' || lastFailure);
  const available = updateStatus.kind === 'available';
  $('install-update').hidden = !available || updateStatus.canInstall === false || manual;
  $('install-update').disabled = !available || updateStatus.canInstall === false || manual;
  $('download-update').hidden = !available || !manual || !updateStatus.release?.assetUrl;
  $('download-update').href = available && manual ? updateStatus.release?.assetUrl || '#' : '#';
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
  i18n.setPreference(state.preferences?.language, state.systemLocale);
  if (selectedScope.startsWith('course:') && !state.courses.some(course => course.id === selectedScope.slice(7))) selectedScope = 'all';
  const settings = location.hash.startsWith('#settings');
  const calendar = location.hash.startsWith('#calendar');
  document.body.classList.toggle('settings-view', settings);
  $('work-layout').hidden = settings;
  $('work-page').hidden = settings || calendar;
  $('calendar-page').hidden = settings || !calendar;
  $('settings-page').hidden = !settings;
  $('work-navigation').hidden = settings;
  $('settings-navigation').hidden = !settings;
  $('nav-settings').classList.toggle('active', settings);
  renderToolbarContext(settings, calendar);
  renderFolders();
  if (calendar) renderCalendarPage();
  else if (!settings) renderWork();
  renderSettings();
  renderOnboarding();
  showCourseAccessReview();
  const last = state.courses.map(course => course.lastSyncedAt).filter(Boolean).sort().at(-1);
  const failures = state.courses.filter(course => course.lastSyncError).length;
  const stale = state.courses.filter(course => ['stale', 'never'].includes(courseSyncStatus(course).kind)).length;
  $('sync-status').textContent = state.syncing ? '正在同步' : failures ? `${failures} 门课程同步失败` : stale ? `${stale} 门课程数据需要更新` : last ? `上次同步：${formatDate(last)}` : '尚未同步';
  $('sync').disabled = state.syncing || !state.courses.some(courseAccessConfirmed);
  $('footer-sync').textContent = state.syncing ? '正在同步' : failures ? `${failures} 门同步失败` : stale ? `${stale} 门数据可能过旧` : last ? `上次同步 ${formatDate(last)}` : '尚未同步';
  $('footer-sync').title = state.courses.filter(course => course.lastSyncError).map(course => `${shortCourseName(course)}：${course.lastSyncError}`).join('；');
  $('footer-sync').classList.toggle('error', failures > 0);
  const plCount = state.courses.filter(course => coursePlatform(course) === 'prairielearn').length;
  const wwCount = state.courses.filter(course => coursePlatform(course) === 'webwork').length;
  $('footer-sources').textContent = `PrairieLearn ${plCount} 门课程 · WeBWorK ${wwCount} 门课程`;
  $('footer-reminder').textContent = state.wechat?.remindersPaused ? '提醒已暂停' : state.wechat?.lastError ? '每日提醒发送失败' : state.wechat?.enabled ? '每日提醒已启用' : '每日提醒未启用';
  $('footer-reminder').classList.toggle('error', Boolean(state.wechat?.lastError && !state.wechat?.remindersPaused));
  $('footer-timezone').textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;
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

window.UBC_OPEN_TASK = taskId => {
  if (!state || !state.tasks.some(task => task.id === taskId)) return;
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
  calendarCursor = new Date(today.getFullYear(), today.getMonth(), 1);
  if (location.hash !== '#calendar') location.hash = 'calendar';
  render();
  closeMobileMenu();
}

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
$('nav-calendar').addEventListener('click', navigateCalendar);
$('nav-prairielearn').addEventListener('click', () => navigateWork('platform:prairielearn'));
$('nav-webwork').addEventListener('click', () => navigateWork('platform:webwork'));
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
    if (location.hash.startsWith('#calendar')) renderCalendarPage();
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
    $('backup-summary').textContent = `文件包含 ${Number(parsed.scope.courses) || 0} 门课程、${Number(parsed.scope.tasks) || 0} 项作业。恢复会替换当前课程和作业，并先创建本机恢复点；SendKey、Cookie、Edge 登录资料不会从文件导入。`;
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
    wechatFormDirty = false; reminderFormDirty = false;
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
    state = await api('/api/task', 'PATCH', { id: editingTaskId, deadlineOverride: new Date(value).toISOString() });
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
  routeFromHash();
  window.webkit?.messageHandlers?.nativeHost?.postMessage({ action: 'setLanguage', language: i18n.locale() });
  checkUpdate();
  window.webkit?.messageHandlers?.nativeHost?.postMessage({ action: 'notificationStatus' });
}).catch(error => message(error.message, true));
setInterval(() => api('/api/state').then(result => { state = result; render(); }).catch(() => {}), 60_000);
