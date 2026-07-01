// ============================================================
// CONFIG
// ============================================================
const CLIENT_ID = '917136650964-63auvuts9dg4hbtqr2o7pa1171pmmrr2.apps.googleusercontent.com';
const SPREADSHEET_ID = '1OnFInZoJLwB1PYkzUFiEMnONpgzwXRl7ysf6n3Eue-Q';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Aout','Septembre','Octobre','Novembre','Décembre'];
const APP_VERSION = '2026.06.09-v24.3';
const DATA_SCHEMA_VERSION = 'budget-sheet-v1';
let USER_MODE = 'ELODIE';
// mettre 'ELODIE' dans la version pour elle

const ZONES = {
  'Épargne':      { 'Revenu':{col:'A',startRow:13}, 'Dépense':{col:'A',startRow:22} },
  'Compte Perso': { 'Revenu':{col:'H',startRow:13}, 'Charge fixe':{col:'H',startRow:22}, 'Charge variable':{col:'H',startRow:36} },
  'Compte Joint': { 'Revenu':{col:'O',startRow:13}, 'Charge fixe':{col:'O',startRow:22}, 'Charge variable':{col:'O',startRow:39} },

  'Compte Perso Elodie': {
    'Revenu': { col:'X', startRow:13 },
    'Charge fixe': { col:'X', startRow:22 },
    'Charge variable': { col:'X', startRow:36 }
  }
};

const TABLES = {

'Compte Perso Elodie': {
  'Revenu': { startCol:'X', endCol:'AA', firstRow:13, lastRow:30 },
  'Charge fixe': { startCol:'X', endCol:'AA', firstRow:33, lastRow:55 },
  'Charge variable': { startCol:'X', endCol:'AA', firstRow:58, lastRow:148 }
},

  'Épargne': {
    'Revenu': { startCol:'A', endCol:'D', firstRow:13, lastRow:30 },
    'Dépense': { startCol:'A', endCol:'D', firstRow:33, lastRow:50 }
  },
  'Compte Perso': {
    'Revenu': { startCol:'H', endCol:'K', firstRow:13, lastRow:30 },
    'Charge fixe': { startCol:'H', endCol:'K', firstRow:33, lastRow:55 },
    'Charge variable': { startCol:'H', endCol:'K', firstRow:58, lastRow:148 }
  },
  'Compte Joint': {
    'Revenu': { startCol:'O', endCol:'R', firstRow:13, lastRow:30 },
    'Charge fixe': { startCol:'O', endCol:'R', firstRow:33, lastRow:55 },
    // O58:R60 = suivi budget Courses / Carburant / Autre.
    // Les vraies dépenses variables commencent à O61.
    'Charge variable': { startCol:'O', endCol:'R', firstRow:61, lastRow:148 }
  }
};


// ============================================================
// STATE
// ============================================================
let accessToken = null;
let currentCompteFilter = 'Compte Joint';
let currentChartCompte = 'Compte Joint';
let sheetData = {};
let viewMonth = new Date().getMonth();
let chartInstance = null;

// SETTINGS (localStorage)
function getSettings() {
  return {
    name1:       localStorage.getItem('s_name1')       || 'Yoann',
    name2:       localStorage.getItem('s_name2')       || 'Élodie',
    email2:      localStorage.getItem('s_email2')      || '',
    seuil:       parseInt(localStorage.getItem('s_seuil') || '80'),
    comparaison: localStorage.getItem('s_comparaison') || 'prev_month'
  };
}
function saveSettings(s) {
  localStorage.setItem('s_name1', s.name1);
  localStorage.setItem('s_name2', s.name2);
  localStorage.setItem('s_email2', s.email2);
  localStorage.setItem('s_seuil', s.seuil);
  localStorage.setItem('s_comparaison', s.comparaison);
}

// ============================================================
// SERVICE WORKER + NOTIFICATIONS
// ============================================================
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/budget-pwa/sw.js')
      .then(reg => { console.log('SW registered'); checkNotifPermission(reg); })
      .catch(e => console.log('SW error', e));
  }
}

async function checkNotifPermission(reg) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

function triggerBudgetNotif(label, pct, seuil) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification('⚠️ Alerte budget', {
    body: `${label} : ${pct}% du budget atteint (seuil : ${seuil}%)`,
    icon: '/budget-pwa/icon-192.png'
  });
}

function checkBudgetAlerts(budgetData) {
  const { seuil } = getSettings();
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  const pctMois = Math.round(now.getDate() / daysInMonth * 100);
  const lastAlerts = JSON.parse(localStorage.getItem('last_alerts') || '{}');
  const today = now.toISOString().split('T')[0];

  budgetData.forEach(b => {
    const depense = b.total - b.restant;
    const pct = b.total > 0 ? Math.round(depense / b.total * 100) : 0;
    const key = `${today}_${b.label}`;
    if (pct >= seuil && !lastAlerts[key]) {
      triggerBudgetNotif(b.label, pct, seuil);
      lastAlerts[key] = true;
      localStorage.setItem('last_alerts', JSON.stringify(lastAlerts));
    }
  });

  // Alerte fin de mois (J-3)
  const daysLeft = daysInMonth - now.getDate();
  const keyEOM = `${today}_eom`;
  if (daysLeft <= 3 && !lastAlerts[keyEOM]) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('📅 Fin de mois dans '+daysLeft+' jour(s)', {
        body: 'Pensez à vérifier votre budget !',
        icon: '/budget-pwa/icon-192.png'
      });
    }
    lastAlerts[keyEOM] = true;
    localStorage.setItem('last_alerts', JSON.stringify(lastAlerts));
  }
}

// ============================================================
// AUTH
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
  const hash = new URLSearchParams(window.location.hash.substring(1));
  const token = hash.get('access_token');
  if (token) {
    accessToken = token;
    fetchUserEmail(accessToken);
    history.replaceState(null, '', window.location.pathname);
    localStorage.setItem('gtoken_expiry', Date.now() + 3500 * 1000);
    localStorage.setItem('gtoken', token);
    showApp(); return;
  }
  const stored = localStorage.getItem('gtoken');
  const expiry = parseInt(localStorage.getItem('gtoken_expiry') || '0');
  if (stored && Date.now() < expiry) { accessToken = stored; showApp(); return; }
  showAuthScreen();
}

function refreshToken() {
  showToast('🔄 Session expirée, reconnexion...', 3000);
  localStorage.removeItem('gtoken');
  localStorage.removeItem('gtoken_expiry');
  setTimeout(() => {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: window.location.origin + window.location.pathname,
      response_type: 'token',
      scope: SCOPES,
      prompt: 'select_account'
    });
    window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
  }, 1500);
}

function logout() {
  localStorage.removeItem('gtoken'); localStorage.removeItem('gtoken_expiry');
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
  applyProfileNames();
  viewMonth = new Date().getMonth();
  updateMonthNav();
  loadMonth(MONTHS[viewMonth]);
  applyUserTabs();
}

// ============================================================
// PROFILS
// ============================================================
function applyProfileNames() {
  const { name1, name2 } = getSettings();
  const initials = n => n.substring(0,2).toUpperCase();
  document.getElementById('label-user1').textContent = name1;
  document.getElementById('label-user2').textContent = name2;
  document.getElementById('repname-y').textContent = name1;
  document.getElementById('repname-e').textContent = name2;
  document.getElementById('avatar-y').textContent = initials(name1);
  document.getElementById('avatar-e').textContent = initials(name2);
  // Titre répartition
  document.querySelector('.section-title #label-user1') && (document.querySelector('.section-title #label-user1').textContent = name1);
}

async function fetchUserEmail(token) {
  try {
    const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: 'Bearer ' + token }
    });

    const data = await resp.json();

    localStorage.setItem('user_email', data.email);

    applyUserModeAuto(data.email);

  } catch (e) {
    console.error('Erreur récupération email', e);
  }
}

