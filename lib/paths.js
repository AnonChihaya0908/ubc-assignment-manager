const fs = require('node:fs');
const path = require('node:path');

function legacyDataDir(appRoot = path.join(__dirname, '..')) {
  return path.join(appRoot, '.local-data');
}

function dataDir(options = {}) {
  const env = options.env || process.env;
  if (env.PRAIRIELEARN_DATA_DIR) return path.resolve(env.PRAIRIELEARN_DATA_DIR);
  const localAppData = env.LOCALAPPDATA;
  if (localAppData) return path.join(path.resolve(localAppData), 'UBC作业管理工具', 'data');
  return legacyDataDir(options.appRoot);
}

function copyMissing(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyMissing(from, to);
    else if (entry.isFile() && !fs.existsSync(to)) fs.copyFileSync(from, to);
  }
}

function migrateLegacyData(options = {}) {
  const env = options.env || process.env;
  if (env.PRAIRIELEARN_DATA_DIR) return { migrated: false, reason: 'custom' };
  const source = path.resolve(options.legacyDir || legacyDataDir(options.appRoot));
  const destination = path.resolve(options.destination || dataDir({ env, appRoot: options.appRoot }));
  if (source.toLowerCase() === destination.toLowerCase() || !fs.existsSync(source)) return { migrated: false, reason: 'missing' };
  fs.mkdirSync(destination, { recursive: true });
  const marker = path.join(destination, '.migrated-from-portable');
  if (fs.existsSync(marker)) return { migrated: false, reason: 'completed' };
  copyMissing(source, destination);
  fs.writeFileSync(marker, `${source}\n${new Date().toISOString()}\n`, { encoding: 'utf8', mode: 0o600 });
  return { migrated: true, source, destination };
}

module.exports = { dataDir, legacyDataDir, migrateLegacyData };
