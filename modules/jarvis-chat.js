const fs = require('fs');
const path = require('path');

const umsatzAnalyse = require('./umsatz-analyse');
const lagerWarnung = require('./lager-warnung');
const rabattAutomatik = require('./rabatt-automatik');
const crossSelling = require('./cross-selling');
const produktbeschreibungen = require('./produktbeschreibungen');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const VALID_LEVELS = ['off', 'beobachten', 'freigabe', 'autonom'];
const MAX_TOOL_ROUNDS = 5;

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

const SYSTEM_PROMPT = `Du bist Jarvis, das zentrale KI-System von MagnaTrade-AI. Du steuerst die Shops Pawvero, Wabipaper und Luminara Syndicate sowie die Agentur-Seite MagnaTrade-AI über deine Tools.

Verfügbare Funktionen pro Projekt (Steuermatrix): umsatz-analyse, lager-warnung, rabatt-automatik, cross-selling, produktbeschreibungen. Jede Funktion hat eine Freigabestufe: off (aus), beobachten (nur anzeigen), freigabe (Vorschlag, Anwenden nötig), autonom (läuft selbstständig). Schreibende Aktionen (Rabatt anwenden, Cross-Sell setzen, Produktbeschreibung übernehmen) funktionieren nur wenn die jeweilige Funktion für das Projekt auf freigabe oder autonom steht — sonst lehnt das Tool ab, das ist Absicht, nicht dein Fehler.

Antworte immer auf Deutsch, kurz und im Gesprächston — das hier wird oft vorgelesen (Sprachausgabe), also keine langen Listen oder Berichte. Bei vielen Ergebnissen (z.B. Produktlisten) nur die wichtigsten 3-5 nennen und fragen ob mehr gewünscht ist. Wenn eine Aktion nicht möglich ist (z.B. Level falsch), erklär kurz warum und was nötig wäre, um es zu ermöglichen.`;

const TOOLS = [
  {
    name: 'get_status',
    description: 'Zeigt die komplette Steuermatrix — welche Funktion für welches Projekt auf welcher Freigabestufe steht.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'set_function_level',
    description: 'Schaltet eine Funktion für ein Projekt auf eine andere Freigabestufe.',
    input_schema: {
      type: 'object',
      properties: {
        project: { type: 'string', enum: ['pawvero', 'wabipaper', 'luminara', 'magnatrade'] },
        function: { type: 'string', enum: ['umsatz-analyse', 'lager-warnung', 'rabatt-automatik', 'cross-selling', 'produktbeschreibungen'] },
        level: { type: 'string', enum: VALID_LEVELS }
      },
      required: ['project', 'function', 'level']
    }
  },
  {
    name: 'get_umsatz',
    description: 'Zeigt den Umsatz der letzten 30 Tage für alle Projekte, bei denen Umsatz-Analyse aktiv ist.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_lager',
    description: 'Zeigt Lagerbestand-Warnungen (niedriger Bestand / ausverkauft) für alle Projekte mit aktiver Lagerbestand-Warnung.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_rabatt_kandidaten',
    description: 'Zeigt Lagerhüter-Kandidaten (viel Bestand, wenig Verkauf) für Rabatt-Automatik.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'apply_rabatt',
    description: 'Setzt Sale-Preis und Coupon für ein konkretes Produkt. Braucht Freigabe oder Autonom-Stufe für das Projekt.',
    input_schema: {
      type: 'object',
      properties: {
        project: { type: 'string', enum: ['pawvero', 'wabipaper', 'luminara'] },
        productId: { type: 'number' },
        percent: { type: 'number', description: 'Rabatt in Prozent, Standard 15 falls nicht angegeben' }
      },
      required: ['project', 'productId']
    }
  },
  {
    name: 'get_cross_selling',
    description: 'Zeigt Cross-Selling-Vorschläge (oft gemeinsam gekaufte Produkte) für alle Projekte mit aktiver Cross-Selling-Funktion.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'list_produkte',
    description: 'Listet Produkte eines Shops (für Produktbeschreibungen).',
    input_schema: {
      type: 'object',
      properties: { project: { type: 'string', enum: ['pawvero', 'wabipaper', 'luminara'] } },
      required: ['project']
    }
  },
  {
    name: 'generate_produktbeschreibung',
    description: 'Erstellt einen Textentwurf (Beschreibung, Tags, SEO, ggf. Preis) für ein Produkt. Bei Pawvero ist einkaufspreis Pflicht, bei den anderen beiden nicht.',
    input_schema: {
      type: 'object',
      properties: {
        project: { type: 'string', enum: ['pawvero', 'wabipaper', 'luminara'] },
        productId: { type: 'number' },
        einkaufspreis: { type: 'number', description: 'Nur für Pawvero nötig' }
      },
      required: ['project', 'productId']
    }
  },
  {
    name: 'apply_produktbeschreibung',
    description: 'Übernimmt einen zuvor generierten Textentwurf nach WooCommerce. Braucht Freigabe oder Autonom-Stufe für das Projekt. Nutze exakt die Felder aus dem letzten generate_produktbeschreibung-Ergebnis.',
    input_schema: {
      type: 'object',
      properties: {
        project: { type: 'string', enum: ['pawvero', 'wabipaper', 'luminara'] },
        productId: { type: 'number' },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        metaTitle: { type: 'string' },
        metaDescription: { type: 'string' },
        focusKeyword: { type: 'string' },
        price: { type: 'number' }
      },
      required: ['project', 'productId', 'description']
    }
  }
];

