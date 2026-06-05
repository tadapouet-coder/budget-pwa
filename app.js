// ============================================================
// CONFIG
// ============================================================
const CLIENT_ID = '917136650964-63auvuts9dg4hbtqr2o7pa1171pmmrr2.apps.googleusercontent.com';
const SPREADSHEET_ID = '1mGEG698AcF6HZX-FxbqDbpFCaX1PJmFH9I6UzbdQYpk';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Aout','Septembre','Octobre','Novembre','Décembre'];

const PREMIUM_DEFAULTS = { profile1Name:'Yoann', profile2Name:'Élodie', profile2Email:'', alertThreshold:80, compareMode:'previousMonth' };
let premiumSettings = loadPremiumSettings();

const ZONES = {
  'Épargne':      { 'Revenu': {col:'A',startRow:13}, 'Dépense': {col:'A',startRow:22} },
  'Compte Perso': { 'Revenu': {col:'H',startRow:13}, 'Charge fixe': {col:'H',startRow:22}, 'Charge variable': {col:'H',startRow:36} },
  'Compte Joint': { 'Revenu': {col:'O',startRow:13}, 'Charge fixe': {col:'O',startRow:22}, 'Charge variable': {col:'O',startRow:39} }
};

// ============================================================
// STATE
// ============================================================
let accessToken = null;
let currentCompteFilter = 'joint';
let sheetData = {};
let viewMonth = new Date().getMonth(); // index 0-11, mois consulté

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
  viewMonth = new Date().getMonth();
  loadMonth(MONTHS[viewMonth]);
}

// ============================================================
// API SHEETS
// ============================================================
async function sheetsGet(range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  if (!resp.ok) { if (resp.status===401) { logout(); return null; } throw new Error('Erreur lecture: '+resp.status); }
  return resp.json();
}

async function sheetsAppend(range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const resp = await fetch(url, {
    method:'POST', headers:{ Authorization:'Bearer '+accessToken, 'Content-Type':'application/json' },
    body: JSON.stringify({ values })
  });
  if (!resp.ok) { if (resp.status===401) { logout(); return null; } throw new Error('Erreur écriture: '+resp.status); }
  return resp.json();
}

// ============================================================
// NAVIGATION PAR MOIS
// ============================================================
function getViewMonthName() { return MONTHS[viewMonth]; }
function getCurrentMonthName() { return MONTHS[new Date().getMonth()]; }
function getNextMonthName() { return MONTHS[(new Date().getMonth()+1)%12]; }

function updateMonthNav() {
  const name = getViewMonthName();
  const isCurrentMonth = viewMonth === new Date().getMonth();
  document.getElementById('header-month').textContent = name;
  document.getElementById('btn-month-next').style.opacity = isCurrentMonth ? '0.3' : '1';
  document.getElementById('btn-month-next').style.pointerEvents = isCurrentMonth ? 'none' : 'auto';
  // Sync le select mois dans le modal
  document.getElementById('input-mois').value = name;
}

async function changeMonth(delta) {
  const newMonth = viewMonth + delta;
  if (newMonth < 0 || newMonth > new Date().getMonth()) return;
  viewMonth = newMonth;
  updateMonthNav();
  await loadMonth(getViewMonthName());
}

// ============================================================
// CHARGEMENT
// ============================================================
async function loadMonth(mois) {
  document.getElementById('header-sub').textContent = mois + ' · chargement...';
  try {
    await loadTransactions(mois);
    await loadSoldes(mois);
    updateProfilesUI();
    renderPremiumViews(mois);
    document.getElementById('header-sub').textContent = mois + (navigator.onLine ? ' · à jour' : ' · hors-ligne');
  } catch(e) {
    const cached = readMonthCache(mois);
    if (cached && cached.rows) {
      sheetData[mois] = cached.rows;
      renderTransactions(cached.rows);
      renderBudgetBars(cached.rows);
      renderStats(cached.rows);
      renderPremiumViews(mois);
      document.getElementById('header-sub').textContent = mois + ' · cache hors-ligne';
      showToast('📴 Données chargées depuis le cache');
      return;
    }
    document.getElementById('header-sub').textContent = 'Erreur';
    showToast('❌ ' + e.message);
  }
}

