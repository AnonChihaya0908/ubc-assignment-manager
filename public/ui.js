let state = null;
let selectedScope = 'all';
let selectedTab = 'pending';
let settingsPanel = 'general';
let settingsCourseId = null;
let editingTaskId = null;
let wechatFormDirty = false;
let selectedTaskId = null;
let searchTerm = '';
let inspectorTasks = [];
let lastSyncError = null;
let updateStatus = { kind: 'checking', currentVersion: '1.1.2' };
let promptedUpdate = null;

const $ = id => document.getElementById(id);
const platformNames = { prairielearn: 'PrairieLearn', webwork: 'WeBWorK' };
const settingNames = { general: '常规与窗口', reminders: '提醒与同步', courses: '课程与登录', data: '数据与退出' };
const tabNames = { pending: '待完成', future: '将开放', history: '已过日期', done: '已完成' };

async function api(path, method = 'GET', body) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
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

function courseFor(task) { return state.courses.find(course => course.id === task.courseId); }
function isDone(task) {
  return task.doneOverride === null || task.doneOverride === undefined
    ? /^100(?:\.0+)?%$/.test((task.score || '').trim())
    : task.doneOverride;
}
function dueOf(task) { return task.deadlineOverride || task.dueAt || null; }
function actionable(task) { return !isDone(task) && task.sourceStatus !== 'future' && task.sourceStatus !== 'past_due'; }

function categoryOf(task, now = Date.now()) {
  if (isDone(task)) return 'done';
  if (task.sourceStatus === 'future' && !task.deadlineOverride) return 'future';
  if (task.sourceStatus === 'past_due' && !task.deadlineOverride) return 'history';
  const due = dueOf(task);
  return due && new Date(due).getTime() < now ? 'history' : 'pending';
}

