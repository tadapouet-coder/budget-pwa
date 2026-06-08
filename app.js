// ============================================================
// CONFIG
// ============================================================
const CLIENT_ID = '917136650964-63auvuts9dg4hbtqr2o7pa1171pmmrr2.apps.googleusercontent.com';
const SPREADSHEET_ID = '1mGEG698AcF6HZX-FxbqDbpFCaX1PJmFH9I6UzbdQYpk';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Aout','Septembre','Octobre','Novembre','Décembre'];

const ZONES = {
  'Épargne':      { 'Revenu':{col:'A',startRow:13}, 'Dépense':{col:'A',startRow:22} },
  'Compte Perso': { 'Revenu':{col:'H',startRow:13}, 'Charge fixe':{col:'H',startRow:22}, 'Charge variable':{col:'H',startRow:36} },
  'Compte Joint': { 'Revenu':{col:'O',startRow:13}, 'Charge fixe':{col:'O',startRow:22}, 'Charge variable':{col:'O',startRow:39} }
};

// ============================================================
// STATE
// ============================================================
let accessToken = null;
let currentCompteFilter = 'joint';
let currentChartCompte = 'joint';
let sheetData = {};
let viewMonth = new Date().getMonth();
let chartInstance = null;

// ============================================================
// SETTINGS
// ============================================================
function getSettings() {
  return {
    name1: localStorage.getItem('s_name1') || 'Yoann',
    name2: localStorage.getItem('s_name2') || 'Élodie',
    email2: localStorage.getItem('s_email2') || '',
    seuil: parseInt(localStorage.getItem('s_seuil') || '80'),
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
// SERVICE WORKER
// ============================================================
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/budget-pwa/sw.js')
      .catch(()=>{});
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
  const hashStr = window.location.hash || '';
  if (hashStr.indexOf('access_token=') !== -1) {
    const hash = new URLSearchParams(hashStr.substring(1));
    const token = hash.get('access_token');
    if (token) {
      accessToken = token;
      history.replaceState(null, '', window.location.pathname);
      localStorage.setItem('gtoken', token);
      localStorage.setItem('gtoken_expiry', Date.now() + 3500 * 1000);
      showApp();
      return;
    }
  }

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
  showAuthScreen();
}

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  viewMonth = new Date().getMonth();
  updateMonthNav();
  loadMonth(MONTHS[viewMonth]);
}

// ============================================================
// HELPERS DATES
// ============================================================
function parseDate(d) {
  if (!d) return null;
  if (typeof d === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
    const p = d.split('/');
    return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
  }
  const dt = new Date(d);
  return isNaN(dt) ? null : dt;
}

// ============================================================
// INIT
// ============================================================
registerSW();
checkAuth();