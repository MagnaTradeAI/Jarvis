const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '..', 'activity.json');
const MAX_ENTRIES = 50;

function loadLog() {
  try {
    return JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8'));
  } catch (err) {
    return [];
  }
}

function saveLog(entries) {
  fs.writeFileSync(LOG_PATH, JSON.stringify(entries, null, 2));
}

// level: 'freigabe' (manuell bestätigt) oder 'autonom' (selbstständig gelaufen)
function record({ project, modul, nachricht, level }) {
  const entries = loadLog();
  entries.unshift({
    zeit: new Date().toISOString(),
    project,
    modul,
    nachricht,
    level
  });
  saveLog(entries.slice(0, MAX_ENTRIES));
}

function list(limit = 20) {
  return loadLog().slice(0, limit);
}

module.exports = { record, list };
