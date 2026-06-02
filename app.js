// ============================================================
// CONFIG
// ============================================================
const CLIENT_ID = '917136650964-63auvuts9dg4hbtqr2o7pa1171pmmrr2.apps.googleusercontent.com';
const SPREADSHEET_ID = '1mGEG698AcF6HZX-FxbqDbpFCaX1PJmFH9I6UzbdQYpk';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

// Mapping zones dans le sheet (colonnes en notation A1)
const ZONES = {
  'Épargne': {
    'Revenu':  { col: 'A', startRow: 13 },
    'Dépense': { col: 'A', startRow: 22 }
  },
  'Compte Perso': {
    'Revenu':          { col: 'H', startRow: 13 },
    'Charge fixe':     { col: 'H', startRow: 22 },
    'Charge variable': { col: 'H', startRow: 36 }
  },
  'Compte Joint': {
    'Revenu':          { col: 'O', startRow: 13 },
    'Charge fixe':     { col: 'O', startRow: 22 },
    'Charge variable': { col: 'O', startRow: 36 }
  }
};

// Colonnes de données par compte (Date, Libellé, Montant, Catégorie)
const COMPTE_COLS = {
  'Épargne':      { date: 'A', lib: 'B', mnt: 'C', cat: 'D' },
  'Compte Perso': { date: 'H', lib: 'I', mnt: 'J', cat: 'K' },
  'Compte Joint': { date: 'O', lib: 'P', mnt: 'Q', cat: 'R' }
};

// Cellules des soldes calculés par le sheet
const SOLDE_CELLS = {
  'perso-eom':   'I5',  // Solde fin de mois Perso
  'perso-today': 'I6',  // Solde aujourd'hui Perso
  'joint-eom':   'P5',  // Solde fin de mois Joint
  'joint-today': 'P6',  // Solde aujourd'hui Joint
  'epargne':     'C5',  // Solde épargne
  'rep-y':       'S5',  // Répartition Yoann
  'rep-e':       'S6',  // Répartition Élodie
};

// ============================================================
// STATE
// ============================================================
let accessToken = null;
let currentCompteFilter = 'joint';
let sheetData = {}; // cache des données par onglet

// ============================================================
// GOOGLE OAUTH (token implicite)
// ============================================================
function login() {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: window.location.origin + window.location.pathname,
    response_type: 'token',
    scope: SCOPES,
    prompt: 'select_account'
  });
  window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
}

function checkAuth() {
  // Récupère le token depuis l'URL (#access_token=...) après redirect OAuth
  const hash = new URLSearchParams(window.location.hash.substring(1));
  const token = hash.get('access_token');
  if (token) {
    accessToken = token;
    // Nettoyer l'URL
    history.replaceState(null, '', window.location.pathname);
    localStorage.setItem('gtoken_expiry', Date.now() + 3500 * 1000);
    localStorage.setItem('gtoken', token);
    showApp();
    return;
  }
  // Vérifier token stocké
  const stored = localStorage.getItem('gtoken');
  const expiry = parseInt(localStorage.getItem('gtoken_expiry') || '0');
  if (stored && Date.now() < expiry) {
    accessToken = stored;
    showApp();
    return;
  }
  showAuthScreen();
}

function logout() {
  localStorage.removeItem('gtoken');
  localStorage.removeItem('gtoken_expiry');
  accessToken = null;
  document.getElementById('app').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
}

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  loadCurrentMonth();
}

// ============================================================
// API GOOGLE SHEETS
// ============================================================
async function sheetsGet(range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const resp = await fetch(url, {
    headers: { Authorization: 'Bearer ' + accessToken }
  });
  if (!resp.ok) {
    if (resp.status === 401) { logout(); return null; }
    throw new Error('Erreur lecture sheet: ' + resp.status);
  }
  return resp.json();
}

async function sheetsAppend(range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values })
  });
  if (!resp.ok) {
    if (resp.status === 401) { logout(); return null; }
    throw new Error('Erreur écriture sheet: ' + resp.status);
  }
  return resp.json();
}

// ============================================================
// CHARGEMENT DES DONNÉES
// ============================================================
function getCurrentMonthName() {
  const months = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Aout','Septembre','Octobre','Novembre','Décembre'];
  return months[new Date().getMonth()];
}

async function loadCurrentMonth() {
  const mois = getCurrentMonthName();
  document.getElementById('header-sub').textContent = mois + ' · chargement...';

  try {
    await Promise.all([
      loadSoldes(mois),
      loadTransactions(mois)
    ]);
    document.getElementById('header-sub').textContent = mois + ' · à jour';
  } catch(e) {
    document.getElementById('header-sub').textContent = 'Erreur de chargement';
    showToast('❌ Erreur: ' + e.message);
  }
}

