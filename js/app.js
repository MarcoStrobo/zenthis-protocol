/* ═══════════════════════════════════════════════════════════════
   Zenthis App — Cross-Chain Swap Logic
   ─────────────────────────────────────────────────────────────── */

import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@6.13.5/dist/ethers.min.js';

/* ─── Chain / token data ─── */
const CHAINS = [
  { id: '0x1',    decimal: 1,     key: 'ETH',  label: 'Ethereum',  color: '#627eea' },
  { id: '0xa4b1', decimal: 42161, key: 'ARB',  label: 'Arbitrum',  color: '#28a0f0' },
  { id: '0x89',   decimal: 137,   key: 'POL',  label: 'Polygon',   color: '#8247e5' },
  { id: '0x38',   decimal: 56,    key: 'BNB',  label: 'BNB Chain', color: '#f0b90b' },
  { id: '0xa86a', decimal: 43114, key: 'AVAX', label: 'Avalanche', color: '#e84142' },
];

const TOKENS = {
  ETH:  [
    { sym: 'ETH',  name: 'Ether',         cg: 'ethereum',       dec: 18, logo: '🔷' },
    { sym: 'USDC', name: 'USD Coin',       cg: 'usd-coin',       dec: 6,  logo: '🔵' },
    { sym: 'USDT', name: 'Tether',         cg: 'tether',         dec: 6,  logo: '💚' },
    { sym: 'WBTC', name: 'Wrapped BTC',    cg: 'wrapped-bitcoin',dec: 8,  logo: '🟠' },
    { sym: 'DAI',  name: 'Dai Stablecoin', cg: 'dai',            dec: 18, logo: '🟡' },
  ],
  ARB:  [
    { sym: 'ETH',  name: 'Ether',     cg: 'ethereum',  dec: 18, logo: '🔷' },
    { sym: 'USDC', name: 'USD Coin',  cg: 'usd-coin',  dec: 6,  logo: '🔵' },
    { sym: 'ARB',  name: 'Arbitrum',  cg: 'arbitrum',  dec: 18, logo: '🔹' },
    { sym: 'GMX',  name: 'GMX',       cg: 'gmx',       dec: 18, logo: '⚡' },
  ],
  POL:  [
    { sym: 'POL',  name: 'Polygon',   cg: 'matic-network', dec: 18, logo: '🟣' },
    { sym: 'USDC', name: 'USD Coin',  cg: 'usd-coin',      dec: 6,  logo: '🔵' },
    { sym: 'USDT', name: 'Tether',    cg: 'tether',        dec: 6,  logo: '💚' },
    { sym: 'WETH', name: 'Wrapped ETH', cg: 'weth',        dec: 18, logo: '🔷' },
  ],
  BNB:  [
    { sym: 'BNB',  name: 'BNB',       cg: 'binancecoin',       dec: 18, logo: '🟡' },
    { sym: 'USDT', name: 'Tether',    cg: 'tether',            dec: 6,  logo: '💚' },
    { sym: 'USDC', name: 'USD Coin',  cg: 'usd-coin',          dec: 6,  logo: '🔵' },
    { sym: 'CAKE', name: 'PancakeSwap', cg: 'pancakeswap-token', dec: 18, logo: '🥞' },
  ],
  AVAX: [
    { sym: 'AVAX', name: 'Avalanche', cg: 'avalanche-2', dec: 18, logo: '🔴' },
    { sym: 'USDC', name: 'USD Coin',  cg: 'usd-coin',    dec: 6,  logo: '🔵' },
    { sym: 'USDT', name: 'Tether',    cg: 'tether',      dec: 6,  logo: '💚' },
    { sym: 'JOE',  name: 'Trader Joe', cg: 'joe',        dec: 18, logo: '🍺' },
  ],
};

const TICKER_TOKENS = ['ethereum','usd-coin','tether','wrapped-bitcoin','arbitrum','matic-network','binancecoin','avalanche-2'];

/* ─── State ─── */
let prices = {};          // { cg-id: usd_price }
let walletAddress = null;
let walletBalances = {};  // { chain-key: { token-sym: amount } }
let slippage = 0.5;

