let state = null;
let selectedScope = 'all';
let selectedTab = 'pending';
let settingsPanel = 'general';
let settingsCourseId = null;
let editingTaskId = null;
let wechatFormDirty = false;

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
  if (selectedScope === 'all') return state.tasks;
  if (selectedScope.startsWith('platform:')) {
    const platform = selectedScope.slice('platform:'.length);
    return state.tasks.filter(task => coursePlatform(courseFor(task)) === platform);
  }
  if (selectedScope.startsWith('course:')) {
    const courseId = selectedScope.slice('course:'.length);
    return state.tasks.filter(task => task.courseId === courseId);
  }
  return state.tasks;
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
      button.append(node('span', 'course-name', shortCourseName(course)));
      const dot = node('span', 'notification-dot');
      dot.hidden = !state.tasks.some(task => task.courseId === course.id && actionable(task));
      button.append(dot);
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

function taskRow(task) {
  const row = node('article', 'assignment-row');
  const main = node('div', 'assignment-main');
  if (task.code && task.code !== task.name) main.append(node('span', 'assignment-code', task.code));
  const title = node('a', 'assignment-title', task.name);
  title.href = task.url;
  title.target = '_blank';
  title.rel = 'noopener noreferrer';
  main.append(title);
  const course = courseFor(task);
  main.append(node('div', 'assignment-meta', [course?.name, task.section, task.score && `成绩 ${task.score}`].filter(Boolean).join(' · ')));

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
  toggle.addEventListener('click', async () => {
    try {
      state = await api('/api/task', 'PATCH', { id: task.id, doneOverride: !isDone(task) });
      render();
    } catch (error) { message(error.message, true); }
  });
  actions.append(edit, toggle);
  row.append(main, date, status, actions);
  return row;
}

function sourceSection(platform, tasks) {
  const section = node('section', 'source-section');
  const heading = node('div', 'source-heading');
  heading.append(node('span', `source-mark ${platform === 'webwork' ? 'ww' : 'pl'}`, platform === 'webwork' ? 'W' : 'P'));
  heading.append(node('h2', '', platformNames[platform]));
  if (state.tasks.some(task => coursePlatform(courseFor(task)) === platform && actionable(task))) heading.append(node('span', 'notification-dot'));
  heading.append(node('span', 'source-caption', `${tasks.length} 项`));
  const list = node('div', 'assignment-list');
  const header = node('div', 'list-header');
  for (const label of ['课程 / 作业', selectedTab === 'future' ? '开放时间' : '日期', '状态', '操作']) header.append(node('span', '', label));
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

function renderWork() {
  const course = selectedScope.startsWith('course:') ? state.courses.find(item => item.id === selectedScope.slice(7)) : null;
  if (selectedScope === 'all') {
    $('work-breadcrumb').textContent = '作业 / 全部作业';
    $('work-heading').textContent = '你的作业';
    $('work-summary').textContent = '两个平台分别归档，在同一处查看截止时间和完成状态。';
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
  for (const tab of Object.keys(tabNames)) {
    $(`${tab}-tab-count`).textContent = tasks.filter(task => categoryOf(task) === tab).length;
  }
  for (const button of document.querySelectorAll('.tab')) button.classList.toggle('active', button.dataset.tab === selectedTab);
  const shown = sortTasks(tasks.filter(task => categoryOf(task) === selectedTab));
  const groups = $('task-groups');
  groups.replaceChildren();
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
    return;
  }
  for (const platform of ['prairielearn', 'webwork']) {
    const platformTasks = shown.filter(task => coursePlatform(courseFor(task)) === platform);
    if (platformTasks.length) groups.append(sourceSection(platform, platformTasks));
  }
}

function renderSettings() {
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

function render() {
  if (!state) return;
  if (selectedScope.startsWith('course:') && !state.courses.some(course => course.id === selectedScope.slice(7))) selectedScope = 'all';
  const settings = location.hash.startsWith('#settings');
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
$('nav-prairielearn').addEventListener('click', () => navigateWork('platform:prairielearn'));
$('nav-webwork').addEventListener('click', () => navigateWork('platform:webwork'));
$('nav-settings').addEventListener('click', () => navigateSettings(settingsPanel));
$('all-folder').addEventListener('click', () => navigateWork('all'));
$('pl-folder').addEventListener('click', () => navigateWork('platform:prairielearn'));
$('ww-folder').addEventListener('click', () => navigateWork('platform:webwork'));
$('nav-menu').addEventListener('click', () => {
  const open = document.querySelector('.folder-pane').classList.toggle('open');
  $('nav-menu').setAttribute('aria-expanded', String(open));
});
document.querySelector('.content').addEventListener('click', () => { if (window.innerWidth <= 760) closeMobileMenu(); });
for (const button of document.querySelectorAll('.settings-link')) button.addEventListener('click', () => navigateSettings(button.dataset.settings));
for (const button of document.querySelectorAll('.tab')) button.addEventListener('click', () => { selectedTab = button.dataset.tab; renderWork(); });
window.addEventListener('hashchange', routeFromHash);

$('sync').addEventListener('click', async () => {
  const button = $('sync');
  button.disabled = true;
  button.textContent = '正在同步…';
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
    message(`${total ? `已读取 ${total} 项。` : ''}${errors.length ? `同步失败：${errors.join('；')}` : '同步完成。'}`, errors.length > 0);
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

api('/api/state').then(result => { state = result; routeFromHash(); }).catch(error => message(error.message, true));
setInterval(() => api('/api/state').then(result => { state = result; render(); }).catch(() => {}), 60_000);