async function loadSoldes(mois) {
  // Un seul appel batchGet pour toutes les cellules
  const ranges = [
    `${mois}!I5`, `${mois}!I6`,
    `${mois}!P5`, `${mois}!P6`,
    `${mois}!C5`,
    `${mois}!S5`, `${mois}!S6`
  ];
  const params = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet?${params}&valueRenderOption=UNFORMATTED_VALUE`;
  const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  if (!resp.ok) {
    if (resp.status === 401) { logout(); return; }
    throw new Error('Erreur lecture sheet: ' + resp.status);
  }
  const json = await resp.json();
  const vrs = json.valueRanges || [];

  const val = (r) => r && r.values && r.values[0] && r.values[0][0] != null ? parseFloat(r.values[0][0]) : 0;

  const persoEom   = val(vrs[0]);
  const persoToday = val(vrs[1]);
  const jointEom   = val(vrs[2]);
  const jointToday = val(vrs[3]);
  const epargne    = val(vrs[4]);
  const repY       = val(vrs[5]);
  const repE       = val(vrs[6]);

  setVal('perso-today', persoToday);
  setVal('perso-eom',   persoEom);
  setVal('joint-today', jointToday);
  setVal('joint-eom',   jointEom);

  document.getElementById('epargne-val').textContent = fmt(epargne);

  // Répartition
  const total = Math.abs(repY) + Math.abs(repE);
  if (total > 0) {
    const pctY = Math.round(Math.abs(repY) / total * 100);
    const pctE = 100 - pctY;
    document.getElementById('rep-y').textContent = fmt(repY);
    document.getElementById('rep-e').textContent = fmt(repE);
    document.getElementById('rep-bar-y').style.width = pctY + '%';
    document.getElementById('rep-bar-e').style.width = pctE + '%';
  }
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = fmt(val);
  el.className = 'solde-row-val ' + (val >= 0 ? 'positive' : 'negative');
}

async function loadTransactions(mois) {
  // Lire toutes les données (lignes 13 à 120, colonnes A à R)
  const data = await sheetsGet(`${mois}!A13:R120`);
  if (!data || !data.values) return;

  sheetData[mois] = data.values;
  renderTransactions(data.values);
  renderBudgetBars(data.values);
  renderStats(data.values);
}

function parseRow(row, offset) {
  // offset: index de début de colonne (0=A, 7=H, 14=O)
  return {
    date: row[offset]     || null,
    lib:  row[offset + 1] || '',
    mnt:  parseFloat(row[offset + 2]) || 0,
    cat:  row[offset + 3] || ''
  };
}

function renderTransactions(rows) {
  const offsets = { joint: 14, perso: 7, epargne: 0 };
  const offset = offsets[currentCompteFilter];
  const container = document.getElementById('tx-list');

  const items = [];
  rows.forEach(row => {
    const r = parseRow(row, offset);
    if (r.lib && r.mnt) items.push(r);
  });

  if (items.length === 0) {
    container.innerHTML = '<div class="budget-loading">Aucune opération</div>';
    return;
  }

  // Trier par date décroissante
  items.sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date) > new Date(a.date) ? 1 : -1;
  });

  container.innerHTML = items.map(r => {
    const isIncome = r.mnt > 0;
    const iconClass = getIconClass(r.cat, isIncome);
    const icon = getIcon(r.cat, isIncome);
    const dateStr = r.date ? fmtDate(r.date) : '';
    return `
      <div class="tx-item">
        <div class="tx-icon ${iconClass}"><i class="ti ${icon}"></i></div>
        <div class="tx-info">
          <div class="tx-label">${escHtml(r.lib)}</div>
          <div class="tx-meta">${dateStr}${r.cat ? ' · ' + r.cat : ''}</div>
        </div>
        <div class="tx-amount ${isIncome ? 'income' : ''}">${isIncome ? '+' : '−'}${fmt(Math.abs(r.mnt))}</div>
      </div>`;
  }).join('');
}

function renderBudgetBars(rows) {
  // Charges variables joint = colonnes O(14) P(15) Q(16) R(17)
  // Les lignes 36-38 (index 23-25) sont les budgets RESTANTS calculés par le sheet => à ignorer
  // Les vraies dépenses commencent ligne 40 = index 27
  const cats = {};

  rows.forEach((row, i) => {
    if (i < 27) return; // ignorer lignes 13-39 (revenus, charges fixes, lignes budget restant)
    const dateVal = row[14];
    const mnt = parseFloat(row[16]) || 0;
    const cat = (row[17] || '').toString().trim();
    // Ignorer les lignes sans date réelle ou montant nul
    if (!dateVal || !mnt || !cat) return;
    // Ignorer les catégories fantômes (Multimédia = label trompeur sur ligne budget restant)
    if (cat === 'Multimédia') return;
    cats[cat] = (cats[cat] || 0) + mnt;
  });

  const container = document.getElementById('budget-bars');
  if (Object.keys(cats).length === 0) {
    container.innerHTML = '<div class="budget-loading">Aucune charge variable</div>';
    return;
  }

  const courses = cats['Courses'] || 0;
  const carbu   = cats['Carburant/transport'] || 0;
  let autre = 0;
  Object.entries(cats).forEach(([k, v]) => {
    if (k !== 'Courses' && k !== 'Carburant/transport') autre += v;
  });

  const bars = [
    { label: 'Courses',   val: courses, budget: 500 },
    { label: 'Carburant', val: carbu,   budget: 240 },
    { label: 'Autre',     val: autre,   budget: 400 }
  ];

  container.innerHTML = bars.map(b => {
    const pct = Math.min(100, Math.round(b.val / b.budget * 100));
    const cls = pct > 90 ? 'bar-over' : pct > 70 ? 'bar-warn' : 'bar-ok';
    return `
      <div class="budget-row">
        <div class="budget-row-top">
          <span class="budget-cat">${b.label}</span>
          <span class="budget-amounts"><b>${fmt(b.val)}</b> / ${b.budget} €</span>
        </div>
        <div class="bar-bg"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');
}