async function executeTool(name, input) {
  switch (name) {
    case 'get_status':
      return loadConfig();

    case 'set_function_level': {
      const config = loadConfig();
      if (!config.matrix[input.project] || !(input.function in config.matrix[input.project])) {
        return { error: 'Projekt oder Funktion unbekannt' };
      }
      config.matrix[input.project][input.function] = input.level;
      saveConfig(config);
      return { ok: true, ...input };
    }

    case 'get_umsatz':
      return { results: await umsatzAnalyse.run() };

    case 'get_lager':
      return { results: await lagerWarnung.run() };

    case 'get_rabatt_kandidaten':
      return { results: await rabattAutomatik.run() };

    case 'apply_rabatt':
      return rabattAutomatik.applyDiscount(input.project, input.productId, input.percent);

    case 'get_cross_selling':
      return { results: await crossSelling.run() };

    case 'list_produkte':
      return produktbeschreibungen.listProducts(input.project);

    case 'generate_produktbeschreibung':
      return produktbeschreibungen.generateContent(input.project, input.productId, input.einkaufspreis);

    case 'apply_produktbeschreibung': {
      const { project, ...payload } = input;
      return produktbeschreibungen.applyContent(project, payload);
    }

    default:
      return { error: `Unbekanntes Tool: ${name}` };
  }
}

async function chat(messages) {
  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) return { error: 'ANTHROPIC_KEY fehlt' };

  let history = [...messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: history
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      return { error: `Claude API Fehler (${res.status}): ${errText.slice(0, 200)}` };
    }

    const data = await res.json();
    history.push({ role: 'assistant', content: data.content });

    if (data.stop_reason !== 'tool_use') {
      const reply = data.content.find((b) => b.type === 'text')?.text || '';
      return { reply, messages: history };
    }

    const toolUses = data.content.filter((b) => b.type === 'tool_use');
    const toolResults = [];
    for (const tu of toolUses) {
      let result;
      try {
        result = await executeTool(tu.name, tu.input || {});
      } catch (err) {
        result = { error: err.message };
      }
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
    }
    history.push({ role: 'user', content: toolResults });
  }

  return { error: 'Zu viele Werkzeug-Aufrufe hintereinander — abgebrochen.' };
}

module.exports = { chat };
