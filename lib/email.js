const fs = require('node:fs');
const path = require('node:path');
const tls = require('node:tls');
const readline = require('node:readline');
const { once } = require('node:events');
const { dataDir } = require('./paths');
const { writeJsonFile } = require('./file-store');
const { localDateKey, inQuietHours } = require('./wechat');
const { effectiveDue, needsAttention } = require('./deadlines');
const { courseAccessConfirmed } = require('./store');
const { localeFor } = require('../public/i18n');

const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 465;
const EMAIL_PATTERN = /^[^\s@<>]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function configPath() { return path.join(dataDir(), 'email.json'); }
function emptyConfig() {
  return { enabled: false, from: '', to: '', time: '09:00', scope: 'all', startDate: null,
    lastSentDate: null, lastSentAt: null, attemptDate: null, attemptCount: 0, lastAttemptAt: null,
    lastError: null, lastTestAt: null };
}
function loadConfig(file = configPath()) {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('邮件提醒设置无效。');
    return { ...emptyConfig(), ...saved };
  } catch (error) {
    if (error.code === 'ENOENT') return emptyConfig();
    throw error;
  }
}
function saveConfig(config, file = configPath()) { writeJsonFile(file, config); }
function publicConfig(config, connected, paused = false) {
  return { enabled: Boolean(config.enabled), connected: Boolean(connected), paused: Boolean(paused),
    from: config.from, to: config.to, time: config.time, scope: config.scope,
    lastSentAt: config.lastSentAt, lastError: config.lastError, lastTestAt: config.lastTestAt };
}
function validateAddress(value) {
  const address = String(value || '').trim();
  if (address.length > 254 || !EMAIL_PATTERN.test(address) || /[\r\n]/.test(address)) throw new Error('请输入有效的邮箱地址。');
  return address;
}
function validateConfig(config) {
  const next = { ...config, from: validateAddress(config.from), to: validateAddress(config.to) };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.time)) throw new Error('请输入有效的邮件发送时间。');
  if (!['all', 'week', 'today'].includes(next.scope)) throw new Error('邮件提醒范围无效。');
  return next;
}
function shouldSend(config, now = new Date(), { connected = false, paused = false, quiet = {} } = {}) {
  if (!config.enabled || !connected || paused || config.lastSentDate === localDateKey(now)) return false;
  if (config.startDate && localDateKey(now) < config.startDate) return false;
  if (inQuietHours(quiet, now)) return false;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.time || '')) return false;
  const [hour, minute] = config.time.split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < hour * 60 + minute) return false;
  if (config.attemptDate === localDateKey(now)) {
    if (config.attemptCount >= 3) return false;
    if (config.lastAttemptAt && now.getTime() - Date.parse(config.lastAttemptAt) < 30 * 60_000) return false;
  }
  return true;
}
function safeLink(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !(host === 'webwork.elearning.ubc.ca' || host === 'prairielearn.com' || host.endsWith('.prairielearn.com') || host === 'www.gradescope.ca')) return '';
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}
function buildDigest(state, config, now = new Date()) {
  const locale = localeFor(state.preferences?.language);
  const english = locale === 'en-US';
  const options = { ...(state.preferences || {}), ignoredSectionsByCourse: Object.fromEntries(
    state.courses.map(course => [course.id, course.ignoredSections || []])) };
  const courses = new Map(state.courses.filter(courseAccessConfirmed).map(course => [course.id, course]));
  const tasks = state.tasks.filter(task => courses.has(task.courseId) && needsAttention(task, now.getTime(), options))
    .filter(task => {
      if (config.scope === 'all') return true;
      const due = Date.parse(effectiveDue(task) || '');
      if (!Number.isFinite(due)) return false;
      if (config.scope === 'week') return due >= now.getTime() && due <= now.getTime() + 7 * 86400_000;
      return localDateKey(new Date(due)) === localDateKey(now);
    })
    .sort((left, right) => (Date.parse(effectiveDue(left) || '') || Infinity) - (Date.parse(effectiveDue(right) || '') || Infinity));
  const subject = english ? `UBC Assignment Manager: ${tasks.length} assignments to handle` : `UBC作业管理工具：${tasks.length} 项待办作业`;
  const lines = [english ? `Assignments for ${localDateKey(now)}` : `${localDateKey(now)} 作业提醒`, ''];
  if (!tasks.length) lines.push(english ? 'No assignments match your reminder range.' : '当前提醒范围内没有待办作业。');
  for (const task of tasks) {
    const due = effectiveDue(task);
    const date = due ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(due))
      : (english ? 'No published deadline' : '暂无明确截止时间');
    const title = String(task.code && task.code !== task.name ? `${task.code} ${task.name}` : task.name).replace(/[\r\n\t]+/g, ' ').slice(0, 220);
    lines.push(`${courses.get(task.courseId).name} · ${title}`);
    lines.push(`${english ? 'Due' : '截止'}: ${date}`);
    const link = safeLink(task.url || courses.get(task.courseId).url);
    if (link) lines.push(link);
    lines.push('');
  }
  lines.push(english ? 'Dates reflect the latest course sync. This email was sent by your own Gmail account.' : '日期以最近一次课程同步为准；本邮件由你授权的 Gmail 账户发送。');
  return { subject, text: lines.join('\n'), count: tasks.length };
}

