const express = require('express');
const fs = require('fs');
const path = require('path');
const umsatzAnalyse = require('./modules/umsatz-analyse');
const lagerWarnung = require('./modules/lager-warnung');
const rabattAutomatik = require('./modules/rabatt-automatik');
const crossSelling = require('./modules/cross-selling');
const produktbeschreibungen = require('./modules/produktbeschreibungen');

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
  saveConfig(config);

  res.json({ ok: true, project, function: fn, level });
});

app.get('/api/umsatz', async (req, res) => {
  try {
    const results = await umsatzAnalyse.run();
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/lager', async (req, res) => {
  try {
    const results = await lagerWarnung.run();
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rabatt', async (req, res) => {
  try {
    const results = await rabattAutomatik.run();
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rabatt/apply', async (req, res) => {
  const { project, productId, percent } = req.body || {};
  if (!project || !productId) {
    return res.status(400).json({ error: 'Erwartet: project, productId' });
  }
  try {
    const result = await rabattAutomatik.applyDiscount(project, productId, percent);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cross-selling', async (req, res) => {
  try {
    const results = await crossSelling.run();
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cross-selling/apply', async (req, res) => {
  const { project, productId, crossSellIds } = req.body || {};
  if (!project || !productId || !Array.isArray(crossSellIds)) {
    return res.status(400).json({ error: 'Erwartet: project, productId, crossSellIds (Array)' });
  }
  try {
    const result = await crossSelling.applyCrossSell(project, productId, crossSellIds);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/produktbeschreibungen/products', async (req, res) => {
  const project = req.query.project;
  if (!project) return res.status(400).json({ error: 'Erwartet: ?project=' });
  try {
    const result = await produktbeschreibungen.listProducts(project);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/produktbeschreibungen/generate', async (req, res) => {
  const { project, productId, einkaufspreis } = req.body || {};
  if (!project || !productId || typeof einkaufspreis !== 'number') {
    return res.status(400).json({ error: 'Erwartet: project, productId, einkaufspreis (Zahl)' });
  }
  try {
    const result = await produktbeschreibungen.generateContent(project, productId, einkaufspreis);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/produktbeschreibungen/apply', async (req, res) => {
  const { project, ...payload } = req.body || {};
  if (!project || !payload.productId) {
    return res.status(400).json({ error: 'Erwartet: project, productId, ...' });
  }
  try {
    const result = await produktbeschreibungen.applyContent(project, payload);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'online', time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Jarvis läuft auf Port ${PORT}`);
});

// Alle 6 Stunden prüfen, ob für AUTONOM-geschaltete Projekte Rabatte fällig sind
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
setInterval(() => {
  rabattAutomatik.autoApplyForAutonomProjects().catch((err) => {
    console.error('Automatischer Rabatt-Check fehlgeschlagen:', err.message);
  });
  crossSelling.autoApplyForAutonomProjects().catch((err) => {
    console.error('Automatischer Cross-Selling-Check fehlgeschlagen:', err.message);
  });
}, AUTO_CHECK_INTERVAL_MS);
