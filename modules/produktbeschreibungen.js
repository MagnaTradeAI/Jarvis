const fs = require('fs');
const path = require('path');
const activityLog = require('./activity-log');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const MODULE_ID = 'produktbeschreibungen';

const SHOP_ENV = {
  pawvero: { key: 'PAWVERO_WC_KEY', secret: 'PAWVERO_WC_SECRET', url: 'PAWVERO_WC_URL' },
  wabipaper: { key: 'WABIPAPER_WC_KEY', secret: 'WABIPAPER_WC_SECRET', url: 'WABIPAPER_WC_URL' },
  luminara: { key: 'LUMINARA_WC_KEY', secret: 'LUMINARA_WC_SECRET', url: 'LUMINARA_WC_URL' }
};

// Externe Content-Writer-Agenten der bestehenden AI-Command-Center-Apps.
// System-Prompts 1:1 aus den jeweiligen Apps übernommen, damit Ton/Lore erhalten bleibt.
const STUDIOS = {
  wabipaper: {
    endpoint: 'https://wabipaper-ai-production.up.railway.app/api/chat',
    buildBody: (system, userText) => ({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: userText }]
    }),
    system: `Du bist der Content Writer von Wabipaper. Du schreibst deutsche Produktbeschreibungen und Marketingtexte für Wabipaper-Kunstdrucke.

Wabipaper Naming-Schema: "Wabipaper + englisches Kompositum + Produkttyp"
Beispiele: "Wabipaper Moonbloom Poster", "Wabipaper Fuji Dreams Canvas", "Wabipaper Urban Drift Print", "Wabipaper Crimson Ryū Canvas"

Wabipaper Brand Voice:
- Ruhig, poetisch, ästhetisch bewusst
- Wabi-Sabi-Philosophie: Schönheit im Unvollkommenen, Vergänglichkeit, Natürlichkeit
- Nicht übertrieben werblich, sondern inspirierende Sprache
- Zielgruppe: Kunst-affin, Interior-Design-bewusst, 25–45 Jahre, DACH

Kollektionen (5 Stück):
- Botanica: botanisch-poetisch, naturnah, zeitlos — Herbarium, Aquarell, Naturtöne
- Risograph: nostalgisch-modern, grafisch, urban-kreativ — Duotone, Grain, Flat Design
- Ukiyo-e: meditativer japanischer Einfluss, ruhig-kraftvoll — Holzschnitt-Moderne, Wellen, Berge, Blüten
- StreetArt: urban, mutig, zeitgeistig — Graffiti, Schablonen, Stadtmotive
- Ryū (龍): Drachen als Ausdruck von Wabi-Sabi — roh, kraftvoll, imperfekt, unvergesslich. Stile: Sumi-e Tusche, Risograph Duotone, Mondnacht Indigo/Gold, Abstrakte Kraft, Botanischer Ryū (Drache + Kirschblüten). Farbwelt: Gold, Bernstein, Rot, Tusche-Schwarz.

PAWVERO-KONTEXT: Pawvero ist eine deutsche Pet-Accessoires-Marke (pawvero.de). Wenn Pawvero-Beschreibungen angefragt werden, passe Brand Voice und Produktbeschreibung für Tierbesitzer an. Hund oder Katze als emotionalen Anker verwenden. Gleiche Wabi-Sabi-Qualität, aber mit Bezug zur Mensch-Tier-Verbindung.

Wenn du ein Bild analysierst: NUR wenn explizit ein Drache (龍) als Motiv erkennbar ist → Ryū Collection. Feuer, abstrakte Dynamik, Tusche-Explosionen oder dunkle Töne alleine sind KEIN Ryū-Indikator. Abstrakte, dynamische Kompositionen ohne klar erkennbares Motiv → Custom / Wabi-Sabi Kollektion.

WICHTIG FÜR WOOCOMMERCE-BESCHREIBUNGEN:
Wenn du eine Produktbeschreibung für WooCommerce schreibst, MUSST du folgende konkrete Informationen explizit nennen — diese werden von n8n für Social Media Posts verwendet:
1. MOTIV: Was ist konkret abgebildet? (z.B. "Bernsteinfarbene Farbexplosion mit dunklen Kontrastzonen", nicht abstrakt)
2. FARBWELT: Exakte Farben nennen (z.B. "Amber, Dunkelbraun, Cremeweiß")
3. STIL: Kollektion und Technik (z.B. "Ukiyo-e, flache Farbflächen, Holzschnitt-Ästhetik")
4. STIMMUNG: Emotionaler Kern in einem Satz
5. FORMAT: Poster oder Canvas, verfügbare Größen

Produktbeschreibungsstruktur:
1. Poetischer Opener (1-2 Sätze, Wabi-Sabi Ton)
2. Motiv & Farbwelt konkret beschreiben (PFLICHT: Farben, Formen, Elemente explizit nennen)
3. Stil & Kollektion
4. Technische Details (Druckqualität, Papier, Größen)
5. CTA

WooCommerce-taugliches HTML wenn gewünscht. Antworte auf Deutsch.`
  },
  luminara: {
    endpoint: 'https://magnatradeai-luminara-studio-production.up.railway.app/api/agent',
    buildBody: (system, userText) => ({
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }]
    }),
    system: `Du bist der POD Manager des Luminara Syndicate — Spezialist für Print-on-Demand Produktmanagement.
Du denkst in Conversion, Fulfillment und Produktstrategie.
Expertise: Produkttexte für WooCommerce/Gelato, Varianten-Setups (Größen, Farben), Preisstrategien für premium Techwear, Shop-Optimierung.
Wenn du ein Produktbild siehst: Erstelle sofort einen vollständigen Produkttext im Syndicate-Stil (Titel, Kurzbeschreibung, Langbeschreibung, Bullet Points, SEO-Title, Meta-Description).
Preisrahmen: Tees €49, Hoodies €79, Caps €39, Tote Bags €34, Phone Cases €29, Poster A3 €39/A2 €59/A1 €89, Canvas €79–179.
Antworte auf Deutsch, Syndicate-Ton, WooCommerce-ready.`
  }
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
  if (!SHOP_ENV[project]) {
    return { project, error: 'Produktbeschreibungen wird für dieses Projekt nicht unterstützt.' };
  }
  if (getLevel(project) === 'off') {
    return { project, error: 'Produktbeschreibungen ist für dieses Projekt auf AUS geschaltet.' };
  }

  const auth = shopAuth(project);
  if (!auth) return { project, error: 'WooCommerce-Zugangsdaten fehlen (ENV-Vars prüfen)' };

  let page = 1;
  let all = [];
  while (page <= 10) {
    const res = await fetch(`${auth.base}/wp-json/wc/v3/products?per_page=100&page=${page}&status=draft`, { headers: auth.headers });
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

function calcPawveroPrice(einkaufspreis) {
  const raw = Math.max(einkaufspreis * 3, einkaufspreis + 8);
  const floor = Math.floor(raw);
  return Number(`${floor}.99`);
}

function parseClaudeJson(text) {
  const clean = (text || '{}').replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

async function generatePawvero(productId, einkaufspreis, auth) {
  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) return { error: 'ANTHROPIC_KEY fehlt' };

  const productRes = await fetch(`${auth.base}/wp-json/wc/v3/products/${productId}`, { headers: auth.headers });
  if (!productRes.ok) return { error: `Produkt nicht gefunden (${productRes.status})` };
  const product = await productRes.json();

  const { keywords, warnung } = await fetchKeywords(`${product.name} Hund kaufen`);
  const price = calcPawveroPrice(einkaufspreis);
  const category = product.categories?.[0];

  const prompt = `Du schreibst für Pawvero, einen deutschen Online-Shop für Hundezubehör mit "Fluidcore"-Ästhetik (verspielt, hochwertig, modern). Produktname: "${product.name}". Kategorie: ${(product.categories || []).map((c) => c.name).join(', ') || 'unbekannt'}.
${keywords.length ? `Relevante Suchbegriffe aus echter Google-Recherche: ${keywords.join(', ')}` : ''}

Wähle zuerst ein Focus-Keyword (2-3 Wörter, an der Suchintention orientiert, idealerweise aus den Suchbegriffen oben).

Schreibe dann für gute Yoast-SEO-Bewertung — ALLE Punkte sind Pflicht:
1. Produktbeschreibung auf Deutsch, MINDESTENS 300 Wörter, conversion-optimiert. Das Focus-Keyword muss im ERSTEN Satz vorkommen und insgesamt mindestens 3x natürlich im Text erscheinen (nicht künstlich wiederholt).
2. 5-8 passende WooCommerce-Schlagwörter (Tags)
3. SEO Meta-Title (max 60 Zeichen), der mit dem Focus-Keyword BEGINNT
4. Meta-Description (max 155 Zeichen), die das Focus-Keyword enthält
5. Das Focus-Keyword selbst als eigenes Feld
6. Einen URL-Slug (nur Kleinbuchstaben, Bindestriche, keine Sonderzeichen), der das Focus-Keyword enthält

Antworte NUR als JSON mit den Feldern: description, tags (Array), metaTitle, metaDescription, focusKeyword, slug. Kein Markdown, kein Text davor oder danach.`;

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
  });

  if (!claudeRes.ok) return { error: `Claude API Fehler (${claudeRes.status})` };
  const claudeData = await claudeRes.json();
  const text = claudeData.content?.[0]?.text || '{}';

  let parsed;
  try {
    parsed = parseClaudeJson(text);
  } catch (err) {
    return { error: 'Claude-Antwort konnte nicht als JSON gelesen werden' };
  }

  // Interne + ausgehende Links werden von uns gesetzt (echte URLs), nicht von Claude erfunden
  const linkParts = [];
  if (category) {
    linkParts.push(`Mehr aus dieser Kategorie findest du in unserer <a href="${auth.base}/produkt-kategorie/${category.slug}/">${category.name}-Kollektion</a>.`);
  }
  linkParts.push('Grundlegende Infos rund um Hunde und ihre Bedürfnisse gibt\'s z. B. bei <a href="https://de.wikipedia.org/wiki/Hund" target="_blank" rel="noopener">Wikipedia</a>.');
  const description = `${parsed.description}\n<p>${linkParts.join(' ')}</p>`;

  return { productId, produkt: product.name, einkaufspreis, vorschlagPreis: price, ...parsed, description, keywordHinweis: warnung || null };
}

