const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { parseWebworkText, parseWebworkProgress } = require('./webwork');
const { dataDir } = require('./paths');

const SYNC_TIMEOUT_MS = 30_000;

function abortError(signal, fallback = '同步等待页面超时。请确认专用 Edge 已登录并停留在作业列表页。') {
  return signal?.reason instanceof Error ? signal.reason : new Error(fallback);
}

function sleep(ms, signal) {
  if (!signal) return new Promise(resolve => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener('abort', cancelled);
      resolve();
    }
    function cancelled() {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancelled);
      reject(abortError(signal));
    }
    signal.addEventListener('abort', cancelled, { once: true });
  });
}

async function withinSyncDeadline(action, timeoutMs = SYNC_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(
    '同步等待页面超时。请确认专用 Edge 已登录并停留在作业列表页，然后重试。')),
  timeoutMs);
  try {
    return await action(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function boundedSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
const profileDir = path.join(dataDir(), 'edge-profile');

function edgePath(options = {}) {
  const platform = options.platform || process.platform;
  const exists = options.exists || fs.existsSync;
  if (platform === 'darwin') {
    const home = options.homeDir || process.env.HOME || require('node:os').homedir();
    const candidates = [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      path.posix.join(home, 'Applications', 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'),
    ];
    const found = candidates.find(candidate => exists(candidate));
    if (!found) throw new Error('未找到 Microsoft Edge。请先安装 Edge，再在应用中打开课程登录窗口。');
    return found;
  }
  const candidates = [
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  const found = candidates.find(candidate => exists(candidate));
  if (!found) throw new Error('未找到 Microsoft Edge。');
  return found;
}

async function activePort(signal) {
  const file = path.join(profileDir, 'DevToolsActivePort');
  if (!fs.existsSync(file)) return null;
  const port = Number(fs.readFileSync(file, 'utf8').split(/\r?\n/)[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: boundedSignal(signal, 1500) });
    return response.ok ? port : null;
  } catch {
    return null;
  }
}

async function ensureBrowser(courseUrl, signal) {
  let port = await activePort(signal);
  if (port) return port;
  fs.mkdirSync(profileDir, { recursive: true });
  const child = spawn(edgePath(), [
    '--no-first-run', '--no-default-browser-check', '--new-window',
    '--remote-debugging-port=0', '--remote-allow-origins=http://127.0.0.1', `--user-data-dir=${profileDir}`, courseUrl,
  ], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  for (let i = 0; i < 80; i++) {
    await sleep(250, signal);
    port = await activePort(signal);
    if (port) return port;
  }
  throw new Error('Edge 已打开，但无法连接。请关闭该工具专用的 Edge 窗口后重试。');
}

async function targetForUrl(port, courseUrl, signal) {
  const listResponse = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: boundedSignal(signal, 5000) });
  if (!listResponse.ok) throw new Error('无法读取 Edge 页面列表。');
  const targets = await listResponse.json();
  const wanted = new URL(courseUrl);
  let target = targets.find(item => {
    if (item.type !== 'page') return false;
    try {
      const actual = new URL(item.url);
      return actual.origin === wanted.origin && actual.pathname.replace(/\/$/, '') === wanted.pathname.replace(/\/$/, '');
    } catch { return false; }
  });
  if (!target) {
    const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(courseUrl)}`, {
      method: 'PUT', signal: boundedSignal(signal, 5000),
    });
    if (!response.ok) throw new Error('无法打开课程页面。');
    target = await response.json();
    await sleep(2000, signal);
  }
  if (!target.webSocketDebuggerUrl) throw new Error('无法连接课程页面。');
  return target;
}

function maskedFrame(payload, opcode = 1) {
  const data = Buffer.from(payload);
  const mask = crypto.randomBytes(4);
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | data.length]);
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0xfe;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0xff;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  const encoded = Buffer.alloc(data.length);
  for (let index = 0; index < data.length; index++) encoded[index] = data[index] ^ mask[index % 4];
  return Buffer.concat([header, mask, encoded]);
}

function cdp(webSocketUrl, method, params = {}, options = {}) {
  return new Promise((resolve, reject) => {
    let socket;
    let request;
    let settled = false;
    const signal = options.signal;
    const cancelled = () => finish(abortError(signal));
    const timeout = setTimeout(() => {
      finish(new Error('等待 PrairieLearn 页面超时。'));
    }, options.timeoutMs || 15000);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancelled);
      if (socket) socket.destroy();
      if (request && !request.destroyed) request.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    if (signal?.aborted) return finish(abortError(signal));
    signal?.addEventListener('abort', cancelled, { once: true });
    request = http.request(webSocketUrl.replace(/^ws:/, 'http:'), {
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
        'Sec-WebSocket-Version': '13', Origin: 'http://127.0.0.1',
      },
    });
    request.on('upgrade', (_, upgradedSocket, head) => {
      socket = upgradedSocket;
      let buffer = Buffer.alloc(0);
      const read = chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
          const opcode = buffer[0] & 0x0f;
          let length = buffer[1] & 0x7f;
          let offset = 2;
          if (length === 126) {
            if (buffer.length < 4) return;
            length = buffer.readUInt16BE(2);
            offset = 4;
          } else if (length === 127) {
            if (buffer.length < 10) return;
            length = Number(buffer.readBigUInt64BE(2));
            offset = 10;
          }
          const serverMasked = Boolean(buffer[1] & 0x80);
          const maskLength = serverMasked ? 4 : 0;
          if (length > 10_000_000) return finish(new Error('页面响应过大。'));
          if (buffer.length < offset + maskLength + length) return;
          let payload = buffer.subarray(offset + maskLength, offset + maskLength + length);
          if (serverMasked) {
            const mask = buffer.subarray(offset, offset + 4);
            payload = Buffer.from(payload);
            for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];
          }
          buffer = buffer.subarray(offset + maskLength + length);
          if (opcode === 8) return finish(new Error('Edge 已关闭调试连接。'));
          if (opcode === 9) { socket.write(maskedFrame(payload, 10)); continue; }
          if (opcode !== 1) continue;
          let message;
          try { message = JSON.parse(payload.toString('utf8')); } catch { continue; }
          if (message.id !== 1) continue;
          if (message.error) finish(new Error(message.error.message));
          else finish(null, message.result);
          return;
        }
      };
      socket.on('data', read);
      socket.on('error', error => finish(error));
      socket.on('close', () => finish(new Error('Edge 连接中断。')));
      if (head.length) read(head);
      socket.resume();
      socket.write(maskedFrame(JSON.stringify({ id: 1, method, params })));
    });
    request.on('response', response => {
      response.resume();
      finish(new Error(`Edge 拒绝调试连接（${response.statusCode}）。`));
    });
    request.on('error', error => finish(error));
    request.end();
  });
}

const EXTRACT_PAGE = `(() => {
  const text = element => (element?.innerText || element?.textContent || '').replace(/\\s+/g, ' ').trim();
  const table = [...document.querySelectorAll('table')].find(element =>
    /Available credit/i.test(text(element)) && /Score/i.test(text(element)));
  if (!table) return { error: '当前页面没有作业表格。请先在 Edge 中登录 PrairieLearn，并打开课程的 Assessments 页面。', pageUrl: location.href };
  const headerCells = [...(table.querySelector('tr')?.children || [])];
  const creditIndex = headerCells.findIndex(cell => /Available credit/i.test(cell.textContent));
  const scoreIndex = headerCells.findIndex(cell => /Score/i.test(cell.textContent));
  let section = '';
  const rows = [];
  for (const tr of table.querySelectorAll('tr')) {
    const cells = [...tr.children].filter(element => /^(TD|TH)$/.test(element.tagName));
    if (!cells.length) continue;
    const titleCell = cells.find(cell => cell.querySelector('a[href*="/assessment"]'));
    const link = titleCell?.querySelector('a[href]');
    if (!link) {
      if (cells.length === 1 || cells[0].colSpan > 1) {
        const candidate = text(cells[0]);
        if (candidate && !/Assessments|Available credit|Score/i.test(candidate)) section = candidate;
      }
      continue;
    }
    const name = text(link);
    if (!name) continue;
    const url = new URL(link.getAttribute('href'), location.href).href;
    if (!url.startsWith(location.origin + '/pl/course_instance/')) continue;
    const code = text(tr.querySelector('[data-testid="assessment-set-badge"]')) || text(cells[0]).replace(name, '').trim();
    const creditCell = cells[creditIndex >= 0 ? creditIndex : cells.indexOf(titleCell) + 1];
    const hint = [...(creditCell?.querySelectorAll('[title],[data-bs-title],[data-bs-original-title],[aria-label]') || [])]
      .map(element => [element.title, element.getAttribute('data-bs-title'), element.getAttribute('data-bs-original-title'), element.getAttribute('aria-label')].filter(Boolean).join(' ')).join(' ');
    const scoreCell = cells[scoreIndex >= 0 ? scoreIndex : cells.indexOf(titleCell) + 2];
    rows.push({ name, code, section, url, creditText: text(creditCell), creditHint: hint,
      score: text(scoreCell?.querySelector('.progress-bar')) || text(scoreCell) });
  }
  const titleMatch = text(document.body).match(/[A-Z]{2,5}\\s*\\d{3}[^,]*,?\\s*20\\d{2}W[12]/);
  return { pageUrl: location.href, courseTitle: titleMatch ? titleMatch[0] : document.title, rows };
})()`;

const EXTRACT_WEBWORK_PAGE = `(() => {
  const headings = [...document.querySelectorAll('body *')].filter(element =>
    element.children.length === 0 && /^(Open Assignments|Future Assignments|Past Due Assignments)$/i.test((element.textContent || '').trim()));
  const links = {};
  for (const link of document.querySelectorAll('a[href]')) {
    const name = (link.innerText || link.textContent || '').trim();
    if (/^Assignment-[\\w-]+$/i.test(name)) links[name] = link.href;
  }
  return { pageUrl: location.href, courseTitle: document.querySelector('h1')?.innerText?.trim() || document.title,
    hasSections: headings.length > 0, bodyText: document.body?.innerText || '', links };
})()`;

const EXTRACT_WEBWORK_PROGRESS = `(async urls => Promise.all(urls.map(async url => {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const documentCopy = new DOMParser().parseFromString(await response.text(), 'text/html');
  return {
    requestedUrl: url,
    pageUrl: response.url,
    tables: [...documentCopy.querySelectorAll('table')].map(table => ({
      headers: [...table.querySelectorAll('thead th, thead td')].map(cell => (cell.textContent || '').replace(/\\s+/g, ' ').trim()),
      rows: [...table.querySelectorAll('tbody tr')].map(row => [...row.cells].map(cell => (cell.textContent || '').replace(/\\s+/g, ' ').trim())),
    })),
  };
})))`;

function sameCoursePage(pageUrl, courseUrl) {
  try {
    const actual = new URL(pageUrl), wanted = new URL(courseUrl);
    return actual.origin === wanted.origin && actual.pathname.replace(/\/$/, '') === wanted.pathname.replace(/\/$/, '');
  } catch { return false; }
}

async function readCoursePage(courseUrl, timeoutMs = SYNC_TIMEOUT_MS) {
  return withinSyncDeadline(async signal => {
    const port = await ensureBrowser(courseUrl, signal);
    const target = await targetForUrl(port, courseUrl, signal);
    await cdp(target.webSocketDebuggerUrl, 'Page.reload', { ignoreCache: true }, { signal });
    let lastError = '没有读取到页面内容。';
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = await cdp(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
        expression: EXTRACT_PAGE, returnByValue: true, awaitPromise: false,
      }, { signal });
      if (result.exceptionDetails) lastError = '读取页面时发生脚本错误。';
      else {
        const page = result.result?.value;
        if (page?.rows?.length && page.pageUrl.startsWith(courseUrl)) return page;
        if (page?.pageUrl?.startsWith(courseUrl)) {
          lastError = page?.error || '作业页面已打开，但没有识别到作业行；页面结构可能已变化。';
        } else {
          lastError = '专用 Edge 窗口尚未登录，或仍停留在登录跳转页面。';
        }
      }
      await sleep(500, signal);
    }
    throw new Error(lastError);
  }, timeoutMs);
}

async function readWebworkPage(courseUrl, timeoutMs = SYNC_TIMEOUT_MS) {
  return withinSyncDeadline(async signal => {
    const port = await ensureBrowser(courseUrl, signal);
    const target = await targetForUrl(port, courseUrl, signal);
    await cdp(target.webSocketDebuggerUrl, 'Page.reload', { ignoreCache: true }, { signal });
    let lastError = '尚未读取到 WeBWorK 页面。';
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = await cdp(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
        expression: EXTRACT_WEBWORK_PAGE, returnByValue: true,
      }, { signal });
      const page = result.result?.value;
      if (page && sameCoursePage(page.pageUrl, courseUrl) && page.hasSections) {
        const rows = parseWebworkText(page.bodyText, page.links, courseUrl);
        if (rows.length) {
          const progressRows = rows.filter(row => row.section === 'open' || row.section === 'past_due');
          if (progressRows.length) {
            const expression = `(${EXTRACT_WEBWORK_PROGRESS})(${JSON.stringify(progressRows.map(row => row.url))})`;
            const progressResult = await cdp(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
              expression, returnByValue: true, awaitPromise: true,
            }, { signal });
            if (progressResult.exceptionDetails || !Array.isArray(progressResult.result?.value)) {
              throw new Error('无法读取 WeBWorK 作业详情，请确认登录仍然有效。');
            }
            for (const [index, detail] of progressResult.result.value.entries()) {
              if (!sameCoursePage(detail.pageUrl, progressRows[index].url)) {
                throw new Error(`无法读取 ${progressRows[index].name} 的题目完成度，请重新登录 WeBWorK。`);
              }
              Object.assign(progressRows[index], parseWebworkProgress(detail.tables));
            }
          }
          return { pageUrl: page.pageUrl, courseTitle: page.courseTitle, rows };
        }
        lastError = '已打开 WeBWorK，但未识别到作业。请确认课程的作业列表已加载。';
      } else if (page && sameCoursePage(page.pageUrl, courseUrl)) {
        lastError = '已打开 WeBWorK，但未看到作业列表。请先登录并打开课程首页。';
      } else {
        lastError = '专用 Edge 窗口尚未登录 WeBWorK，或仍停留在学校登录页面。';
      }
      await sleep(500, signal);
    }
    throw new Error(lastError);
  }, timeoutMs);
}

async function openCoursePage(courseUrl) {
  const port = await ensureBrowser(courseUrl);
  const target = await targetForUrl(port, courseUrl);
  await cdp(target.webSocketDebuggerUrl, 'Page.bringToFront');
}

module.exports = { edgePath, activePort, ensureBrowser, openCoursePage, readCoursePage, readWebworkPage, cdp,
  withinSyncDeadline, SYNC_TIMEOUT_MS,
  EXTRACT_PAGE, EXTRACT_WEBWORK_PAGE, EXTRACT_WEBWORK_PROGRESS };
