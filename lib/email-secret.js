const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { dataDir } = require('./paths');

function invoke(action, value = '', options = {}) {
  const platform = options.platform || process.platform;
  let command, args;
  if (platform === 'win32') {
    command = 'powershell.exe';
    args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'email-secret.ps1'), '-Action', action, '-Path', path.join(dataDir(), 'email-secret.dpapi')];
  } else if (platform === 'darwin') {
    command = options.helper || path.join(__dirname, '..', 'runtime', 'email-keychain');
    if (!fs.existsSync(command)) throw new Error('邮件安全存储助手缺失，请安装完整的 macOS 应用。');
    args = [action];
  } else throw new Error('邮件凭据仅支持 Windows 和 macOS。');
  const result = (options.spawnSync || spawnSync)(command, args, {
    input: value, encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 8192,
  });
  if (action === 'read' && result.status === 2) return '';
  if (result.error || result.status !== 0) throw new Error('无法访问本机安全存储，请检查当前账户权限。');
  return result.stdout || '';
}

function saveSecret(value, options) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new Error('请输入有效的应用专用密码。');
  invoke('write', value.replace(/\s+/g, ''), options);
}
function readSecret(options) { return invoke('read', '', options); }
function deleteSecret(options) { invoke('delete', '', options); }

module.exports = { saveSecret, readSecret, deleteSecret };
