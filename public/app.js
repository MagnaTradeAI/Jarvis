const LEVELS = ['off', 'beobachten', 'freigabe', 'autonom'];
const LEVEL_LABEL = { off: 'AUS', beobachten: 'BEOBACHTEN', freigabe: 'FREIGABE', autonom: 'AUTONOM' };
const PROJECT_LABEL = { pawvero: 'Pawvero', wabipaper: 'Wabipaper', luminara: 'Luminara Syndicate', magnatrade: 'MagnaTrade-AI' };

const statusEl = document.getElementById('status');
const statusLabel = document.getElementById('status-label');
const headRow = document.getElementById('matrix-head');
const body = document.getElementById('matrix-body');
const umsatzGrid = document.getElementById('umsatz-grid');
const refreshBtn = document.getElementById('refresh-umsatz');
const lagerGrid = document.getElementById('lager-grid');
const refreshLagerBtn = document.getElementById('refresh-lager');
const rabattGrid = document.getElementById('rabatt-grid');
const refreshRabattBtn = document.getElementById('refresh-rabatt');
const crossGrid = document.getElementById('cross-grid');
const refreshCrossBtn = document.getElementById('refresh-cross');
const pbShop = document.getElementById('pb-shop');
const pbProduct = document.getElementById('pb-product');
const pbPreis = document.getElementById('pb-einkaufspreis');
const pbGenerateBtn = document.getElementById('pb-generate');
const pbResult = document.getElementById('pb-result');
const chatLog = document.getElementById('chat-log');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send');
const micBtn = document.getElementById('mic-btn');
const ttsToggle = document.getElementById('tts-toggle');

let config = null;
let pbLastDraft = null;
let chatHistory = [];
let ttsEnabled = true;

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('Config-Abruf fehlgeschlagen');
    config = await res.json();
    setStatus('online', 'ONLINE');
    render();
  } catch (err) {
    setStatus('error', 'VERBINDUNG FEHLGESCHLAGEN');
  }
}

function setStatus(state, label) {
  statusEl.className = 'status ' + state;
  statusLabel.textContent = label;
}

function render() {
  headRow.innerHTML = '<th></th>' + config.projects.map(p => `<th>${p.label}</th>`).join('');

  body.innerHTML = config.functions.map(fn => {
    const cells = config.projects.map(p => {
      const level = config.matrix[p.id][fn.id];
      return `<td class="cell">
        <button class="toggle" type="button"
          data-project="${p.id}" data-function="${fn.id}" data-level="${level}">
          ${LEVEL_LABEL[level]}
        </button>
      </td>`;
    }).join('');
    return `<tr><th>${fn.label}</th>${cells}</tr>`;
  }).join('');

  body.querySelectorAll('button.toggle').forEach(btn => {
    btn.addEventListener('click', onToggleClick);
  });
}

async function onToggleClick(e) {
  const btn = e.currentTarget;
  const project = btn.dataset.project;
  const fn = btn.dataset.function;
  const current = btn.dataset.level;
  const next = LEVELS[(LEVELS.indexOf(current) + 1) % LEVELS.length];

  btn.dataset.level = next;
  btn.textContent = LEVEL_LABEL[next];

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, function: fn, level: next })
    });
    if (!res.ok) throw new Error('Speichern fehlgeschlagen');
    config.matrix[project][fn] = next;
  } catch (err) {
    btn.dataset.level = current;
    btn.textContent = LEVEL_LABEL[current];
    setStatus('error', 'SPEICHERN FEHLGESCHLAGEN');
    setTimeout(() => setStatus('online', 'ONLINE'), 3000);
  }
}

async function loadUmsatz() {
  umsatzGrid.innerHTML = '<p class="umsatz-empty">LÄDT…</p>';
  try {
    const res = await fetch('/api/umsatz');
    const data = await res.json();
    renderUmsatz(data.results || []);
  } catch (err) {
    umsatzGrid.innerHTML = '<p class="umsatz-empty">Abruf fehlgeschlagen.</p>';
  }
}

