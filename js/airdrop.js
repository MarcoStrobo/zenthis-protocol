// ─── Zenthis Airdrop System ──────────────────────────────────────────────────
import { initializeApp }        from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection,
         query, orderBy, limit, getDocs, where, serverTimestamp,
         increment, runTransaction }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth, signInAnonymously }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@6.13.5/dist/ethers.min.js';

// ─── Firebase ────────────────────────────────────────────────────────────────
const app = initializeApp({
  apiKey:            "AIzaSyCdP7nxgSM-IBatzybe1K-XwOr2AcX4DxY",
  authDomain:        "zenthis-app.firebaseapp.com",
  projectId:         "zenthis-app",
  storageBucket:     "zenthis-app.firebasestorage.app",
  messagingSenderId: "634595451666",
  appId:             "1:634595451666:web:b83f7c9350c54b1a11c9cb",
  measurementId:     "G-ZENTHIS2026",
});
const db   = getFirestore(app);
const auth = getAuth(app);

// ─── Constants ───────────────────────────────────────────────────────────────
const POINTS = {
  joined:          100,
  whitelistDone:   200,
  tweetDone:       150,
  earlyBird:       100,
};
const REFERRAL_PTS     = 300;
const EARLY_BIRD_LIMIT = 1000;
const IDO_DATE         = new Date('2026-06-15T00:00:00Z');
const AIRDROP_SUPPLY   = 5_000_000;

// ─── State ───────────────────────────────────────────────────────────────────
let currentWallet = null;
let userData      = null;
let totalParticipants = 0;

// ─── Boot ────────────────────────────────────────────────────────────────────
async function init() {
  // Store ?ref= code for later use
  const urlRef = new URLSearchParams(window.location.search).get('ref');
  if (urlRef) localStorage.setItem('zth_ref', urlRef.toUpperCase());

  // Days to TGE
  updateDaysCounter();

  // Anonymous auth (needed for Firestore writes)
  try { await signInAnonymously(auth); } catch (_) {}

  // Load global stats + leaderboard
  await Promise.all([loadStats(), loadLeaderboard()]);

  // Auto-reconnect if wallet was previously connected
  const cached = localStorage.getItem('zth_wallet');
  if (cached) {
    currentWallet = cached;
    await loadUserData(cached);
    showDashboard();
  }
}

// ─── Days counter ────────────────────────────────────────────────────────────
function updateDaysCounter() {
  const days = Math.max(0, Math.ceil((IDO_DATE - Date.now()) / 86_400_000));
  const el = document.getElementById('statDays');
  if (el) el.textContent = days;
}

// ─── Wallet connect ──────────────────────────────────────────────────────────
window.connectWallet = async function () {
  if (!window.ethereum) {
    alert('MetaMask not found. Please install it from metamask.io');
    return;
  }
  const btn = document.getElementById('connectBtn');
  btn.textContent = 'Connecting…';
  btn.disabled = true;

  try {
    const provider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await provider.send('eth_requestAccounts', []);
    const wallet   = accounts[0].toLowerCase();

    currentWallet = wallet;
    localStorage.setItem('zth_wallet', wallet);

    await createOrLoadProfile(wallet);
    showDashboard();
    await loadLeaderboard(); // refresh with user highlighted
  } catch (e) {
    btn.textContent = 'Connect MetaMask';
    btn.disabled = false;
    console.error(e);
  }
};

