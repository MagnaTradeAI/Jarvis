const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const MODULE_ID = 'produktbeschreibungen';

const SHOP_ENV = {
  pawvero: { key: 'PAWVERO_WC_KEY', secret: 'PAWVERO_WC_SECRET', url: 'PAWVERO_WC_URL' }
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
  if (!env) return null;
  const key = process.env[env.key];
  const secret = process.env[env.secret];
  const url = process.env[env.url];
  if (!key || !secret || !url) return null;
  return {
    base: url.replace(/\/$/, ''),
    headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` }
  };
}

async function listProducts(project) {
  if (getLevel(project) === 'off') {
    return { project, error: 'Produktbeschreibungen ist für dieses Projekt auf AUS geschaltet.' };
  }

  const auth = shopAuth(project);
  if (!auth) return { project, error: 'WooCommerce-Zugangsdaten fehlen (ENV-Vars prüfen)' };

  let page = 1;
  let all = [];
  while (page <= 10) {
    const res = await fetch(`${auth.base}/wp-json/wc/v3/products?per_page=100&page=${page}&status=publish`, { headers: auth.headers });
    if (!res.ok) return { project, error: `WooCommerce API Fehler (${res.status})` };
    const products = await res.json();
    all = all.concat(products);
    if (products.length < 100) break;
    page++;
  }

  return {
    project,
    products: all.map((p) => ({ id: p.id, name: p.name, sku: p.sku, preis: p.regular_price }))
  };
}

async function fetchKeywords(query) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return { keywords: [], warnung: 'SERPER_API_KEY fehlt' };

  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, gl: 'de', hl: 'de' })
  });
  if (!res.ok) return { keywords: [], warnung: `Serper API Fehler (${res.status})` };

  const data = await res.json();
  const keywords = [
    ...(data.relatedSearches || []).map((r) => r.query),
    ...(data.peopleAlsoAsk || []).map((p) => p.question)
  ].slice(0, 10);

  return { keywords };
}

function calcPrice(einkaufspreis) {
  const raw = Math.max(einkaufspreis * 3, einkaufspreis + 8);
  const floor = Math.floor(raw);
  return Number(`${floor}.99`);
}

async function generateContent(project, productId, einkaufspreis) {
  if (getLevel(project) === 'off') {
    return { error: 'Produktbeschreibungen ist für dieses Projekt auf AUS geschaltet.' };
  }

  const auth = shopAuth(project);
  if (!auth) return { error: 'WooCommerce-Zugangsdaten fehlen' };

  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) return { error: 'ANTHROPIC_KEY fehlt' };

  const productRes = await fetch(`${auth.base}/wp-json/wc/v3/products/${productId}`, { headers: auth.headers });
  if (!productRes.ok) return { error: `Produkt nicht gefunden (${productRes.status})` };
  const product = await productRes.json();

  const { keywords, warnung } = await fetchKeywords(`${product.name} Hund kaufen`);
  const price = calcPrice(einkaufspreis);

  const prompt = `Du schreibst für Pawvero, einen deutschen Online-Shop für Hundezubehör mit "Fluidcore"-Ästhetik (verspielt, hochwertig, modern). Produktname: "${product.name}". Kategorie: ${(product.categories || []).map((c) => c.name).join(', ') || 'unbekannt'}.
${keywords.length ? `Relevante Suchbegriffe aus echter Google-Recherche: ${keywords.join(', ')}` : ''}

Schreibe:
1. Eine conversion-optimierte Produktbeschreibung auf Deutsch (150-250 Wörter, Vorteile klar herausstellen, aktivierende Sprache, aber nicht reißerisch)
2. 5-8 passende WooCommerce-Schlagwörter (Tags)
3. Einen Yoast SEO Meta-Title (max 60 Zeichen)
4. Eine Yoast Meta-Description (max 155 Zeichen)
5. Ein Yoast Focus-Keyword

Antworte NUR als JSON mit den Feldern: description, tags (Array), metaTitle, metaDescription, focusKeyword. Kein Markdown, kein Text davor oder danach.`;

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!claudeRes.ok) return { error: `Claude API Fehler (${claudeRes.status})` };
  const claudeData = await claudeRes.json();
  const text = claudeData.content?.[0]?.text || '{}';

  let parsed;
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(clean);
  } catch (err) {
    return { error: 'Claude-Antwort konnte nicht als JSON gelesen werden' };
  }

  return {
    productId,
    produkt: product.name,
    einkaufspreis,
    vorschlagPreis: price,
    ...parsed,
    keywordHinweis: warnung || null
  };
}

async function applyContent(project, payload) {
  const level = getLevel(project);
  if (level !== 'freigabe' && level !== 'autonom') {
    return { ok: false, error: 'Produktbeschreibungen ist für dieses Projekt nicht auf FREIGABE oder AUTONOM geschaltet.' };
  }

  const auth = shopAuth(project);
  if (!auth) return { ok: false, error: 'WooCommerce-Zugangsdaten fehlen' };

  const { productId, description, tags, metaTitle, metaDescription, focusKeyword, price } = payload;

  const body = {
    description,
    tags: (tags || []).map((name) => ({ name })),
    meta_data: [
      { key: '_yoast_wpseo_title', value: metaTitle || '' },
      { key: '_yoast_wpseo_metadesc', value: metaDescription || '' },
      { key: '_yoast_wpseo_focuskw', value: focusKeyword || '' }
    ]
  };
  if (price) body.regular_price = String(price);

  const res = await fetch(`${auth.base}/wp-json/wc/v3/products/${productId}`, {
    method: 'PUT',
    headers: { ...auth.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) return { ok: false, error: `Speichern fehlgeschlagen (${res.status})` };
  const product = await res.json();

  return { ok: true, project, produkt: product.name };
}

module.exports = { listProducts, generateContent, applyContent, MODULE_ID };