function renderUmsatz(results) {
  if (!results.length) {
    umsatzGrid.innerHTML = '<p class="umsatz-empty">Keine Projekte aktiv — Umsatz-Analyse in der Matrix oben auf BEOBACHTEN oder höher schalten.</p>';
    return;
  }

  umsatzGrid.innerHTML = results.map(r => {
    const label = PROJECT_LABEL[r.project] || r.project;
    if (r.error) {
      return `<div class="umsatz-card error"><h3>${label}</h3><p>${r.error}</p></div>`;
    }
    return `<div class="umsatz-card">
      <h3>${label}</h3>
      <div class="figure">${r.umsatz.toFixed(2)} €</div>
      <div class="row"><span>Bestellungen</span><span>${r.bestellungen}</span></div>
      <div class="row"><span>Ø Bestellwert</span><span>${r.durchschnittsbestellwert.toFixed(2)} €</span></div>
      <div class="row"><span>Zeitraum</span><span>${r.zeitraum.von} – ${r.zeitraum.bis}</span></div>
    </div>`;
  }).join('');
}

refreshBtn.addEventListener('click', loadUmsatz);

async function loadLager() {
  lagerGrid.innerHTML = '<p class="umsatz-empty">LÄDT…</p>';
  try {
    const res = await fetch('/api/lager');
    const data = await res.json();
    renderLager(data.results || []);
  } catch (err) {
    lagerGrid.innerHTML = '<p class="umsatz-empty">Abruf fehlgeschlagen.</p>';
  }
}

function renderLager(results) {
  if (!results.length) {
    lagerGrid.innerHTML = '<p class="umsatz-empty">Keine Projekte aktiv — Lagerbestand-Warnung in der Matrix oben auf BEOBACHTEN oder höher schalten.</p>';
    return;
  }

  lagerGrid.innerHTML = results.map(r => {
    const label = PROJECT_LABEL[r.project] || r.project;
    if (r.error) {
      return `<div class="lager-card error"><h3>${label}</h3><p>${r.error}</p></div>`;
    }
    if (!r.warnungen.length) {
      return `<div class="lager-card"><h3>${label}</h3><p class="lager-ok">Alles im grünen Bereich (${r.geprueft} Produkte geprüft)</p></div>`;
    }
    const items = r.warnungen.map(w => {
      const out = w.status === 'outofstock';
      return `<div class="lager-item">
        <span class="name">${w.name}${w.sku !== '–' ? ' (' + w.sku + ')' : ''}</span>
        <span class="qty${out ? ' out' : ''}">${out ? 'AUSVERKAUFT' : w.bestand + ' Stk.'}</span>
      </div>`;
    }).join('');
    return `<div class="lager-card"><h3>${label}</h3>${items}</div>`;
  }).join('');
}

refreshLagerBtn.addEventListener('click', loadLager);

async function loadRabatt() {
  rabattGrid.innerHTML = '<p class="umsatz-empty">LÄDT…</p>';
  try {
    const res = await fetch('/api/rabatt');
    const data = await res.json();
    renderRabatt(data.results || []);
  } catch (err) {
    rabattGrid.innerHTML = '<p class="umsatz-empty">Abruf fehlgeschlagen.</p>';
  }
}

function renderRabatt(results) {
  if (!results.length) {
    rabattGrid.innerHTML = '<p class="umsatz-empty">Keine Projekte aktiv — Rabatt-Automatik in der Matrix oben auf BEOBACHTEN oder höher schalten.</p>';
    return;
  }

  rabattGrid.innerHTML = results.map(r => {
    const label = PROJECT_LABEL[r.project] || r.project;
    if (r.error) {
      return `<div class="rabatt-card error"><h3>${label}</h3><p>${r.error}</p></div>`;
    }
    if (!r.kandidaten.length) {
      return `<div class="rabatt-card"><h3>${label}</h3><p class="lager-ok">Keine Lagerhüter gefunden (${r.geprueft} Produkte geprüft)</p></div>`;
    }
    const items = r.kandidaten.map(k => {
      const status = k.bereitsImSale ? 'IM SALE' : `${k.vorschlagProzent}% VORSCHLAG`;
      const disabled = k.bereitsImSale ? 'disabled' : '';
      return `<div class="rabatt-item">
        <span class="info">${k.name}
          <span class="meta">Bestand ${k.bestand} · ${k.verkauftLetzte60Tage} verkauft (60T) · ${k.regulaerpreis.toFixed(2)} €</span>
        </span>
        <button class="apply-btn${k.bereitsImSale ? ' done' : ''}" ${disabled}
          data-project="${r.project}" data-id="${k.id}" data-percent="${k.vorschlagProzent}">
          ${status}
        </button>
      </div>`;
    }).join('');
    return `<div class="rabatt-card"><h3>${label}</h3>${items}</div>`;
  }).join('');

  rabattGrid.querySelectorAll('.apply-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', onApplyClick);
  });
}