async function loadSoldes(mois) {
  const cellRanges = [mois+'!I5', mois+'!I6', mois+'!P5', mois+'!P6', mois+'!C5', mois+'!S5', mois+'!S6'];
  const rangeParams = cellRanges.map(r => 'ranges='+encodeURIComponent(r)).join('&');
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/'+SPREADSHEET_ID+'/values:batchGet?'+rangeParams+'&valueRenderOption=FORMATTED_VALUE';

  let persoEom=0, persoToday=0, jointEom=0, jointToday=0, epargne=0, repY=0, repE=0;
  try {
    const resp = await fetch(url, { headers: { Authorization: 'Bearer '+accessToken } });
    if (!resp.ok) throw new Error('Erreur lecture: '+resp.status);
    const json = await resp.json();
    const vrs = json.valueRanges || [];
    const pf = vr => {
      const raw = vr?.values?.[0]?.[0];
      if (!raw && raw!==0) return 0;
      if (typeof raw==='number') return raw;
      return parseFloat(String(raw).replace(/[\u00a0\u202f ]/g,'').replace(/€/g,'').replace(/,/g,'.').replace(/[^0-9.\-]/g,'')) || 0;
    };
    persoEom=pf(vrs[0]); persoToday=pf(vrs[1]);
    jointEom=pf(vrs[2]); jointToday=pf(vrs[3]);
    epargne=pf(vrs[4]); repY=pf(vrs[5]); repE=pf(vrs[6]);
  } catch(e) { showToast('Erreur soldes: '+e.message); return; }

  setVal('perso-today', persoToday);
  setVal('perso-eom',   persoEom);
  setVal('joint-today', jointToday);
  setVal('joint-eom',   jointEom);
  document.getElementById('epargne-val').textContent = fmt(epargne);

  const total = Math.abs(repY) + Math.abs(repE);
  if (total > 0) {
    const pctY = Math.round(Math.abs(repY)/total*100);
    document.getElementById('rep-y').textContent = fmt(repY);
    document.getElementById('rep-e').textContent = fmt(repE);
    document.getElementById('rep-bar-y').style.width = pctY+'%';
    document.getElementById('rep-bar-e').style.width = (100-pctY)+'%';
  }
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = fmt(val);
  el.className = 'solde-row-val '+(val>=0?'positive':'negative');
}

async function loadTransactions(mois) {
  const data = await sheetsGet(`${mois}!A13:T120`);
  if (!data || !data.values) return;
  sheetData[mois] = data.values;
  writeMonthCache(mois, data.values);
  renderTransactions(data.values);
  renderBudgetBars(data.values);
  renderStats(data.values);
  renderComparison(mois, data.values);
  renderBalanceChart(mois, data.values);
}

// ============================================================
// RENDER TRANSACTIONS
// ============================================================
function parseRow(row, offset) {
  return { date: row[offset]||null, lib: row[offset+1]||'', mnt: parseFloat(row[offset+2])||0, cat: row[offset+3]||'' };
}

function sortByDate(a, b) {
  if (!a.date) return 1; if (!b.date) return -1;
  const da = parseDate(a.date), db = parseDate(b.date);
  if (!da) return 1; if (!db) return -1;
  return db - da;
}

function renderTransactions(rows) {
  const offsets = { joint:14, perso:7, epargne:0 };
  const offset = offsets[currentCompteFilter];
  const container = document.getElementById('tx-list');
  const items = [];
  rows.forEach(row => { const r=parseRow(row,offset); if(r.lib && r.mnt) items.push(r); });
  if (!items.length) { container.innerHTML='<div class="budget-loading">Aucune opération</div>'; return; }
  items.sort(sortByDate);
  container.innerHTML = items.map(r => {
    const isIncome = r.mnt > 0;
    const dateStr = r.date ? fmtDate(r.date) : '';
    return `<div class="tx-item">
      <div class="tx-icon ${getIconClass(r.cat,isIncome)}"><i class="ti ${getIcon(r.cat,isIncome)}"></i></div>
      <div class="tx-info">
        <div class="tx-label">${escHtml(r.lib)}</div>
        <div class="tx-meta">${dateStr}${r.cat?' · '+r.cat:''}</div>
      </div>
      <div class="tx-amount ${isIncome?'income':''}">${isIncome?'+':'−'}${fmt(Math.abs(r.mnt))}</div>
    </div>`;
  }).join('');
}