// ⚠️ MODE DEBUG ACTIF → penser à enlever avant prod
function applyUserModeAuto(email) {

  // 🔥 FORÇAGE MODE ÉLODIE (TEST)
  USER_MODE = 'ELODIE';

  // ✅ filtre cohérent
  currentCompteFilter = 'Compte Joint';

  // ✅ appliquer les tabs
  applyUserTabs();
  setTimeout(() => {
  applyUserTabs();
}, 0);

  // ✅ 🔥 REFRESH UI COMPLET
  const mois = getViewMonthName();
  if (sheetData[mois]) {
    renderTransactions(sheetData[mois]);
    renderStats(sheetData[mois]);
    renderChart(mois);
  }
}


// ============================================================
// API SHEETS
// ============================================================
async function sheetsGet(range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  if (!resp.ok) {
    if (resp.status===401) { refreshToken(); return null; }
    throw new Error('Erreur lecture: '+resp.status);
  }
  return resp.json();
}

async function sheetsAppend(range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const resp = await fetch(url, {
    method:'POST', headers:{ Authorization:'Bearer '+accessToken, 'Content-Type':'application/json' },
    body: JSON.stringify({ values })
  });
  if (!resp.ok) {
    if (resp.status===401) { refreshToken(); return null; }
    // Lire le détail de l'erreur Google
    const errBody = await resp.json().catch(()=>({error:{message:'Erreur inconnue'}}));
    const msg = errBody?.error?.message || ('Erreur ' + resp.status);
    throw new Error(msg);
  }
  return resp.json();
}


async function sheetsUpdate(range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const resp = await fetch(url, {
    method:'PUT',
    headers:{ Authorization:'Bearer '+accessToken, 'Content-Type':'application/json' },
    body: JSON.stringify({ values })
  });
  if (!resp.ok) {
    if (resp.status===401) { refreshToken(); return null; }
    const errBody = await resp.json().catch(() => ({ error:{ message:'Erreur inconnue' } }));
    const msg = errBody && errBody.error && errBody.error.message ? errBody.error.message : ('Erreur ' + resp.status);
    throw new Error(msg);
  }
  return resp.json();
}

// ============================================================
// NAVIGATION PAR MOIS
// ============================================================
function getViewMonthName() { return MONTHS[viewMonth]; }
function getCurrentMonthName() { return MONTHS[new Date().getMonth()]; }
function getNextMonthName() { return MONTHS[(new Date().getMonth()+1)%12]; }
function getPrevMonthName() { return MONTHS[(viewMonth - 1 + 12) % 12]; }
function getPrevYearMonthName() { return MONTHS[viewMonth]; } // même mois, an-1



async function updateMonthNav() {

  const name = getViewMonthName();
  document.getElementById('header-month').textContent = name;
  document.getElementById('input-mois').value = name;

  // ✅ Gestion mois suivant intelligente
  const nextMonth = MONTHS[viewMonth + 1];

  if (nextMonth) {

    const exists = await sheetExists(nextMonth);

    const btnNext = document.getElementById('btn-month-next');

    btnNext.style.opacity = exists ? '1' : '0.3';
    btnNext.style.pointerEvents = exists ? 'auto' : 'none';

  } else {

    // cas décembre (pas de mois après)
    const btnNext = document.getElementById('btn-month-next');

    btnNext.style.opacity = '0.3';
    btnNext.style.pointerEvents = 'none';
  }
}




async function changeMonth(delta) {

  const n = viewMonth + delta;

  // limite calendrier
  if (n < 0 || n > 11) return;

  const targetMonth = MONTHS[n];

  // ✅ CHECK AVANT TOUT
  const exists = await sheetExists(targetMonth);

  if (!exists) {
    showToast(`❌ ${targetMonth} n'est pas encore créé`);
    return; // ⛔ STOP → aucune modification
  }

  // ✅ seulement si OK
  viewMonth = n;

  await updateMonthNav();   // important : await
  await loadMonth(targetMonth);
}


// ============================================================
// CHARGEMENT
// ============================================================
async function loadMonth(mois) {
  if (!mois) return;
  document.getElementById('header-sub').textContent = mois + ' · chargement...';
  // Indicateur offline
  if (!navigator.onLine) {
    document.getElementById('header-sub').textContent = mois + ' · hors-ligne';
    if (sheetData[mois]) {
      renderTransactions(sheetData[mois]);
      await renderBudgetBars(sheetData[mois], mois);
      renderStats(sheetData[mois]);
      renderChart(mois);
    }
    return;
  }
  try {
    await loadTransactions(mois);
    await loadSoldes(mois);
    document.getElementById('header-sub').textContent = mois + ' · à jour';
  } catch(e) {
    document.getElementById('header-sub').textContent = navigator.onLine ? 'Erreur' : 'Hors-ligne';
    if (sheetData[mois]) {
      renderTransactions(sheetData[mois]);
      await renderBudgetBars(sheetData[mois], mois);
    }
    if (navigator.onLine) showToast('❌ ' + e.message);
  }
}

async function loadSoldes(mois) {
  
const cells = [
  mois+'!I5', mois+'!I6',    // TOI
  mois+'!P5', mois+'!P6',    // JOINT
  mois+'!C5',
  mois+'!S5', mois+'!S6',

  mois+'!Y5', mois+'!Y6'     // ✅ ELODIE
];

  const params = cells.map(r=>'ranges='+encodeURIComponent(r)).join('&');
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/'+SPREADSHEET_ID+'/values:batchGet?'+params+'&valueRenderOption=FORMATTED_VALUE';
  
let persoEom=0,persoToday=0,
    jointEom=0,jointToday=0,
    epargne=0,repY=0,repE=0,
    elodieEom=0, elodieToday=0;

  try {
    const resp = await fetch(url, { headers:{ Authorization:'Bearer '+accessToken } });
    if (!resp.ok) throw new Error('Erreur: '+resp.status);
    const json = await resp.json(); const vrs = json.valueRanges||[];
    const pf = vr => {
      const raw = vr?.values?.[0]?.[0];
      if (!raw && raw!==0) return 0;
      if (typeof raw==='number') return raw;
      return parseFloat(String(raw).replace(/[\u00a0\u202f ]/g,'').replace(/€/g,'').replace(/,/g,'.').replace(/[^0-9.\-]/g,''))||0;
    };
    persoEom=pf(vrs[0]); persoToday=pf(vrs[1]);
    jointEom=pf(vrs[2]); jointToday=pf(vrs[3]);
    epargne=pf(vrs[4]); repY=pf(vrs[5]); repE=pf(vrs[6]);
    elodieEom = pf(vrs[7]);
    elodieToday = pf(vrs[8]);

    // Cacher en localStorage pour le mode offline
    localStorage.setItem('cache_soldes_'+mois, JSON.stringify({persoEom,persoToday,jointEom,jointToday,epargne,repY,repE,elodieEom,elodieToday}));
  } catch(e) {
    // Fallback cache
    const cached = localStorage.getItem('cache_soldes_'+mois);
    if (cached) { const c=JSON.parse(cached); ({persoEom,persoToday,jointEom,jointToday,epargne,repY,repE}=c); }
    else { showToast('Erreur soldes: '+e.message); return; }
  }
  
if (USER_MODE === 'ELODIE') {
  setVal('perso-today', elodieToday);
  setVal('perso-eom', elodieEom);
} else {
  setVal('perso-today', persoToday);
  setVal('perso-eom', persoEom);
}

  setVal('joint-today', jointToday); setVal('joint-eom', jointEom);




  // Budget journalier = solde fin de mois ÷ jours restants
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  const daysLeft = Math.max(1, daysInMonth - now.getDate() + 1);

  const fmtJour = (val) => {
    if (isNaN(val) || val === null || val === undefined) return '—';
    const n = Math.abs(val).toLocaleString('fr-FR', {minimumFractionDigits:0, maximumFractionDigits:2});
    return (val < 0 ? '−' : '') + n + ' €';
  };

  const persoJourEl = document.getElementById('perso-jour');
  const jointJourEl = document.getElementById('joint-jour');
  
if (persoJourEl) {
  const base = USER_MODE === 'ELODIE' ? elodieEom : persoEom;
  const v = base / daysLeft;

    persoJourEl.textContent = fmtJour(v);
    persoJourEl.className = 'solde-row-val ' + (v >= 0 ? 'positive' : 'negative');
  }
  if (jointJourEl) {
    const v = jointEom / daysLeft;
    jointJourEl.textContent = fmtJour(v);
    jointJourEl.className = 'solde-row-val ' + (v >= 0 ? 'positive' : 'negative');
  }
  document.getElementById('epargne-val').textContent = fmt(epargne);
  const epargneCard = document.getElementById('epargne-card');

if (USER_MODE === 'ELODIE') {
  if (epargneCard) epargneCard.style.display = 'none';
} else {
  if (epargneCard) epargneCard.style.display = '';
}

  const total = Math.abs(repY)+Math.abs(repE);
  if (total>0) {
    const pctY = Math.round(Math.abs(repY)/total*100);
    const { name1, name2 } = getSettings();
    document.getElementById('rep-y').textContent = fmt(repY);
    document.getElementById('rep-e').textContent = fmt(repE);
    document.getElementById('rep-bar-y').style.width = pctY+'%';
    document.getElementById('rep-bar-e').style.width = (100-pctY)+'%';
  }
}

