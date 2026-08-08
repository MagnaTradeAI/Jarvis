const express = require('express');
const fs = require('fs');
const path = require('path');
const umsatzAnalyse = require('./modules/umsatz-analyse');
const lagerWarnung = require('./modules/lager-warnung');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_PATH = path.join(__dirname, 'config.json');

const VALID_LEVELS = ['off', 'beobachten', 'freigabe', 'autonom'];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Aktuelle Matrix + Projekt-/Funktionslisten abrufen
app.get('/api/config', (req, res) => {
  res.json(loadConfig());
});

// Einzelne Zelle der Matrix ändern: { project, function, level }
app.post('/api/config', (req, res) => {
  const { project, function: fn, level } = req.body || {};

  if (!project || !fn || !VALID_LEVELS.includes(level)) {
    return res.status(400).json({ error: 'Ungültige Anfrage. Erwartet: project, function, level.' });
  }

  const config = loadConfig();

  if (!config.matrix[project] || !(fn in config.matrix[project])) {
    return res.status(404).json({ error: 'Projekt oder Funktion unbekannt.' });
  }

  config.matrix[project][fn] = level;
