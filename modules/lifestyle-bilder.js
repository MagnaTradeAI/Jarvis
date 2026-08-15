const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const MODULE_ID = 'lifestyle-bilder';

const SHOP_ENV = {
  pawvero: { key: 'PAWVERO_WC_KEY', secret: 'PAWVERO_WC_SECRET', url: 'PAWVERO_WC_URL' },
  wabipaper: { key: 'WABIPAPER_WC_KEY', secret: 'WABIPAPER_WC_SECRET', url: 'WABIPAPER_WC_URL' }
};

// Zwei unterschiedliche Lifestyle-Kontexte pro Marke, damit die 2 generierten
// Bilder sich sichtbar unterscheiden (Winkel/Szene), nicht nur zufällig variieren.
const PROMPTS = {
  pawvero: [
    'Professional lifestyle product photography. Show the exact product from the reference image in authentic real-world use with a happy dog. If the reference image already shows a real environment (e.g. a car interior, a room, or outdoors), keep that same environment — do not swap it for an unrelated setting. Only if the reference image is a plain studio shot with no environment, place the product in whichever real-world setting naturally matches its intended use (car safety gear → inside a car, walking gear → outdoors, home comfort items → indoors). Natural editorial pet-brand photography lighting, photorealistic, preserve exact product design, shape and color from the reference image, no added text, no logo changes.',
    'Professional lifestyle product photography. Same instructions as before, but a different camera angle and moment: show the exact product from the reference image in authentic real-world use with a happy dog. If the reference image already shows a real environment, keep that same environment — do not swap it for an unrelated setting. Only if the reference image is a plain studio shot with no environment, place the product in whichever real-world setting naturally matches its intended use. Natural editorial pet-brand photography lighting, photorealistic, preserve exact product design, shape and color from the reference image, no added text, no logo changes.'
  ],
  wabipaper: [
    'Professional interior photography. Show the exact art print from the reference image framed and hanging on a wall in a minimalist Japandi-style living room, soft natural daylight, wide shot, editorial interior-design-magazine style, photorealistic, preserve the exact artwork design from the reference image, no added text.',
    'Professional interior photography. Show the exact art print from the reference image framed above a cozy reading nook or shelf styled with plants and books, soft natural daylight, close-up styled shot, editorial interior-design-magazine style, photorealistic, preserve the exact artwork design from the reference image, no added text.'
  ]
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
  if (!SHOP_ENV[project]) return { project, error: 'Lifestyle-Bilder wird für dieses Projekt nicht unterstützt.' };
  if (getLevel(project) === 'off') return { project, error: 'Lifestyle-Bilder ist für dieses Projekt auf AUS geschaltet.' };

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
    products: all.map((p) => ({ id: p.id, name: p.name, sku: p.sku, bild: p.images?.[0]?.src || null }))
  };
}

function extractUrl(output) {
  if (typeof output === 'string') return output;
  if (output && typeof output.url === 'function') return output.url().href;
  if (output && output.url) return output.url;
  return String(output);
}

async function generateImages(project, productId) {
  if (!SHOP_ENV[project]) return { error: 'Lifestyle-Bilder wird für dieses Projekt nicht unterstützt.' };
  if (getLevel(project) === 'off') return { error: 'Lifestyle-Bilder ist für dieses Projekt auf AUS geschaltet.' };

  const auth = shopAuth(project);
  if (!auth) return { error: 'WooCommerce-Zugangsdaten fehlen' };

  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) return { error: 'REPLICATE_API_TOKEN fehlt' };

  const productRes = await fetch(`${auth.base}/wp-json/wc/v3/products/${productId}`, { headers: auth.headers });
  if (!productRes.ok) return { error: `Produkt nicht gefunden (${productRes.status})` };
  const product = await productRes.json();

  const sourceImage = product.images?.[0]?.src;
  if (!sourceImage) return { error: 'Produkt hat kein Bild, das als Vorlage dienen kann.' };

  let Replicate;
  try {
    Replicate = require('replicate');
  } catch (err) {
    return { error: "Paket 'replicate' fehlt in package.json" };
  }
  const replicate = new Replicate({ auth: apiToken });

  const prompts = PROMPTS[project];
  const bilder = [];

  for (const prompt of prompts) {
    try {
      const output = await replicate.run('google/nano-banana-pro', {
        input: { prompt, image_input: [sourceImage] }
      });
      bilder.push(extractUrl(output));
    } catch (err) {
      return { error: `Replicate-Fehler: ${err.message}` };
    }
  }

  return { productId, produkt: product.name, quellbild: sourceImage, bilder };
}

async function applyImages(project, productId, imageUrls) {
  const level = getLevel(project);
  if (level !== 'freigabe' && level !== 'autonom') {
    return { ok: false, error: 'Lifestyle-Bilder ist für dieses Projekt nicht auf FREIGABE oder AUTONOM geschaltet.' };
  }

  const auth = shopAuth(project);
  if (!auth) return { ok: false, error: 'WooCommerce-Zugangsdaten fehlen' };

  const productRes = await fetch(`${auth.base}/wp-json/wc/v3/products/${productId}`, { headers: auth.headers });
  if (!productRes.ok) return { ok: false, error: `Produkt nicht gefunden (${productRes.status})` };
  const product = await productRes.json();

  const bestehendeBilder = (product.images || []).map((img) => ({ id: img.id }));
  const neueBilder = imageUrls.map((src) => ({ src }));

  const res = await fetch(`${auth.base}/wp-json/wc/v3/products/${productId}`, {
    method: 'PUT',
    headers: { ...auth.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ images: [...bestehendeBilder, ...neueBilder] })
  });

  if (!res.ok) return { ok: false, error: `Speichern fehlgeschlagen (${res.status})` };
  const updated = await res.json();

  return { ok: true, project, produkt: updated.name, hinzugefuegt: imageUrls.length };
}

module.exports = { listProducts, generateImages, applyImages, MODULE_ID };