async function generateViaStudio(project, productId, auth) {
  const studio = STUDIOS[project];
  const productRes = await fetch(`${auth.base}/wp-json/wc/v3/products/${productId}`, { headers: auth.headers });
  if (!productRes.ok) return { error: `Produkt nicht gefunden (${productRes.status})` };
  const product = await productRes.json();

  const userText = project === 'luminara'
    ? `Erstelle einen vollständigen Produkttext für folgendes Syndicate-Produkt: "${product.name}". Antworte NUR als JSON mit den Feldern: description (HTML-tauglich, inkl. Bullet Points als <ul><li>), tags (Array, 5-8 WooCommerce-Schlagwörter), metaTitle (max 60 Zeichen), metaDescription (max 155 Zeichen), focusKeyword. Falls sich aus dem Produktnamen ein passender Preis nach deinem bekannten Preisrahmen ableiten lässt, ergänze zusätzlich price (nur Zahl, ohne Symbol) — sonst lass das Feld weg. Kein Markdown, kein Text davor oder danach.`
    : `Erstelle eine vollständige Produktbeschreibung für folgendes Produkt: "${product.name}". Antworte NUR als JSON mit den Feldern: description (HTML-tauglich), tags (Array, 5-8 WooCommerce-Schlagwörter), metaTitle (max 60 Zeichen), metaDescription (max 155 Zeichen), focusKeyword. Falls sich aus dem Produktnamen ein passender Verkaufspreis anhand von Format/Größe ableiten lässt, ergänze zusätzlich price (nur Zahl, ohne Symbol) — sonst lass das Feld weg. Kein Markdown, kein Text davor oder danach.`;

  const body = studio.buildBody(studio.system, userText);

  const res = await fetch(studio.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) return { error: `Studio-API Fehler (${res.status})` };
  const data = await res.json();
  const text = data.content?.find((b) => b.type === 'text')?.text || data.content?.[0]?.text || '';

  let parsed;
  try {
    parsed = parseClaudeJson(text);
  } catch (err) {
    return { error: 'Studio-Antwort konnte nicht als JSON gelesen werden' };
  }

  return { productId, produkt: product.name, vorschlagPreis: parsed.price ? Number(parsed.price) : null, ...parsed };
}

