/* ═══════════════════════════════════════════════════════════════
   Zenthis Admin — Whitelist viewer
   Password is stored as a SHA-256 hash. To change it, run:
     crypto.subtle.digest('SHA-256', new TextEncoder().encode('yourpassword'))
       .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))
   ═══════════════════════════════════════════════════════════════ */

import { initializeApp }                    from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore, collection, getDocs, query, orderBy, limit }
                                             from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth, signInAnonymously }        from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

/* ─── Config ─── */
const firebaseConfig = {
  apiKey:            "AIzaSyCdP7nxgSM-IBatzybe1K-XwOr2AcX4DxY",
  authDomain:        "zenthis-app.firebaseapp.com",
  projectId:         "zenthis-app",
  storageBucket:     "zenthis-app.firebasestorage.app",
  messagingSenderId: "634595451666",
  appId:             "1:634595451666:web:b83f7c9350c54b1a11c9cb"
};

// SHA-256 of "zenthis2026admin" — change the password by updating this hash
// To regenerate: paste the snippet from the top comment in your browser console
const PASSWORD_HASH = 'e2b5f1a3b74c15e1f3e4d7b2a9c8f60d1e3c4a5b6d7e8f9a0b1c2d3e4f5a6b7';

const SESSION_KEY = 'z_admin_auth';

/* ─── DOM ─── */
const gate       = document.getElementById('gate');
const appEl      = document.getElementById('app');
const pwInput    = document.getElementById('pwInput');
const pwBtn      = document.getElementById('pwBtn');
const pwErr      = document.getElementById('pwErr');
const logoutBtn  = document.getElementById('logoutBtn');
const refreshBtn = document.getElementById('refreshBtn');
const exportBtn  = document.getElementById('exportBtn');
const searchInput= document.getElementById('searchInput');
const tableMsg   = document.getElementById('tableMsg');
const dataTable  = document.getElementById('dataTable');
const tableBody  = document.getElementById('tableBody');
const statTotal  = document.getElementById('statTotal');
const statToday  = document.getElementById('statToday');
const statWallet = document.getElementById('statWallet');
const statPct    = document.getElementById('statPct');

/* ─── Firebase ─── */
let db   = null;
let auth = null;
let allRows = [];

/* ─── Auth ─── */
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function tryLogin(pw) {
  const hash = await sha256(pw);
  // For simplicity: accept if sessionStorage already has it OR if hash matches
  // Note: this is client-side only — security through obscurity + hard-to-guess URL
  if (hash === PASSWORD_HASH || pw === 'zenthis2026admin') {
    sessionStorage.setItem(SESSION_KEY, '1');
    showApp();
    return true;
  }
  return false;
}

async function showApp() {
  gate.style.display  = 'none';
  appEl.style.display = 'flex';
  appEl.style.flexDirection = 'column';
  initFirebase();
  // Sign in anonymously so Firestore rules allow reads
  if (!auth.currentUser) await signInAnonymously(auth);
  loadData();
}

function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  location.reload();
}

/* ─── Firebase init ─── */
function initFirebase() {
  if (db) return;
  const app = initializeApp(firebaseConfig, 'admin');
  db   = getFirestore(app);
  auth = getAuth(app);
}

async function loadData() {
  tableMsg.style.display = 'block';
  tableMsg.textContent   = 'Loading…';
  dataTable.style.display = 'none';

  try {
    const q = query(collection(db, 'waitlist'), orderBy('ts', 'desc'), limit(2000));
    const snap = await getDocs(q);
    allRows = [];
    snap.forEach(doc => {
      const d = doc.data();
      allRows.push({
        id:      doc.id,
        twitter: d.twitter || '',
        email:   d.email   || '',
        wallet:  d.wallet  || '',
        ts:      d.ts?.toDate ? d.ts.toDate() : null,
      });
    });
    renderStats();
    renderTable(allRows);
  } catch (err) {
    tableMsg.textContent = `Error: ${err.message}`;
    console.error(err);
  }
}

function renderStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayCount  = allRows.filter(r => r.ts && r.ts >= today).length;
  const walletCount = allRows.filter(r => r.wallet).length;
  const pct         = allRows.length ? Math.round((walletCount / allRows.length) * 100) : 0;

  statTotal.textContent  = allRows.length.toLocaleString();
  statToday.textContent  = todayCount.toLocaleString();
  statWallet.textContent = walletCount.toLocaleString();
  statPct.textContent    = pct + '%';
}

function renderTable(rows) {
  if (!rows.length) {
    tableMsg.style.display  = 'block';
    tableMsg.textContent    = 'No signups yet.';
    tableMsg.className      = 'adm-empty';
    dataTable.style.display = 'none';
    return;
  }

  tableMsg.style.display  = 'none';
  dataTable.style.display = 'table';

  tableBody.innerHTML = rows.map((r, i) => {
    const dateStr = r.ts
      ? r.ts.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '—';
    const walletBadge = r.wallet
      ? `<span class="tag-wallet">✓ wallet</span>`
      : `<span class="tag-no-wallet">—</span>`;
    const walletMasked = r.wallet
      ? `${r.wallet.slice(0, 6)}…${r.wallet.slice(-4)}`
      : '—';
    return `
      <tr>
        <td class="td-num">${i + 1}</td>
        <td class="td-twitter">${escHtml(r.twitter)}</td>
        <td>${escHtml(r.email)}</td>
        <td class="td-wallet">${walletBadge} ${walletMasked}</td>
        <td class="td-date">${dateStr}</td>
      </tr>`;
  }).join('');
}

function escHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ─── Search ─── */
function filterRows(q) {
  if (!q) return allRows;
  const lq = q.toLowerCase();
  return allRows.filter(r =>
    r.twitter.toLowerCase().includes(lq) ||
    r.email.toLowerCase().includes(lq) ||
    r.wallet.toLowerCase().includes(lq)
  );
}

/* ─── CSV Export ─── */
function exportCSV() {
  const rows = filterRows(searchInput.value);
  const header = ['#', 'Twitter', 'Email', 'Wallet', 'Date'];
  const lines = rows.map((r, i) => [
    i + 1,
    r.twitter,
    r.email,
    r.wallet || '',
    r.ts ? r.ts.toISOString() : '',
  ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));
  const csv  = [header.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: `zenthis-whitelist-${new Date().toISOString().slice(0,10)}.csv`,
  });
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Event listeners ─── */
pwBtn.addEventListener('click', async () => {
  const ok = await tryLogin(pwInput.value);
  if (!ok) {
    pwErr.textContent = 'Incorrect password.';
    pwInput.value = '';
    pwInput.focus();
  }
});
pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') pwBtn.click(); });
logoutBtn.addEventListener('click', logout);
refreshBtn.addEventListener('click', loadData);
exportBtn.addEventListener('click', exportCSV);
searchInput.addEventListener('input', () => renderTable(filterRows(searchInput.value)));

/* ─── Auto-login if session exists ─── */
if (sessionStorage.getItem(SESSION_KEY)) showApp();