let fromChain = CHAINS[0];          // Ethereum
let fromToken = TOKENS.ETH[0];      // ETH
let toChain   = CHAINS[1];          // Arbitrum
let toToken   = TOKENS.ARB[1];      // USDC

let assetTarget = 'from'; // which side is the modal opening for

/* ─── DOM refs ─── */
const $ = id => document.getElementById(id);

const connectBtn      = $('connectBtn');
const connectBtnLabel = $('connectBtnLabel');
const walletOverlay   = $('walletOverlay');
const walletClose     = $('walletClose');
const connectMetaMask = $('connectMetaMask');
const mmTag           = $('mmTag');

const assetOverlay    = $('assetOverlay');
const assetClose      = $('assetClose');
const assetTitle      = $('assetTitle');
const assetSearch     = $('assetSearch');
const chainPills      = $('chainPills');
const tokenRows       = $('tokenRows');

const settingsOverlay = $('settingsOverlay');
const settingsBtn     = $('settingsBtn');
const settingsClose   = $('settingsClose');

const fromSelector    = $('fromSelector');
const fromChainBadge  = $('fromChainBadge');
const fromTokenName   = $('fromTokenName');
const fromChainName   = $('fromChainName');
const fromBalance     = $('fromBalance');
const fromAmount      = $('fromAmount');
const fromUSD         = $('fromUSD');

const toSelector      = $('toSelector');
const toChainBadge    = $('toChainBadge');
const toTokenName     = $('toTokenName');
const toChainName     = $('toChainName');
const toAmount        = $('toAmount');
const toUSD           = $('toUSD');

const switchBtn       = $('switchBtn');
const swapBtn         = $('swapBtn');
const feeDetail       = $('feeDetail');
const feeAmt          = $('feeAmt');
const swapRate        = $('swapRate');
const swapWarn        = $('swapWarn');
const priceTicker     = $('priceTicker');

const gateOverlay     = $('gateOverlay');
const gateClose       = $('gateClose');

/* ═══════════════════════════════════════════════════════════════
   PRICES
   ═══════════════════════════════════════════════════════════════ */
async function fetchPrices() {
  const ids = [...new Set([...TICKER_TOKENS, fromToken.cg, toToken.cg])].join(',');
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { cache: 'no-cache' }
    );
    if (!res.ok) return;
    const data = await res.json();
    Object.assign(prices, data);
    renderTicker();
    updateCalculation();
    updateBalanceDisplay();
  } catch (_) { /* silent fail — show stale data */ }
}

function price(cg) { return prices[cg]?.usd ?? null; }

/* ─── Price Ticker ─── */
function renderTicker() {
  const pairs = [
    ['ETH',  'ethereum'],
    ['BTC',  'wrapped-bitcoin'],
    ['ARB',  'arbitrum'],
    ['POL',  'matic-network'],
    ['BNB',  'binancecoin'],
    ['AVAX', 'avalanche-2'],
    ['USDC', 'usd-coin'],
  ];
  const items = pairs.map(([sym, cg]) => {
    const p = price(cg);
    if (!p) return '';
    return `<span class="ticker-item"><span class="ticker-sym">${sym}</span> <span class="ticker-price">$${formatPrice(p)}</span></span>`;
  }).filter(Boolean);

  // duplicate for seamless loop
  const set = items.join('<span class="ticker-sep">·</span>');
  priceTicker.innerHTML = `<div class="ticker-inner">${set}<span class="ticker-sep"> &nbsp; </span>${set}</div>`;
}

