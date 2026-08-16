const fs = require('fs');
const path = require('path');
const activityLog = require('./activity-log');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const MODULE_ID = 'rabatt-automatik';

const LAGERHUETER_STOCK_MIN = 20;
const LAGERHUETER_ORDER_MAX = 1;
const ORDER_LOOKBACK_DAYS = 60;
const DISCOUNT_PERCENT = 15;
const SALE_DURATION_DAYS = 7;

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

async function orderedCounts(base, headers) {
  const min = new Date();
  min.setDate(min.getDate() - ORDER_LOOKBACK_DAYS);
  const after = min.toISOString().slice(0, 10) + 'T00:00:00';
  const orders = await fetchAllPaged(base, headers, `/wp-json/wc/v3/orders?after=${after}&status=completed,processing`);

  const counts = {};
  for (const order of orders) {
    for (const item of order.line_items || []) {
      counts[item.product_id] = (counts[item.product_id] || 0) + (item.quantity || 1);
    }
  }
  return counts;
}

async function findCandidates(project) {
  const auth = shopAuth(project);
  if (!auth) return { project, error: 'WooCommerce-Zugangsdaten fehlen (ENV-Vars prüfen)' };

  try {
    const [products, counts] = await Promise.all([
      fetchAllPaged(auth.base, auth.headers, '/wp-json/wc/v3/products?status=publish'),
      orderedCounts(auth.base, auth.headers)
    ]);

    const kandidaten = products
      .filter((p) => p.manage_stock && typeof p.stock_quantity === 'number' && p.stock_quantity >= LAGERHUETER_STOCK_MIN)
      .filter((p) => (counts[p.id] || 0) <= LAGERHUETER_ORDER_MAX)
      .map((p) => ({
        id: p.id,
        name: p.name,
        bestand: p.stock_quantity,
        verkauftLetzte60Tage: counts[p.id] || 0,
        regulaerpreis: parseFloat(p.regular_price || p.price || 0),
        vorschlagProzent: DISCOUNT_PERCENT,
        bereitsImSale: !!(p.date_on_sale_to && new Date(p.date_on_sale_to) > new Date())
      }));

    return { project, geprueft: products.length, kandidaten };
  } catch (err) {
    return { project, error: err.message };
  }
}

async function run() {
  const config = loadConfig();
  const projects = Object.keys(SHOP_ENV).filter(
    (p) => config.matrix[p]?.[MODULE_ID] && config.matrix[p][MODULE_ID] !== 'off'
  );
  return Promise.all(projects.map(findCandidates));
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

async function applyDiscount(project, productId, percent = DISCOUNT_PERCENT) {
  const level = getLevel(project);
  if (level !== 'freigabe' && level !== 'autonom') {
    return { ok: false, error: 'Rabatt-Automatik ist für dieses Projekt nicht auf FREIGABE oder AUTONOM geschaltet.' };
  }

  const auth = shopAuth(project);
  if (!auth) return { ok: false, error: 'WooCommerce-Zugangsdaten fehlen' };

  const productRes = await fetch(`${auth.base}/wp-json/wc/v3/products/${productId}`, { headers: auth.headers });
  if (!productRes.ok) return { ok: false, error: `Produkt nicht gefunden (${productRes.status})` };
  const product = await productRes.json();

  const regularPrice = parseFloat(product.regular_price || product.price || 0);
  if (!regularPrice) return { ok: false, error: 'Kein regulärer Preis hinterlegt.' };

  const salePrice = Math.round(regularPrice * (1 - percent / 100) * 100) / 100;
  const from = new Date();
  const to = new Date();
  to.setDate(to.getDate() + SALE_DURATION_DAYS);

  const updateRes = await fetch(`${auth.base}/wp-json/wc/v3/products/${productId}`, {
    method: 'PUT',
    headers: { ...auth.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sale_price: String(salePrice),
      date_on_sale_from: from.toISOString(),
      date_on_sale_to: to.toISOString()
    })
  });
  if (!updateRes.ok) return { ok: false, error: `Sale-Preis setzen fehlgeschlagen (${updateRes.status})` };

  const code = `SALE${percent}-${randomSuffix()}`;
  const couponRes = await fetch(`${auth.base}/wp-json/wc/v3/coupons`, {
    method: 'POST',
    headers: { ...auth.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      discount_type: 'percent',
      amount: String(percent),
      product_ids: [productId],
      date_expires: to.toISOString().slice(0, 10)
    })
  });

  let couponCode = null;
  if (couponRes.ok) {
    const coupon = await couponRes.json();
    couponCode = coupon.code;
  }

  activityLog.record({
    project,
    modul: 'rabatt-automatik',
    nachricht: `Rabatt gesetzt: ${product.name} — ${percent}% ${couponCode ? `+ Coupon ${couponCode}` : ''}`.trim(),
    level
  });

  return {
    ok: true,
    project,
    produkt: product.name,
    salePrice,
    couponCode,
    gueltigBis: to.toISOString().slice(0, 10)
  };
}

// Wird periodisch aus server.js aufgerufen — wendet Rabatte nur für Projekte
// an, die auf AUTONOM stehen, und überspringt Produkte, die schon im Sale sind.
async function autoApplyForAutonomProjects() {
  const config = loadConfig();
  const projects = Object.keys(SHOP_ENV).filter((p) => config.matrix[p]?.[MODULE_ID] === 'autonom');

  const applied = [];
  for (const project of projects) {
    const { kandidaten = [] } = await findCandidates(project);
    for (const k of kandidaten) {
      if (k.bereitsImSale) continue;
      applied.push(await applyDiscount(project, k.id, k.vorschlagProzent));
    }
  }
  return applied;
}

module.exports = { run, applyDiscount, autoApplyForAutonomProjects, MODULE_ID };