async function onApplyClick(e) {
  const btn = e.currentTarget;
  const project = btn.dataset.project;
  const productId = btn.dataset.id;
  const percent = btn.dataset.percent;

  btn.disabled = true;
  btn.textContent = 'WIRD ANGEWENDET…';

  try {
    const res = await fetch('/api/rabatt/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, productId: Number(productId), percent: Number(percent) })
    });
    const result = await res.json();
    if (result.ok) {
      btn.textContent = `IM SALE BIS ${result.gueltigBis}${result.couponCode ? ' · ' + result.couponCode : ''}`;
      btn.classList.add('done');
    } else {
      btn.textContent = result.error || 'FEHLGESCHLAGEN';
      btn.disabled = false;
    }
  } catch (err) {
    btn.textContent = 'FEHLGESCHLAGEN';
    btn.disabled = false;
  }
}

refreshRabattBtn.addEventListener('click', loadRabatt);

async function loadCross() {
  crossGrid.innerHTML = '<p class="umsatz-empty">LÄDT…</p>';
  try {
    const res = await fetch('/api/cross-selling');
    const data = await res.json();
    renderCross(data.results || []);
  } catch (err) {
    crossGrid.innerHTML = '<p class="umsatz-empty">Abruf fehlgeschlagen.</p>';
  }
}

function renderCross(results) {
  if (!results.length) {
    crossGrid.innerHTML = '<p class="umsatz-empty">Keine Projekte aktiv — Cross-Selling-Vorschläge in der Matrix oben auf BEOBACHTEN oder höher schalten.</p>';
    return;
  }

  crossGrid.innerHTML = results.map(r => {
    const label = PROJECT_LABEL[r.project] || r.project;
    if (r.error) {
      return `<div class="cross-card error"><h3>${label}</h3><p>${r.error}</p></div>`;
    }
    if (!r.vorschlaege.length) {
      return `<div class="cross-card"><h3>${label}</h3><p class="lager-ok">Noch keine Muster erkennbar (${r.ausgewerteteBestellungen} Bestellungen ausgewertet)</p></div>`;
    }
    const items = r.vorschlaege.map(v => {
      const partnerNames = v.partner.map(p => `${p.name} (${p.count}×)`).join(', ');
      const crossSellIds = v.partner.map(p => p.id).join(',');
      return `<div class="cross-item">
        <span class="info">${v.productName}
          <span class="meta">Häufig zusammen mit: ${partnerNames}</span>
        </span>
        <button class="apply-btn" type="button"
          data-project="${r.project}" data-id="${v.productId}" data-cross="${crossSellIds}">
          ALS CROSS-SELL SETZEN
        </button>
      </div>`;
    }).join('');
    return `<div class="cross-card"><h3>${label}</h3>${items}</div>`;
  }).join('');

  crossGrid.querySelectorAll('.apply-btn').forEach(btn => {
    btn.addEventListener('click', onCrossApplyClick);
  });
}

async function onCrossApplyClick(e) {
  const btn = e.currentTarget;
  const project = btn.dataset.project;
  const productId = btn.dataset.id;
  const crossSellIds = btn.dataset.cross.split(',').map(Number);

  btn.disabled = true;
  btn.textContent = 'WIRD GESETZT…';

  try {
    const res = await fetch('/api/cross-selling/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, productId: Number(productId), crossSellIds })
    });
    const result = await res.json();
    if (result.ok) {
      btn.textContent = 'GESETZT';
      btn.classList.add('done');
    } else {
      btn.textContent = result.error || 'FEHLGESCHLAGEN';
      btn.disabled = false;
    }
  } catch (err) {
    btn.textContent = 'FEHLGESCHLAGEN';
    btn.disabled = false;
  }
}