function formatPrice(p) {
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (p >= 1)    return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return p.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

/* ═══════════════════════════════════════════════════════════════
   SWAP CALCULATION
   ═══════════════════════════════════════════════════════════════ */
function updateCalculation() {
  const amt = parseFloat(fromAmount.value);
  const fp  = price(fromToken.cg);
  const tp  = price(toToken.cg);

  // USD value of input
  if (fp && amt > 0) {
    fromUSD.textContent = `≈ $${(amt * fp).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } else {
    fromUSD.textContent = '—';
  }

  if (!amt || amt <= 0 || !fp || !tp) {
    toAmount.textContent = '—';
    toUSD.textContent    = '—';
    feeDetail.classList.remove('visible');
    swapWarn.style.display = 'none';
    updateSwapBtn();
    return;
  }

  const fee    = amt * 0.001;           // 0.10%
  const netAmt = amt - fee;
  const out    = (netAmt * fp) / tp;

  toAmount.textContent = out.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  toUSD.textContent    = `≈ $${(out * tp).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Fee detail
  feeAmt.textContent  = `${fee.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 8 })} ${fromToken.sym}`;
  swapRate.textContent = `1 ${fromToken.sym} = ${(fp / tp).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })} ${toToken.sym}`;
  feeDetail.classList.add('visible');

  // Insufficient balance check
  const balance = walletBalances[fromChain.key]?.[fromToken.sym] ?? null;
  if (balance !== null && amt > balance) {
    swapWarn.style.display = 'block';
  } else {
    swapWarn.style.display = 'none';
  }

  updateSwapBtn();
}

function updateSwapBtn() {
  const amt      = parseFloat(fromAmount.value);
  const balance  = walletBalances[fromChain.key]?.[fromToken.sym] ?? null;
  const insufficient = balance !== null && amt > balance;

  if (!walletAddress) {
    swapBtn.textContent = 'Connect Wallet';
    swapBtn.disabled    = false;
    swapBtn.className   = 'swap-cta';
  } else if (!amt || amt <= 0) {
    swapBtn.textContent = 'Enter amount';
    swapBtn.disabled    = true;
    swapBtn.className   = 'swap-cta swap-cta-disabled';
  } else if (insufficient) {
    swapBtn.textContent = `Insufficient ${fromToken.sym}`;
    swapBtn.disabled    = true;
    swapBtn.className   = 'swap-cta swap-cta-disabled';
  } else {
    swapBtn.textContent = `Swap ${fromToken.sym} → ${toToken.sym}`;
    swapBtn.disabled    = false;
    swapBtn.className   = 'swap-cta';
  }
}

/* ═══════════════════════════════════════════════════════════════
   WALLET
   ═══════════════════════════════════════════════════════════════ */
async function connectMetaMaskWallet() {
  if (!window.ethereum) {
    window.open('https://metamask.io/download/', '_blank');
    return;
  }
  try {
    const provider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await provider.send('eth_requestAccounts', []);
    walletAddress  = accounts[0];
    onWalletConnected(provider);
  } catch (err) {
    console.warn('MetaMask:', err.message);
  }
}

async function onWalletConnected(provider) {
  const short = walletAddress.slice(0, 6) + '…' + walletAddress.slice(-4);
  connectBtnLabel.textContent = short;
  connectBtn.classList.add('connected');
  closeModal(walletOverlay);
  if (window._zlog) window._zlog('wallet_connected', { wallet: 'metamask' });

  // Fetch ETH balance on current chain
  try {
    const bal = await provider.getBalance(walletAddress);
    const eth = parseFloat(ethers.formatEther(bal));
    if (!walletBalances[fromChain.key]) walletBalances[fromChain.key] = {};
    walletBalances[fromChain.key][fromToken.sym === 'ETH' ? 'ETH' : fromToken.sym] = eth;
    updateBalanceDisplay();
  } catch (_) {}

  updateSwapBtn();
}

function updateBalanceDisplay() {
  const bal = walletBalances[fromChain.key]?.[fromToken.sym];
  fromBalance.textContent = bal != null
    ? `Balance: ${bal.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })} ${fromToken.sym}`
    : '';
}

/* Check if MetaMask is already connected on page load */
async function checkExistingWallet() {
  if (!window.ethereum) return;
  mmTag.textContent = 'Detected';
  mmTag.classList.add('wallet-tag-detected');
  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts.length > 0) {
      walletAddress = accounts[0];
      const provider = new ethers.BrowserProvider(window.ethereum);
      await onWalletConnected(provider);
    }
  } catch (_) {}
}

/* ═══════════════════════════════════════════════════════════════
   ASSET SELECTOR MODAL
   ═══════════════════════════════════════════════════════════════ */
let assetChainFilter = null;

function openAssetModal(target) {
  assetTarget      = target;
  assetChainFilter = target === 'from' ? fromChain.key : toChain.key;
  assetTitle.textContent = target === 'from' ? 'Select asset to send' : 'Select asset to receive';
  assetSearch.value = '';
  renderChainPills();
  renderTokenList('');
  openModal(assetOverlay);
  assetSearch.focus();
}

function renderChainPills() {
  chainPills.innerHTML = CHAINS.map(c => `
    <button class="chain-pill${c.key === assetChainFilter ? ' active' : ''}" data-chain="${c.key}">
      <span class="pill-dot" style="background:${c.color}"></span>${c.label}
    </button>`
  ).join('');

  chainPills.querySelectorAll('.chain-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      assetChainFilter = btn.dataset.chain;
      renderChainPills();
      renderTokenList(assetSearch.value);
    });
  });
}