// ============================================================
// BUDGET BARS
// ============================================================
function renderBudgetBars(rows) {
  const container = document.getElementById('budget-bars');
  if (!rows[23]) { container.innerHTML='<div class="budget-loading">Aucune donnée budget</div>'; return; }

  const budgetData = [
    { label:'Courses',   restant: parseFloat(rows[23]?.[16])||0, total: parseFloat(rows[23]?.[19])||500 },
    { label:'Carburant', restant: parseFloat(rows[24]?.[16])||0, total: parseFloat(rows[24]?.[19])||240 },
    { label:'Autre',     restant: parseFloat(rows[25]?.[16])||0, total: parseFloat(rows[25]?.[19])||400 }
  ];

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  const dayOfMonth = now.getDate();
  const pctMois = Math.round(dayOfMonth/daysInMonth*100);

  // Résumé fin de mois si on est dans les 5 derniers jours
  const isEndOfMonth = dayOfMonth >= daysInMonth - 4;

  container.innerHTML = `
    <div class="budget-header-row">
      <span class="budget-header-label">📅 Avancement du mois</span>
      <span class="budget-header-value">${dayOfMonth} / ${daysInMonth} jours · <b>${pctMois}%</b></span>
    </div>` +
  budgetData.map(b => {
    const depense = b.total - b.restant;
    const pct = Math.min(100, b.total>0 ? Math.round(depense/b.total*100) : 0);
    // Couleur intelligente : rouge si dépenses > avancement du mois + marge 10%
    const surConsommation = pct - pctMois;
    const cls = surConsommation > 10 ? 'bar-over' : surConsommation > 0 ? 'bar-warn' : 'bar-ok';
    const resteColor = surConsommation > 10 ? 'var(--red)' : surConsommation > 0 ? 'var(--orange)' : 'var(--green-dark)';
    return `<div class="budget-row">
      <div class="budget-row-top">
        <span class="budget-cat">${b.label}</span>
        <span class="budget-amounts"><b>${fmt(depense)}</b> / ${b.total} €&nbsp;<span style="color:${resteColor}">reste ${fmt(b.restant)}</span></span>
      </div>
      <div class="bar-bg" style="position:relative">
        <div class="bar-fill ${cls}" style="width:${pct}%"></div>
        <div class="month-marker" style="left:${pctMois}%"></div>
      </div>
    </div>`;
  }).join('') +
  (isEndOfMonth ? `<div class="eom-summary">
    <i class="ti ti-calendar-check"></i> Fin de mois — Total dépensé : <b>${fmt(budgetData.reduce((s,b)=>s+(b.total-b.restant),0))}</b>
  </div>` : '');
  checkBudgetAlerts(budgetData);
}

// ============================================================
// STATS
// ============================================================
function renderStats(rows) {
  const cats = {};
  rows.forEach((row,i) => {
    if (i < 27) return;
    const mnt = parseFloat(row[16])||0, cat = row[17]||'Autre';
    if (mnt>0 && row[14]) cats[cat]=(cats[cat]||0)+mnt;
  });
  let chargesFixes = 0;
  rows.forEach((row,i) => {
    if (i<9||i>21) return;
    const mnt=parseFloat(row[16])||0; if(mnt>0) chargesFixes+=mnt;
  });
  const container = document.getElementById('stats-bars');
  const max = Math.max(...Object.values(cats), chargesFixes, 1);
  let html = '';
  if (chargesFixes>0) {
    const pct=Math.round(chargesFixes/max*100);
    html+=`<div class="budget-row"><div class="budget-row-top"><span class="budget-cat">Charges fixes</span><span class="budget-amounts"><b>${fmt(chargesFixes)}</b></span></div><div class="bar-bg"><div class="bar-fill bar-ok" style="width:${pct}%"></div></div></div>`;
  }
  Object.entries(cats).sort((a,b)=>b[1]-a[1]).forEach(([cat,val]) => {
    const pct=Math.round(val/max*100);
    html+=`<div class="budget-row"><div class="budget-row-top"><span class="budget-cat">${cat}</span><span class="budget-amounts"><b>${fmt(val)}</b></span></div><div class="bar-bg"><div class="bar-fill bar-ok" style="width:${pct}%"></div></div></div>`;
  });
  container.innerHTML = html||'<div class="budget-loading">Aucune donnée</div>';
}

// ============================================================
// BUDGETS SETTINGS (T36/T37/T38)
// ============================================================
async function getBudgetsFromSheet(mois) {
  const cells=[`${mois}!T36`,`${mois}!T37`,`${mois}!T38`];
  const params=cells.map(r=>`ranges=${encodeURIComponent(r)}`).join('&');
  try {
    const resp=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet?${params}&valueRenderOption=UNFORMATTED_VALUE`,{headers:{Authorization:'Bearer '+accessToken}});
    if (!resp.ok) return {courses:500,carburant:240,autre:400};
    const json=await resp.json(); const vrs=json.valueRanges||[];
    return { courses:parseFloat(vrs[0]?.values?.[0]?.[0])||500, carburant:parseFloat(vrs[1]?.values?.[0]?.[0])||240, autre:parseFloat(vrs[2]?.values?.[0]?.[0])||400 };
  } catch(e) { return {courses:500,carburant:240,autre:400}; }
}

async function saveBudgetsToSheet(mois, courses, carburant, autre) {
  const resp=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate`,{
    method:'POST', headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},
    body:JSON.stringify({valueInputOption:'RAW',data:[
      {range:`${mois}!T36`,values:[[courses]]},{range:`${mois}!T37`,values:[[carburant]]},{range:`${mois}!T38`,values:[[autre]]}
    ]})
  });
  if (!resp.ok) throw new Error('Erreur écriture budgets: '+resp.status);
}