// ─── Create or load Firestore profile ────────────────────────────────────────
async function createOrLoadProfile(wallet) {
  const ref  = doc(db, 'airdrop', wallet);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    userData = snap.data();
    return;
  }

  // New user — generate refCode, apply early bird
  const refCode    = generateRefCode();
  const referredBy = localStorage.getItem('zth_ref') || null;
  const earlyBird  = totalParticipants < EARLY_BIRD_LIMIT;
  const points     = POINTS.joined + (earlyBird ? POINTS.earlyBird : 0);

  userData = {
    wallet,
    refCode,
    referredBy: referredBy || null,
    points,
    actions:  { joined: true, whitelistDone: false, tweetDone: false },
    referralCount: 0,
    earlyBird,
    ts: serverTimestamp(),
  };

  await setDoc(ref, userData);

  // Credit the referrer
  if (referredBy) await creditReferrer(referredBy, wallet);

  // Update global stats doc
  try {
    const statsRef = doc(db, 'airdrop_meta', 'stats');
    await runTransaction(db, async tx => {
      const statsSnap = await tx.get(statsRef);
      if (statsSnap.exists()) {
        tx.update(statsRef, { count: increment(1), totalPoints: increment(points) });
      } else {
        tx.set(statsRef, { count: 1, totalPoints: points });
      }
    });
  } catch (_) {}

  totalParticipants++;
}