function setVal(id, val) {
  const el = document.getElementById(id); if(!el) return;
  el.textContent = fmt(val);
  el.className = 'solde-row-val '+(val>=0?'positive':'negative');
}

async function loadTransactions(mois) {
  const data = await sheetsGet(`${mois}!A13:AA160`);
  if (!data || !data.values) return;
  sheetData[mois] = data.values;
  // Cache offline
  try { localStorage.setItem('cache_rows_'+mois, JSON.stringify(data.values)); } catch(e) {}
  renderTransactions(data.values);
  await renderBudgetBars(data.values, mois);
  renderStats(data.values);
  renderChart(mois);
}

// ============================================================
// TRANSACTIONS
// ============================================================
function parseRow(row, offset) {
  return { date:row[offset]||null, lib:row[offset+1]||'', mnt:parseFloat(row[offset+2])||0, cat:row[offset+3]||'' };
}

function renderTransactions(rows) {
  
// 🔐 blocage données pour Elodie
if (USER_MODE === 'ELODIE' && currentCompteFilter === 'Compte Perso') {
  document.getElementById('tx-list').innerHTML = '<div class="budget-loading">Non autorisé</div>';
  return;
}

if (USER_MODE === 'ELODIE' && currentCompteFilter === 'Épargne') {
  document.getElementById('tx-list').innerHTML = '<div class="budget-loading">Non autorisé</div>';
  return;
}

const offsets = {
  'Compte Joint':14,
  'Compte Perso':7,
  'Épargne':0,
  'Compte Perso Elodie':23
};

const offset = offsets[currentCompteFilter] ?? offsets['Compte Joint'];

  const container = document.getElementById('tx-list');
  const today = new Date(); today.setHours(23,59,59,0);
  const items = [];
  rows.forEach(row => {
    const r = parseRow(row, offset);
    if (!r.lib || !r.mnt) return;
    const d = parseDate(r.date);
    if (!d || d > today) return;
    items.push(r);
  });
  if (!items.length) { container.innerHTML='<div class="budget-loading">Aucune opération</div>'; return; }
  items.sort((a,b) => {
    const da=parseDate(a.date), db=parseDate(b.date);
    if(!da) return 1; if(!db) return -1; return db-da;
  });
  container.innerHTML = items.map(r => {
    const isIncome = r.mnt>0;
    return `<div class="tx-item">
      <div class="tx-icon ${getIconClass(r.cat,isIncome)}"><i class="ti ${getIcon(r.cat,isIncome)}"></i></div>
      <div class="tx-info">
        <div class="tx-label">${escHtml(r.lib)}</div>
        <div class="tx-meta">${r.date?fmtDate(r.date):''}${r.cat?' · '+r.cat:''}</div>
      </div>
      <div class="tx-amount ${isIncome?'income':''}">${isIncome?'+':'−'}${fmt(Math.abs(r.mnt))}</div>
    </div>`;
  }).join('');
}

// ============================================================
// BUDGET BARS
// ============================================================

async function renderBudgetBars(rows, mois) {
  const container = document.getElementById('budget-bars');
  if (!rows[45]) { container.innerHTML='<div class="budget-loading">Aucune donnée</div>'; return; }

  const budgets = await getBudgetsFromSheet(mois || getViewMonthName());
  const budgetRows = [
    { label:'Courses',   restant:parseFloat(rows[45] && rows[45][16])||0, total:budgets.courses },
    { label:'Carburant', restant:parseFloat(rows[46] && rows[46][16])||0, total:budgets.carburant },
    { label:'Autre',     restant:parseFloat(rows[47] && rows[47][16])||0, total:budgets.autre }
  ];

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
  const dayOfMonth = now.getDate();
  const pctMois = Math.round(dayOfMonth/daysInMonth*100);
  const { seuil } = getSettings();
  const isEndOfMonth = dayOfMonth >= daysInMonth-4;

  checkBudgetAlerts(budgetRows);

  container.innerHTML = `
    <div class="budget-header-row">
      <span class="budget-header-label">📅 Avancement du mois</span>
      <span class="budget-header-value">${dayOfMonth} / ${daysInMonth} jours · <b>${pctMois}%</b></span>
    </div>` +
  budgetRows.map(b => {
    const depense = b.total - b.restant;
    const pct = b.total>0 ? Math.min(100,Math.round(depense/b.total*100)) : 0;
    const surConso = pct - pctMois;
    const cls = surConso > 10 ? 'bar-over' : surConso > 0 ? 'bar-warn' : 'bar-ok';
    const rc = surConso > 10 ? 'var(--red)' : surConso > 0 ? 'var(--orange)' : 'var(--green-dark)';
    const alertIcon = pct >= seuil ? ' 🔔' : '';
    return `<div class="budget-row">
      <div class="budget-row-top">
        <span class="budget-cat">${b.label}${alertIcon}</span>
        <span class="budget-amounts"><b>${fmt(depense)}</b> / ${b.total} €&nbsp;<span style="color:${rc}">reste ${fmt(b.restant)}</span></span>
      </div>
      <div class="bar-bg" style="position:relative">
        <div class="bar-fill ${cls}" style="width:${pct}%"></div>
        <div class="month-marker" style="left:${pctMois}%"></div>
      </div>
    </div>`;
  }).join('') +
  (isEndOfMonth ? `<div class="eom-summary"><i class="ti ti-calendar-check"></i> Fin de mois — Total : <b>${fmt(budgetRows.reduce((s,b)=>s+(b.total-b.restant),0))}</b></div>` : '');
}

