const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const MODULE_ID = 'lager-warnung';
const LOW_STOCK_THRESHOLD = 5;

const SHOP_ENV = {
  pawvero: { key: 'PAWVERO_WC_KEY', secret: 'PAWVERO_WC_SECRET', url: 'PAWVERO_WC_URL' },
  wabipaper: { key: 'WABIPAPER_WC_KEY', secret: 'WABIPAPER_WC_SECRET', url: 'WABIPAPER_WC_URL' },
  luminara: { key: 'LUMINARA_WC_KEY', secret: 'LUMINARA_WC_SECRET', url: 'LUMINARA_WC_URL' }
};

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

async function fetchLowStock(project) {
  const env = SHOP_ENV[project];
  const key = process.env[env.key];
  const secret = process.env[env.secret];
  const url = process.env[env.url];

  if (!key || !secret || !url) {
    return { project, error: 'WooCommerce-Zugangsdaten fehlen (ENV-Vars prüfen)' };
  }

  const base = url.replace(/\/$/, '');
  const auth = Buffer.from(`${key}:${secret}`).toString('base64');

  let page = 1;
  let allProducts = [];

  while (page <= 10) {
    const endpoint = `${base}/wp-json/wc/v3/products?per_page=100&page=${page}&status=publish`;
    let res;
    try {
      res = await fetch(endpoint, { headers: { Authorization: `Basic ${auth}` } });
    } catch (err) {
      return { project, error: `Verbindung fehlgeschlagen: ${err.message}` };
    }
    if (!res.ok) {
      return { project, error: `WooCommerce API Fehler (${res.status})` };
    }
    const products = await res.json();
    allProducts = allProducts.concat(products);
    if (products.length < 100) break;
    page++;
  }

  const warnungen = allProducts
    .filter((p) => p.manage_stock && (p.stock_status === 'outofstock' || (typeof p.stock_quantity === 'number' && p.stock_quantity <= LOW_STOCK_THRESHOLD)))
    .map((p) => ({
      name: p.name,
      sku: p.sku || '–',
      bestand: p.stock_quantity,
      status: p.stock_status,
      link: p.permalink
    }));

  return { project, geprueft: allProducts.length, warnungen };
}

async function run() {
  const config = loadConfig();
  const projects = Object.keys(SHOP_ENV).filter(
    (p) => config.matrix[p]?.[MODULE_ID] && config.matrix[p][MODULE_ID] !== 'off'
  );

  return Promise.all(projects.map(fetchLowStock));
}

module.exports = { run, MODULE_ID, LOW_STOCK_THRESHOLD };
