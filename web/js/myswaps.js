/* ═══════════════════════════════════════════════════════════════
   Zenthis App — "My swaps" panel
   Lists swaps stored in this browser, shows on-chain status, lets the
   user claim the LP's lock on the destination chain or refund an
   expired source lock.
   ─────────────────────────────────────────────────────────────── */

import { ethers } from './vendor/ethers.min.js';
import { HTLC_ABI, CHAIN_INFO, SWAP_STORE_KEY } from './config.js';
import { waitAndClaim, STEPS } from './swapflow.js';

const STATUS = ['Empty', 'Active', 'Redeemed', 'Refunded'];

let getWallet = () => null;
let listEl, msgEl, overlay;

function loadSwaps() {
  try { return JSON.parse(localStorage.getItem(SWAP_STORE_KEY) || '[]'); } catch { return []; }
}
function saveSwaps(list) {
  localStorage.setItem(SWAP_STORE_KEY, JSON.stringify(list));
}
function say(text) { if (msgEl) msgEl.textContent = text || ''; }

async function currentChainId(provider) {
  return Number((await provider.getNetwork()).chainId);
}

async function switchChain(chainId) {
  await window.ethereum.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: '0x' + chainId.toString(16) }]
  });
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fmtLeft(secs) {
  if (secs <= 0) return 'expired';
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  return h ? `${h}h ${m}m left` : `${m}m left`;
}

async function readSource(rec) {
  if (!rec.swapId || !window.ethereum) return null;
  const provider = new ethers.BrowserProvider(window.ethereum);
  if ((await currentChainId(provider)) !== rec.chainId) return null;
  const htlc = new ethers.Contract(rec.htlc, HTLC_ABI, provider);
  const s = await htlc.getSwap(rec.swapId);
  return { status: Number(s.status), timelock: Number(s.timelock) };
}

async function claim(rec) {
  const wallet = getWallet();
  if (!wallet) return say('Connect your wallet first.');
  try {
    await waitAndClaim(rec, wallet, (id, detail) => {
      const label = STEPS.find(s => s.id === id)?.label || id;
      say(detail === 'gasless' ? 'Asking the liquidity provider to claim for you…' : label + '…');
    });
    say('Claimed. Funds are in your wallet.');
  } catch (e) {
    say('Claim failed: ' + (e.shortMessage || e.message));
  }
  refreshMySwaps();
}

async function refund(rec) {
  try {
    await switchChain(rec.chainId);
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const htlc = new ethers.Contract(rec.htlc, HTLC_ABI, signer);
    say('Confirm the refund in your wallet…');
    await (await htlc.refund(rec.swapId)).wait();
    say('Refunded to your wallet.');
  } catch (e) {
    say('Refund failed: ' + (e.shortMessage || e.message));
  }
  refreshMySwaps();
}

async function renderRow(rec) {
  const row = el('div', 'myswap-row');
  const head = el('div', 'myswap-head');
  const from = CHAIN_INFO[rec.chain]?.label || rec.chain;
  const to = CHAIN_INFO[rec.toChain]?.label || rec.toChain;
  head.append(el('strong', '', `${rec.amount} ETH  ${from} → ${to}`));
  row.append(head);

  const info = el('div', 'myswap-info', 'Loading…');
  row.append(info);
  const actions = el('div', 'myswap-actions');
  row.append(actions);

  const now = Math.floor(Date.now() / 1000);
  let state = null;
  try { state = await readSource(rec); } catch (e) { info.textContent = 'Could not read status.'; }

  if (!rec.swapId) {
    info.textContent = 'Not confirmed on-chain (no swap id recorded).';
  } else if (!state) {
    info.textContent = `Switch to ${from} to see status.`;
    const b = el('button', 'myswap-btn', `Switch to ${from}`);
    b.onclick = async () => { try { await switchChain(rec.chainId); } catch (e) { say(e.shortMessage || e.message); } refreshMySwaps(); };
    actions.append(b);
  } else {
    const left = state.timelock - now;
    info.textContent = `${STATUS[state.status]}${state.status === 1 ? ' · ' + fmtLeft(left) : ''}`;
    if (state.status === 1) {
      if (!rec.claimed) {
        const c = el('button', 'myswap-btn primary', `Claim on ${to}`);
        c.onclick = () => claim(rec);
        actions.append(c);
      }
      if (left <= 0) {
        const r = el('button', 'myswap-btn', 'Refund');
        r.onclick = () => refund(rec);
        actions.append(r);
      }
    }
  }
  return row;
}

export async function refreshMySwaps() {
  if (!listEl) return;
  const swaps = loadSwaps().slice().reverse();
  listEl.replaceChildren();
  if (!swaps.length) {
    listEl.append(el('p', 'myswap-empty', 'No swaps stored in this browser yet.'));
    return;
  }
  for (const rec of swaps) listEl.append(await renderRow(rec));
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(loadSwaps(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'zenthis-swaps-backup.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

export function initMySwaps(walletGetter) {
  getWallet = walletGetter;
  overlay = document.getElementById('mySwapsOverlay');
  listEl = document.getElementById('mySwapsList');
  msgEl = document.getElementById('mySwapsMsg');
  const openBtn = document.getElementById('mySwapsBtn');
  if (!overlay || !openBtn) return;

  const close = () => { overlay.classList.remove('open'); document.body.style.overflow = ''; };
  openBtn.addEventListener('click', () => {
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    say('');
    refreshMySwaps();
  });
  document.getElementById('mySwapsClose').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('mySwapsExport').addEventListener('click', exportBackup);
}