refreshCrossBtn.addEventListener('click', loadCross);

async function loadPbProducts() {
  const project = pbShop.value;
  pbProduct.innerHTML = '<option value="">Lädt…</option>';
  try {
    const res = await fetch(`/api/produktbeschreibungen/products?project=${project}`);
    const data = await res.json();
    if (data.error) {
      pbProduct.innerHTML = `<option value="">${data.error}</option>`;
      return;
    }
    pbProduct.innerHTML = '<option value="">Produkt wählen…</option>' +
      data.products.map(p => `<option value="${p.id}">${p.name}${p.sku ? ' (' + p.sku + ')' : ''}</option>`).join('');
  } catch (err) {
    pbProduct.innerHTML = '<option value="">Abruf fehlgeschlagen</option>';
  }
}

pbShop.addEventListener('change', () => {
  pbResult.innerHTML = '';
  pbLastDraft = null;
  pbPreis.disabled = pbShop.value !== 'pawvero';
  if (pbPreis.disabled) pbPreis.value = '';
  loadPbProducts();
});

pbGenerateBtn.addEventListener('click', async () => {
  const project = pbShop.value;
  const productId = Number(pbProduct.value);
  const einkaufspreis = Number(pbPreis.value);

  if (!productId) {
    pbResult.innerHTML = '<p class="umsatz-empty">Bitte Produkt wählen.</p>';
    return;
  }
  if (project === 'pawvero' && !einkaufspreis) {
    pbResult.innerHTML = '<p class="umsatz-empty">Bitte Einkaufspreis eingeben.</p>';
    return;
  }

  pbGenerateBtn.disabled = true;
  pbGenerateBtn.textContent = 'GENERIERT…';
  pbResult.innerHTML = '<p class="umsatz-empty">Erstellt Text…</p>';

  try {
    const res = await fetch('/api/produktbeschreibungen/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, productId, einkaufspreis: project === 'pawvero' ? einkaufspreis : undefined })
    });
    const data = await res.json();

    if (data.error) {
      pbResult.innerHTML = `<p class="umsatz-empty">${data.error}</p>`;
      pbLastDraft = null;
      return;
    }

    pbLastDraft = { ...data, productId };
    pbResult.innerHTML = `
      ${data.vorschlagPreis ? `<div class="pb-field"><span class="label">VORSCHLAGSPREIS</span><span class="pb-price">${data.vorschlagPreis.toFixed(2)} €</span></div>` : ''}
      <div class="pb-field"><span class="label">BESCHREIBUNG</span><span class="value">${data.description}</span></div>
      <div class="pb-field"><span class="label">SCHLAGWÖRTER</span><div class="pb-tags">${(data.tags || []).map(t => `<span class="pb-tag">${t}</span>`).join('')}</div></div>
      <div class="pb-field"><span class="label">META-TITLE</span><span class="value">${data.metaTitle || ''}</span></div>
      <div class="pb-field"><span class="label">META-DESCRIPTION</span><span class="value">${data.metaDescription || ''}</span></div>
      <div class="pb-field"><span class="label">FOCUS-KEYWORD</span><span class="value">${data.focusKeyword || ''}</span></div>
      ${data.keywordHinweis ? `<div class="pb-field"><span class="label">HINWEIS</span><span class="value">${data.keywordHinweis}</span></div>` : ''}
      <button class="apply-btn" id="pb-apply" type="button">ÜBERNEHMEN NACH WOOCOMMERCE</button>
    `;

    document.getElementById('pb-apply').addEventListener('click', onPbApply);
  } catch (err) {
    pbResult.innerHTML = '<p class="umsatz-empty">Generierung fehlgeschlagen.</p>';
  } finally {
    pbGenerateBtn.disabled = false;
    pbGenerateBtn.textContent = 'GENERIEREN';
  }
});