// ============================================================
// GRAPHIQUE DÉPENSES CUMULÉES
// ============================================================
async function renderChart(mois) {
  const rows = sheetData[mois];
  if (!rows) return;

  const { comparaison } = getSettings();
  const offset = currentChartCompte==='Compte Joint' ? 14 : 7;
  const varStart = currentChartCompte==='Compte Joint' ? 48 : 45;

  const now = new Date();
  const year = now.getFullYear();
  const daysInMonth = new Date(year, viewMonth+1, 0).getDate();

  // Calculer dépenses cumulées jour par jour — charges fixes + variables
  // Charges fixes : index 9-20 (L22-L33), variables : index 23+ perso / 27+ joint
  const fixeStart = 20, fixeEnd = 42;
  const depParJour = new Array(daysInMonth).fill(0);
  rows.forEach((row, i) => {
    const isFixe = i >= fixeStart && i <= fixeEnd;
    const isVar = i >= varStart;
    if (!isFixe && !isVar) return;
    const mnt = parseFloat(row[offset+2])||0;
    const d = parseDate(row[offset]);
    if (!d || mnt <= 0) return;
    // Dépenses antérieures au mois affiché (ex: 28 mai dans onglet Juin) → placées au jour 1
    const depMonth = d.getMonth();
    const depYear = d.getFullYear();
    const now = new Date();
    let day;
    if (depYear < now.getFullYear() || depMonth < viewMonth) {
      day = 1;
    } else {
      day = d.getDate();
    }
    if (day >= 1 && day <= daysInMonth) depParJour[day-1] += mnt;
  });
  // Cumuler
  const cumul = depParJour.reduce((acc, v, i) => { acc.push((acc[i-1]||0)+v); return acc; }, []);

  // Série de comparaison
  let cumulComp = null, labelComp = '';
  if (comparaison !== 'none') {
    let compMois = '';
    if (comparaison === 'prev_month') {
      compMois = MONTHS[(viewMonth-1+12)%12];
      labelComp = compMois;
    } else {
      compMois = MONTHS[viewMonth]; // même mois an-1
      labelComp = compMois+' '+(year-1);
    }
    const compRows = sheetData[compMois] || JSON.parse(localStorage.getItem('cache_rows_'+compMois)||'null');
    if (compRows) {
      const compDays = new Array(daysInMonth).fill(0);
      compRows.forEach((row, i) => {
        const isFixe = i >= fixeStart && i <= fixeEnd;
        const isVar = i >= varStart;
        if (!isFixe && !isVar) return;
        const mnt = parseFloat(row[offset+2])||0;
        const d = parseDate(row[offset]);
        if (!d || mnt <= 0) return;
        const compMonthIdx = MONTHS.indexOf(compMois);
        const depMonth = d.getMonth();
        let day;
        if (depMonth < compMonthIdx) {
          day = 1;
        } else {
          day = d.getDate();
        }
        if (day >= 1 && day <= daysInMonth) compDays[day-1] += mnt;
      });
      cumulComp = compDays.reduce((acc, v, i) => { acc.push((acc[i-1]||0)+v); return acc; }, []);
    } else if (comparaison === 'prev_month' && navigator.onLine) {
      // Charger le mois précédent en arrière-plan
      try {
        const data = await sheetsGet(`${compMois}!A13:AA120`);
        if (data?.values) {
          sheetData[compMois] = data.values;
          localStorage.setItem('cache_rows_'+compMois, JSON.stringify(data.values));
          renderChart(mois); return;
        }
      } catch(e) {}
    }
  }

  const labels = Array.from({length:daysInMonth},(_,i)=>i+1);
  // Tronquer à aujourd'hui si c'est le mois courant
  const today = viewMonth===now.getMonth() ? now.getDate() : daysInMonth;
  const cumulAff = cumul.slice(0, today);

  const datasets = [{
    label: 'Ce mois',
    data: cumulAff,
    borderColor: '#1D9E75',
    backgroundColor: 'rgba(29,158,117,0.08)',
    fill: true,
    tension: 0.3,
    pointRadius: 2,
    pointHoverRadius: 5
  }];

  if (cumulComp) {
    datasets.push({
      label: labelComp,
      data: cumulComp.slice(0, daysInMonth),
      borderColor: '#8E8E93',
      backgroundColor: 'transparent',
      borderDash: [4,4],
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 4
    });
  }

  const ctx = document.getElementById('chart-depenses');
  if (!ctx) return;
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels: labels.slice(0, Math.max(today, daysInMonth)), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: !!cumulComp, position:'bottom', labels:{ font:{size:11}, boxWidth:20 } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${fmt(ctx.raw)}`
          }
        }
      },
      scales: {
        x: { ticks:{font:{size:10}, maxTicksLimit:10}, grid:{display:false} },
        y: { ticks:{font:{size:10}, callback: v => fmt(v)}, grid:{color:'rgba(0,0,0,0.05)'} }
      }
    }
  });

  // Légende comparaison
  const leg = document.getElementById('chart-legend');
  if (cumulComp && cumulAff.length > 0 && cumulComp.length > 0) {
    const diff = cumulAff[cumulAff.length-1] - cumulComp[cumulAff.length-1];
    const sign = diff > 0 ? '+' : '';
    const col = diff > 0 ? 'var(--red)' : 'var(--green-dark)';
    leg.innerHTML = `<span style="color:${col};font-size:12px;font-weight:600">${sign}${fmt(diff)} vs ${labelComp}</span>`;
  } else { leg.innerHTML = ''; }
}

// ============================================================
// STATS
// ============================================================

function renderStats(rows) {
  const cats = {};
  rows.forEach((row,i) => {
    if(i < 48 || i > 135) return;
    const mnt=parseFloat(row[16])||0, cat=row[17]||'Autre';
    if(mnt>0&&row[14]) cats[cat]=(cats[cat]||0)+mnt;
  });
  let chargesFixes=0;
  rows.forEach((row,i) => {
    if(i<20||i>42) return;
    const mnt=parseFloat(row[16])||0; if(mnt>0) chargesFixes+=mnt;
  });
  const container = document.getElementById('stats-bars');
  const max = Math.max(...Object.values(cats),chargesFixes,1);
  let html='';
  if(chargesFixes>0){const p=Math.round(chargesFixes/max*100);html+=`<div class="budget-row"><div class="budget-row-top"><span class="budget-cat">Charges fixes</span><span class="budget-amounts"><b>${fmt(chargesFixes)}</b></span></div><div class="bar-bg"><div class="bar-fill bar-ok" style="width:${p}%"></div></div></div>`;}
  Object.entries(cats).sort((a,b)=>b[1]-a[1]).forEach(([cat,val])=>{
    const p=Math.round(val/max*100);
    html+=`<div class="budget-row"><div class="budget-row-top"><span class="budget-cat">${cat}</span><span class="budget-amounts"><b>${fmt(val)}</b></span></div><div class="bar-bg"><div class="bar-fill bar-ok" style="width:${p}%"></div></div></div>`;
  });
  container.innerHTML=html||'<div class="budget-loading">Aucune donnée</div>';
}

// ============================================================
// RÉSUMÉ ANNUEL
// ============================================================

async function loadAnnuel() {
  const container = document.getElementById('annuel-content');
  container.innerHTML = '<div class="budget-loading">Chargement de l\'année...</div>';
  const currentMonthIdx = new Date().getMonth();
  const results = [];

  for (let i = 0; i <= currentMonthIdx; i++) {
    const mois = MONTHS[i];
    try {
      let rows = sheetData[mois];
      if (!rows) {
        const cached = localStorage.getItem('cache_rows_'+mois);
        if (cached) { rows = JSON.parse(cached); sheetData[mois] = rows; }
        else if (navigator.onLine) {
          const data = await sheetsGet(`${mois}!A13:AA160`);
          if (data && data.values) { rows = data.values; sheetData[mois] = rows; localStorage.setItem('cache_rows_'+mois, JSON.stringify(rows)); }
        }
      }
      if (!rows) { results.push({ mois, revJoint:0, depJoint:0, revPerso:0, depPerso:0, err:true }); continue; }

      
let revJoint=0, depJoint=0,
    revPerso=0, depPerso=0,
    revElodie=0, depElodie=0;

      const today = new Date(); today.setHours(23,59,59,0);
      rows.forEach((row,i) => {
        const mntJ = parseFloat(row[16])||0;
        const mntP = parseFloat(row[9])||0;
        const dateJ = parseDate(row[14]);
        const dateP = parseDate(row[7]);
        const mntE = parseFloat(row[25])||0;   // X → montant
        const dateE = parseDate(row[23]);      // X → date

        if (i===0) {
          if (mntJ !== 0) revJoint += mntJ;
          if (mntP !== 0) revPerso += mntP;
          if (mntE !== 0) revElodie += mntE;
        }
        if (i>=1 && i<=17) {
          if (mntJ > 0 && dateJ && dateJ <= today) revJoint += mntJ;
          if (mntP > 0 && dateP && dateP <= today) revPerso += mntP;
          if (mntE > 0 && dateE && dateE <= today) revElodie += mntE;
        }
        if (i>=20 && i<=42) {
          if (mntJ > 0 && dateJ && dateJ <= today) depJoint += mntJ;
          if (mntP > 0 && dateP && dateP <= today) depPerso += mntP;
          if (mntE > 0 && dateE && dateE <= today) depElodie += mntE;
        }
        if (i>=48 && i<=135) {
          if (mntJ > 0 && dateJ && dateJ <= today) depJoint += mntJ;
        }
        if (i>=45 && i<=135) {
          if (mntP > 0 && dateP && dateP <= today) depPerso += mntP;
          if (mntE > 0 && dateE && dateE <= today) depElodie += mntE;
        }
      });
      
results.push({
  mois,
  revJoint,
  depJoint,
  soldeJoint: revJoint - depJoint,

  revPerso: USER_MODE === 'ELODIE' ? revElodie : revPerso,
  depPerso: USER_MODE === 'ELODIE' ? depElodie : depPerso,
  soldePerso: USER_MODE === 'ELODIE'
    ? (revElodie - depElodie)
    : (revPerso - depPerso)
});

    } catch(e) {
      results.push({ mois, revJoint:0, depJoint:0, revPerso:0, depPerso:0, err:true });
    }
  }

  const totRevJ = results.reduce((s,r)=>s+r.revJoint,0);
  const totDepJ = results.reduce((s,r)=>s+r.depJoint,0);
  const totRevP = results.reduce((s,r)=>s+r.revPerso,0);
  const totDepP = results.reduce((s,r)=>s+r.depPerso,0);

  
container.innerHTML = `
  <div class="annuel-tabs">
    <div class="annuel-tab active" onclick="switchAnnuelTab('joint',this)">Compte Joint</div>

<div class="annuel-tab" onclick="switchAnnuelTab('perso',this)">Compte Perso</div>

  </div>

    <div id="annuel-joint"><div class="annuel-table">
      <div class="annuel-header"><span>Mois</span><span>Revenus</span><span>Dépenses</span><span>Solde</span></div>
      ${results.map(r=>`<div class="annuel-row ${r.err?'annuel-err':''}" onclick="jumpToMonth('${r.mois}')"><span class="annuel-mois">${r.mois.substring(0,3)}</span><span class="annuel-rev">${r.err?'—':fmt(r.revJoint)}</span><span class="annuel-dep">${r.err?'—':fmt(r.depJoint)}</span><span class="annuel-sol ${(r.soldeJoint||0)>=0?'positive':'negative'}">${r.err?'—':fmt(r.soldeJoint)}</span></div>`).join('')}
      <div class="annuel-total"><span>Total</span><span>${fmt(totRevJ)}</span><span>${fmt(totDepJ)}</span><span class="${(totRevJ-totDepJ)>=0?'positive':'negative'}">${fmt(totRevJ-totDepJ)}</span></div>
    </div></div>
    <div id="annuel-perso" style="display:none"><div class="annuel-table">
      <div class="annuel-header"><span>Mois</span><span>Revenus</span><span>Dépenses</span><span>Solde</span></div>
      ${results.map(r=>`<div class="annuel-row ${r.err?'annuel-err':''}" onclick="jumpToMonth('${r.mois}')"><span class="annuel-mois">${r.mois.substring(0,3)}</span><span class="annuel-rev">${r.err?'—':fmt(r.revPerso)}</span><span class="annuel-dep">${r.err?'—':fmt(r.depPerso)}</span><span class="annuel-sol ${(r.soldePerso||0)>=0?'positive':'negative'}">${r.err?'—':fmt(r.soldePerso)}</span></div>`).join('')}
      <div class="annuel-total"><span>Total</span><span>${fmt(totRevP)}</span><span>${fmt(totDepP)}</span><span class="${(totRevP-totDepP)>=0?'positive':'negative'}">${fmt(totRevP-totDepP)}</span></div>
    </div></div>`;
}

function switchAnnuelTab(which, el) {
  document.querySelectorAll('.annuel-tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('annuel-joint').style.display = which==='joint'?'block':'none';
  document.getElementById('annuel-perso').style.display = which==='perso'?'block':'none';
}

function jumpToMonth(mois) {
  const idx = MONTHS.indexOf(mois);
  if (idx < 0 || idx > new Date().getMonth()) return;
  viewMonth = idx;
  updateMonthNav();
  // Aller sur dashboard
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelector('[data-screen="dashboard"]').classList.add('active');
  document.getElementById('screen-dashboard').classList.add('active');
  loadMonth(mois);
}

// ============================================================
// PARAMÈTRES
// ============================================================

async function getBudgetsFromSheet(mois) {
  const cells=[`${mois}!V4`,`${mois}!V5`,`${mois}!V6`];
  const params=cells.map(r=>`ranges=${encodeURIComponent(r)}`).join('&');
  try {
    const resp=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet?${params}&valueRenderOption=UNFORMATTED_VALUE`,{headers:{Authorization:'Bearer '+accessToken}});
    if(!resp.ok) return {courses:500,carburant:240,autre:400};
    const json=await resp.json(); const vrs=json.valueRanges||[];
    return {courses:parseFloat(vrs[0]?.values?.[0]?.[0])||500,carburant:parseFloat(vrs[1]?.values?.[0]?.[0])||240,autre:parseFloat(vrs[2]?.values?.[0]?.[0])||400};
  } catch(e) { return {courses:500,carburant:240,autre:400}; }
}