// ─── Credit referrer ─────────────────────────────────────────────────────────
async function creditReferrer(refCode, newWallet) {
  try {
    // Find referrer wallet by refCode
    const q    = query(collection(db, 'airdrop'), where('refCode', '==', refCode), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return;

    const referrerRef = snap.docs[0].ref;

    // Prevent double-crediting: check if referral event already exists
    const evQ = query(collection(db, 'referral_events'),
      where('refereeWallet', '==', newWallet), limit(1));
    const evSnap = await getDocs(evQ);
    if (!evSnap.empty) return;

    // Log the referral event
    await setDoc(doc(collection(db, 'referral_events')), {
      referrerWallet: snap.docs[0].id,
      referrerRefCode: refCode,
      refereeWallet: newWallet,
      ts: serverTimestamp(),
    });

    // Add points to referrer
    await updateDoc(referrerRef, {
      points:        increment(REFERRAL_PTS),
      referralCount: increment(1),
    });

    // Update global stats
    try {
      await updateDoc(doc(db, 'airdrop_meta', 'stats'), {
        totalPoints: increment(REFERRAL_PTS),
      });
    } catch (_) {}
  } catch (e) { console.error('creditReferrer:', e); }
}

// ─── Actions ─────────────────────────────────────────────────────────────────
async function completeAction(actionKey) {
  if (!currentWallet || !userData) return;
  if (userData.actions?.[actionKey]) return; // already done

  const pts = POINTS[actionKey];
  if (!pts) return;

  try {
    await updateDoc(doc(db, 'airdrop', currentWallet), {
      [`actions.${actionKey}`]: true,
      points: increment(pts),
    });
    await updateDoc(doc(db, 'airdrop_meta', 'stats'), {
      totalPoints: increment(pts),
    }).catch(() => {});

    userData.actions[actionKey] = true;
    userData.points = (userData.points || 0) + pts;

    renderDashboard();
    showPointsPop(`+${pts} pts`);
    window._zlog?.('airdrop_action', { action: actionKey, wallet: currentWallet });
  } catch (e) { console.error(e); }
}

window.doWhitelistAction = function () {
  window.open('index.html#buy', '_blank');
  // Give points after 3s (honor system — user went to the whitelist)
  setTimeout(async () => {
    await completeAction('whitelistDone');
  }, 3000);
};

window.doTweetAction = async function () {
  // Retweet the official airdrop announcement
  window.open('https://twitter.com/intent/retweet?tweet_id=2051234034643021981', '_blank');

  // Award points after a short delay
  setTimeout(async () => {
    await completeAction('tweetDone');
  }, 4000);
};

window.scrollToRef = function () {
  document.getElementById('referralCard')?.scrollIntoView({ behavior: 'smooth' });
};

// ─── Referral link helpers ────────────────────────────────────────────────────
function buildRefLink(refCode) {
  return `https://zenthisprotocol.xyz/airdrop.html?ref=${refCode}`;
}

window.copyRefLink = function () {
  if (!userData?.refCode) return;
  const link = buildRefLink(userData.refCode);
  navigator.clipboard.writeText(link).then(() => {
    const btn = document.getElementById('copyBtn');
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
};

// Share button in referral card — composes a new tweet with the personal ref link
window.shareOnTwitter = function () {
  if (!userData?.refCode) return;
  const refLink = buildRefLink(userData.refCode);
  const text = encodeURIComponent(
    `I just joined the @zenthis_io airdrop — 5,000,000 ZENTHIS up for grabs 🔥\n\n` +
    `IDO: June 15th · No bridges · 0.10% fee\n\n` +
    `Join with my link → ${refLink}\n\n` +
    `#ZenthisIDO #DeFi #Airdrop`
  );
  window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
};

// ─── Load global stats ───────────────────────────────────────────────────────
async function loadStats() {
  try {
    const snap = await getDoc(doc(db, 'airdrop_meta', 'stats'));
    if (snap.exists()) {
      const d = snap.data();
      totalParticipants = d.count || 0;
      const pEl = document.getElementById('statParticipants');
      const tEl = document.getElementById('statPoints');
      if (pEl) pEl.textContent = totalParticipants.toLocaleString();
      if (tEl) tEl.textContent = (d.totalPoints || 0).toLocaleString();

      // Early bird spots
      const left = Math.max(0, EARLY_BIRD_LIMIT - totalParticipants);
      const ebEl = document.getElementById('earlyBirdLeft');
      if (ebEl) ebEl.textContent = left.toLocaleString();
      if (left <= 0) {
        const banner = document.getElementById('earlyBirdBanner');
        if (banner) banner.style.display = 'none';
      }
    }
  } catch (_) {}
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────
async function loadLeaderboard() {
  const body = document.getElementById('leaderboardBody');
  if (!body) return;

  try {
    const q    = query(collection(db, 'airdrop'), orderBy('points', 'desc'), limit(20));
    const snap = await getDocs(q);

    if (snap.empty) {
      body.innerHTML = '<div class="lb-empty">No participants yet — be the first! 🚀</div>';
      return;
    }

    let userRank = null;
    let html = '';
    snap.docs.forEach((d, i) => {
      const data    = d.data();
      const isMe    = data.wallet === currentWallet;
      const rank    = i + 1;
      if (isMe) userRank = rank;

      const rankClass = rank === 1 ? 'top1' : rank === 2 ? 'top2' : rank === 3 ? 'top3' : '';
      const tier = getTier(data.points);
      const wallet = truncateWallet(data.wallet || d.id);

      html += `
        <div class="lb-row${isMe ? ' is-me' : ''}">
          <span class="lb-rank ${rankClass}">${rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}</span>
          <span class="lb-wallet">
            ${wallet}
            ${isMe ? '<span class="lb-you-tag">YOU</span>' : ''}
            ${data.earlyBird ? '<span style="font-size:.8rem;margin-left:4px" title="Early bird">⚡</span>' : ''}
          </span>
          <span class="lb-tier">${tier.icon} ${tier.name}</span>
          <span class="lb-refs">${data.referralCount || 0}</span>
          <span class="lb-points">${(data.points || 0).toLocaleString()}</span>
        </div>`;
    });

    body.innerHTML = html;

    // Update user's rank in dashboard
    if (userRank && currentWallet) {
      const rankEl = document.getElementById('userRank');
      if (rankEl) rankEl.textContent = `#${userRank}`;
    }
  } catch (e) {
    body.innerHTML = '<div class="lb-empty">Could not load leaderboard.</div>';
    console.error(e);
  }
}

// ─── Load existing user data ──────────────────────────────────────────────────
async function loadUserData(wallet) {
  try {
    const snap = await getDoc(doc(db, 'airdrop', wallet));
    if (snap.exists()) {
      userData = snap.data();
    } else {
      // First time from cached wallet — create profile
      await createOrLoadProfile(wallet);
    }
  } catch (e) { console.error(e); }
}

// ─── Show dashboard (hide connect card) ──────────────────────────────────────
function showDashboard() {
  document.getElementById('connectCard').style.display = 'none';
  document.getElementById('dashboardGrid').style.display = 'grid';
  renderDashboard();
}

// ─── Render dashboard ─────────────────────────────────────────────────────────
function renderDashboard() {
  if (!userData) return;

  const pts      = userData.points || 0;
  const tier     = getTier(pts);
  const refCount = userData.referralCount || 0;
  const refPts   = refCount * REFERRAL_PTS;
  const estimate = estimateTokens(pts);
  const refLink  = buildRefLink(userData.refCode || '——');

  // Points
  const ptsEl = document.getElementById('userPoints');
  if (ptsEl) {
    animateNumber(ptsEl, parseInt(ptsEl.textContent) || 0, pts, 600);
  }

  // Tier badge
  const tierEl = document.getElementById('tierBadge');
  if (tierEl) {
    tierEl.textContent = `${tier.icon} ${tier.name} Tier`;
    tierEl.className   = `tier-badge tier-${tier.name.toLowerCase()}`;
  }

  // Estimate
  const estEl = document.getElementById('userEstimate');
  if (estEl) estEl.textContent = `~${estimate.toLocaleString()} ZENTHIS`;

  // Meta
  const ebEl = document.getElementById('userEarlyBird');
  if (ebEl) ebEl.textContent = userData.earlyBird ? '⚡ Yes' : 'No';

  // Referral card
  document.getElementById('referralCard').style.display = 'block';
  const rlEl = document.getElementById('refLinkText');
  if (rlEl) rlEl.textContent = refLink;
  const rcEl = document.getElementById('refCount');
  if (rcEl) rcEl.textContent = refCount;
  const rpEl = document.getElementById('refPoints');
  if (rpEl) rpEl.textContent = refPts.toLocaleString();
  const rcodeEl = document.getElementById('refCode');
  if (rcodeEl) rcodeEl.textContent = userData.refCode || '—';

  // Action rows
  setActionDone('actionWhitelist', userData.actions?.whitelistDone);
  setActionDone('actionTweet',     userData.actions?.tweetDone);
  if (refCount > 0) setActionDone('actionReferral', true);
}

function setActionDone(rowId, done) {
  const row = document.getElementById(rowId);
  if (!row) return;
  if (done) {
    row.classList.add('done');
    const btn = row.querySelector('.action-btn');
    if (btn) { btn.textContent = 'Done ✓'; btn.disabled = true; }
    const check = row.querySelector('.action-check');
    if (check) check.textContent = '✓';
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getTier(points) {
  if (points >= 1000) return { name: 'Diamond', icon: '💎' };
  if (points >= 600)  return { name: 'Gold',    icon: '🥇' };
  if (points >= 300)  return { name: 'Silver',  icon: '🥈' };
  return                     { name: 'Bronze',  icon: '🥉' };
}

function estimateTokens(points) {
  // Simple formula: points relative to max possible (1000 pts + referrals)
  // Assume avg 500 pts per participant across 5000 participants → 2.5M pts pool
  // User's share = points / projectedTotal * 5M
  const projectedTotal = Math.max(totalParticipants * 500, 10000);
  return Math.floor((points / projectedTotal) * AIRDROP_SUPPLY);
}

function generateRefCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function truncateWallet(addr) {
  if (!addr || addr.length < 10) return addr;
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

function animateNumber(el, from, to, duration) {
  const start = performance.now();
  const step  = ts => {
    const t   = Math.min((ts - start) / duration, 1);
    const val = Math.round(from + (to - from) * easeOut(t));
    el.textContent = val.toLocaleString();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

function showPointsPop(text) {
  const el = document.getElementById('ptsPop');
  if (!el) return;
  el.textContent = text;
  el.className = 'pts-pop show';
  setTimeout(() => { el.className = 'pts-pop hide'; }, 1000);
  setTimeout(() => { el.className = 'pts-pop'; }, 1500);
}

// ─── Boot ────────────────────────────────────────────────────────────────────
init();