function renderStats(rows) {
  const cats = {};
  // Joint charges variables (offset 14, à partir de row 27)
  rows.forEach((row, i) => {
    if (i < 27) return;
    const mnt = parseFloat(row[16]) || 0;
    const cat = row[17] || 'Autre';
    if (mnt > 0 && row[14]) cats[cat] = (cats[cat] || 0) + mnt;
  });

  // Joint charges fixes (offset 14, rows 9-21 ~ lignes 22-34)
  let chargesFixes = 0;
  rows.forEach((row, i) => {
    if (i < 9 || i > 21) return;
    const mnt = parseFloat(row[16]) || 0;
    if (mnt > 0) chargesFixes += mnt;
  });

  const container = document.getElementById('stats-bars');
  const max = Math.max(...Object.values(cats), chargesFixes, 1);

  let html = '';
  if (chargesFixes > 0) {
    const pct = Math.round(chargesFixes / max * 100);
    html += `<div class="budget-row">
      <div class="budget-row-top"><span class="budget-cat">Charges fixes</span><span class="budget-amounts"><b>${fmt(chargesFixes)}</b></span></div>
      <div class="bar-bg"><div class="bar-fill bar-ok" style="width:${pct}%"></div></div>
    </div>`;
  }

  Object.entries(cats)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, val]) => {
      const pct = Math.round(val / max * 100);
      html += `<div class="budget-row">
        <div class="budget-row-top"><span class="budget-cat">${cat}</span><span class="budget-amounts"><b>${fmt(val)}</b></span></div>
        <div class="bar-bg"><div class="bar-fill bar-ok" style="width:${pct}%"></div></div>
      </div>`;
    });

  container.innerHTML = html || '<div class="budget-loading">Aucune donnée</div>';
}

// ============================================================
// AJOUT D'UNE OPÉRATION
// ============================================================
async function submitDepense() {
  const compte = getChipVal('chips-compte');
  const type = getChipVal('chips-type');
  const montant = parseFloat(document.getElementById('input-montant').value);
  const libelle = document.getElementById('input-libelle').value.trim();
  const date = document.getElementById('input-date').value;
  const categorie = getChipVal('chips-cat');
  const mois = document.getElementById('input-mois').value;

  const errEl = document.getElementById('submit-error');
  if (!montant || isNaN(montant)) { errEl.textContent = 'Montant invalide'; errEl.classList.remove('hidden'); return; }
  if (!libelle) { errEl.textContent = 'Libellé requis'; errEl.classList.remove('hidden'); return; }
  errEl.classList.add('hidden');

  if (!ZONES[compte] || !ZONES[compte][type]) {
    errEl.textContent = `Combinaison "${compte}" / "${type}" non valide`;
    errEl.classList.remove('hidden');
    return;
  }

  const zone = ZONES[compte][type];
  const range = `${mois}!${zone.col}${zone.startRow}`;

  // Format date DD/MM/YYYY
  const [y, m, d] = date.split('-');
  const dateStr = `${d}/${m}/${y}`;

  // Pour les revenus le montant est positif, pour les dépenses négatif
  const mntVal = (type === 'Revenu') ? montant : montant;

  let row;
  if (compte === 'Épargne') {
    row = [dateStr, libelle, mntVal];
  } else {
    row = [dateStr, libelle, mntVal, categorie];
  }

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  document.getElementById('btn-submit-label').textContent = 'Enregistrement...';

  try {
    await sheetsAppend(range, [row]);
    closeModal();
    showToast('✅ Enregistré !');
    // Recharger les données
    sheetData = {};
    await loadCurrentMonth();
  } catch(e) {
    errEl.textContent = 'Erreur: ' + e.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    document.getElementById('btn-submit-label').textContent = 'Enregistrer';
  }
}