async function openSettings() {
  fillPremiumSettingsForm();
  const mois = getViewMonthName();
  const b = await getBudgetsFromSheet(mois);
  document.getElementById('budget-courses').value   = b.courses;
  document.getElementById('budget-carburant').value = b.carburant;
  document.getElementById('budget-autre').value     = b.autre;
  const nextName = getNextMonthName();
  document.getElementById('btn-prepare-label').textContent = 'Préparer '+nextName+' 2026';
  const exists = await sheetExists(nextName);
  const btn = document.getElementById('btn-prepare-month');
  const info = document.getElementById('next-month-info');
  btn.disabled = exists; btn.style.opacity = exists?'0.4':'1';
  info.textContent = exists ? "L'onglet "+nextName+" existe déjà." : "Créer l'onglet "+nextName+" à partir de "+mois+".";
  document.getElementById('modal-settings').classList.add('open');
}

function closeSettings() { document.getElementById('modal-settings').classList.remove('open'); }

async function saveSettings() {
  readPremiumSettingsForm();
  const courses=parseFloat(document.getElementById('budget-courses').value)||500;
  const carburant=parseFloat(document.getElementById('budget-carburant').value)||240;
  const autre=parseFloat(document.getElementById('budget-autre').value)||400;
  const btn=document.getElementById('btn-save-settings');
  btn.disabled=true;
  try {
    await saveBudgetsToSheet(getViewMonthName(), courses, carburant, autre);
    closeSettings(); showToast('✅ Budgets enregistrés !');
    sheetData={}; await loadMonth(getViewMonthName());
  } catch(e) { showToast('❌ '+e.message); } finally { btn.disabled=false; }
}

