const fs = require('node:fs');
const path = require('node:path');
const { effectiveDue, isComplete } = require('./deadlines');
const { dataDir } = require('./paths');

function configPath() {
  return path.join(dataDir(), 'wechat.json');
}

function emptyConfig() {
  return {
    enabled: false,
    time: '09:00',
    startDate: null,
    sendKey: '',
    lastSentDate: null,
    lastSentAt: null,
    attemptDate: null,
    attemptCount: 0,
    lastAttemptAt: null,
    lastError: null,
    lastTestAt: null,
  };
}

function loadConfig(file = configPath()) {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('微信提醒设置无效。');
    return { ...emptyConfig(), ...saved };
  } catch (error) {
    if (error.code === 'ENOENT') return emptyConfig();
    throw error;
  }
}

function saveConfig(config, file = configPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

function publicConfig(config) {
  return {
    enabled: Boolean(config.enabled),
    time: config.time,
    startDate: config.startDate,
    hasKey: Boolean(config.sendKey),
    lastSentAt: config.lastSentAt,
    lastError: config.lastError,
    lastTestAt: config.lastTestAt,
  };
}

function validateSendKey(value) {
  const key = String(value || '').trim();
  if (!/^SCT[A-Za-z0-9_-]{8,253}$/.test(key)) {
    throw new Error('请输入 Server酱 Turbo 的 SCT SendKey。');
  }
  return key;
}

function localDateKey(now = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function shouldSendDaily(config, now = new Date()) {
  if (!config.enabled || !config.sendKey || config.lastSentDate === localDateKey(now)) return false;
  if (config.startDate && localDateKey(now) < config.startDate) return false;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.time || '')) return false;
  const [hour, minute] = config.time.split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < hour * 60 + minute) return false;
  if (config.attemptDate === localDateKey(now)) {
    if (config.attemptCount >= 3) return false;
    if (config.lastAttemptAt && now.getTime() - new Date(config.lastAttemptAt).getTime() < 30 * 60_000) return false;
  }
  return true;
}

function cleanLine(value) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function localTime(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function buildDailyDigest(state, now = new Date()) {
  const pending = state.tasks.filter(task => {
    if (isComplete(task)) return false;
    if ((task.sourceStatus === 'future' || task.sourceStatus === 'past_due') && !task.deadlineOverride) return false;
    return true;
  });
  pending.sort((a, b) => {
    const first = effectiveDue(a), second = effectiveDue(b);
    if (first && second) return new Date(first) - new Date(second);
    if (first) return -1;
    if (second) return 1;
    return a.name.localeCompare(b.name);
  });
  const title = pending.length ? `UBC作业管理工具：${pending.length} 项未完成` : 'UBC作业管理工具：今日无待完成';
  const lines = [`${localTime(now).split(' ')[0]} 作业清单`, ''];
  if (!pending.length) lines.push('目前没有已开放且未完成的作业。');
  for (const task of pending.slice(0, 20)) {
    const course = state.courses.find(item => item.id === task.courseId);
    const due = effectiveDue(task);
    let dateText = '暂无明确截止时间';
    if (due) {
      const prefix = task.deadlineKind === 'credit_window' && !task.deadlineOverride ? '得分阶段结束' :
        new Date(due) < now ? '已过页面日期' : '截止';
      dateText = `${prefix} ${localTime(due)}`;
    }
    lines.push(`- ${cleanLine(course?.name || '课程')} · ${cleanLine(task.code && task.code !== task.name ? `${task.code} ${task.name}` : task.name)}：${dateText}`);
  }
  if (pending.length > 20) lines.push(`- 其余 ${pending.length - 20} 项请在电脑应用中查看。`);
  lines.push('', '日期以最近一次课程同步结果为准。');
  return { title, desp: lines.join('\n'), count: pending.length };
}

function connectionError(error) {
  const code = error?.cause?.code || error?.code;
  if (code === 'EACCES' || code === 'EPERM') {
    return new Error('无法连接 Server酱：当前应用的网络访问被系统或运行环境拒绝。请检查防火墙或从桌面重新启动应用。');
  }
  if (error?.name === 'TimeoutError' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return new Error('连接 Server酱超时，请检查网络后重试。');
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new Error('无法解析 Server酱域名，请检查 DNS 或网络连接。');
  }
  return new Error('无法连接 Server酱，请检查网络后重试。');
}

async function sendServerChan(sendKey, title, desp, fetchImpl = fetch) {
  const key = validateSendKey(sendKey);
  const payload = new URLSearchParams({ title, desp });
  let response;
  try {
    response = await fetchImpl(`https://sctapi.ftqq.com/${key}.send`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: payload,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw connectionError(error);
  }
  if (!response.ok) throw new Error(`Server酱请求失败（HTTP ${response.status}）。`);
  let result;
  try { result = await response.json(); }
  catch { throw new Error('Server酱返回了无法识别的结果。'); }
  if (Number(result.code) !== 0) throw new Error(`Server酱未接受消息（代码 ${String(result.code ?? '未知').replace(/[^\w-]/g, '').slice(0, 20)}）。`);
  return true;
}

module.exports = {
  configPath, emptyConfig, loadConfig, saveConfig, publicConfig, validateSendKey,
  localDateKey, shouldSendDaily, buildDailyDigest, sendServerChan,
};
