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
    { id: 'pl:1', platform: 'prairielearn', name: 'CPSC 310 · 2026W1', url: 'https://us.prairielearn.com/pl/course_instance/1/assessments', lastSyncedAt: new Date().toISOString() },
    { id: 'ww:1', platform: 'webwork', name: 'STAT_V 251 101 2026W1 Introductory Probability and Statistics', url: 'https://webwork.elearning.ubc.ca/webwork2/example', lastSyncedAt: new Date().toISOString() },
  ];
  const makeTask = (id, courseId, name, extra) => ({ id, courseId, name, code: name, section: '', url: courses.find(course => course.id === courseId).url,
    creditText: '', score: '', dueAt: null, opensAt: null, deadlineKind: null, doneOverride: null, deadlineOverride: null, ...extra });
  const fixtureState = { version: '1.1.2', courses, syncing: false, wechat: { enabled: false, time: '09:00', hasKey: false, lastSentAt: null, lastError: null, lastTestAt: null }, tasks: [
    makeTask('a', 'pl:1', 'LAB04', { dueAt: future(10) }),
    makeTask('b', 'ww:1', 'Assignment-03', { sourceStatus: 'open', dueAt: future(8), score: '40%',
      sourceComplete: false, problemCount: 6, completedProblemCount: 2 }),
    makeTask('c', 'ww:1', 'Assignment-04', { sourceStatus: 'future', opensAt: future(3) }),
    makeTask('d', 'ww:1', 'Assignment-02', { sourceStatus: 'past_due' }),
    makeTask('e', 'pl:1', 'LAB03', { score: '75%', doneOverride: true }),
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
      response.end(JSON.stringify({ kind: 'available', canInstall: true, currentVersion: '1.1.2',
        release: { version: '1.2.0', name: '1.2.0', notes: '更新说明' } }));
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
    const files = { '/': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/ui.js': ['ui.js', 'text/javascript'] };
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
      if (await evaluate("document.querySelector('#pending-tab-count')?.textContent === '2'")) break;
      await sleep(250);
    }
    assert.equal(await evaluate("document.querySelector('#pending-tab-count').textContent"), '2');
    for (let i = 0; i < 20; i++) {
      if (await evaluate("document.querySelector('#update-dialog').open")) break;
      await sleep(100);
    }
    assert.equal(await evaluate("document.querySelector('#update-dialog').open"), true);
    assert.equal(await evaluate("document.querySelector('#update-dialog-text').textContent.includes('1.2.0')"), true);
    await evaluate("document.querySelector('#update-later').click()");
    assert.equal(await evaluate("document.querySelector('#update-dialog').open"), false);
    assert.equal(await evaluate('document.title'), 'UBC作业管理工具 1.1.2');
    assert.equal(await evaluate("document.querySelector('#future-tab-count').textContent"), '1');
    assert.equal(await evaluate("document.querySelector('#history-tab-count').textContent"), '1');
    assert.equal(await evaluate("document.querySelector('#nav-webwork .notification-dot').hidden"), false);
    assert.equal(await evaluate("document.querySelector('#nav-prairielearn .notification-dot').hidden"), false);
    assert.equal(await evaluate("document.querySelector('#overview-pending').textContent"), '2');
    assert.equal(await evaluate("document.querySelector('#overview-done').textContent"), '1');
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
    assert.equal(await evaluate("document.querySelectorAll('.assignment-row').length"), 1);
    assert.equal(await evaluate("document.querySelector('.assignment-row .status-label').textContent"), '完成中');
    assert.equal(await evaluate("document.querySelector('#inspector-content').textContent.includes('题目完成2 / 6')"), true);
    await evaluate("document.querySelector('#inspector-content .inspector-actions button:last-child').click()");
    for (let i = 0; i < 20; i++) {
      if (await evaluate("document.querySelector('#nav-webwork .notification-dot').hidden")) break;
      await sleep(100);
    }
    assert.equal(await evaluate("document.querySelector('#nav-webwork .notification-dot').hidden"), true);
    assert.equal(await evaluate("document.querySelector('#ww-folder .notification-dot').hidden"), true);
    await evaluate("document.querySelector('#nav-settings').click()");
    assert.equal(await evaluate("document.querySelector('#settings-page').hidden"), false);
    if (process.env.UI_SETTINGS_PREVIEW_PATH) {
      const screenshot = await cdp(target.webSocketDebuggerUrl, 'Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(process.env.UI_SETTINGS_PREVIEW_PATH, Buffer.from(screenshot.data, 'base64'));
    }
    await evaluate("document.querySelector('[data-settings=reminders]').click()");
    assert.equal(await evaluate("document.querySelector('#settings-reminders').hidden"), false);
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
    await resizeViewport(680, 800);
    await evaluate("document.querySelector('#nav-menu').click()");
    assert.equal(await evaluate("document.querySelector('.folder-pane').classList.contains('open')"), true);
    await evaluate("document.querySelector('#nav-all').click()");
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