// ============================================================
// PRÉPARER MOIS SUIVANT
// ============================================================
async function sheetExists(name) {
  try {
    const resp=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties.title`,{headers:{Authorization:'Bearer '+accessToken}});
    if (!resp.ok) return false;
    const json=await resp.json();
    return (json.sheets||[]).some(s=>s.properties.title===name);
  } catch(e) { return false; }
}

function addMonths(dateStr, n) {
  if (!dateStr||typeof dateStr!=='string') return dateStr;
  const parts=dateStr.split('/'); if(parts.length!==3) return dateStr;
  const [d,m,y]=parts.map(Number);
  const dt=new Date(y, m-1+n, d);
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
}

async function prepareNextMonth() {
  const moisActuel=getCurrentMonthName(), moisSuivant=getNextMonthName();
  const btn=document.getElementById('btn-prepare-month');
  const origLabel=document.getElementById('btn-prepare-label').textContent;
  btn.disabled=true; document.getElementById('btn-prepare-label').textContent='Préparation...';
  try {
    const metaResp=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`,{headers:{Authorization:'Bearer '+accessToken}});
    const meta=await metaResp.json();
    const cur=meta.sheets.find(s=>s.properties.title===moisActuel);
    if (!cur) throw new Error('Onglet '+moisActuel+' introuvable');

    // Dupliquer l'onglet
    const dupResp=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,{
      method:'POST', headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},
      body:JSON.stringify({requests:[{duplicateSheet:{sourceSheetId:cur.properties.sheetId,insertSheetIndex:cur.properties.index+1,newSheetName:moisSuivant}}]})
    });
    if (!dupResp.ok) throw new Error('Erreur copie: '+dupResp.status);

    // Lire soldes fin de mois
    const soldeResp=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet?ranges=${encodeURIComponent(moisActuel+'!C5')}&ranges=${encodeURIComponent(moisActuel+'!I5')}&ranges=${encodeURIComponent(moisActuel+'!P5')}&valueRenderOption=UNFORMATTED_VALUE`,{headers:{Authorization:'Bearer '+accessToken}});
    const soldeJson=await soldeResp.json(); const vrs=soldeJson.valueRanges||[];
    const soldeEpargne=parseFloat(vrs[0]?.values?.[0]?.[0])||0;
    const soldePerso=parseFloat(vrs[1]?.values?.[0]?.[0])||0;
    const soldeJoint=parseFloat(vrs[2]?.values?.[0]?.[0])||0;

    // Lire charges fixes pour décaler dates
    const fixeResp=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet?ranges=${encodeURIComponent(moisSuivant+'!H22:J36')}&ranges=${encodeURIComponent(moisSuivant+'!O22:Q33')}&valueRenderOption=FORMATTED_VALUE`,{headers:{Authorization:'Bearer '+accessToken}});
    const fixeJson=await fixeResp.json();
    const newPerso=(fixeJson.valueRanges?.[0]?.values||[]).map(r=>r?.[0]?[addMonths(r[0],1),r[1]||'',r[2]||'']:r);
    const newJoint=(fixeJson.valueRanges?.[1]?.values||[]).map(r=>r?.[0]?[addMonths(r[0],1),r[1]||'',r[2]||'']:r);

    // Écrire les mises à jour
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate`,{
      method:'POST', headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},
      body:JSON.stringify({valueInputOption:'USER_ENTERED',data:[
        {range:`${moisSuivant}!B1`,values:[[moisSuivant]]},
        {range:`${moisSuivant}!C13`,values:[[soldeEpargne]]},
        {range:`${moisSuivant}!J13`,values:[[soldePerso]]},
        {range:`${moisSuivant}!Q13`,values:[[soldeJoint]]},
        {range:`${moisSuivant}!J14:J19`,values:[[''],[''],[''],[''],[''],['`']]},
        {range:`${moisSuivant}!Q14:Q19`,values:[[''],[''],[''],[''],[''],['`']]},
        ...(newPerso.length?[{range:`${moisSuivant}!H22:J36`,values:newPerso}]:[]),
        ...(newJoint.length?[{range:`${moisSuivant}!O22:Q33`,values:newJoint}]:[]),
      ]})
    });

    // Effacer charges variables
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchClear`,{
      method:'POST', headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},
      body:JSON.stringify({ranges:[`${moisSuivant}!H36:K300`,`${moisSuivant}!O39:R300`]})
    });

    closeSettings(); showToast('✅ Onglet '+moisSuivant+' créé !', 3000);
  } catch(e) {
    showToast('❌ '+e.message, 4000); btn.disabled=false;
    document.getElementById('btn-prepare-label').textContent=origLabel;
  }
}

// ============================================================
// AJOUT DÉPENSE
// ============================================================
async function submitDepense() {
  const compte=getChipVal('chips-compte'), type=getChipVal('chips-type');
  const montant=parseFloat(document.getElementById('input-montant').value);
  const libelle=document.getElementById('input-libelle').value.trim();
  const date=document.getElementById('input-date').value;
  const categorie=getChipVal('chips-cat');
  const mois=document.getElementById('input-mois').value;
  const errEl=document.getElementById('submit-error');

  if (!montant||isNaN(montant)) { errEl.textContent='Montant invalide'; errEl.classList.remove('hidden'); return; }
  if (!libelle) { errEl.textContent='Libellé requis'; errEl.classList.remove('hidden'); return; }
  errEl.classList.add('hidden');
  if (!ZONES[compte]||!ZONES[compte][type]) { errEl.textContent=`Combinaison "${compte}" / "${type}" non valide`; errEl.classList.remove('hidden'); return; }

  const zone=ZONES[compte][type];
  const [y,m,d]=date.split('-');
  const dateStr=`${d}/${m}/${y}`;
  const row=compte==='Épargne'?[dateStr,libelle,montant]:[dateStr,libelle,montant,categorie];

  const btn=document.getElementById('btn-submit');
  btn.disabled=true; document.getElementById('btn-submit-label').textContent='Enregistrement...';
  try {
    await sheetsAppend(`${mois}!${zone.col}${zone.startRow}`,[row]);
    // Vibration haptique
    if (navigator.vibrate) navigator.vibrate(50);
    closeModal(); showToast('✅ Enregistré !');
    sheetData={}; await loadMonth(mois);
  } catch(e) { errEl.textContent='Erreur: '+e.message; errEl.classList.remove('hidden');
  } finally { btn.disabled=false; document.getElementById('btn-submit-label').textContent='Enregistrer'; }
}

// ============================================================
// HELPERS
// ============================================================
function fmt(val) {
  if (val===null||val===undefined||isNaN(val)) return '—';
  const n=Math.abs(val);
  // Arrondi à 2 décimales, mais sans afficher les centimes si entier
  const str=n.toLocaleString('fr-FR',{minimumFractionDigits:0,maximumFractionDigits:2});
  return (val<0?'−':'')+str+' €';
}

function parseDate(d) {
  if (!d) return null;
  if (typeof d==='string'&&d.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
    const [day,month,year]=d.split('/');
    return new Date(parseInt(year),parseInt(month)-1,parseInt(day));
  }
  if (typeof d==='string'&&d.match(/^\d{4}-\d{2}-\d{2}/)) return new Date(d);
  return new Date(d);
}

function fmtDate(d) {
  if (!d) return '';
  try {
    const date=parseDate(d);
    if (!date||isNaN(date)) return d;
    return date.toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
  } catch { return d; }
}

function escHtml(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function getChipVal(gid) { const s=document.querySelector(`#${gid} .chip.selected`); return s?s.dataset.val:''; }

function getIconClass(cat,isIncome) {
  if (isIncome) return 'income';
  const c=(cat||'').toLowerCase();
  if (c.includes('cours')||c.includes('alim')||c.includes('leclerc')||c.includes('carrefour')||c.includes('primeur')) return 'courses';
  if (c.includes('carbu')||c.includes('transport')||c.includes('essence')) return 'transport';
  if (c.includes('santé')||c.includes('médec')||c.includes('psy')||c.includes('pharmac')) return 'sante';
  if (c.includes('loisir')||c.includes('vacance')) return 'loisir';
  if (c.includes('fix')||c.includes('pret')||c.includes('crèche')||c.includes('loyer')) return 'fix';
  if (c.includes('cadeau')) return 'loisir';
  return 'autre';
}

