const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const VALUE_NAME = 'UBCAssignmentManager';
const PRODUCT_EXE = 'UBC作业管理工具.exe';

function startupCommand(appRoot) {
  return `"${path.join(appRoot, PRODUCT_EXE)}" --background`;
}

function runRegistry(args, runner = spawnSync) {
  return runner('reg.exe', args, { encoding: 'utf8', windowsHide: true, timeout: 5000 });
}

function encodedPowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function readRegisteredCommand(runner = spawnSync) {
  const script = `$ErrorActionPreference='Stop'; $value=(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name '${VALUE_NAME}' -ErrorAction SilentlyContinue).'${VALUE_NAME}'; if ($null -ne $value) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$value)) }`;
  const result = runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedPowerShell(script)], {
    encoding: 'utf8', windowsHide: true, timeout: 5000,
  });
  if (result.status !== 0) throw new Error('registry query failed');
  const encoded = String(result.stdout || '').trim();
  return encoded ? Buffer.from(encoded, 'base64').toString('utf8') : null;
}

function startupStatus(options = {}) {
  const platform = options.platform || process.platform;
  const appRoot = options.appRoot || path.join(__dirname, '..');
  const exists = options.exists || fs.existsSync;
  const reader = options.reader || (() => readRegisteredCommand(options.runner || spawnSync));
  const expectedCommand = startupCommand(appRoot);
  if (platform !== 'win32') return { supported: false, enabled: false, configured: false, error: '开机启动仅支持 Windows。' };
  if (!exists(path.join(appRoot, PRODUCT_EXE))) {
    return { supported: false, enabled: false, configured: false, error: '当前目录缺少 UBC作业管理工具.exe，请先生成或重新解压完整应用。' };
  }
  let actualCommand;
  try { actualCommand = reader(); }
  catch { return { supported: true, enabled: false, configured: false, error: '无法读取 Windows 开机启动状态，请检查账户权限后重试。' }; }
  if (!actualCommand) return { supported: true, enabled: false, configured: false, error: null };
  if (actualCommand.toLowerCase() !== expectedCommand.toLowerCase()) {
    return { supported: true, enabled: false, configured: true, error: '开机启动仍指向旧的应用位置，请重新开启此选项以修复。' };
  }
  return { supported: true, enabled: true, configured: true, error: null };
}

function setStartupEnabled(enabled, options = {}) {
  if (typeof enabled !== 'boolean') throw new Error('开机启动状态无效。');
  const platform = options.platform || process.platform;
  const appRoot = options.appRoot || path.join(__dirname, '..');
  const exists = options.exists || fs.existsSync;
  const runner = options.runner || spawnSync;
  if (platform !== 'win32') throw new Error('开机启动仅支持 Windows。');
  const executable = path.join(appRoot, PRODUCT_EXE);
  if (enabled && !exists(executable)) throw new Error('当前目录缺少 UBC作业管理工具.exe，请先生成或重新解压完整应用。');
  const args = enabled
    ? ['add', RUN_KEY, '/v', VALUE_NAME, '/t', 'REG_SZ', '/d', startupCommand(appRoot), '/f']
    : ['delete', RUN_KEY, '/v', VALUE_NAME, '/f'];
  const result = runRegistry(args, runner);
  if (result.status !== 0 && !(enabled === false && result.status === 1)) {
    throw new Error(`Windows 无法${enabled ? '启用' : '关闭'}开机启动。请检查账户权限后重试。`);
  }
  return startupStatus({ platform, appRoot, exists, runner, reader: options.reader });
}

module.exports = { RUN_KEY, VALUE_NAME, PRODUCT_EXE, startupCommand, startupStatus, setStartupEnabled, readRegisteredCommand };