function formatDate(iso) {
  if (!iso) return '暂无日期';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '暂无日期';
  return new Intl.DateTimeFormat('zh-CN', {
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
  const allPending = state.tasks.filter(task => categoryOf(task) === 'pending').length;
  $('all-count').textContent = allPending || '';
  $('all-folder').classList.toggle('active', selectedScope === 'all');
  $('nav-all').classList.toggle('active', !location.hash.startsWith('#settings') && selectedScope === 'all');
  for (const platform of ['prairielearn', 'webwork']) {
    const courses = state.courses.filter(course => coursePlatform(course) === platform);
    const tasks = state.tasks.filter(task => coursePlatform(courseFor(task)) === platform);
    const hasPending = tasks.some(actionable);
    $(`${platform === 'webwork' ? 'ww' : 'pl'}-count`).textContent = tasks.filter(actionable).length || '';
    const rail = $(platform === 'webwork' ? 'nav-webwork' : 'nav-prairielearn');
    const group = $(platform === 'webwork' ? 'ww-folder' : 'pl-folder');
    setDot(rail.querySelector('.notification-dot'), hasPending);
    setDot(group.querySelector('.notification-dot'), hasPending);
    const selectedCourse = selectedScope.startsWith('course:') ? state.courses.find(course => course.id === selectedScope.slice(7)) : null;
    rail.classList.toggle('active', !location.hash.startsWith('#settings') && (selectedScope === `platform:${platform}` || coursePlatform(selectedCourse) === platform && Boolean(selectedCourse)));
    group.classList.toggle('active', selectedScope === `platform:${platform}`);
    const container = $(platform === 'webwork' ? 'ww-courses' : 'pl-courses');
    container.replaceChildren();
    for (const course of courses) {
      const button = node('button', 'course-folder');
      button.type = 'button';
      button.title = course.name;
      button.classList.toggle('active', selectedScope === `course:${course.id}`);
      button.append(node('span', `source-mark ${platform === 'webwork' ? 'ww' : 'pl'}`, platform === 'webwork' ? 'W' : 'PL'));
      button.append(node('span', 'course-name', shortCourseName(course)));
      const dot = node('span', 'notification-dot');
      const pendingCount = state.tasks.filter(task => task.courseId === course.id && actionable(task)).length;
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

function taskRow(task) {
  const row = node('article', 'assignment-row');
  row.dataset.taskId = task.id;
  row.tabIndex = 0;
  row.setAttribute('aria-label', `查看 ${task.name} 的详情`);
  const main = node('div', 'assignment-main');
  const course = courseFor(task);
  main.append(node('span', `source-mark ${coursePlatform(course) === 'webwork' ? 'ww' : 'pl'}`, coursePlatform(course) === 'webwork' ? 'W' : 'PL'));
  const description = node('div', 'assignment-description');
  if (task.code && task.code !== task.name) description.append(node('span', 'assignment-code', task.code));
  const title = node('a', 'assignment-title', task.name);
  title.href = task.url;
  title.target = '_blank';
  title.rel = 'noopener noreferrer';
  description.append(title);
  description.append(node('div', 'assignment-meta', [course ? shortCourseName(course) : '', platformNames[coursePlatform(course)], task.section].filter(Boolean).join(' · ')));
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
  const status = node('span', `status-label ${category === 'history' ? 'late' : category}`, category === 'history' && task.sourceStatus === 'past_due' ? '已截止' : tabNames[category]);
  const actions = node('div', 'row-actions');
  const edit = node('button', '', '改日期');
  edit.type = 'button';
  edit.addEventListener('click', () => editDeadline(task));
  const toggle = node('button', '', isDone(task) ? '撤销完成' : '标为完成');
  toggle.type = 'button';
  toggle.addEventListener('click', () => toggleTaskCompletion(task));
  actions.append(edit, toggle);
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

function taskSection(title, tasks, recent = false) {
  const section = node('section', 'source-section');
  const heading = node('div', 'source-heading');
  heading.append(node('h2', '', title), node('span', 'source-caption', `${tasks.length} 项`));
  const list = node('div', 'assignment-list');
  const header = node('div', 'list-header');
  for (const label of ['作业', selectedTab === 'future' && !recent ? '开放时间' : '日期', '状态', '成绩']) header.append(node('span', '', label));
  list.append(header);
  for (const task of tasks) list.append(taskRow(task));
  section.append(heading, list);
  return section;
}

function sortTasks(tasks) {
  return tasks.sort((a, b) => {
    const first = selectedTab === 'future' ? a.opensAt : dueOf(a);
    const second = selectedTab === 'future' ? b.opensAt : dueOf(b);
    if (first && second) return selectedTab === 'history' ? new Date(second) - new Date(first) : new Date(first) - new Date(second);
    if (first) return -1;
    if (second) return 1;
    return a.name.localeCompare(b.name);
  });
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
  container.append(node('h2', '', task.name));
  container.append(node('p', 'inspector-course', course?.name || platformNames[platform]));
  const details = node('dl', 'inspector-details');
  const addDetail = (label, value) => { details.append(node('dt', '', label), node('dd', '', value)); };
  const dateInfo = rowDate(task);
  addDetail('来源', platformNames[platform]);
  addDetail('状态', categoryOf(task) === 'history' && task.sourceStatus === 'past_due' ? '已截止' : tabNames[categoryOf(task)]);
  if (task.section) addDetail('分类', task.section);
  if (task.sourceStatus === 'future' && task.opensAt) addDetail('开放时间', formatDate(task.opensAt));
  addDetail(dateInfo.label, dateInfo.value ? formatDate(dateInfo.value) : dateInfo.text || '暂无日期');
  addDetail('成绩', task.score || '暂无成绩');
  container.append(details);
  const due = dueOf(task);
  if (due && !isDone(task)) {
    const days = Math.ceil((new Date(due).getTime() - Date.now()) / 86400000);
    const hint = days > 0 ? `距离当前日期还有 ${days} 天。` : days === 0 ? '今天到期。' : '网页显示的日期已经过去。';
    container.append(node('p', 'inspector-hint', `${hint}截止信息会随平台同步更新。`));
  } else if (!due && !isDone(task)) {
    container.append(node('p', 'inspector-hint', '网页没有显示明确截止时间。你可以手动设置提醒日期。'));
  }
  if (task.url) {
    const link = node('a', 'inspector-open', `在 ${platformNames[platform]} 中打开 ↗`);
    link.href = task.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    container.append(link);
  }
  const actions = node('div', 'inspector-actions');
  const edit = node('button', 'secondary-button', '修改提醒日期');
  edit.type = 'button';
  edit.addEventListener('click', () => editDeadline(task));
  const toggle = node('button', 'secondary-button', isDone(task) ? '撤销完成' : '标为完成');
  toggle.type = 'button';
  toggle.addEventListener('click', () => toggleTaskCompletion(task));
  actions.append(edit, toggle);
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

function renderWork() {
  const course = selectedScope.startsWith('course:') ? state.courses.find(item => item.id === selectedScope.slice(7)) : null;
  if (selectedScope === 'all') {
    $('work-breadcrumb').textContent = '作业 / 全部作业';
    $('work-heading').textContent = '作业概览';
    $('work-summary').textContent = '将两个平台的待办和成绩汇总到同一工作区。';
  } else if (course) {
    $('work-breadcrumb').textContent = `作业 / ${platformNames[coursePlatform(course)]} / ${shortCourseName(course)}`;
    $('work-heading').textContent = shortCourseName(course);
    $('work-summary').textContent = course.name;
  } else {
    const platform = selectedScope.slice('platform:'.length);
    $('work-breadcrumb').textContent = `作业 / ${platformNames[platform]}`;
    $('work-heading').textContent = platformNames[platform];
    $('work-summary').textContent = '查看这个平台的课程和作业。';
  }
  const tasks = visibleTasks();
  $('today-label').textContent = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  const pendingCount = tasks.filter(task => categoryOf(task) === 'pending').length;
  $('pending-badge').querySelector('span:last-child').textContent = `${pendingCount} 项待完成`;
  $('pending-badge').querySelector('.notification-dot').hidden = pendingCount === 0;
  $('overview-pending').textContent = pendingCount;
  $('overview-done').textContent = tasks.filter(task => categoryOf(task) === 'done').length;
  const nearest = tasks.filter(task => categoryOf(task) === 'pending' && dueOf(task))
    .map(task => new Date(dueOf(task)).getTime()).filter(Number.isFinite).sort((a, b) => a - b)[0];
  $('overview-nearest').textContent = nearest === undefined ? '—' : `${Math.max(0, Math.ceil((nearest - Date.now()) / 86400000))} 天`;
  for (const tab of Object.keys(tabNames)) {
    $(`${tab}-tab-count`).textContent = tasks.filter(task => categoryOf(task) === tab).length;
  }
  for (const button of document.querySelectorAll('.tab')) button.classList.toggle('active', button.dataset.tab === selectedTab);
  const shown = sortTasks(tasks.filter(task => categoryOf(task) === selectedTab));
  const groups = $('task-groups');
  groups.replaceChildren();
  const recentDone = selectedTab === 'pending' ? sortTasks(tasks.filter(task => categoryOf(task) === 'done')).slice(0, 3) : [];
  inspectorTasks = [...shown, ...recentDone];
  if (!inspectorTasks.some(task => task.id === selectedTaskId)) selectedTaskId = inspectorTasks[0]?.id || null;
  if (!shown.length) {
    const empty = node('div', 'empty-state');
    const title = !state.courses.length ? '还没有课程' : selectedTab === 'pending' && state.tasks.length === 0 ? '还没有同步作业' : `暂无${tabNames[selectedTab]}的作业`;
    empty.append(node('h2', '', title));
    empty.append(node('p', '', !state.courses.length ? '到设置中添加 PrairieLearn 或 WeBWorK 课程。' : state.tasks.length === 0 ? '到设置中打开课程登录窗口，然后点击左下角的立即同步。' : '可以在左侧切换课程，或查看其他作业状态。'));
    if (!state.courses.length || state.tasks.length === 0) {
      const action = node('button', 'primary-button', '前往课程设置');
      action.type = 'button';
      action.addEventListener('click', () => navigateSettings('courses'));
      empty.append(action);
    }
    groups.append(empty);
  } else {
    groups.append(taskSection({ pending: '即将截止', future: '将开放', history: '已过日期', done: '已完成' }[selectedTab], shown));
  }
  if (recentDone.length) groups.append(taskSection('最近完成', recentDone, true));
  renderSelection();
}

function renderSettings() {
  $('app-version').textContent = state.version || '1.1.2';
  document.title = `UBC作业管理工具 ${state.version || '1.1.2'}`;
  document.querySelector('.toolbar-version').textContent = state.version || '1.1.2';
  renderUpdateStatus();
  $('settings-breadcrumb').textContent = `设置 / ${settingNames[settingsPanel]}`;
  $('settings-heading').textContent = settingNames[settingsPanel];
  $('settings-summary').textContent = settingsPanel === 'courses' ? '添加课程，管理登录窗口和手动导入。' :
    settingsPanel === 'reminders' ? '查看当前的提醒和同步规则。' :
    settingsPanel === 'data' ? '了解本地数据的保存方式，并管理应用运行。' :
    '窗口布局和作业标记规则。';
  for (const panel of Object.keys(settingNames)) $(`settings-${panel}`).hidden = settingsPanel !== panel;
  for (const button of document.querySelectorAll('.settings-link')) button.classList.toggle('active', button.dataset.settings === settingsPanel);
  const select = $('settings-course-select');
  const current = settingsCourseId || select.value;
  select.replaceChildren();
  for (const course of state.courses) select.append(new Option(course.name, course.id));
  settingsCourseId = state.courses.some(course => course.id === current) ? current : state.courses[0]?.id || null;
  if (settingsCourseId) select.value = settingsCourseId;
  select.disabled = !state.courses.length;
  $('open-browser').disabled = !state.courses.length;
  $('import-text').disabled = !state.courses.length;
  $('course-list').replaceChildren();
  if (!state.courses.length) $('course-list').append(node('p', 'setting-intro', '尚未添加课程。'));
  for (const course of state.courses) {
    const row = node('div', 'settings-course');
    const description = node('div', 'settings-course-main');
    description.append(node('strong', '', course.name));
    description.append(node('small', '', `${platformNames[coursePlatform(course)]} · ${course.lastSyncedAt ? `上次同步 ${formatDate(course.lastSyncedAt)}` : '尚未同步'}`));
    const remove = node('button', '', '移除');
    remove.type = 'button';
    remove.setAttribute('aria-label', `移除 ${course.name}`);
    remove.addEventListener('click', async () => {
      if (!confirm(`移除 ${course.name} 及其本地作业记录？`)) return;
      try {
        state = await api('/api/course', 'DELETE', { id: course.id });
        if (selectedScope === `course:${course.id}`) selectedScope = 'all';
        if (settingsCourseId === course.id) settingsCourseId = null;
        render();
      } catch (error) { message(error.message, true); }
    });
    row.append(description, remove);
    $('course-list').append(row);
  }
  const wechat = state.wechat || { enabled: false, time: '09:00', hasKey: false };
  if (!wechatFormDirty) {
    $('wechat-time').value = wechat.time || '09:00';
    $('wechat-enabled').checked = Boolean(wechat.enabled);
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
  if (!status.length) status.push(wechat.enabled ? '已启用，等待下次发送时间。' : '每日提醒尚未启用。');
  $('wechat-status').textContent = status.join(' · ');
  $('wechat-status').classList.toggle('error', Boolean(wechat.lastError));
}

function renderUpdateStatus() {
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
    : updateStatus.kind === 'available' && updateStatus.canInstall === false
      ? '发现新版本。当前位于 Git 开发目录，请在独立的便携包中使用应用内更新。'
    : labels[updateStatus.kind] || '更新状态未知。';
  $('update-status').classList.toggle('error', updateStatus.kind === 'error' || lastFailure);
  const available = updateStatus.kind === 'available';
  $('install-update').hidden = !available || updateStatus.canInstall === false;
  $('install-update').disabled = !available || updateStatus.canInstall === false;
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
    if (updateStatus.kind === 'available' && updateStatus.canInstall !== false && promptedUpdate !== updateStatus.release.version &&
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
  if (selectedScope.startsWith('course:') && !state.courses.some(course => course.id === selectedScope.slice(7))) selectedScope = 'all';
  const settings = location.hash.startsWith('#settings');
  document.body.classList.toggle('settings-view', settings);
  $('work-layout').hidden = settings;
  $('work-page').hidden = settings;
  $('settings-page').hidden = !settings;
  $('work-navigation').hidden = settings;
  $('settings-navigation').hidden = !settings;
  $('nav-settings').classList.toggle('active', settings);
  renderFolders();
  renderWork();
  renderSettings();
  const last = state.courses.map(course => course.lastSyncedAt).filter(Boolean).sort().at(-1);
  $('sync-status').textContent = last ? `上次同步：${formatDate(last)}` : '尚未同步';
  $('sync').disabled = state.syncing || !state.courses.length;
  $('footer-sync').textContent = state.syncing ? '正在同步' : lastSyncError ? '同步失败' : last ? `上次同步 ${formatDate(last)}` : '尚未同步';
  $('footer-sync').title = lastSyncError || '';
  $('footer-sync').classList.toggle('error', Boolean(lastSyncError));
  const plCount = state.courses.filter(course => coursePlatform(course) === 'prairielearn').length;
  const wwCount = state.courses.filter(course => coursePlatform(course) === 'webwork').length;
  $('footer-sources').textContent = `PrairieLearn ${plCount} 门课程 · WeBWorK ${wwCount} 门课程`;
  $('footer-reminder').textContent = state.wechat?.lastError ? '每日提醒发送失败' : state.wechat?.enabled ? '每日提醒已启用' : '每日提醒未启用';
  $('footer-reminder').classList.toggle('error', Boolean(state.wechat?.lastError));
  $('footer-timezone').textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;
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
$('toolbar-courses').addEventListener('click', () => navigateWork('all'));
$('nav-prairielearn').addEventListener('click', () => navigateWork('platform:prairielearn'));
$('nav-webwork').addEventListener('click', () => navigateWork('platform:webwork'));
$('nav-settings').addEventListener('click', () => navigateSettings(settingsPanel));
$('check-update').addEventListener('click', () => checkUpdate(true));
$('install-update').addEventListener('click', installUpdate);
$('update-now').addEventListener('click', installUpdate);
$('update-later').addEventListener('click', () => $('update-dialog').close());
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
  if (state) renderWork();
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
  lastSyncError = null;
  let total = 0;
  const errors = [];
  try {
    for (const course of [...state.courses]) {
      try {
        const result = await api('/api/sync', 'POST', { courseId: course.id });
        state = result.state;
        total += state.tasks.filter(task => task.courseId === course.id).length;
      } catch (error) { errors.push(`${shortCourseName(course)}：${error.message}`); }
    }
    lastSyncError = errors.length ? errors.join('；') : null;
    message(`${total ? `已读取 ${total} 项。` : ''}${errors.length ? `同步失败：${lastSyncError}` : '同步完成。'}`, errors.length > 0);
    render();
  } finally {
    button.textContent = '立即同步';
    button.disabled = !state.courses.length;
  }
});

$('settings-course-select').addEventListener('change', event => { settingsCourseId = event.target.value; });
$('open-browser').addEventListener('click', async () => {
  const course = selectedSettingsCourse();
  if (!course) return;
  try {
    const result = await api('/api/open-browser', 'POST', { courseId: course.id });
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
for (const id of ['wechat-key', 'wechat-time', 'wechat-enabled']) {
  $(id).addEventListener('input', () => { wechatFormDirty = true; });
  $(id).addEventListener('change', () => { wechatFormDirty = true; });
}
$('wechat-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('wechat-form').querySelector('button[type="submit"]');
  const body = { time: $('wechat-time').value, enabled: $('wechat-enabled').checked };
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
  if (!confirm('清除本机保存的微信推送密钥，并关闭每日提醒？')) return;
  try {
    state = await api('/api/wechat', 'PATCH', { clearKey: true });
    $('wechat-key').value = '';
    wechatFormDirty = false;
    render();
    message('密钥已清除，每日微信提醒已关闭。');
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
  try { await api('/api/shutdown', 'POST', {}); window.close(); }
  catch (error) { message(error.message, true); }
});

api('/api/state').then(result => { state = result; routeFromHash(); checkUpdate(); }).catch(error => message(error.message, true));
setInterval(() => api('/api/state').then(result => { state = result; render(); }).catch(() => {}), 60_000);