function getIcon(cat,isIncome) {
  if (isIncome) return 'ti-arrow-down-circle';
  const c=(cat||'').toLowerCase();
  if (c.includes('cours')||c.includes('alim')) return 'ti-shopping-cart';
  if (c.includes('carbu')||c.includes('essence')) return 'ti-gas-station';
  if (c.includes('santé')||c.includes('médec')) return 'ti-heart-rate-monitor';
  if (c.includes('loisir')) return 'ti-confetti';
  if (c.includes('pret')||c.includes('prêt')) return 'ti-building-bank';
  if (c.includes('crèche')) return 'ti-school';
  if (c.includes('cadeau')) return 'ti-gift';
  if (c.includes('animal')||c.includes('vét')) return 'ti-paw';
  return 'ti-receipt';
}

function showToast(msg, duration=2500) {
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.remove('hidden');
  setTimeout(()=>t.classList.add('hidden'), duration);
}

function openModal() {
  document.getElementById('input-date').value=new Date().toISOString().split('T')[0];
  document.getElementById('input-mois').value=getViewMonthName();
  document.getElementById('modal').classList.add('open');
  document.getElementById('submit-error').classList.add('hidden');
  document.getElementById('input-montant').value='';
  document.getElementById('input-libelle').value='';
}

function closeModal() { document.getElementById('modal').classList.remove('open'); }