async function saveBudgetsToSheet(mois,courses,carburant,autre) {
  const resp=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate`,{
    method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},
    body:JSON.stringify({valueInputOption:'RAW',data:[
      {range:`${mois}!V4`,values:[[courses]]},{range:`${mois}!V5`,values:[[carburant]]},{range:`${mois}!V6`,values:[[autre]]}
    ]})
  });
  if(!resp.ok) throw new Error('Erreur budgets: '+resp.status);
}

async function openSettings() {
  updateAppVersionDisplay();
  const s = getSettings();
  document.getElementById('settings-name1').value = s.name1;
  document.getElementById('settings-name2').value = s.name2;
  document.getElementById('settings-email2').value = s.email2;
  // Chips seuil
  document.querySelectorAll('#chips-seuil .chip').forEach(c=>c.classList.toggle('selected',parseInt(c.dataset.val)===s.seuil));
  // Chips comparaison
  document.querySelectorAll('#chips-comparaison .chip').forEach(c=>c.classList.toggle('selected',c.dataset.val===s.comparaison));
  // Budgets
  const mois = getViewMonthName();
  const b = await getBudgetsFromSheet(mois);
  document.getElementById('budget-courses').value   = b.courses;
  document.getElementById('budget-carburant').value = b.carburant;
  document.getElementById('budget-autre').value     = b.autre;
  // Mois suivant
  const nextName = getNextMonthName();
  document.getElementById('btn-prepare-label').textContent = 'Préparer '+nextName+' 2026';
  const exists = await sheetExists(nextName);
  const btn=document.getElementById('btn-prepare-month');
  btn.disabled=exists; btn.style.opacity=exists?'0.4':'1';
  document.getElementById('next-month-info').textContent = exists ? "L'onglet "+nextName+" existe déjà." : "Créer l'onglet "+nextName+" à partir de "+mois+".";
  document.getElementById('modal-settings').classList.add('open');
}

function closeSettings() { document.getElementById('modal-settings').classList.remove('open'); }

async function saveSettingsHandler() {
  const name1 = document.getElementById('settings-name1').value.trim()||'Yoann';
  const name2 = document.getElementById('settings-name2').value.trim()||'Élodie';
  const email2 = document.getElementById('settings-email2').value.trim();
  const seuil = parseInt(getChipVal('chips-seuil'))||80;
  const comparaison = getChipVal('chips-comparaison')||'prev_month';
  const courses = parseFloat(document.getElementById('budget-courses').value)||500;
  const carburant = parseFloat(document.getElementById('budget-carburant').value)||240;
  const autre = parseFloat(document.getElementById('budget-autre').value)||400;

  saveSettings({name1,name2,email2,seuil,comparaison});
  const btn=document.getElementById('btn-save-settings'); btn.disabled=true;
  try {
    await saveBudgetsToSheet(getViewMonthName(),courses,carburant,autre);
    closeSettings(); showToast('✅ Paramètres enregistrés !');
    applyProfileNames();
    sheetData={}; await loadMonth(getViewMonthName());
  } catch(e) { showToast('❌ '+e.message);
  } finally { btn.disabled=false; }
}

// ============================================================
// PRÉPARER MOIS SUIVANT
// ============================================================
async function sheetExists(name) {
  try {
    const resp=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties.title`,{headers:{Authorization:'Bearer '+accessToken}});
    if(!resp.ok) return false;
    const json=await resp.json();
    return (json.sheets||[]).some(s=>s.properties.title===name);
  } catch(e){return false;}
}

