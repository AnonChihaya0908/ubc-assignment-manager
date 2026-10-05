const path = require('node:path');
const os = require('node:os');

function legacyDataDir(appRoot = path.join(__dirname, '..')) {
  return path.join(appRoot, '.local-data');
}

function dataDir(options = {}) {
  const env = options.env || process.env;
  if (env.PRAIRIELEARN_DATA_DIR) return path.resolve(env.PRAIRIELEARN_DATA_DIR);
  const platform = options.platform || process.platform;
  if (platform === 'darwin') {
    const home = options.homeDir || env.HOME || os.homedir();
    return path.posix.join(home, 'Library', 'Application Support', 'UBC作业管理工具', 'data');
  }
  const localAppData = env.LOCALAPPDATA;
  if (localAppData) return path.join(path.resolve(localAppData), 'UBC作业管理工具', 'data');
  return legacyDataDir(options.appRoot);
}

module.exports = { dataDir, legacyDataDir };
