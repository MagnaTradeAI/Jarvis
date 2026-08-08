const LEVELS = ['off', 'beobachten', 'freigabe', 'autonom'];
const LEVEL_LABEL = { off: 'AUS', beobachten: 'BEOBACHTEN', freigabe: 'FREIGABE', autonom: 'AUTONOM' };
const PROJECT_LABEL = { pawvero: 'Pawvero', wabipaper: 'Wabipaper', luminara: 'Luminara Syndicate', magnatrade: 'MagnaTrade-AI' };

const statusEl = document.getElementById('status');
const statusLabel = document.getElementById('status-label');
const headRow = document.getElementById('matrix-head');
const body = document.getElementById('matrix-body');
const umsatzGrid = document.getElementById('umsatz-grid');
const refreshBtn = document.getElementById('refresh-umsatz');

let config = null;

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

loadConfig();
loadUmsatz();