function renderTokenList(query) {
  const q    = query.trim().toLowerCase();
  const list = TOKENS[assetChainFilter] || [];
  const filtered = list.filter(t =>
    !q || t.sym.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
  );

  tokenRows.innerHTML = filtered.length
    ? filtered.map(t => {
        const p = price(t.cg);
        const pStr = p ? `$${formatPrice(p)}` : '';
        return `
          <button class="token-row" data-chain="${assetChainFilter}" data-sym="${t.sym}">
            <span class="token-row-logo">${t.logo}</span>
            <span class="token-row-info">
              <span class="token-row-sym">${t.sym}</span>
              <span class="token-row-name">${t.name}</span>
            </span>
            <span class="token-row-price">${pStr}</span>
          </button>`;
      }).join('')
    : '<div class="token-empty">No tokens found</div>';

  tokenRows.querySelectorAll('.token-row').forEach(btn => {
    btn.addEventListener('click', () => selectToken(btn.dataset.chain, btn.dataset.sym));
  });
}

function selectToken(chainKey, sym) {
  const chain = CHAINS.find(c => c.key === chainKey);
  const token = TOKENS[chainKey].find(t => t.sym === sym);
  if (!chain || !token) return;

  if (assetTarget === 'from') {
    fromChain = chain;
    fromToken = token;
  } else {
    toChain = chain;
    toToken = token;
  }

  updatePanelUI();
  closeModal(assetOverlay);
  updateCalculation();
  updateBalanceDisplay();
}

/* ═══════════════════════════════════════════════════════════════
   PANEL UI
   ═══════════════════════════════════════════════════════════════ */
function updatePanelUI() {
  fromChainBadge.textContent = fromChain.key;
  fromTokenName.textContent  = fromToken.sym;
  fromChainName.textContent  = fromChain.label;

  toChainBadge.textContent = toChain.key;
  toTokenName.textContent  = toToken.sym;
  toChainName.textContent  = toChain.label;
}

/* ─── Switch From / To ─── */
function switchFromTo() {
  [fromChain, toChain]   = [toChain, fromChain];
  [fromToken, toToken]   = [toToken, fromToken];
  fromAmount.value = '';
  updatePanelUI();
  updateCalculation();
  updateBalanceDisplay();
}

/* ═══════════════════════════════════════════════════════════════
   LAUNCH GATE + COUNTDOWN
   ═══════════════════════════════════════════════════════════════ */
const LAUNCH_DATE = new Date('2026-06-15T12:00:00Z');

function updateCountdown() {
  const now  = Date.now();
  const diff = LAUNCH_DATE.getTime() - now;

  if (diff <= 0) {
    $('gcd-d').textContent = '00';
    $('gcd-h').textContent = '00';
    $('gcd-m').textContent = '00';
    $('gcd-s').textContent = '00';
    return;
  }

  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);

  $('gcd-d').textContent = String(d).padStart(2, '0');
  $('gcd-h').textContent = String(h).padStart(2, '0');
  $('gcd-m').textContent = String(m).padStart(2, '0');
  $('gcd-s').textContent = String(s).padStart(2, '0');
}