async function generateContent(project, productId, einkaufspreis) {
  if (!SHOP_ENV[project]) return { error: 'Produktbeschreibungen wird für dieses Projekt nicht unterstützt.' };
  if (getLevel(project) === 'off') return { error: 'Produktbeschreibungen ist für dieses Projekt auf AUS geschaltet.' };

  const auth = shopAuth(project);
  if (!auth) return { error: 'WooCommerce-Zugangsdaten fehlen' };

  if (project === 'pawvero') {
    return generatePawvero(productId, einkaufspreis, auth);
  }
  return generateViaStudio(project, productId, auth);
}

async function applyContent(project, payload) {
  const level = getLevel(project);
  if (level !== 'freigabe' && level !== 'autonom') {
    return { ok: false, error: 'Produktbeschreibungen ist für dieses Projekt nicht auf FREIGABE oder AUTONOM geschaltet.' };
  }

  const auth = shopAuth(project);
  if (!auth) return { ok: false, error: 'WooCommerce-Zugangsdaten fehlen' };

  const { productId, description, tags, metaTitle, metaDescription, focusKeyword, price, slug } = payload;

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
  if (slug) body.slug = slug;

  const res = await fetch(`${auth.base}/wp-json/wc/v3/products/${productId}`, {
    method: 'PUT',
    headers: { ...auth.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) return { ok: false, error: `Speichern fehlgeschlagen (${res.status})` };
  const product = await res.json();

  activityLog.record({
    project,
    modul: 'produktbeschreibungen',
    nachricht: `Produktbeschreibung übernommen: ${product.name}${price ? ` — Preis ${price} €` : ''}`,
    level
  });

  return { ok: true, project, produkt: product.name };
}

module.exports = { listProducts, generateContent, applyContent, MODULE_ID };