// ============================================================
// PREMIUM: PROFILS, OFFLINE, NOTIFICATIONS, GRAPHIQUES, ANNUEL
// ============================================================
function loadPremiumSettings() {
  try { return { ...PREMIUM_DEFAULTS, ...(JSON.parse(localStorage.getItem('budget_premium_settings') || '{}')) }; }
  catch { return { ...PREMIUM_DEFAULTS }; }
}
function savePremiumSettingsLocal() { localStorage.setItem('budget_premium_settings', JSON.stringify(premiumSettings)); }
function getInitials(name, fallback) { const clean=(name||fallback||'').trim(); return clean.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase() || fallback; }
function updateProfilesUI() {
  const p1=premiumSettings.profile1Name||'Profil 1', p2=premiumSettings.profile2Name||'Profil 2';
  const names=document.querySelectorAll('.rep-name'); if(names[0]) names[0].textContent=p1; if(names[1]) names[1].textContent=p2;
  const avatars=document.querySelectorAll('.rep-avatar'); if(avatars[0]) avatars[0].textContent=getInitials(p1,'P1'); if(avatars[1]) avatars[1].textContent=getInitials(p2,'P2');
}
function fillPremiumSettingsForm() {
  const set=(id,val)=>{const el=document.getElementById(id); if(el) el.value=val;};
  set('profile-1-name', premiumSettings.profile1Name); set('profile-2-name', premiumSettings.profile2Name); set('profile-2-email', premiumSettings.profile2Email);
  set('alert-threshold', premiumSettings.alertThreshold); set('compare-mode', premiumSettings.compareMode);
}
function readPremiumSettingsForm() {
  const val=id=>document.getElementById(id)?.value?.trim();
  premiumSettings={...premiumSettings, profile1Name:val('profile-1-name')||'Yoann', profile2Name:val('profile-2-name')||'Élodie', profile2Email:val('profile-2-email')||'', alertThreshold:Math.max(1,Math.min(150,parseFloat(val('alert-threshold'))||80)), compareMode:val('compare-mode')||'previousMonth'};
  savePremiumSettingsLocal(); updateProfilesUI();
}
function writeMonthCache(mois, rows) { try { localStorage.setItem('budget_cache_'+mois, JSON.stringify({rows, savedAt:Date.now()})); } catch {} }
function readMonthCache(mois) { try { return JSON.parse(localStorage.getItem('budget_cache_'+mois)||'null'); } catch { return null; } }
function renderPremiumViews(mois) { const rows=sheetData[mois]; if(!rows) return; renderComparison(mois, rows); renderBalanceChart(mois, rows); }
function getDayOfMonthForView(mois) { const now=new Date(); return MONTHS[now.getMonth()]===mois ? now.getDate() : new Date(now.getFullYear(), MONTHS.indexOf(mois)+1, 0).getDate(); }
function sumJointVariableUntil(rows, dayLimit) {
  const out={total:0,cats:{}};
  (rows||[]).forEach((row,i)=>{ if(i<26) return; const d=parseDate(row[14]); const mnt=parseFloat(row[16])||0; const cat=row[17]||'Autre'; if(d&&!isNaN(d)&&d.getDate()<=dayLimit&&mnt>0){ out.total+=mnt; out.cats[cat]=(out.cats[cat]||0)+mnt; }});
  return out;
}
function getComparisonMonthName(mois) { const idx=MONTHS.indexOf(mois); return premiumSettings.compareMode==='previousYear' ? mois : MONTHS[Math.max(0,idx-1)]; }
async function ensureMonthLoaded(mois) {
  if(sheetData[mois]) return sheetData[mois]; const cached=readMonthCache(mois); if(cached?.rows){ sheetData[mois]=cached.rows; return cached.rows; }
  if(!accessToken) return null; const data=await sheetsGet(`${mois}!A13:T120`); if(data?.values){ sheetData[mois]=data.values; writeMonthCache(mois,data.values); return data.values; } return null;
}
async function renderComparison(mois, rows) {
  const container=document.getElementById('compare-panel'); if(!container) return;
  const compareMonth=getComparisonMonthName(mois), day=getDayOfMonthForView(mois), current=sumJointVariableUntil(rows,day);
  let previousRows=null;
  if(premiumSettings.compareMode==='previousYear') previousRows=readMonthCache(mois+'_N-1')?.rows || null;
  else if(compareMonth!==mois) previousRows=await ensureMonthLoaded(compareMonth);
  if(!previousRows){ container.innerHTML=`<div class="budget-loading">Comparaison indisponible : ${premiumSettings.compareMode==='previousYear'?'prévoir les données N-1':'mois précédent non chargé'}</div>`; return; }
  const previous=sumJointVariableUntil(previousRows,day), diff=current.total-previous.total, pct=previous.total?Math.round(diff/previous.total*100):0, cls=diff<=0?'status-ok':pct<=10?'status-warn':'status-over';
  container.innerHTML=`<div class="compare-card"><div class="compare-main"><div class="compare-label">Total au jour ${day}</div><div class="compare-value ${diff<=0?'positive':'negative'}">${diff>=0?'+':''}${fmt(diff)}</div></div><div class="compare-sub">Ce mois : <b>${fmt(current.total)}</b> · Référence (${premiumSettings.compareMode==='previousYear'?'même mois N-1':compareMonth}) : <b>${fmt(previous.total)}</b> · <span class="status-pill ${cls}">${pct>=0?'+':''}${pct}%</span></div></div>`;
}
function buildDailySeries(rows, mois) {
  const days=new Date(new Date().getFullYear(), MONTHS.indexOf(mois)+1, 0).getDate(); const series=Array.from({length:days},(_,i)=>({day:i+1,val:0}));
  (rows||[]).forEach((row,i)=>{ if(i<26) return; const d=parseDate(row[14]); const mnt=parseFloat(row[16])||0; if(d&&!isNaN(d)&&mnt>0&&d.getDate()>=1&&d.getDate()<=days) series[d.getDate()-1].val+=mnt; });
  let cum=0; return series.map(p=>({day:p.day,val:(cum+=p.val)}));
}
function renderLineChart(containerId, series, options={}) {
  const el=document.getElementById(containerId); if(!el) return; if(!series?.length || Math.max(...series.map(p=>p.val))<=0){ el.innerHTML='<div class="chart-empty">Aucune donnée graphique</div>'; return; }
  const w=360,h=180,pad=26,max=Math.max(...series.map(p=>p.val),1),x=i=>pad+(series.length===1?0:i*(w-pad*2)/(series.length-1)),y=v=>h-pad-(v/max)*(h-pad*2),points=series.map((p,i)=>`${x(i).toFixed(1)},${y(p.val).toFixed(1)}`).join(' ');
  el.innerHTML=`<svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escHtml(options.title||'Graphique')}"><line class="chart-axis" x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}"></line><line class="chart-axis" x1="${pad}" y1="${pad}" x2="${pad}" y2="${h-pad}"></line><polyline class="chart-line" points="${points}"></polyline><text class="chart-label" x="${pad}" y="14">${escHtml(options.title||'')}</text><text class="chart-label" x="${pad}" y="${h-6}">J1</text><text class="chart-label" x="${w-pad-28}" y="${h-6}">J${series.length}</text><text class="chart-label" x="${w-pad-70}" y="14">Max ${fmt(max)}</text></svg>`;
}
function renderBalanceChart(mois, rows) { renderLineChart('balance-chart', buildDailySeries(rows, mois), {title:'Cumul dépenses variables joint'}); }
async function renderAnnualSummary() {
  const kpis=document.getElementById('annual-kpis'), detail=document.getElementById('annual-detail'); if(!kpis||!detail) return; kpis.innerHTML=detail.innerHTML='<div class="budget-loading">Chargement...</div>';
  const currentIdx=new Date().getMonth(), monthly=[]; for(let i=0;i<=currentIdx;i++){ const m=MONTHS[i]; let rows=null; try{rows=await ensureMonthLoaded(m);}catch{} monthly.push({mois:m,total:rows?sumJointVariableUntil(rows,31).total:0}); }
  const total=monthly.reduce((s,m)=>s+m.total,0), avg=monthly.length?total/monthly.length:0, best=monthly.reduce((a,b)=>b.total<a.total?b:a,monthly[0]), worst=monthly.reduce((a,b)=>b.total>a.total?b:a,monthly[0]);
  kpis.innerHTML=`<div class="kpi-card"><div class="kpi-label">Total annuel</div><div class="kpi-value">${fmt(total)}</div><div class="kpi-sub">Charges variables joint</div></div><div class="kpi-card"><div class="kpi-label">Moyenne/mois</div><div class="kpi-value">${fmt(avg)}</div><div class="kpi-sub">Depuis janvier</div></div><div class="kpi-card"><div class="kpi-label">Mois le plus bas</div><div class="kpi-value">${best.mois}</div><div class="kpi-sub">${fmt(best.total)}</div></div><div class="kpi-card"><div class="kpi-label">Mois le plus haut</div><div class="kpi-value">${worst.mois}</div><div class="kpi-sub">${fmt(worst.total)}</div></div>`;
  renderLineChart('annual-chart', monthly.map((m,i)=>({day:i+1,val:m.total})), {title:'Dépenses par mois'});
  const max=Math.max(...monthly.map(m=>m.total),1); detail.innerHTML=monthly.map(m=>`<div class="budget-row"><div class="budget-row-top"><span class="budget-cat">${m.mois}</span><span class="budget-amounts"><b>${fmt(m.total)}</b></span></div><div class="bar-bg"><div class="bar-fill bar-ok" style="width:${Math.round(m.total/max*100)}%"></div></div></div>`).join('');
}
async function enableNotifications() { if(!('Notification' in window)){showToast('Notifications non supportées'); return;} const perm=await Notification.requestPermission(); showToast(perm==='granted'?'✅ Notifications activées':'Notifications refusées'); }
function checkBudgetAlerts(budgetData) { if(!('Notification' in window)||Notification.permission!=='granted') return; const threshold=premiumSettings.alertThreshold||80, mois=getViewMonthName(); budgetData.forEach(b=>{ const spent=b.total-b.restant, pct=b.total>0?Math.round(spent/b.total*100):0, key=`budget_alert_${mois}_${b.label}_${threshold}`; if(pct>=threshold&&!localStorage.getItem(key)){ new Notification(`Budget ${b.label} à ${pct}%`, {body:`Dépensé ${fmt(spent)} sur ${fmt(b.total)}. Reste ${fmt(b.restant)}.`}); localStorage.setItem(key,'1'); }}); }
function registerServiceWorker() { if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{}); }

