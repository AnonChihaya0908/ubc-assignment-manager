const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { edgePath, cdp, withinSyncDeadline, EXTRACT_PAGE, EXTRACT_WEBWORK_PAGE, EXTRACT_WEBWORK_PROGRESS } = require('../lib/browser');
const { parseWebworkText, parseWebworkProgress } = require('../lib/webwork');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function removeFixtureDirectory(directory, prefix) {
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith(prefix)) return;
  for (let attempt = 0; attempt < 10; attempt++) {
    try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }); return; }
    catch (error) {
      if (!['ENOTEMPTY', 'EPERM', 'EBUSY'].includes(error.code)) throw error;
      if (attempt < 9) await sleep(500);
    }
  }
}

const fixture = `<!doctype html><title>PrairieLearn</title>
<nav><a href="/pl/course_instance/231184/assessments">CPSC 310, 2026W1</a></nav>
<table><thead><tr><th>Label</th><th>Title</th><th>Available credit</th><th>Score</th></tr></thead>
<tbody><tr><th colspan="4" data-testid="assessment-group-heading">Lab Assignments</th></tr>
<tr><td><span data-testid="assessment-set-badge">LAB03</span></td><td><a href="/pl/course_instance/231184/assessment_instance/3/">Refactoring and Testability</a></td>
<td>100% until 23:59, Thu, Oct 8</td><td><div class="progress-bar">0%</div></td></tr>
<tr><td><span data-testid="assessment-set-badge">LAB04</span></td><td><a href="/pl/course_instance/231184/assessment_instance/4/">DIP, LSP &amp; Testability</a></td>
<td>100% until 23:59, Thu, Oct 15</td><td>Not started</td></tr></tbody></table>`;

const webworkFixture = `<!doctype html><title>WeBWorK</title><h1>STAT_V 251 101 2026W1 Introductory Probability and Statistics</h1>
<h2>Open Assignments</h2><div><a href="/webwork2/course/Assignment-03">Assignment-03</a><p>Open. Due October 8, 2026, 11:59:00 PM PDT.</p></div>
<h2>Future Assignments</h2><div>Assignment-04<p>Will open on October 6, 2026, 12:00:00 AM PDT.</p></div>
<h2>Past Due Assignments</h2><div><a href="/webwork2/course/Assignment-02">Assignment-02</a><p>Answers available for review.</p></div>`;

const webworkDetailFixture = `<!doctype html><title>Assignment-03</title><table class="problem_set_table">
<thead><tr><th>Name</th><th>Attempts</th><th>Remaining</th><th>Worth</th><th>Status</th></tr></thead>
<tbody><tr><td>Problem 1</td><td>1</td><td>7</td><td>2</td><td>100%</td></tr>
<tr><td>Problem 2</td><td>2</td><td>8</td><td>3</td><td>100%</td></tr></tbody></table>`;

const webworkPastDetailFixture = `<!doctype html><title>Assignment-02</title><table class="problem_set_table">
<thead><tr><th>Name</th><th>Attempts</th><th>Remaining</th><th>Worth</th><th>Status</th></tr></thead>
<tbody><tr><td>Problem 1</td><td>1</td><td>0</td><td>2</td><td>50%</td></tr>
<tr><td>Problem 2</td><td>1</td><td>0</td><td>3</td><td>100%</td></tr></tbody></table>`;

const gradescopeFixture = `<!doctype html><title>Gradescope</title><h1>Example 2026W1</h1>
<table><thead><tr><th>Name</th><th>Status</th><th>Released</th><th>Due (PDT)</th></tr></thead>
<tbody><tr><td><a href="/courses/12345/assignments/1">Homework A</a></td><td>No Submission</td><td>Oct 05 at 1:15PM</td><td>Oct 09 at 11:59PM</td></tr>
<tr><td><a href="/courses/12345/assignments/2">Homework B</a></td><td>45 / 50</td><td>Sep 10 at 3:00PM</td><td>Sep 21 at 11:59PM<br>Late Due Date: Sep 22 at 2:00AM</td></tr></tbody></table>`;

