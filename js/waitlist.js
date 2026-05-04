import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore, collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyCdP7nxgSM-IBatzybe1K-XwOr2AcX4DxY",
  authDomain: "zenthis-app.firebaseapp.com",
  projectId: "zenthis-app",
  storageBucket: "zenthis-app.firebasestorage.app",
  messagingSenderId: "634595451666",
  appId: "1:634595451666:web:b83f7c9350c54b1a11c9cb"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

let count = 4217;

/* ─── Task unlock logic ─── */
const check1  = document.getElementById('check1');
const check2  = document.getElementById('check2');
const check3  = document.getElementById('check3');
const step2   = document.getElementById('wlStep2');
const task1El = document.getElementById('wlTask1');
const task2El = document.getElementById('wlTask2');
const task3El = document.getElementById('wlTask3');

function evaluateTasks() {
  if (check1) task1El.classList.toggle('done', check1.checked);
  if (check2) task2El.classList.toggle('done', check2.checked);
  if (check3) task3El?.classList.toggle('done', check3.checked);
  const allDone = check1?.checked && check2?.checked && check3?.checked;
  step2?.classList.toggle('wl-unlocked', allDone);
}

/* clicking "Follow ↗" / "Retweet ↗" auto-checks its box after a short delay */
document.querySelectorAll('.wl-task-action').forEach(link => {
  link.addEventListener('click', () => {
    const id = link.dataset.check;
    setTimeout(() => {
      const cb = document.getElementById(id);
      if (cb && !cb.checked) { cb.checked = true; evaluateTasks(); }
    }, 1500);
  });
});

if (check1) check1.addEventListener('change', evaluateTasks);
if (check2) check2.addEventListener('change', evaluateTasks);
if (check3) check3.addEventListener('change', evaluateTasks);

/* ─── Form submission ─── */
async function submitWhitelist(twitter, email, wallet, onSuccess) {
  const t = twitter.trim().replace(/^@/, '');
  const e = email.trim().toLowerCase();
  const w = wallet.trim();

  if (!t) { alert('Please enter your Twitter handle.'); return; }
  if (!e || !e.includes('@')) { alert('Please enter a valid email.'); return; }

  const data = { twitter: '@' + t, email: e, ts: serverTimestamp() };
  if (w) data.wallet = w;

  try {
    await addDoc(collection(db, 'waitlist'), data);
  } catch (err) {
    console.error('Firestore:', err);
  }

  if (window._zlog) window._zlog('whitelist_signup', { has_wallet: !!w });

  count++;
  document.querySelectorAll('#waitlistCount, #stickyCount')
    .forEach(el => { el.textContent = count.toLocaleString(); });

  onSuccess();
}

/* Main form */
const mainForm    = document.getElementById('waitlistForm');
const formSuccess = document.getElementById('formSuccess');

if (mainForm) {
  mainForm.addEventListener('submit', e => {
    e.preventDefault();
    const twitter = document.getElementById('waitlistTwitter')?.value || '';
    const email   = document.getElementById('waitlistEmail')?.value   || '';
    const wallet  = document.getElementById('waitlistWallet')?.value  || '';
    submitWhitelist(twitter, email, wallet, () => {
      document.getElementById('wlFormFields').style.display  = 'none';
      document.querySelector('.form-note').style.display     = 'none';
      formSuccess.classList.add('visible');
    });
  });
}

/* Sticky bar form */
const stickyForm    = document.getElementById('stickyForm');
const stickyTwitter = document.getElementById('stickyTwitter');
const stickyEmail   = document.getElementById('stickyEmail');

if (stickyForm) {
  stickyForm.addEventListener('submit', e => {
    e.preventDefault();
    const twitter = stickyTwitter?.value || '';
    const email   = stickyEmail?.value   || '';
    submitWhitelist(twitter || 'sticky', email, '', () => {
      stickyForm.innerHTML = '<span style="color:var(--green);font-weight:600;font-size:.85rem;">✓ You\'re on the list!</span>';
    });
  });
}