// ============================================================
// EVENTS
// ============================================================
document.getElementById('btn-login').addEventListener('click', login);
document.getElementById('btn-logout').addEventListener('click', logout);
document.getElementById('btn-refresh').addEventListener('click', ()=>{ sheetData={}; loadMonth(getViewMonthName()); });
document.getElementById('btn-settings').addEventListener('click', openSettings);
document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
document.getElementById('btn-enable-notifications')?.addEventListener('click', enableNotifications);
document.getElementById('btn-prepare-month').addEventListener('click', prepareNextMonth);
document.getElementById('btn-month-prev').addEventListener('click', ()=>changeMonth(-1));
document.getElementById('btn-month-next').addEventListener('click', ()=>changeMonth(+1));
document.getElementById('modal-settings').addEventListener('click', e=>{ if(e.target===document.getElementById('modal-settings')) closeSettings(); });
document.getElementById('btn-submit').addEventListener('click', submitDepense);
document.getElementById('modal').addEventListener('click', e=>{ if(e.target===document.getElementById('modal')) closeModal(); });

['fab-dashboard','fab-tx','fab-stats'].forEach(id=>{
  document.getElementById(id).addEventListener('click', openModal);
});

document.querySelectorAll('.nav-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('screen-'+btn.dataset.screen).classList.add('active');
    if (btn.dataset.screen === 'annual') renderAnnualSummary();
  });
});

document.querySelectorAll('.compte-tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.compte-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    currentCompteFilter=tab.dataset.compte;
    const mois=getViewMonthName();
    if (sheetData[mois]) renderTransactions(sheetData[mois]);
  });
});

document.querySelectorAll('.chips').forEach(group=>{
  group.addEventListener('click', e=>{
    const chip=e.target.closest('.chip'); if(!chip) return;
    group.querySelectorAll('.chip').forEach(c=>c.classList.remove('selected'));
    chip.classList.add('selected');
  });
});

// ============================================================
// INIT
// ============================================================
registerServiceWorker();
updateProfilesUI();
window.addEventListener('online', () => showToast('✅ Connexion rétablie'));
window.addEventListener('offline', () => showToast('📴 Mode hors-ligne'));
checkAuth();
