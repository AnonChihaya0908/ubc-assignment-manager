const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startupCommand, startupStatus, setStartupEnabled, readRegisteredCommand } = require('../lib/windows-startup');

test('Windows startup registration uses the current app path and can be removed', () => {
  const appRoot = 'D:\\Apps\\UBC 作业';
  let registered = null;
  const runner = (_file, args) => {
    if (args[0] === 'add') {
      registered = args[args.indexOf('/d') + 1];
      return { status: 0, stdout: '' };
    }
    if (args[0] === 'delete') {
      registered = null;
      return { status: 0, stdout: '' };
    }
    throw new Error(`unexpected command: ${args.join(' ')}`);
  };
  const options = { platform: 'win32', appRoot, exists: () => true, runner, reader: () => registered };
  assert.equal(startupStatus(options).enabled, false);
  const enabled = setStartupEnabled(true, options);
  assert.equal(enabled.enabled, true);
  assert.equal(registered, startupCommand(appRoot));
  assert.match(registered, /UBC作业管理工具\.exe" --background$/);
  assert.equal(setStartupEnabled(false, options).enabled, false);
});

test('startup status identifies a moved installation and a missing executable', () => {
  const oldCommand = '"C:\\Old\\UBC作业管理工具.exe" --background';
  const reader = () => oldCommand;
  const moved = startupStatus({ platform: 'win32', appRoot: 'D:\\New', exists: () => true, reader });
  assert.equal(moved.enabled, false);
  assert.equal(moved.configured, true);
  assert.match(moved.error, /旧的应用位置/);
  const missing = startupStatus({ platform: 'win32', appRoot: path.join('D:', 'Missing'), exists: () => false, reader });
  assert.equal(missing.supported, false);
  assert.match(missing.error, /缺少/);
});

test('registry reader transports a Unicode command without console encoding loss', () => {
  const command = '"D:\\中文目录\\UBC作业管理工具.exe" --background';
  const runner = () => ({ status: 0, stdout: `${Buffer.from(command, 'utf8').toString('base64')}\r\n` });
  assert.equal(readRegisteredCommand(runner), command);
});