/* ═══════════════════════════════════════════════════════════════
   MODAL HELPERS
   ═══════════════════════════════════════════════════════════════ */
function openModal(overlay)  { overlay.classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeModal(overlay) { overlay.classList.remove('open'); document.body.style.overflow = ''; }

/* ═══════════════════════════════════════════════════════════════
   EVENT LISTENERS
   ═══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {

  /* Wallet button */
  connectBtn.addEventListener('click', () => {
    if (walletAddress) return; // already connected → do nothing (future: show account)
    openModal(walletOverlay);
  });
  walletClose.addEventListener('click', () => closeModal(walletOverlay));
  walletOverlay.addEventListener('click', e => { if (e.target === walletOverlay) closeModal(walletOverlay); });

  /* MetaMask connect */
  connectMetaMask.addEventListener('click', connectMetaMaskWallet);

  /* Asset selectors */
  fromSelector.addEventListener('click', () => openAssetModal('from'));
  toSelector.addEventListener('click',   () => openAssetModal('to'));
  assetClose.addEventListener('click',   () => closeModal(assetOverlay));
  assetOverlay.addEventListener('click', e => { if (e.target === assetOverlay) closeModal(assetOverlay); });
  assetSearch.addEventListener('input',  () => renderTokenList(assetSearch.value));

  /* Settings */
  settingsBtn.addEventListener('click',   () => openModal(settingsOverlay));
  settingsClose.addEventListener('click', () => closeModal(settingsOverlay));
  settingsOverlay.addEventListener('click', e => { if (e.target === settingsOverlay) closeModal(settingsOverlay); });

  document.querySelectorAll('.slippage-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.slippage-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      slippage = parseFloat(btn.dataset.val);
    });
  });

  /* Swap tabs (no-op for now) */
  document.querySelectorAll('.swap-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.swap-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });

  /* Switch button */
  switchBtn.addEventListener('click', switchFromTo);

  /* Amount input */
  fromAmount.addEventListener('input', updateCalculation);

  /* Swap CTA */
  swapBtn.addEventListener('click', () => {
    if (!walletAddress) { openModal(walletOverlay); return; }
    const amt = parseFloat(fromAmount.value);
    if (!amt || amt <= 0) return;
    if (window._zlog) window._zlog('swap_attempted', { from: fromToken.sym, to: toToken.sym, amount: amt });
    // Show launch gate — swap live on June 15
    openModal(gateOverlay);
  });

  /* Gate modal */
  gateClose.addEventListener('click', () => closeModal(gateOverlay));
  gateOverlay.addEventListener('click', e => { if (e.target === gateOverlay) closeModal(gateOverlay); });

  /* Close any modal on Escape */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      [walletOverlay, assetOverlay, settingsOverlay, gateOverlay].forEach(closeModal);
    }
  });

  /* ─── Init ─── */
  updatePanelUI();
  checkExistingWallet();
  await fetchPrices();
  setInterval(fetchPrices, 30_000);

  updateCountdown();
  setInterval(updateCountdown, 1_000);

  // Show gate after 1.5s on first visit
  setTimeout(() => {
    if (!sessionStorage.getItem('gateSeen')) {
      openModal(gateOverlay);
      sessionStorage.setItem('gateSeen', '1');
    }
  }, 1500);

  // account change
  if (window.ethereum) {
    window.ethereum.on('accountsChanged', accounts => {
      if (accounts.length === 0) {
        walletAddress = null;
        walletBalances = {};
        connectBtnLabel.textContent = 'Connect Wallet';
        connectBtn.classList.remove('connected');
        updateSwapBtn();
        updateBalanceDisplay();
      } else {
        walletAddress = accounts[0];
        const short = walletAddress.slice(0, 6) + '…' + walletAddress.slice(-4);
        connectBtnLabel.textContent = short;
        updateSwapBtn();
      }
    });

    window.ethereum.on('chainChanged', () => window.location.reload());
  }
});
