const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { edgePath, cdp } = require('../lib/browser');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('desktop navigation separates sources, settings, and clears red dots after completion', { timeout: 30000 }, async () => {
  const future = days => new Date(Date.now() + days * 86400000).toISOString();
  const courses = [
    { id: 'pl:1', platform: 'prairielearn', name: 'CPSC 310 · 2026W1', url: 'https://us.prairielearn.com/pl/course_instance/1/assessments',
      lastSyncedAt: new Date().toISOString(), lastSyncError: '专用 Edge 窗口尚未登录', lastSyncErrorKind: 'login', ignoredSections: [], accessConfirmedAt: new Date().toISOString() },
    { id: 'ww:1', platform: 'webwork', name: 'STAT_V 251 101 2026W1 Introductory Probability and Statistics', url: 'https://webwork.elearning.ubc.ca/webwork2/example', lastSyncedAt: new Date().toISOString(), ignoredSections: [], accessConfirmedAt: new Date().toISOString() },
  ];
  const makeTask = (id, courseId, name, extra) => ({ id, courseId, name, code: name, section: '', url: courses.find(course => course.id === courseId).url,
    creditText: '', score: '', dueAt: null, opensAt: null, deadlineKind: null, doneOverride: null, deadlineOverride: null, ...extra });
  const fixtureState = { version: '1.1.4', courses, syncing: false,
    preferences: { requireManualCompletion: false, onboardingDismissed: true },
    startup: { supported: true, enabled: false, configured: false, error: null },
    wechat: { enabled: false, remindersPaused: false, time: '09:00', hasKey: false, lastSentAt: null, lastError: null, lastTestAt: null,
      leadHours: [24, 3], quietEnabled: false, quietStart: '22:00', quietEnd: '08:00', disabledCourseIds: [], nextSendAt: null,
      history: [{ at: new Date().toISOString(), type: 'test', result: 'accepted', detail: 'Server酱已接受测试消息' }] }, tasks: [
    makeTask('a', 'pl:1', 'LAB04', { section: 'In Class Assignment', dueAt: future(10), score: '100%' }),
    makeTask('b', 'ww:1', 'Assignment-03', { sourceStatus: 'open', dueAt: future(8), score: '40%',
      sourceComplete: false, problemCount: 6, completedProblemCount: 2 }),
    makeTask('c', 'ww:1', 'Assignment-04', { sourceStatus: 'future', opensAt: future(3) }),
    makeTask('d', 'ww:1', 'Assignment-02', { sourceStatus: 'past_due' }),
    makeTask('e', 'pl:1', '复习作业', { code: 'LAB03', score: '75%', doneOverride: true }),
  ] };
  const publicDir = path.join(__dirname, '..', 'public');
  const server = http.createServer((request, response) => {
    if (request.url === '/api/state') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(fixtureState));
      return;
    }
    if (request.url === '/api/update/check' && request.method === 'POST') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ kind: 'available', canInstall: true, currentVersion: '1.1.4',
        release: { version: '1.2.0', name: '1.2.0', notes: '更新说明' } }));
      return;
    }
    if (request.url === '/api/sync-all' && request.method === 'POST') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ results: courses.map(course => ({ courseId: course.id, ok: true, count: 2 })), state: fixtureState }));
      return;
    }
    if (request.url === '/api/startup' && request.method === 'PATCH') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        fixtureState.startup.enabled = JSON.parse(body).enabled;
        fixtureState.startup.configured = fixtureState.startup.enabled;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(fixtureState));
      });
      return;
    }
    if (request.url === '/api/preferences' && request.method === 'PATCH') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        Object.assign(fixtureState.preferences, JSON.parse(body));
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(fixtureState));
      });
      return;
    }
    if (request.url === '/api/course/access-review' && request.method === 'POST') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        const selected = new Set(JSON.parse(body).confirmedIds);
        const pending = fixtureState.courses.filter(course => !course.accessConfirmedAt);
        const removed = new Set(pending.filter(course => !selected.has(course.id)).map(course => course.id));
        const now = new Date().toISOString();
        fixtureState.courses = fixtureState.courses.filter(course => !removed.has(course.id));
        fixtureState.tasks = fixtureState.tasks.filter(task => !removed.has(task.courseId));
        for (const course of fixtureState.courses) if (selected.has(course.id)) course.accessConfirmedAt = now;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: `已确认 ${selected.size} 门课程，移除 ${removed.size} 门未选择课程。`, state: fixtureState }));
      });
      return;
    }
    if (request.url === '/api/reminders' && request.method === 'PATCH') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        const update = JSON.parse(body);
        if (update.courseId) {
          const disabled = new Set(fixtureState.wechat.disabledCourseIds);
          if (update.enabled) disabled.delete(update.courseId); else disabled.add(update.courseId);
          fixtureState.wechat.disabledCourseIds = [...disabled];
        } else Object.assign(fixtureState.wechat, update.paused === undefined ? update : { remindersPaused: update.paused });
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(fixtureState));
      });
      return;
    }
    if (request.url === '/api/task' && request.method === 'PATCH') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        const update = JSON.parse(body);
        const task = fixtureState.tasks.find(item => item.id === update.id);
        task.doneOverride = update.doneOverride;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(fixtureState));
      });
      return;
    }
    if (request.url === '/api/course/category' && request.method === 'PATCH') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        const update = JSON.parse(body);
        const course = fixtureState.courses.find(item => item.id === update.courseId);
        course.ignoredSections = update.ignored ? [update.section] : [];
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(fixtureState));
      });
      return;
    }
    if (request.url === '/api/wechat' && request.method === 'PATCH') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        const update = JSON.parse(body);
        fixtureState.wechat = { ...fixtureState.wechat, time: update.time, enabled: update.enabled, hasKey: Boolean(update.sendKey) };
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(fixtureState));
      });
      return;
    }
    const files = { '/': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'],
      '/task-status.js': ['task-status.js', 'text/javascript'], '/dialogs.js': ['dialogs.js', 'text/javascript'],
      '/ui.js': ['ui.js', 'text/javascript'] };
    const target = files[request.url];
    if (!target) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': target[1] });
    response.end(fs.readFileSync(path.join(publicDir, target[0])));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const pageUrl = `http://127.0.0.1:${server.address().port}/`;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-ui-fixture-'));
  const profile = path.join(temporary, 'profile');
  let child;
  let debugPort;
  try {
    child = spawn(edgePath(), ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--remote-debugging-port=0', '--remote-allow-origins=http://127.0.0.1', `--user-data-dir=${profile}`,
      '--window-size=1440,810', pageUrl], { stdio: 'ignore' });
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 80; i++) {
      if (fs.existsSync(portFile)) { debugPort = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]); break; }
      await sleep(250);
    }
    assert.ok(debugPort, 'Edge debugging port should be ready');
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const target = targets.find(item => item.url.startsWith(pageUrl));
    assert.ok(target, 'app fixture page should be open');
    const evaluate = async expression => (await cdp(target.webSocketDebuggerUrl, 'Runtime.evaluate', { expression, returnByValue: true })).result.value;
    const browserVersion = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
    const windowInfo = await cdp(browserVersion.webSocketDebuggerUrl, 'Browser.getWindowForTarget', { targetId: target.id });
    const viewport = await evaluate('({ width: innerWidth, height: innerHeight })');
    const frameWidth = windowInfo.bounds.width - viewport.width;
    const frameHeight = windowInfo.bounds.height - viewport.height;
    const resizeViewport = async (width, height) => {
      let windowWidth = width + frameWidth;
      let windowHeight = height + frameHeight;
      for (let attempt = 0; attempt < 3; attempt++) {
        await cdp(browserVersion.webSocketDebuggerUrl, 'Browser.setWindowBounds', {
          windowId: windowInfo.windowId, bounds: { width: windowWidth, height: windowHeight },
        });
        for (let i = 0; i < 12; i++) {
          if (await evaluate(`innerWidth === ${width} && innerHeight === ${height}`)) return;
          await sleep(100);
        }
        const actual = await evaluate('({ width: innerWidth, height: innerHeight })');
        windowWidth += width - actual.width;
        windowHeight += height - actual.height;
      }
      const actual = await evaluate('({ width: innerWidth, height: innerHeight })');
      assert.fail(`Browser viewport did not resize to ${width}x${height}; actual ${actual.width}x${actual.height}; initial bounds ${JSON.stringify(windowInfo.bounds)}`);
    };
    for (let i = 0; i < 40; i++) {
      if (await evaluate("document.querySelector('#pending-tab-count')?.textContent === '1'")) break;
      await sleep(250);
    }
    assert.equal(await evaluate("document.querySelector('#pending-tab-count').textContent"), '1');
    for (let i = 0; i < 20; i++) {
      if (await evaluate("document.querySelector('#update-dialog').open")) break;
      await sleep(100);
    }
    assert.equal(await evaluate("document.querySelector('#update-dialog').open"), true);
    assert.equal(await evaluate("document.querySelector('#update-dialog-text').textContent.includes('1.2.0')"), true);
    await evaluate("document.querySelector('#update-later').click()");
    assert.equal(await evaluate("document.querySelector('#update-dialog').open"), false);
    assert.equal(await evaluate("(() => { const first = AppDialog.push({ id: 'queue-one', level: 'warning', title: '课程确认', body: '请检查课程。', required: true, actions: [{ id: 'continue', label: '继续', kind: 'primary' }] }); const duplicate = AppDialog.push({ id: 'queue-one', title: '不应重复' }); AppDialog.push({ id: 'queue-two', title: '第二条通知' }); window.__dialogResult = first; return first === duplicate; })()"), true);
    assert.equal(await evaluate("document.querySelector('#app-dialog').open"), true);
    assert.equal(await evaluate("document.querySelector('#app-dialog').dataset.level"), 'warning');
    assert.equal(await evaluate("document.querySelector('#app-dialog-title').textContent"), '课程确认');
    if (process.env.UI_DIALOG_PREVIEW_PATH) {
      const screenshot = await cdp(target.webSocketDebuggerUrl, 'Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(process.env.UI_DIALOG_PREVIEW_PATH, Buffer.from(screenshot.data, 'base64'));
    }
    await evaluate("document.querySelector('#app-dialog').dispatchEvent(new Event('cancel', { cancelable: true }))");
    assert.equal(await evaluate("document.querySelector('#app-dialog').open"), true);
    await evaluate("document.querySelector('#app-dialog-actions button').click()");
    for (let i = 0; i < 20; i++) {
      if (await evaluate("document.querySelector('#app-dialog-title').textContent === '第二条通知'")) break;
      await sleep(50);
    }
    assert.equal(await evaluate("document.querySelector('#app-dialog-title').textContent"), '第二条通知');
    await evaluate("document.querySelector('#app-dialog').dispatchEvent(new Event('cancel', { cancelable: true }))");
    assert.equal(await evaluate("document.querySelector('#app-dialog').open"), false);
    await evaluate("state.courses[0].accessConfirmedAt = null; render()");
    for (let i = 0; i < 20; i++) {
      if (await evaluate("document.querySelector('#app-dialog-title').textContent === '确认本机课程'")) break;
      await sleep(50);
    }
    assert.equal(await evaluate("document.querySelector('#app-dialog').open"), true);
    assert.equal(await evaluate("document.querySelector('#app-dialog-choices input').checked"), false);
    assert.equal(await evaluate("document.querySelector('.settings-course .course-action').disabled"), true);
    if (process.env.UI_COURSE_REVIEW_PREVIEW_PATH) {
      const screenshot = await cdp(target.webSocketDebuggerUrl, 'Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(process.env.UI_COURSE_REVIEW_PREVIEW_PATH, Buffer.from(screenshot.data, 'base64'));
    }
    await evaluate("document.querySelector('#app-dialog-choices input').click()");
    assert.equal(await evaluate("document.querySelector('#app-dialog-choices input').checked"), true);
    assert.equal(await evaluate("document.querySelectorAll('#app-dialog-actions button')[1].disabled"), false);
    await evaluate("document.querySelectorAll('#app-dialog-actions button')[1].click()");
    for (let i = 0; i < 100; i++) {
      if (!await evaluate("document.querySelector('#app-dialog').open")) break;
      await sleep(50);
    }
    assert.equal(await evaluate("document.querySelector('#app-dialog').open"), false);
    assert.equal(await evaluate("Boolean(state.courses[0].accessConfirmedAt)"), true);
    assert.equal(await evaluate('document.title'), 'UBC作业管理工具 1.1.4');
    assert.equal(await evaluate("document.querySelector('#future-tab-count').textContent"), '1');
    assert.equal(await evaluate("document.querySelector('#history-tab-count').textContent"), '1');
    assert.equal(await evaluate("document.querySelector('#nav-webwork .notification-dot').hidden"), false);
    assert.equal(await evaluate("document.querySelector('#nav-prairielearn .notification-dot').hidden"), true);
    assert.equal(await evaluate("document.querySelector('#overview-pending').textContent"), '2');
    assert.equal(await evaluate("document.querySelector('#pending-badge').textContent.includes('2 项需处理')"), true);
    assert.equal(await evaluate("document.querySelector('#overview-done').textContent"), '2');
    assert.equal(await evaluate("document.querySelector('#toolbar-courses') === null"), true);
    assert.equal(await evaluate("document.querySelector('.window-toolbar').dataset.context"), 'all');
    assert.equal(await evaluate("document.querySelector('#toolbar-scope-mark').getAttribute('aria-label')"), '当前界面：全部作业');
    await evaluate("document.querySelector('#clear-filters').click()");
    assert.equal(await evaluate("document.querySelectorAll('.assignment-row').length"), 5);
    await evaluate("(() => { const input = document.querySelector('#task-search'); input.value = 'STAT_V'; input.dispatchEvent(new Event('input', { bubbles: true })); })()");
    assert.equal(await evaluate("document.querySelectorAll('.assignment-row').length"), 3);
    await evaluate("(() => { const input = document.querySelector('#task-search'); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); const platform = document.querySelector('#filter-platform'); platform.value = 'prairielearn'; platform.dispatchEvent(new Event('change', { bubbles: true })); const course = document.querySelector('#filter-course'); course.value = 'pl:1'; course.dispatchEvent(new Event('change', { bubbles: true })); const status = document.querySelector('#filter-status'); status.value = 'done'; status.dispatchEvent(new Event('change', { bubbles: true })); const date = document.querySelector('#filter-date'); date.value = 'undated'; date.dispatchEvent(new Event('change', { bubbles: true })); input.value = 'LAB03'; input.dispatchEvent(new Event('input', { bubbles: true })); })()");
    assert.equal(await evaluate("document.querySelectorAll('.assignment-row').length"), 1);
    assert.equal(await evaluate("document.querySelector('.assignment-row').textContent.includes('复习作业')"), true);
    assert.equal(await evaluate("document.querySelector('#filter-result').textContent"), '1 项结果');
    await evaluate("(() => { const input = document.querySelector('#task-search'); input.value = '不存在'; input.dispatchEvent(new Event('input', { bubbles: true })); })()");
    assert.equal(await evaluate("document.querySelector('.empty-state h2').textContent"), '没有匹配的作业');
    assert.equal(await evaluate("document.querySelector('.empty-state').textContent.includes('同步失败')"), false);
    await evaluate("document.querySelector('.empty-state button').click()");
    assert.equal(await evaluate("document.querySelectorAll('.assignment-row').length"), 5);
    assert.equal(await evaluate("document.querySelector('#task-search').value"), '');
    assert.equal(await evaluate("document.querySelector('#filter-status').value"), 'all');
    const allToolbarBackground = await evaluate("getComputedStyle(document.querySelector('.window-toolbar')).backgroundImage");
    await evaluate("document.querySelector('#nav-prairielearn').click()");
    assert.equal(await evaluate("document.querySelector('.window-toolbar').dataset.context"), 'prairielearn');
    assert.equal(await evaluate("document.querySelector('.app-rail').dataset.context"), 'prairielearn');
    assert.equal(await evaluate("document.querySelector('#toolbar-scope-mark').textContent.trim()"), 'PL');
    const prairieLearnToolbarBackground = await evaluate("getComputedStyle(document.querySelector('.window-toolbar')).backgroundImage");
    assert.notEqual(prairieLearnToolbarBackground, allToolbarBackground);
    await evaluate("document.querySelector('#nav-all').click()");
    await evaluate("document.querySelector('[data-task-id=\"a\"]').click()");
    assert.equal(await evaluate("document.querySelector('#inspector-content').textContent.includes('完成状态已完成')"), true);
    assert.equal(await evaluate("document.querySelector('#inspector-content').textContent.includes('成绩达到 100%')"), true);
    assert.equal(await evaluate("document.querySelector('#inspector-content').textContent.includes('成绩100%')"), true);
    assert.equal(await evaluate("document.querySelector('.score-bar[aria-label=\"成绩 75%\"]') !== null"), true);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.window-toolbar')).backgroundImage.includes('radial-gradient')"), true);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.content')).backgroundImage === 'none'"), true);
    await resizeViewport(1440, 810);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    if (process.env.UI_PREVIEW_PATH) {
      const screenshot = await cdp(target.webSocketDebuggerUrl, 'Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(process.env.UI_PREVIEW_PATH, Buffer.from(screenshot.data, 'base64'));
    }
    await evaluate("document.querySelector('#nav-webwork').click()");
    assert.equal(await evaluate("document.querySelector('#work-heading').textContent"), 'WeBWorK');
    assert.equal(await evaluate("document.querySelector('.window-toolbar').dataset.context"), 'webwork');
    assert.equal(await evaluate("document.querySelector('.app-rail').dataset.context"), 'webwork');
    assert.equal(await evaluate("document.querySelector('#toolbar-scope-mark').textContent.trim()"), 'W');
    assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.window-toolbar')).backgroundImage"), prairieLearnToolbarBackground);
    assert.equal(await evaluate("document.querySelectorAll('.assignment-row').length"), 1);
    assert.equal(await evaluate("document.querySelector('.assignment-row .status-label').textContent"), '完成中');
    assert.equal(await evaluate("document.querySelector('#inspector-content').textContent.includes('题目完成2 / 6')"), true);
    await evaluate("document.querySelector('#inspector-content .inspector-actions button:last-child').click()");
    assert.equal(await evaluate("document.querySelector('#nav-webwork .notification-dot').hidden"), false);
    assert.equal(await evaluate("[...document.querySelectorAll('#inspector-content .inspector-actions button')].some(button => button.textContent === '恢复网站判断')"), true);
    await evaluate("document.querySelector('[data-tab=history]').click()");
    assert.equal(await evaluate("document.querySelector('.assignment-row').dataset.taskId"), 'd');
    await evaluate("document.querySelector('#inspector-content .inspector-actions button:nth-child(2)').click()");
    for (let i = 0; i < 20; i++) {
      if (await evaluate("document.querySelector('#nav-webwork .notification-dot').hidden")) break;
      await sleep(100);
    }
    assert.equal(await evaluate("document.querySelector('#nav-webwork .notification-dot').hidden"), true);
    assert.equal(await evaluate("document.querySelector('#ww-folder .notification-dot').hidden"), true);
    assert.equal(await evaluate("(() => { const search = document.querySelector('.toolbar-search'); const icon = document.querySelector('.toolbar-search-icon'); const a = search.getBoundingClientRect(); const b = icon.getBoundingClientRect(); return Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) < 1; })()"), true);
    await evaluate("document.querySelector('#task-search').focus()");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#task-search')).boxShadow"), 'none');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#task-search')).outlineStyle"), 'none');
    await evaluate("document.querySelector('#nav-settings').click()");
    assert.equal(await evaluate("document.querySelector('#settings-page').hidden"), false);
    assert.equal(await evaluate("document.querySelector('.window-toolbar').dataset.context"), 'settings');
    assert.equal(await evaluate("document.querySelector('#toolbar-scope-mark').getAttribute('aria-label')"), '当前界面：设置');
    assert.equal(await evaluate("document.querySelector('#settings-heading') === null"), true);
    assert.equal(await evaluate("document.querySelector('#settings-summary') === null"), true);
    assert.equal(await evaluate("parseFloat(getComputedStyle(document.querySelector('#settings-breadcrumb')).fontSize)"), 13);
    assert.equal(await evaluate("document.querySelector('#settings-general .setting-block:first-child h2').textContent"), '应用信息');
    assert.equal(await evaluate("document.querySelectorAll('#settings-general .setting-block:first-child .setting-row').length"), 1);
    assert.equal(await evaluate("document.querySelector('#settings-general .setting-block:first-child').textContent.includes('默认 16:9')"), false);
    assert.equal(await evaluate("document.querySelector('#settings-general .setting-block:first-child').textContent.includes('主界面')"), false);
    assert.equal(await evaluate("document.querySelector('#startup-status').textContent.includes('当前未启用')"), true);
    await evaluate("document.querySelector('#startup-enabled').click()");
    for (let i = 0; i < 20; i++) {
      if (fixtureState.startup.enabled) break;
      await sleep(100);
    }
    assert.equal(fixtureState.startup.enabled, true);
    assert.equal(await evaluate("document.querySelector('#require-manual-completion').checked"), false);
    await evaluate("document.querySelector('#require-manual-completion').click()");
    for (let i = 0; i < 20; i++) {
      if (fixtureState.preferences.requireManualCompletion) break;
      await sleep(100);
    }
    assert.equal(fixtureState.preferences.requireManualCompletion, true);
    await evaluate("document.querySelector('#restart-onboarding').click()");
    for (let i = 0; i < 20; i++) {
      if (await evaluate("document.querySelector('#onboarding-dialog').open")) break;
      await sleep(100);
    }
    assert.equal(await evaluate("document.querySelector('#onboarding-dialog').open"), true);
    assert.equal(await evaluate("document.querySelector('#onboarding-finish-panel').hidden"), false);
    assert.equal(await evaluate("document.querySelector('#onboarding-finish-text').textContent.includes('5 项作业')"), true);
    await evaluate("document.querySelector('#onboarding-complete').click()");
    for (let i = 0; i < 20; i++) {
      if (!await evaluate("document.querySelector('#onboarding-dialog').open")) break;
      await sleep(100);
    }
    assert.equal(fixtureState.preferences.onboardingDismissed, true);
    if (process.env.UI_SETTINGS_PREVIEW_PATH) {
      const screenshot = await cdp(target.webSocketDebuggerUrl, 'Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(process.env.UI_SETTINGS_PREVIEW_PATH, Buffer.from(screenshot.data, 'base64'));
    }
    await evaluate("document.querySelector('[data-settings=reminders]').click()");
    assert.equal(await evaluate("document.querySelector('#settings-reminders').hidden"), false);
    assert.equal(await evaluate("document.querySelector('#reminder-history').textContent.includes('服务已接受')"), true);
    await evaluate("(() => { const leads = document.querySelector('#reminder-leads'); leads.value = '48, 6'; leads.dispatchEvent(new Event('input', { bubbles: true })); const quiet = document.querySelector('#quiet-enabled'); quiet.checked = true; quiet.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('#reminder-form button[type=submit]').click(); })()");
    for (let i = 0; i < 20; i++) {
      if (fixtureState.wechat.quietEnabled) break;
      await sleep(100);
    }
    assert.deepEqual(fixtureState.wechat.leadHours, [48, 6]);
    assert.equal(fixtureState.wechat.quietEnabled, true);
    await evaluate("document.querySelector('#reminders-paused').click()");
    for (let i = 0; i < 20; i++) {
      if (fixtureState.wechat.remindersPaused) break;
      await sleep(100);
    }
    assert.equal(await evaluate("document.querySelector('#footer-reminder').textContent"), '提醒已暂停');
    await evaluate("document.querySelector('#reminders-paused').click()");
    for (let i = 0; i < 20; i++) {
      if (!fixtureState.wechat.remindersPaused) break;
      await sleep(100);
    }
    await evaluate("(() => { const key = document.querySelector('#wechat-key'); key.value = 'SCTabcdefghijklmnop'; key.dispatchEvent(new Event('input', { bubbles: true })); const time = document.querySelector('#wechat-time'); time.value = '10:15'; time.dispatchEvent(new Event('input', { bubbles: true })); const enabled = document.querySelector('#wechat-enabled'); enabled.checked = true; enabled.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('#wechat-form button[type=submit]').click(); })()");
    for (let i = 0; i < 20; i++) {
      if (await evaluate("document.querySelector('#wechat-key-status').textContent.includes('已保存在本机')")) break;
      await sleep(100);
    }
    assert.equal(await evaluate("document.querySelector('#wechat-key').value"), '');
    assert.equal(await evaluate("document.querySelector('#wechat-time').value"), '10:15');
    assert.equal(await evaluate("document.querySelector('#wechat-enabled').checked"), true);
    assert.equal(await evaluate("document.querySelector('#wechat-test').disabled"), false);
    assert.equal(JSON.stringify(fixtureState).includes('SCTabcdefghijklmnop'), false);
    await evaluate("document.querySelector('[data-settings=courses]').click()");
    assert.equal(await evaluate("document.querySelector('#settings-courses').hidden"), false);
    assert.equal(await evaluate("document.querySelectorAll('.settings-course').length"), 2);
    assert.equal(await evaluate("document.querySelector('.settings-course').textContent.includes('需要重新登录')"), true);
    assert.equal(await evaluate("document.querySelector('.settings-course').textContent.includes('保留')"), true);
    assert.equal(await evaluate("document.querySelector('[aria-label=\"CPSC 310 · 2026W1 管理 In Class Assignment\"]') !== null"), true);
    await evaluate("document.querySelector('[aria-label=\"CPSC 310 · 2026W1 管理 In Class Assignment\"]').click()");
    for (let i = 0; i < 20; i++) {
      if (fixtureState.courses[0].ignoredSections.length) break;
      await sleep(100);
    }
    assert.deepEqual(fixtureState.courses[0].ignoredSections, ['In Class Assignment']);
    await evaluate("document.querySelector('#nav-all').click(); document.querySelector('[data-tab=ignored]').click()");
    assert.equal(await evaluate("document.querySelector('.assignment-row').dataset.taskId"), 'a');
    assert.equal(await evaluate("document.querySelector('#all-count').textContent"), '');
    assert.equal(await evaluate("document.querySelector('#nav-prairielearn .notification-dot').hidden"), true);
    await evaluate("document.querySelector('[data-task-id=a] .row-actions button').click()");
    for (let i = 0; i < 20; i++) {
      if (!fixtureState.courses[0].ignoredSections.length) break;
      await sleep(100);
    }
    assert.deepEqual(fixtureState.courses[0].ignoredSections, []);
    await evaluate("document.querySelector('[data-settings=data]').click()");
    assert.equal(await evaluate("document.querySelector('#settings-data').hidden"), false);
    assert.equal(await evaluate("document.querySelector('#settings-data').textContent.includes('查询参数会移除')"), true);
    assert.equal(await evaluate("document.querySelector('#backup-import').disabled"), true);
    await resizeViewport(900, 800);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await resizeViewport(680, 800);
    await evaluate("document.querySelector('#nav-menu').click()");
    assert.equal(await evaluate("document.querySelector('.folder-pane').classList.contains('open')"), true);
    await evaluate("document.querySelector('#nav-all').click()");
    assert.equal(await evaluate("document.querySelector('.assignment-row').dataset.taskId"), 'a');
    assert.equal(await evaluate("document.querySelector('.assignment-row .status-label').textContent"), '待确认');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.row-actions')).display"), 'flex');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    assert.equal(await evaluate("document.querySelector('#work-page').scrollWidth <= document.querySelector('#work-page').clientWidth"), true);
    if (process.env.UI_NARROW_PREVIEW_PATH) {
      await sleep(250);
      const screenshot = await cdp(target.webSocketDebuggerUrl, 'Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(process.env.UI_NARROW_PREVIEW_PATH, Buffer.from(screenshot.data, 'base64'));
    }
  } finally {
    if (debugPort) {
      try {
        const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
        await cdp(version.webSocketDebuggerUrl, 'Browser.close');
      } catch {}
    }
    if (child) { child.kill(); await sleep(400); }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('pl-ui-fixture-')) {
      try { fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }); }
      catch (error) { if (error.code !== 'EPERM') throw error; }
    }
  }
});
