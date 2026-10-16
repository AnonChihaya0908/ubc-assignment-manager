const { spawnSync } = require('node:child_process');

const BC_WINDOWS_ZONE = 'British Columbia Standard Time';
const BC_IANA_ZONE = 'America/Vancouver';

function configureSystemTimeZone({ platform = process.platform, env = process.env, run = spawnSync,
  supportsPermanentTime = () => new Date('2026-11-02T16:00:00Z').getHours() === 9 &&
    new Date('2027-01-16T16:00:00Z').getHours() === 9 } = {}) {
  if (platform !== 'win32') return null;
  try {
    const result = run('tzutil.exe', ['/g'], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    if (result.status !== 0 || String(result.stdout || '').trim() !== BC_WINDOWS_ZONE) return null;
    // Windows knows this new zone, while bundled Node/Chromium may not yet map its ID to IANA.
    env.TZ = BC_IANA_ZONE;
    // Older runtimes still roll Vancouver back to UTC-8 in November. Keep future reminders
    // on the Windows UTC-7 schedule even when that runtime's zone database is outdated.
    if (env === process.env && !supportsPermanentTime()) env.TZ = 'Etc/GMT+7';
    return BC_IANA_ZONE;
  } catch {
    return null;
  }
}

module.exports = { configureSystemTimeZone, BC_WINDOWS_ZONE, BC_IANA_ZONE };