// ============================================================
// HELPERS UI
// ============================================================
function fmt(val) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  const n = Math.abs(val);
  const str = n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return (val < 0 ? '−' : '') + str + ' €';
}

function fmtDate(d) {
  if (!d) return '';
  try {
    const date = new Date(d);
    if (isNaN(date)) return d;
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  } catch { return d; }
}

function escHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function getChipVal(groupId) {
  const sel = document.querySelector(`#${groupId} .chip.selected`);
  return sel ? sel.dataset.val : '';
}

function getIconClass(cat, isIncome) {
  if (isIncome) return 'income';
  const c = (cat || '').toLowerCase();
  if (c.includes('cours') || c.includes('alim') || c.includes('primeur') || c.includes('leclerc')) return 'courses';
  if (c.includes('carbu') || c.includes('transport') || c.includes('essence')) return 'transport';
  if (c.includes('santé') || c.includes('médec') || c.includes('psy') || c.includes('pharmac')) return 'sante';
  if (c.includes('loisir') || c.includes('cadeau') || c.includes('vacance')) return 'loisir';
  if (c.includes('fix') || c.includes('pret') || c.includes('crèche') || c.includes('loyer')) return 'fix';
  return 'autre';
}

function getIcon(cat, isIncome) {
  if (isIncome) return 'ti-arrow-down-circle';
  const c = (cat || '').toLowerCase();
  if (c.includes('cours') || c.includes('alim')) return 'ti-shopping-cart';
  if (c.includes('carbu') || c.includes('essence')) return 'ti-gas-station';
  if (c.includes('santé') || c.includes('médec') || c.includes('psy')) return 'ti-heart-rate-monitor';
  if (c.includes('loisir')) return 'ti-confetti';
  if (c.includes('pret') || c.includes('prêt')) return 'ti-building-bank';
  if (c.includes('crèche') || c.includes('école')) return 'ti-school';
  if (c.includes('cadeau')) return 'ti-gift';
  if (c.includes('animal') || c.includes('vét')) return 'ti-paw';
  return 'ti-receipt';
}

function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), duration);
}

function openModal() {
  document.getElementById('input-date').value = new Date().toISOString().split('T')[0];
  // Sync mois courant
  document.getElementById('input-mois').value = getCurrentMonthName();
  document.getElementById('modal').classList.add('open');
  document.getElementById('submit-error').classList.add('hidden');
  document.getElementById('input-montant').value = '';
  document.getElementById('input-libelle').value = '';
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
}

// ============================================================
// EVENTS
// ============================================================
document.getElementById('btn-login').addEventListener('click', login);
document.getElementById('btn-logout').addEventListener('click', logout);
document.getElementById('btn-refresh').addEventListener('click', () => { sheetData = {}; loadCurrentMonth(); });
document.getElementById('btn-submit').addEventListener('click', submitDepense);

// FABs
['fab-dashboard', 'fab-tx', 'fab-stats'].forEach(id => {
  document.getElementById(id).addEventListener('click', openModal);
});

// Nav
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('screen-' + btn.dataset.screen).classList.add('active');
  });
});

// Compte tabs
document.querySelectorAll('.compte-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.compte-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentCompteFilter = tab.dataset.compte;
    const mois = getCurrentMonthName();
    if (sheetData[mois]) renderTransactions(sheetData[mois]);
  });
});

// Chips
document.querySelectorAll('.chips').forEach(group => {
  group.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    group.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
  });
});

// Fermer modal en cliquant outside
document.getElementById('modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal')) closeModal();
});

// ============================================================
// INIT
// ============================================================
checkAuth();