async function onPbApply(e) {
  if (!pbLastDraft) return;
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'WIRD ÜBERNOMMEN…';

  try {
    const res = await fetch('/api/produktbeschreibungen/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: pbShop.value,
        productId: pbLastDraft.productId,
        description: pbLastDraft.description,
        tags: pbLastDraft.tags,
        metaTitle: pbLastDraft.metaTitle,
        metaDescription: pbLastDraft.metaDescription,
        focusKeyword: pbLastDraft.focusKeyword,
        price: pbLastDraft.vorschlagPreis
      })
    });
    const result = await res.json();
    if (result.ok) {
      btn.textContent = 'ÜBERNOMMEN';
      btn.classList.add('done');
    } else {
      btn.textContent = result.error || 'FEHLGESCHLAGEN';
      btn.disabled = false;
    }
  } catch (err) {
    btn.textContent = 'FEHLGESCHLAGEN';
    btn.disabled = false;
  }
}

function renderChat() {
  if (!chatHistory.length) {
    chatLog.innerHTML = '<p class="chat-empty">Noch keine Unterhaltung — frag z.B. "Wie viel Umsatz hat Pawvero diesen Monat?"</p>';
    return;
  }
  chatLog.innerHTML = chatHistory.map(m => {
    const text = typeof m.content === 'string' ? m.content : (m.content.find(b => b.type === 'text')?.text || '');
    if (!text) return '';
    return `<div class="chat-msg ${m.role}">${text}</div>`;
  }).join('');
  chatLog.scrollTop = chatLog.scrollHeight;
}

function speak(text) {
  if (!ttsEnabled || !text || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'de-DE';
  window.speechSynthesis.speak(utter);
}

async function sendChatMessage(text) {
  if (!text.trim()) return;
  chatHistory.push({ role: 'user', content: text });
  renderChat();
  chatInput.value = '';
  chatSendBtn.disabled = true;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatHistory })
    });
    const data = await res.json();

    if (data.error) {
      chatHistory.push({ role: 'assistant', content: data.error });
      renderChat();
      return;
    }

    chatHistory = data.messages;
    renderChat();
    const lastText = chatHistory[chatHistory.length - 1]?.content;
    const text2 = Array.isArray(lastText) ? lastText.find(b => b.type === 'text')?.text : lastText;
    speak(text2 || data.reply || '');

    loadConfig();
    loadUmsatz();
    loadLager();
    loadRabatt();
    loadCross();
  } catch (err) {
    chatHistory.push({ role: 'assistant', content: 'Verbindung fehlgeschlagen.' });
    renderChat();
  } finally {
    chatSendBtn.disabled = false;
  }
}

chatSendBtn.addEventListener('click', () => sendChatMessage(chatInput.value));
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChatMessage(chatInput.value);
});

ttsToggle.addEventListener('click', () => {
  ttsEnabled = !ttsEnabled;
  ttsToggle.classList.toggle('on', ttsEnabled);
  if (!ttsEnabled) window.speechSynthesis.cancel();
});
ttsToggle.classList.add('on');

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognitionImpl) {
  const recognition = new SpeechRecognitionImpl();
  recognition.lang = 'de-DE';
  recognition.continuous = false;
  recognition.interimResults = false;

  let listening = false;

  micBtn.addEventListener('click', () => {
    if (listening) {
      recognition.stop();
      return;
    }
    recognition.start();
  });

  recognition.addEventListener('start', () => {
    listening = true;
    micBtn.classList.add('active');
  });

  recognition.addEventListener('end', () => {
    listening = false;
    micBtn.classList.remove('active');
  });

  recognition.addEventListener('result', (e) => {
    const transcript = e.results[0][0].transcript;
    sendChatMessage(transcript);
  });

  recognition.addEventListener('error', () => {
    listening = false;
    micBtn.classList.remove('active');
  });
} else {
  micBtn.disabled = true;
  micBtn.title = 'Spracheingabe nicht unterstützt (Chrome/Edge nötig)';
}

renderChat();

loadConfig();
loadUmsatz();
loadLager();
loadRabatt();
loadCross();
loadPbProducts();