test('browser work is cancelled when the sync deadline expires', async () => {
  const started = Date.now();
  await assert.rejects(() => withinSyncDeadline(signal => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }), 30), /同步等待页面超时/);
  assert.ok(Date.now() - started < 1000, 'deadline should stop waiting promptly');
});

test('dedicated background Edge keeps a headless session for both course sources and closes on exit', { timeout: 45000 }, async () => {
  const httpServer = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(request.url.startsWith('/courses/') ? gradescopeFixture : request.url.includes('Assignment-03') ? webworkDetailFixture :
      request.url.includes('Assignment-02') ? webworkPastDetailFixture : request.url.startsWith('/webwork2/') ? webworkFixture : fixture);
  });
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-background-fixture-'));
  const priorDataDir = process.env.PRAIRIELEARN_DATA_DIR;
  process.env.PRAIRIELEARN_DATA_DIR = temporary;
  delete require.cache[require.resolve('../lib/browser')];
  const browser = require('../lib/browser');
  const base = `http://127.0.0.1:${httpServer.address().port}`;
  try {
    const prairieUrl = `${base}/pl/course_instance/231184/assessments`;
    const webworkUrl = `${base}/webwork2/course`;
    const gradescopeUrl = `${base}/courses/12345`;
    const port = await browser.ensureBrowser(prairieUrl);
    assert.equal(browser.browserMode(), 'background');
    assert.equal(await browser.activePort(), port);
    assert.equal((await browser.readCoursePage(prairieUrl)).rows.length, 2);
    const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
      .find(item => item.url.startsWith(prairieUrl));
    await browser.cdp(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
      expression: 'document.cookie = "ubc_fixture_session=kept; SameSite=Lax"', returnByValue: true,
    });
    const webwork = await browser.readWebworkPage(webworkUrl);
    assert.equal(webwork.rows.find(row => row.name === 'Assignment-03').score, '100%');
    const gradescope = await browser.readGradescopePage(gradescopeUrl);
    assert.equal(gradescope.rows.length, 2);
    assert.equal(gradescope.rows[1].status, '45 / 50');
    assert.equal(gradescope.timeZone, 'PDT');
    assert.equal(await browser.hideBrowser(webworkUrl), port);
    await browser.closeBrowser();
    const restartedPort = await browser.ensureBrowser(prairieUrl);
    await browser.readCoursePage(prairieUrl);
    const restartedTarget = (await (await fetch(`http://127.0.0.1:${restartedPort}/json/list`)).json())
      .find(item => item.url.startsWith(prairieUrl));
    const cookie = await browser.cdp(restartedTarget.webSocketDebuggerUrl, 'Runtime.evaluate', {
      expression: 'document.cookie', returnByValue: true,
    });
    assert.match(cookie.result.value, /ubc_fixture_session=kept/);
  } finally {
    await browser.closeBrowser();
    assert.equal(await browser.activePort(), null);
    if (priorDataDir === undefined) delete process.env.PRAIRIELEARN_DATA_DIR;
    else process.env.PRAIRIELEARN_DATA_DIR = priorDataDir;
    delete require.cache[require.resolve('../lib/browser')];
    httpServer.closeAllConnections();
    await new Promise(resolve => httpServer.close(resolve));
    await removeFixtureDirectory(temporary, 'pl-background-fixture-');
  }
});

