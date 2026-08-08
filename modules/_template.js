const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const MODULE_ID = 'umsatz-analyse';

function getLevel(project) {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  return config.matrix[project]?.[MODULE_ID] || 'off';
}

async function run(project) {
  const level = getLevel(project);
  if (level === 'off') {
    return { project, module: MODULE_ID, level, skipped: true };
  }

  const analyse = { project, module: MODULE_ID, level, findings: [] };

  if (level === 'beobachten') return analyse;
  if (level === 'freigabe') return analyse;
  if (level === 'autonom') return analyse;
}

module.exports = { run, MODULE_ID };