function smtpError(code) {
  if (code === 535 || code === 534) return new Error('邮箱授权失败，请检查 Gmail 应用专用密码或账户限制。');
  if (code === 421 || code === 450 || code === 451 || code === 452) return new Error(`邮箱服务暂时不可用（SMTP ${code}），稍后重试。`);
  return new Error(`邮箱服务器拒绝发送（SMTP ${code || '未知'}）。`);
}
function mimeMessage({ from, to, subject, text }) {
  const encodedSubject = Buffer.from(subject, 'utf8').toString('base64');
  const body = Buffer.from(text, 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
  return [`From: <${from}>`, `To: <${to}>`, `Subject: =?UTF-8?B?${encodedSubject}?=`,
    `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64', '', body].join('\r\n');
}
async function sendSmtp({ from, to, password, subject, text }, connector = tls.connect) {
  from = validateAddress(from);
  to = validateAddress(to);
  if (!from.toLowerCase().endsWith('@gmail.com')) throw new Error('目前仅支持 Gmail 发件账户。');
  if (!password) throw new Error('请先连接 Gmail 发件账户。');
  const socket = connector({ host: SMTP_HOST, port: SMTP_PORT, servername: SMTP_HOST,
    minVersion: 'TLSv1.2', rejectUnauthorized: true });
  socket.setTimeout(15_000, () => socket.destroy(new Error('SMTP_TIMEOUT')));
  socket.on('error', () => {});
  try {
    await once(socket, 'secureConnect');
    const interface_ = readline.createInterface({ input: socket, crlfDelay: Infinity });
    const lines = interface_[Symbol.asyncIterator]();
    async function response(allowed) {
      let code;
      while (true) {
        const item = await lines.next();
        if (item.done) throw new Error('邮件连接中断，请检查网络后重试。');
        const match = /^(\d{3})([ -])/.exec(item.value);
        if (!match) continue;
        code = Number(match[1]);
        if (match[2] === ' ') break;
      }
      if (!allowed.includes(code)) throw smtpError(code);
      return code;
    }
    async function command(line, allowed) { socket.write(`${line}\r\n`); return response(allowed); }
    await response([220]);
    await command('EHLO localhost', [250]);
    const auth = Buffer.from(`\0${from}\0${password}`, 'utf8').toString('base64');
    const authCode = await command(`AUTH PLAIN ${auth}`, [235, 334]);
    if (authCode === 334) await command(auth, [235]);
    await command(`MAIL FROM:<${from}>`, [250]);
    await command(`RCPT TO:<${to}>`, [250, 251]);
    await command('DATA', [354]);
    const message = mimeMessage({ from, to, subject: String(subject).replace(/[\r\n]/g, ' '), text });
    await command(`${message}\r\n.`, [250]);
    await command('QUIT', [221]);
    interface_.close();
    return true;
  } catch (error) {
    if (error?.message === 'SMTP_TIMEOUT' || error?.code === 'ETIMEDOUT') throw new Error('连接 Gmail 超时，请检查网络后重试。');
    if (error?.code === 'ENOTFOUND' || error?.code === 'EAI_AGAIN') throw new Error('无法解析 Gmail 邮件服务器，请检查网络。');
    if (error?.code === 'ECONNREFUSED' || error?.code === 'ENETUNREACH') throw new Error('无法连接 Gmail 邮件服务器，请检查网络。');
    throw error;
  } finally { socket.destroy(); }
}

module.exports = { configPath, emptyConfig, loadConfig, saveConfig, publicConfig, validateAddress,
  validateConfig, shouldSend, safeLink, buildDigest, mimeMessage, sendSmtp };
