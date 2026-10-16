const test = require('node:test');
const assert = require('node:assert/strict');
const clock = require('../public/local-time');
const { configureSystemTimeZone, BC_WINDOWS_ZONE } = require('../lib/system-time-zone');

test('only the new British Columbia Windows zone changes Node local time', () => {
  const env = {};
  const result = configureSystemTimeZone({ platform: 'win32', env,
    run: () => ({ status: 0, stdout: `${BC_WINDOWS_ZONE}\r\n` }) });
  assert.equal(result, 'America/Vancouver');
  assert.equal(env.TZ, 'America/Vancouver');
  const other = { TZ: 'Europe/London' };
  assert.equal(configureSystemTimeZone({ platform: 'win32', env: other,
    run: () => ({ status: 0, stdout: 'Pacific Standard Time\r\n' }) }), null);
  assert.equal(other.TZ, 'Europe/London');
  assert.equal(configureSystemTimeZone({ platform: 'darwin', env }), null);
});

test('an older Node timezone database falls back to the year-round UTC-7 offset', () => {
  const previous = process.env.TZ;
  try {
    const zone = configureSystemTimeZone({ platform: 'win32',
      run: () => ({ status: 0, stdout: BC_WINDOWS_ZONE }), supportsPermanentTime: () => false });
    assert.equal(zone, 'America/Vancouver');
    assert.equal(process.env.TZ, 'Etc/GMT+7');
    assert.equal(new Date('2027-01-16T16:00:00Z').getHours(), 9);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('British Columbia display and manual input stay UTC-7 after November 2026', () => {
  clock.configure('America/Vancouver');
  for (const instant of ['2026-10-16T16:00:00Z', '2026-11-02T16:00:00Z', '2027-01-16T16:00:00Z']) {
    assert.equal(clock.inputValue(instant), instant.slice(0, 10) + 'T09:00');
    assert.equal(clock.parseInput(instant.slice(0, 10) + 'T09:00').toISOString(), instant.replace('Z', '.000Z'));
    assert.match(clock.format('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false }, instant), /09:00/);
  }
  assert.equal(clock.dateKey('2026-11-02T06:30:00Z'), '2026-11-01');
  assert.equal(clock.dateKey('2026-11-02T07:30:00Z'), '2026-11-02');
  assert.equal(clock.offsetMinutes('2026-11-02T16:00:00Z'), -420);
  clock.configure(null);
});

test('historical British Columbia dates retain the old winter offset', () => {
  clock.configure('America/Vancouver');
  assert.equal(clock.inputValue('2026-01-16T17:00:00Z'), '2026-01-16T09:00');
  assert.equal(clock.parseInput('2026-01-16T09:00').toISOString(), '2026-01-16T17:00:00.000Z');
  assert.equal(clock.offsetMinutes('2026-01-16T17:00:00Z'), -480);
  clock.configure(null);
});

test('daily reminders use the native British Columbia 09:00 after November', () => {
  const previous = process.env.TZ;
  try {
    configureSystemTimeZone({ platform: 'win32', env: process.env,
      run: () => ({ status: 0, stdout: BC_WINDOWS_ZONE }) });
    const { localDateKey, shouldSendDaily } = require('../lib/wechat');
    const { shouldSend: shouldSendEmail } = require('../lib/email');
    const config = { enabled: true, remindersPaused: false, sendKey: 'test', time: '09:00' };
    assert.equal(localDateKey(new Date('2026-11-02T16:00:00Z')), '2026-11-02');
    assert.equal(shouldSendDaily(config, new Date('2026-11-02T15:59:00Z')), false);
    assert.equal(shouldSendDaily(config, new Date('2026-11-02T16:00:00Z')), true);
    assert.equal(shouldSendDaily(config, new Date('2027-01-16T16:00:00Z')), true);
    assert.equal(shouldSendEmail({ enabled: true, time: '09:00' },
      new Date('2027-01-16T16:00:00Z'), { connected: true }), true);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