function addMonths(dateStr,n) {
  if(!dateStr||typeof dateStr!=='string') return dateStr;
  const parts=dateStr.split('/'); if(parts.length!==3) return dateStr;
  const [d,m,y]=parts.map(Number);
  const dt=new Date(y,m-1+n,d);
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
}


async function prepareNextMonth() {
  const moisActuel=getCurrentMonthName(), moisSuivant=getNextMonthName();
  const btn=document.getElementById('btn-prepare-month');
  btn.disabled=true; document.getElementById('btn-prepare-label').textContent='Préparation...';

  try {
    // 1. Récupérer l'onglet du mois actuel et dupliquer l'onglet.
    const metaResp=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`,{headers:{Authorization:'Bearer '+accessToken}});
    if(!metaResp.ok) throw new Error('Erreur métadonnées: '+metaResp.status);
    const meta=await metaResp.json();
    const cur=meta.sheets.find(s=>s.properties.title===moisActuel);
    if(!cur) throw new Error('Onglet '+moisActuel+' introuvable');

    const duplicateResp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,{
      method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},
      body:JSON.stringify({requests:[{duplicateSheet:{sourceSheetId:cur.properties.sheetId,insertSheetIndex:cur.properties.index+1,newSheetName:moisSuivant}}]})
    });
    if(!duplicateResp.ok) throw new Error('Erreur duplication: '+duplicateResp.status);

    // 2. Récupérer les soldes fin de mois à reporter dans la ligne 13 du nouvel onglet.
    const soldeResp=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet?ranges=${encodeURIComponent(moisActuel+'!C5')}&ranges=${encodeURIComponent(moisActuel+'!I5')}&ranges=${encodeURIComponent(moisActuel+'!P5')}&valueRenderOption=UNFORMATTED_VALUE`,{headers:{Authorization:'Bearer '+accessToken}});
    if(!soldeResp.ok) throw new Error('Erreur lecture soldes: '+soldeResp.status);
    const soldeJson=await soldeResp.json(); const vrs=soldeJson.valueRanges||[];
    const sE=parseFloat(vrs[0]?.values?.[0]?.[0])||0;
    const sP=parseFloat(vrs[1]?.values?.[0]?.[0])||0;
    const sJ=parseFloat(vrs[2]?.values?.[0]?.[0])||0;

    // 3. Lire, depuis l'onglet dupliqué, les lignes à conserver en changeant les dates.
    // - Ancien solde Épargne : A13:C13, date +1 mois, libellé conservé, montant remplacé par le report.
    // - Revenus Perso : H13:J30, dates +1 mois, libellés/montants conservés, J13 remplacé par le report.
    // - Revenus Joint : O13:Q30, dates +1 mois, libellés/montants conservés, Q13 remplacé par le report.
    // - Charges fixes : H33:J55 et O33:Q55, dates +1 mois.
    const keptResp=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet?ranges=${encodeURIComponent(moisSuivant+'!A13:C13')}&ranges=${encodeURIComponent(moisSuivant+'!H13:J30')}&ranges=${encodeURIComponent(moisSuivant+'!O13:Q30')}&ranges=${encodeURIComponent(moisSuivant+'!H33:J55')}&ranges=${encodeURIComponent(moisSuivant+'!O33:Q55')}&valueRenderOption=FORMATTED_VALUE`,{headers:{Authorization:'Bearer '+accessToken}});
    if(!keptResp.ok) throw new Error('Erreur lecture lignes conservées: '+keptResp.status);
    const keptJson=await keptResp.json();

    const oldEpargne = (keptJson.valueRanges?.[0]?.values||[])[0] || [];
    const epargneReport = [[oldEpargne[0] ? addMonths(oldEpargne[0],1) : '', oldEpargne[1] || 'Ancien Solde', sE]];

    const revenusPerso=(keptJson.valueRanges?.[1]?.values||[]).map((r,idx)=>{
      const row = r?.[0] ? [addMonths(r[0],1), r[1]||'', r[2]||''] : ['', r?.[1]||'', r?.[2]||''];
      if (idx === 0) row[2] = sP;
      return row;
    });

    const revenusJoint=(keptJson.valueRanges?.[2]?.values||[]).map((r,idx)=>{
      const row = r?.[0] ? [addMonths(r[0],1), r[1]||'', r[2]||''] : ['', r?.[1]||'', r?.[2]||''];
      if (idx === 0) row[2] = sJ;
      return row;
    });

    const fixesPerso=(keptJson.valueRanges?.[3]?.values||[]).map(r=>r?.[0]?[addMonths(r[0],1),r[1]||'',r[2]||'']:r);
    const fixesJoint=(keptJson.valueRanges?.[4]?.values||[]).map(r=>r?.[0]?[addMonths(r[0],1),r[1]||'',r[2]||'']:r);

    // 4. Mettre à jour le nom du mois, les reports, les revenus conservés et les charges fixes décalées.
    const updateResp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate`,{
      method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},
      body:JSON.stringify({valueInputOption:'USER_ENTERED',data:[
        {range:`${moisSuivant}!B1`,values:[[moisSuivant]]},
        {range:`${moisSuivant}!A13:C13`,values:epargneReport},
        ...(revenusPerso.length?[{range:`${moisSuivant}!H13:J30`,values:revenusPerso}]:[]),
        ...(revenusJoint.length?[{range:`${moisSuivant}!O13:Q30`,values:revenusJoint}]:[]),
        ...(fixesPerso.length?[{range:`${moisSuivant}!H33:J55`,values:fixesPerso}]:[]),
        ...(fixesJoint.length?[{range:`${moisSuivant}!O33:Q55`,values:fixesJoint}]:[]),
      ]})
    });
    if(!updateResp.ok) throw new Error('Erreur mise à jour mois suivant: '+updateResp.status);

    // 5. Nettoyer uniquement les zones de saisie mensuelles à ne pas conserver.
    // Important : ne pas vider H13:K30 et O13:R30, car les revenus récurrents sont conservés.
    // Important : ne pas vider O58:R60, car ce sont les lignes de suivi budget.
    // Important : ne pas vider V4:V6, car ce sont les budgets mensuels paramétrables.
    const clearResp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchClear`,{
      method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},
      body:JSON.stringify({ranges:[
        `${moisSuivant}!A14:D30`,  // Épargne revenus hors ancien solde
        `${moisSuivant}!A33:D50`,  // Épargne dépenses
        `${moisSuivant}!H58:K148`, // Perso charges variables
        `${moisSuivant}!O61:R148`  // Joint charges variables réelles
      ]})
    });
    if(!clearResp.ok) throw new Error('Erreur nettoyage mois suivant: '+clearResp.status);

    // 6. Nettoyer les caches locaux impactés.
    sheetData = {};
    localStorage.removeItem('cache_rows_'+moisSuivant);
    localStorage.removeItem('cache_soldes_'+moisSuivant);

    closeSettings(); showToast('✅ Onglet '+moisSuivant+' créé !',3000);
  } catch(e) {
    showToast('❌ '+e.message,4000); btn.disabled=false;
    document.getElementById('btn-prepare-label').textContent='Préparer '+getNextMonthName()+' 2026';
  }
}


function colToNumber(col) {
  let n = 0;
  for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
  return n;
}
function numberToCol(n) {
  let col = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    col = String.fromCharCode(65 + r) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}
function offsetCol(col, offset) { return numberToCol(colToNumber(col) + offset); }
function isBlankCell(v) { return v === undefined || v === null || String(v).trim() === ''; }
async function findFirstEmptyTableRow(mois, compte, type) {
  const table = TABLES[compte] && TABLES[compte][type];
  if (!table) throw new Error(`Tableau introuvable pour ${compte} / ${type}`);
  const range = `${mois}!${table.startCol}${table.firstRow}:${table.endCol}${table.lastRow}`;
  const data = await sheetsGet(range);
  if (!data) return null;
  const rows = data.values || [];
  const rowCount = table.lastRow - table.firstRow + 1;
  for (let i = 0; i < rowCount; i++) {
    const row = rows[i] || [];
    if (isBlankCell(row[0]) && isBlankCell(row[1]) && isBlankCell(row[2])) return table.firstRow + i;
  }
  throw new Error(`Aucune ligne vide disponible pour ${compte} / ${type}. Ajoute une ligne préformatée dans Google Sheets ou libère une ligne.`);
}

// ============================================================
// AJOUT DÉPENSE
// ============================================================
async function submitDepense() {
  const compte=getChipVal('chips-compte'), type=getChipVal('chips-type');
  const montant=parseFloat(document.getElementById('input-montant').value);
  const libelle=document.getElementById('input-libelle').value.trim();
  const date=document.getElementById('input-date').value;
  
let categorie = getChipVal('chips-cat');

// ✅ sécurité : recalcul au moment du submit
const autoCat = autoCategorieSmart(libelle);

if (autoCat) {
  categorie = autoCat;
}

  const mois=document.getElementById('input-mois').value;
  const errEl=document.getElementById('submit-error');
  if(!montant||isNaN(montant)){errEl.textContent='Montant invalide';errEl.classList.remove('hidden');return;}
  if(!libelle){errEl.textContent='Libellé requis';errEl.classList.remove('hidden');return;}
  errEl.classList.add('hidden');
  if(!ZONES[compte]||!ZONES[compte][type]){errEl.textContent=`Combinaison "${compte}" / "${type}" non valide`;errEl.classList.remove('hidden');return;}
  const zone=ZONES[compte][type];
  const [y,m,d]=date.split('-');
  const dateStr=`${d}/${m}/${y}`;
  const row=compte==='Épargne'?[dateStr,libelle,montant]:[dateStr,libelle,montant,categorie];
  const btn=document.getElementById('btn-submit');
  btn.disabled=true; document.getElementById('btn-submit-label').textContent='Enregistrement...';
  try {
    const table = TABLES[compte] && TABLES[compte][type];
    if (!table) throw new Error(`Tableau introuvable pour ${compte} / ${type}`);

    const targetRow = await findFirstEmptyTableRow(mois, compte, type);
    if (!targetRow) {
      btn.disabled=false;
      document.getElementById('btn-submit-label').textContent='Enregistrer';
      return;
    }

    const endCol = offsetCol(table.startCol, row.length - 1);
    const result = await sheetsUpdate(`${mois}!${table.startCol}${targetRow}:${endCol}${targetRow}`, [row]);
    if (!result) {
      btn.disabled=false;
      document.getElementById('btn-submit-label').textContent='Enregistrer';
      return;
    }
    if(navigator.vibrate) navigator.vibrate(50);
    closeModal(); showToast('✅ Enregistré !');
    sheetData={}; await loadMonth(mois);
  } catch(e) {errEl.textContent='Erreur: '+e.message;errEl.classList.remove('hidden');
  } finally {btn.disabled=false;document.getElementById('btn-submit-label').textContent='Enregistrer';}
}

// ============================================================
// HELPERS
// ============================================================
// ============================================================
// AUTO CATEGORIE (SAFE)
// ============================================================

function autoCategorieSmart(libelle) {
  if (!libelle) return null;

  const l = libelle.trim().toLowerCase();

  if (l.includes("leclerc") || l.includes("carrefour") || l.includes("intermarch"))
    return "Courses";

  if (l.includes("total") || l.includes("essence") || l.includes("station"))
    return "Carburant/transport";

  if (l.includes("pharmacie") || l.includes("médecin"))
    return "Santé";

  if (l.includes("restaurant") || l.includes("ciné") || l.includes("netflix"))
    return "Loisir";

  return null; // important → ne force pas
}


function fmt(val) {
  if(val===null||val===undefined||isNaN(val)) return '—';
  return (val<0?'−':'')+Math.abs(val).toLocaleString('fr-FR',{minimumFractionDigits:0,maximumFractionDigits:2})+' €';
}

function parseDate(d) {
  if(!d && d!==0) return null;
  // Serial Excel (nombre entier comme 46977)
  if(typeof d==='number') {
    return new Date(Date.UTC(1899, 11, 30) + d * 86400000);
  }
  // Format DD/MM/YYYY
  if(typeof d==='string' && d.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
    const[day,m,y]=d.split('/');
    return new Date(parseInt(y),parseInt(m)-1,parseInt(day));
  }
  // Format ISO YYYY-MM-DD
  if(typeof d==='string' && d.match(/^\d{4}-\d{2}-\d{2}/)) return new Date(d);
  // Format YYYY-MM-DDThh:mm:ss
  if(typeof d==='string' && d.includes('T')) return new Date(d);
  return null;
}

function fmtDate(d) {
  if(!d) return '';
  try {
    const date=parseDate(d);
    if(!date||isNaN(date)) return d;
    return date.toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
  } catch{return d;}
}

function escHtml(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function getChipVal(gid){const s=document.querySelector(`#${gid} .chip.selected`);return s?s.dataset.val:'';}

