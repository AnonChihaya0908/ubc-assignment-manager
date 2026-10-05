const fs = require('node:fs');
const path = require('node:path');

function replaceFile(temporary, destination, fileSystem = fs) {
  try {
    fileSystem.renameSync(temporary, destination);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    fileSystem.copyFileSync(temporary, destination);
    fileSystem.unlinkSync(temporary);
  }
}

function writeJsonFile(file, value, fileSystem = fs) {
  fileSystem.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fileSystem.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  try {
    replaceFile(temporary, file, fileSystem);
  } catch (error) {
    try { fileSystem.unlinkSync(temporary); } catch { }
    throw error;
  }
}

module.exports = { replaceFile, writeJsonFile };
