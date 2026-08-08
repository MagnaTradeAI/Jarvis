const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const MODULE_ID = 'umsatz-analyse';

const SHOP_ENV = {
  pawvero: { key: 'PAWVERO_WC_KEY', secret: 'PAWVERO_WC_SECRET', url: 'PAWVERO_WC_URL' },
  wabipaper: { key: 'WABIPAPER_WC_KEY', secret: 'WABIPAPER_WC_SECRET', url: 'WABIPAPER_WC_URL' },
  luminara: { key: 'LUMINARA_WC_KEY', secret: 'LUMINARA_WC_SECRET', url: 'LUMINARA_WC_URL' }
};

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function dateRange(days = 30) {
  const max = new Date();
  const min = new Date();
  min.setDate(min.getDate() - days);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { date_min: fmt(min), date_max: fmt(max) };
}

async function fetchSales(project) {
  const env = SHOP_ENV[project];
  const key = process.env[env.key];
  const secret = process.env[env.secret];
  const url = process.env[env.url];

  if (!key || !secret || !url) {
    return { project, error: 'WooCommerce-Zugangsdaten fehlen (ENV-Vars prüfen)' };
  }

  const { date_min, date_max } = dateRange(30);
  const base = url.replace(/\/$/, '');
  const auth = Buffer.from(`${key}:${secret}`).toString('base64');

  let page = 1;
  let allOrders = [];

  while (page <= 10) {
    const endpoint = `${base}/wp-json/wc/v3/orders?after=${date_min}T00:00:00&before=${date_max}T23:59:59&status=completed,processing&per_page=100&page=${page}`;
    let res;
    try {
      res = await fetch(endpoint, { headers: { Authorization: `Basic ${auth}` } });
    } catch (err) {
      return { project, error: `Verbindung fehlgeschlagen: ${err.message}` };
    }
    if (!res.ok) {
      return { project, error: `WooCommerce API Fehler (${res.status})` };
    }
    const orders = await res.json();
    allOrders = allOrders.concat(orders);
    if (orders.length < 100) break;
    page++;
  }

  const umsatz = allOrders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0);
  const bestellungen = allOrders.length;
  const durchschnitt = bestellungen ? umsatz / bestellungen : 0;

  return {
    project,
    zeitraum: { von: date_min, bis: date_max },
    umsatz: Math.round(umsatz * 100) / 100,
    bestellungen,
    durchschnittsbestellwert: Math.round(durchschnitt * 100) / 100
  };
}

async function run() {
  const config = loadConfig();
  const projects = Object.keys(SHOP_ENV).filter(
    (p) => config.matrix[p]?.[MODULE_ID] && config.matrix[p][MODULE_ID] !== 'off'
  );

  return Promise.all(projects.map(fetchSales));
}

module.exports = { run, MODULE_ID };
