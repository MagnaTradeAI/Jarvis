const fs = require('fs');
const path = require('path');
const activityLog = require('./activity-log');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const MODULE_ID = 'cross-selling';

const ORDER_LOOKBACK_DAYS = 90;
const MIN_COOCCURRENCE = 2;
const MAX_SUGGESTIONS = 3;

const SHOP_ENV = {
  pawvero: { key: 'PAWVERO_WC_KEY', secret: 'PAWVERO_WC_SECRET', url: 'PAWVERO_WC_URL' },
  wabipaper: { key: 'WABIPAPER_WC_KEY', secret: 'WABIPAPER_WC_SECRET', url: 'WABIPAPER_WC_URL' },
  luminara: { key: 'LUMINARA_WC_KEY', secret: 'LUMINARA_WC_SECRET', url: 'LUMINARA_WC_URL' }
};

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function getLevel(project) {
  const config = loadConfig();
  return config.matrix[project]?.[MODULE_ID] || 'off';
}

function shopAuth(project) {
  const env = SHOP_ENV[project];
  const key = process.env[env.key];
  const secret = process.env[env.secret];
  const url = process.env[env.url];
  if (!key || !secret || !url) return null;
  return {
    base: url.replace(/\/$/, ''),
    headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` }
  };
}

async function fetchAllPaged(base, headers, endpointPath) {
  let page = 1;
  let all = [];
  while (page <= 10) {
    const sep = endpointPath.includes('?') ? '&' : '?';
    const res = await fetch(`${base}${endpointPath}${sep}per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`WooCommerce API Fehler (${res.status})`);
    const data = await res.json();
    all = all.concat(data);
    if (data.length < 100) break;
    page++;
  }
  return all;
}

// Zählt, wie oft je zwei Produkte in derselben Bestellung vorkamen
function buildCoOccurrence(orders) {
  const pairCounts = {};
  const names = {};

  for (const order of orders) {
    const items = order.line_items || [];
    for (const item of items) {
      names[item.product_id] = item.name;
    }
    for (let i = 0; i < items.length; i++) {
      for (let j = 0; j < items.length; j++) {
        if (i === j) continue;
        const a = items[i].product_id;
        const b = items[j].product_id;
        pairCounts[a] = pairCounts[a] || {};
        pairCounts[a][b] = (pairCounts[a][b] || 0) + 1;
      }
    }
  }

  return { pairCounts, names };
}

async function findSuggestions(project) {
  const auth = shopAuth(project);
  if (!auth) return { project, error: 'WooCommerce-Zugangsdaten fehlen (ENV-Vars prüfen)' };

  try {
    const min = new Date();
    min.setDate(min.getDate() - ORDER_LOOKBACK_DAYS);
    const after = min.toISOString().slice(0, 10) + 'T00:00:00';

    const orders = await fetchAllPaged(auth.base, auth.headers, `/wp-json/wc/v3/orders?after=${after}&status=completed,processing`);
    const { pairCounts, names } = buildCoOccurrence(orders);

    const vorschlaege = Object.keys(pairCounts).map((productId) => {
      const partners = Object.entries(pairCounts[productId])
        .filter(([, count]) => count >= MIN_COOCCURRENCE)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_SUGGESTIONS)
        .map(([id, count]) => ({ id: Number(id), name: names[id] || `Produkt ${id}`, count }));

      return {
        productId: Number(productId),
        productName: names[productId] || `Produkt ${productId}`,
        partner: partners
      };
    }).filter((v) => v.partner.length > 0);

    return { project, ausgewerteteBestellungen: orders.length, vorschlaege };
  } catch (err) {
    return { project, error: err.message };
  }
}

async function run() {
  const config = loadConfig();
  const projects = Object.keys(SHOP_ENV).filter(
    (p) => config.matrix[p]?.[MODULE_ID] && config.matrix[p][MODULE_ID] !== 'off'
  );
  return Promise.all(projects.map(findSuggestions));
}

// Setzt die Vorschläge als native WooCommerce Cross-Sells auf dem Produkt
async function applyCrossSell(project, productId, crossSellIds) {
  const level = getLevel(project);
  if (level !== 'freigabe' && level !== 'autonom') {
    return { ok: false, error: 'Cross-Selling ist für dieses Projekt nicht auf FREIGABE oder AUTONOM geschaltet.' };
  }

  const auth = shopAuth(project);
  if (!auth) return { ok: false, error: 'WooCommerce-Zugangsdaten fehlen' };

  const res = await fetch(`${auth.base}/wp-json/wc/v3/products/${productId}`, {
    method: 'PUT',
    headers: { ...auth.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cross_sell_ids: crossSellIds })
  });

  if (!res.ok) return { ok: false, error: `Cross-Sells setzen fehlgeschlagen (${res.status})` };
  const product = await res.json();

  activityLog.record({
    project,
    modul: 'cross-selling',
    nachricht: `Cross-Sells gesetzt: ${product.name} (${crossSellIds.length} Produkte verknüpft)`,
    level
  });

  return { ok: true, project, produkt: product.name, crossSellIds };
}

async function autoApplyForAutonomProjects() {
  const config = loadConfig();
  const projects = Object.keys(SHOP_ENV).filter((p) => config.matrix[p]?.[MODULE_ID] === 'autonom');

  const applied = [];
  for (const project of projects) {
    const { vorschlaege = [] } = await findSuggestions(project);
    for (const v of vorschlaege) {
      applied.push(await applyCrossSell(project, v.productId, v.partner.map((p) => p.id)));
    }
  }
  return applied;
}

module.exports = { run, applyCrossSell, autoApplyForAutonomProjects, MODULE_ID };