function getIconClass(cat,isIncome){
  if(isIncome) return 'income';
  const c=(cat||'').toLowerCase();
  if(c.includes('cours')||c.includes('alim')||c.includes('leclerc')||c.includes('carrefour')) return 'courses';
  if(c.includes('carbu')||c.includes('transport')||c.includes('essence')) return 'transport';
  if(c.includes('santé')||c.includes('médec')||c.includes('pharmac')) return 'sante';
  if(c.includes('loisir')||c.includes('vacance')||c.includes('cadeau')) return 'loisir';
  if(c.includes('fix')||c.includes('pret')||c.includes('crèche')) return 'fix';
  return 'autre';
}

function getIcon(cat,isIncome){
  if(isIncome) return 'ti-arrow-down-circle';
  const c=(cat||'').toLowerCase();
  if(c.includes('cours')||c.includes('alim')) return 'ti-shopping-cart';
  if(c.includes('carbu')||c.includes('essence')) return 'ti-gas-station';
  if(c.includes('santé')||c.includes('médec')) return 'ti-heart-rate-monitor';
  if(c.includes('loisir')) return 'ti-confetti';
  if(c.includes('pret')||c.includes('prêt')) return 'ti-building-bank';
  if(c.includes('crèche')) return 'ti-school';
  if(c.includes('cadeau')) return 'ti-gift';
  if(c.includes('animal')||c.includes('vét')) return 'ti-paw';
  return 'ti-receipt';
}

function showToast(msg,duration=2500){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.remove('hidden');
  setTimeout(()=>t.classList.add('hidden'),duration);
}