test('Edge reads assignment rows from a rendered student-style table', { timeout: 30000 }, async () => {
  const httpServer = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(request.url.includes('Assignment-03') ? webworkDetailFixture :
      request.url.includes('Assignment-02') ? webworkPastDetailFixture : request.url.startsWith('/webwork2/') ? webworkFixture : fixture);
  });
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const pageUrl = `http://127.0.0.1:${httpServer.address().port}/pl/course_instance/231184/assessments`;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-edge-fixture-'));
  const profile = path.join(temporary, 'profile');
  let child;
  let debugPort;
  try {
    child = spawn(edgePath(), ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--remote-debugging-port=0', '--remote-allow-origins=http://127.0.0.1', `--user-data-dir=${profile}`, pageUrl], { stdio: 'ignore' });
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 80; i++) {
      if (fs.existsSync(portFile)) {
        try {
          debugPort = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
          if (debugPort) break;
        } catch (error) {
          if (!['ENOENT', 'EBUSY', 'EPERM'].includes(error.code)) throw error;
        }
      }
      await sleep(250);
    }
    assert.ok(debugPort, 'Edge debugging port should be ready');
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const target = targets.find(item => item.url.startsWith(pageUrl));
    assert.ok(target, 'fixture page should be open');
    await cdp(target.webSocketDebuggerUrl, 'Runtime.enable');
    let result;
    for (let attempt = 0; attempt < 40; attempt++) {
      const evaluation = await cdp(target.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: EXTRACT_PAGE, returnByValue: true });
      result = evaluation.result.value;
      if (result?.rows?.length === 2) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(result.courseTitle, 'CPSC 310, 2026W1');
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].code, 'LAB03');
    assert.equal(result.rows[0].creditText, '100% until 23:59, Thu, Oct 8');
    assert.equal(result.rows[1].score, 'Not started');
    const webworkUrl = `http://127.0.0.1:${httpServer.address().port}/webwork2/course`;
    const opened = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(webworkUrl)}`, { method: 'PUT' });
    const webworkTarget = await opened.json();
    let webwork;
    for (let attempt = 0; attempt < 40; attempt++) {
      const evaluation = await cdp(webworkTarget.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: EXTRACT_WEBWORK_PAGE, returnByValue: true });
      webwork = evaluation.result.value;
      if (webwork?.hasSections && webwork.bodyText.includes('Assignment-03')) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(webwork.hasSections, true);
    const webworkRows = parseWebworkText(webwork.bodyText, webwork.links, webworkUrl);
    assert.deepEqual(webworkRows.map(row => row.section), ['open', 'future', 'past_due']);
    assert.equal(webworkRows[0].dueText, 'October 8, 2026, 11:59:00 PM PDT.');
    assert.equal(webworkRows[1].openText, 'October 6, 2026, 12:00:00 AM PDT.');
    const progressExpression = `(${EXTRACT_WEBWORK_PROGRESS})(${JSON.stringify([webworkRows[0].url, webworkRows[2].url])})`;
    const progressEvaluation = await cdp(webworkTarget.webSocketDebuggerUrl, 'Runtime.evaluate', {
      expression: progressExpression, returnByValue: true, awaitPromise: true,
    });
    const progress = parseWebworkProgress(progressEvaluation.result.value[0].tables);
    assert.equal(progress.score, '100%');
    assert.equal(progress.sourceComplete, true);
    assert.equal(progress.problemCount, 2);
    const pastProgress = parseWebworkProgress(progressEvaluation.result.value[1].tables);
    assert.equal(pastProgress.score, '80%');
    assert.equal(pastProgress.sourceComplete, false);
  } finally {
    if (debugPort) {
      try {
        const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
        await cdp(version.webSocketDebuggerUrl, 'Browser.close');
      } catch {}
    }
    if (child) {
      child.kill();
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    httpServer.closeAllConnections();
    await new Promise(resolve => httpServer.close(resolve));
    // The temporary folder is created directly under the system temp directory above.
    await removeFixtureDirectory(temporary, 'pl-edge-fixture-');
  }
});

test('Chrome can sync a course using its own persistent profile', { timeout: 30000 }, async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(fixture);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-chrome-fixture-'));
  const previous = process.env.PRAIRIELEARN_DATA_DIR;
  process.env.PRAIRIELEARN_DATA_DIR = temporary;
  delete require.cache[require.resolve('../lib/browser')];
  const browser = require('../lib/browser');
  browser.configureBrowser({ preference: () => 'chrome' });
  try {
    const url = `http://127.0.0.1:${server.address().port}/pl/course_instance/231184/assessments`;
    const page = await browser.readCoursePage(url);
    assert.equal(page.rows.length, 2);
    assert.ok(fs.existsSync(path.join(temporary, 'chrome-profile', 'DevToolsActivePort')));
    assert.equal(browser.browserMode(), 'background');
  } finally {
    await browser.closeBrowser();
    if (previous === undefined) delete process.env.PRAIRIELEARN_DATA_DIR;
    else process.env.PRAIRIELEARN_DATA_DIR = previous;
    delete require.cache[require.resolve('../lib/browser')];
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await removeFixtureDirectory(temporary, 'pl-chrome-fixture-');
  }
});
