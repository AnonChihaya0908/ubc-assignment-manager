const path = require('node:path');

function dataDir() {
  return process.env.PRAIRIELEARN_DATA_DIR
    ? path.resolve(process.env.PRAIRIELEARN_DATA_DIR)
    : path.join(__dirname, '..', '.local-data');
}

module.exports = { dataDir };