function openModal(){
  document.getElementById('input-date').value=new Date().toISOString().split('T')[0];
  document.getElementById('input-mois').value=getViewMonthName();
  document.getElementById('modal').classList.add('open');
  document.getElementById('submit-error').classList.add('hidden');
  document.getElementById('input-montant').value='';
  document.getElementById('input-libelle').value='';
  updateTypeChoicesForCompte();
  applyUserMode();
}


function closeModal(){document.getElementById('modal').classList.remove('open');}


function updateTypeChoicesForCompte() {
  const compte = getChipVal('chips-compte');

const allowedTypes = {
  'Compte Joint': ['Charge variable', 'Charge fixe', 'Revenu'],
  'Compte Perso': ['Charge variable', 'Charge fixe', 'Revenu'],
  'Compte Perso Elodie': ['Charge variable', 'Charge fixe', 'Revenu'],
  'Épargne': ['Revenu', 'Dépense']
};


  const allowed = allowedTypes[compte] || [];
  const chips = Array.from(document.querySelectorAll('#chips-type .chip'));
  let selectedStillVisible = false;

  chips.forEach(chip => {
    const isAllowed = allowed.includes(chip.dataset.val);
    chip.style.display = isAllowed ? '' : 'none';

    if (!isAllowed) chip.classList.remove('selected');
    if (isAllowed && chip.classList.contains('selected')) selectedStillVisible = true;
  });

  if (!selectedStillVisible) {
    const firstAllowedChip = chips.find(chip => allowed.includes(chip.dataset.val));
    if (firstAllowedChip) firstAllowedChip.classList.add('selected');
  }
}

function applyUserMode() {

  const chips = document.querySelectorAll('#chips-compte .chip');

  chips.forEach(chip => {

    const val = chip.dataset.val;

    if (USER_MODE === 'TOI') {
      if (val === 'Compte Perso Elodie') {
        chip.style.display = 'none';
      }
    }

    if (USER_MODE === 'ELODIE') {
      if (val === 'Compte Perso' || val === 'Épargne') {
        chip.style.display = 'none';
      }
    }

  });

}

async function clearCacheAndReconnect() {
  const ok = confirm("Cette action va vider le cache local, supprimer la session Google actuelle et relancer une connexion propre.\n\nContinuer ?");
  if (!ok) return;
  try {
    showToast('🧹 Nettoyage du cache...', 2000);
    localStorage.removeItem('gtoken'); localStorage.removeItem('gtoken_expiry');
    Object.keys(localStorage).forEach(key => { if (key.indexOf('cache_rows_') === 0 || key.indexOf('cache_soldes_') === 0 || key === 'last_alerts') localStorage.removeItem(key); });
    sheetData = {}; accessToken = null;
    if ('caches' in window) { const cacheNames = await caches.keys(); await Promise.all(cacheNames.map(name => caches.delete(name))); }
    if ('serviceWorker' in navigator) { const registrations = await navigator.serviceWorker.getRegistrations(); await Promise.all(registrations.map(reg => reg.unregister())); }
    showToast('✅ Cache vidé. Reconnexion...', 1500);
    setTimeout(() => { login(); }, 800);
  } catch (e) { showToast('❌ Erreur nettoyage : ' + e.message, 4000); }
}


function updateAppVersionDisplay() {
  const versionEl = document.getElementById('app-version-value');
  if (versionEl) versionEl.textContent = APP_VERSION + ' · ' + DATA_SCHEMA_VERSION;
}

// ============================================================
// EVENTS
// ============================================================
document.getElementById('btn-login').addEventListener('click',login);
document.getElementById('btn-logout').addEventListener('click',logout);
document.getElementById('btn-refresh').addEventListener('click',()=>{sheetData={};loadMonth(getViewMonthName());});
document.getElementById('btn-settings').addEventListener('click',openSettings);
document.getElementById('btn-save-settings').addEventListener('click',saveSettingsHandler);
document.getElementById('btn-prepare-month').addEventListener('click',prepareNextMonth);
document.getElementById('btn-clear-cache-reconnect').addEventListener('click', clearCacheAndReconnect);
document.getElementById('btn-month-prev').addEventListener('click',()=>changeMonth(-1));
document.getElementById('btn-month-next').addEventListener('click',()=>changeMonth(+1));

// Swipe gauche/droite pour changer de mois
(function() {
  let startX = 0, startY = 0;
  const app = document.getElementById('app');
  app.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  app.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    // Ignorer si c'est un scroll vertical ou un mouvement trop court
    if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 60) return;
    // Ignorer si on swipe sur un modal ouvert
    if (document.getElementById('modal').classList.contains('open')) return;
    if (document.getElementById('modal-settings').classList.contains('open')) return;
    if (dx < 0) changeMonth(+1); // swipe gauche → mois suivant
    else changeMonth(-1);        // swipe droit → mois précédent
  }, { passive: true });
})();
document.getElementById('modal-settings').addEventListener('click',e=>{if(e.target===document.getElementById('modal-settings'))closeSettings();});
document.getElementById('btn-submit').addEventListener('click',submitDepense);
document.getElementById('modal').addEventListener('click',e=>{if(e.target===document.getElementById('modal'))closeModal();});

['fab-dashboard','fab-tx','fab-stats','fab-annuel'].forEach(id=>{
  document.getElementById(id).addEventListener('click',openModal);
});

document.querySelectorAll('.nav-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    btn.classList.add('active');
    const screen=btn.dataset.screen;
    document.getElementById('screen-'+screen).classList.add('active');
    if(screen==='annuel') loadAnnuel();
  });
});

document.querySelectorAll('.compte-tab').forEach(tab => {

  tab.addEventListener('click', () => {

    const val = tab.dataset.compte;

    // 🔐 sécurité utilisateur
    if (USER_MODE === 'ELODIE' && (val === 'Compte Perso' || val === 'Épargne')) {
      showToast("Accès non autorisé");
      return;
    }

    document.querySelectorAll('.compte-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    currentCompteFilter = val;

    const mois = getViewMonthName();
    if (sheetData[mois]) renderTransactions(sheetData[mois]);

  });

});

document.querySelectorAll('#chart-tabs .chart-tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.chart-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active'); currentChartCompte=tab.dataset.compte;
    renderChart(getViewMonthName());
  });
});

document.querySelectorAll('.chips').forEach(group=>{
  group.addEventListener('click',e=>{
    const chip=e.target.closest('.chip'); if(!chip) return;
    group.querySelectorAll('.chip').forEach(c=>c.classList.remove('selected'));
    chip.classList.add('selected');

    if (group.id === 'chips-compte') {
      updateTypeChoicesForCompte();
    }
  });
});

// ============================================================
// AUTO CATEGORIE TRIGGER (SAFE)
// ============================================================

const inputLib = document.getElementById('input-libelle');

if (inputLib) {
  inputLib.addEventListener('input', (e) => {

    const cat = autoCategorieSmart(e.target.value);

    if (!cat) return; // si inconnu → ne rien faire

    document.querySelectorAll('#chips-cat .chip').forEach(chip => {
      chip.classList.toggle('selected', chip.dataset.val === cat);
    });

  });
}
// Détection offline/online
window.addEventListener('online',()=>{ showToast('✅ Connexion rétablie'); sheetData={}; loadMonth(getViewMonthName()); });
window.addEventListener('offline',()=>{ showToast('📡 Hors-ligne — données en cache',3000); });

function applyUserTabs() {

  document.querySelectorAll('.compte-tab').forEach(tab => {

    const val = tab.dataset.compte;

    if (USER_MODE === 'TOI') {

      // cacher Perso Elodie
      if (val === 'Compte Perso Elodie') {
        tab.style.display = 'none';
      } else {
        tab.style.display = '';
      }

    }

    if (USER_MODE === 'ELODIE') {

      // cacher TON perso + épargne
      if (val === 'Compte Perso' || val === 'Épargne') {
        tab.style.display = 'none';
      } else {
        tab.style.display = '';
      }

    }

  });

}

// ============================================================
// INIT
// ============================================================
registerSW();
updateAppVersionDisplay();
checkAuth();
