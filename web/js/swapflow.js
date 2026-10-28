/* ═══════════════════════════════════════════════════════════════
   Zenthis App — guided atomic swap flow
   switch chain -> lock on A -> wait for LP lock on B -> switch -> claim on B
   Every step is persisted so an interrupted swap can be resumed.
   ─────────────────────────────────────────────────────────────── */

import { ethers } from './vendor/ethers.min.js';
import {
  HTLC_ADDRESSES, HTLC_ABI, CHAIN_INFO, CHAIN_RPC, SWAP_STORE_KEY, ROUTES,
  LP_SPREAD_BPS, SWAP_LIMITS, SWAP_TIMELOCK_SECS, RELAY_URL, MIN_GAS_BALANCE_ETH,
  LP_ADDRESS, LP_ADDRESS_TESTNET
} from './config.js';

/* ─── Persistence ─── */
export function loadSwaps() {
  try { return JSON.parse(localStorage.getItem(SWAP_STORE_KEY) || '[]'); } catch { return []; }
}
function saveSwaps(list) { localStorage.setItem(SWAP_STORE_KEY, JSON.stringify(list)); }
export function updateSwap(hashlock, patch) {
  const list = loadSwaps();
  const rec = list.find(r => r.hashlock === hashlock);
  if (rec) Object.assign(rec, patch);
  saveSwaps(list);
  return rec;
}

/* ─── Read-only providers (independent of the wallet's network) ─── */
const providers = {};
export function readProvider(chainKey) {
  if (!providers[chainKey]) {
    providers[chainKey] = new ethers.JsonRpcProvider(
      CHAIN_RPC[chainKey], ethers.Network.from(CHAIN_INFO[chainKey].id), { staticNetwork: true }
    );
  }
  return providers[chainKey];
}
function htlcRead(chainKey) {
  return new ethers.Contract(HTLC_ADDRESSES[chainKey], HTLC_ABI, readProvider(chainKey));
}

/* ─── Wallet network handling ─── */
export async function ensureChain(chainKey) {
  const info = CHAIN_INFO[chainKey];
  const chainId = '0x' + info.id.toString(16);
  const current = await window.ethereum.request({ method: 'eth_chainId' });
  if (current.toLowerCase() === chainId) return;
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (e) {
    const code = e.code ?? e?.error?.code;
    if (code !== 4902 && code !== -32603) throw e;
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId, chainName: info.label,
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: [CHAIN_RPC[chainKey]], blockExplorerUrls: [info.explorer]
      }]
    });
  }
}

/* ─── Quote, balances, liquidity ─── */
const feeCache = {};
export async function htlcFeeBps(chainKey) {
  if (feeCache[chainKey] !== undefined) return feeCache[chainKey];
  try { feeCache[chainKey] = Number(await htlcRead(chainKey).feeBps()); }
  catch { feeCache[chainKey] = 20; }
  return feeCache[chainKey];
}

/** Net amount the user receives for `amount` ETH sent (HTLC fee A, LP spread, HTLC fee B). */
export async function quoteEthToEth(amount, fromKey, toKey) {
  const [feeA, feeB] = await Promise.all([htlcFeeBps(fromKey), htlcFeeBps(toKey)]);
  const netA = amount * (1 - feeA / 10000);
  const sent = netA * (1 - LP_SPREAD_BPS / 10000);
  const recv = sent * (1 - feeB / 10000);
  return { recv, feeA, feeB, spread: LP_SPREAD_BPS, totalPct: (1 - recv / amount) * 100 };
}

export async function nativeBalance(chainKey, address) {
  return parseFloat(ethers.formatEther(await readProvider(chainKey).getBalance(address)));
}

export async function lpLiquidity(chainKey, lpAddress) {
  return nativeBalance(chainKey, lpAddress);
}

export function routeSupported(fromKey, toKey, fromSym, toSym, lpAddress) {
  return fromKey !== toKey && fromSym === 'ETH' && toSym === 'ETH'
    && ROUTES.some(([a, b]) => a === fromKey && b === toKey)
    && !!HTLC_ADDRESSES[fromKey] && !!HTLC_ADDRESSES[toKey]
    && !!CHAIN_RPC[fromKey] && !!CHAIN_RPC[toKey]
    && ethers.isAddress(lpAddress);
}

export function validateAmount(amount, liquidity) {
  if (amount < SWAP_LIMITS.min) return `Minimum is ${SWAP_LIMITS.min} ETH`;
  if (amount > SWAP_LIMITS.max) return `Maximum is ${SWAP_LIMITS.max} ETH per swap`;
  if (liquidity !== null && amount * 1.01 > liquidity) return 'Not enough LP liquidity on the destination chain';
  return null;
}

/* ─── Steps ─── */
export const STEPS = [
  { id: 'switch',  label: 'Switch network' },
  { id: 'lock',    label: 'Lock funds' },
  { id: 'wait',    label: 'Wait for liquidity provider' },
  { id: 'claim',   label: 'Claim on destination' },
  { id: 'done',    label: 'Done' }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* getLogs with an adaptive range (public RPCs reject wide ranges). */
async function queryChunked(contract, filter, from, to, step = 400) {
  const out = [];
  let cur = from;
  while (cur <= to) {
    const end = Math.min(cur + step - 1, to);
    try { out.push(...await contract.queryFilter(filter, cur, end)); cur = end + 1; }
    catch (e) { if (step <= 10) throw e; step = Math.floor(step / 2); }
  }
  return out;
}

/**
 * Starts a swap of `amountEth` ETH from fromKey to toKey.
 * onStep(stepId, detail) is called as the flow progresses; throws on failure.
 */
export async function runSwap({ fromKey, toKey, amountEth, wallet, lpAddress, onStep }) {
  onStep('switch');
  await ensureChain(fromKey);

  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const htlc = new ethers.Contract(HTLC_ADDRESSES[fromKey], HTLC_ABI, signer);

  // Minimum acceptable payout on the destination chain: 1% under the quote. Anything lower
  // is treated as a hostile or broken lock and is never claimed (see waitAndClaim).
  const quote = await quoteEthToEth(amountEth, fromKey, toKey);
  const minRecvWei = ethers.parseEther((quote.recv * 0.99).toFixed(18)).toString();

  const preimage = ethers.hexlify(ethers.randomBytes(32));
  const hashlock = ethers.sha256(preimage); // ZenthisHTLC verifies sha256, not keccak256
  const timelock = Math.floor(Date.now() / 1000) + SWAP_TIMELOCK_SECS;
  const rec = {
    preimage, hashlock, timelock, htlc: HTLC_ADDRESSES[fromKey], createdAt: Date.now(),
    chain: fromKey, chainId: CHAIN_INFO[fromKey].id,
    toChain: toKey, toChainId: CHAIN_INFO[toKey].id,
    initiator: wallet, amount: String(amountEth), swapId: null, status: 'locking',
    lp: lpAddress, minRecvWei
  };
  // Persist the secret BEFORE sending funds: losing it means waiting for the refund.
  const store = loadSwaps(); store.push(rec); saveSwaps(store);

  onStep('lock');
  const destBlock = await readProvider(toKey).getBlockNumber();
  // maxFeeBps = the fee quoted to the user: reverts if the owner raised it meanwhile (audit HTLC-01).
  const tx = await htlc.newSwapProtected(lpAddress, hashlock, timelock, quote.feeA, {
    value: ethers.parseEther(String(amountEth))
  });
  const receipt = await tx.wait();
  const ev = receipt.logs.map(l => { try { return htlc.interface.parseLog(l); } catch { return null; } })
    .find(e => e && e.name === 'SwapCreated');
  updateSwap(hashlock, { swapId: ev.args.swapId, txHash: receipt.hash, status: 'locked', destFromBlock: destBlock - 5 });

  return waitAndClaim(loadSwaps().find(r => r.hashlock === hashlock), wallet, onStep);
}

/**
 * A destination lock is only claimed if it was made by the LP, is native ETH, pays at least the
 * minimum agreed payout and leaves a safe window. Revealing the secret against any other lock
 * (e.g. a 1-wei lock planted by an attacker who copied the public hashlock) would let the LP
 * redeem the source lock while the user receives dust.
 */
export function isGenuineLpLock(ev, rec) {
  return isGenuineLock(ev.args, rec, 600);
}

/** Same checks on any {hashlock, initiator, token, amount, timelock} (event args or getSwap result). */
export function isGenuineLock(a, rec, minSecsLeft) {
  if (a.hashlock !== rec.hashlock) return false;
  const lps = rec.lp ? [rec.lp] : [LP_ADDRESS, LP_ADDRESS_TESTNET].filter(Boolean);
  if (!lps.some(x => x && x.toLowerCase() === a.initiator.toLowerCase())) return false;
  if (a.token !== ethers.ZeroAddress) return false;
  const minWei = rec.minRecvWei ? BigInt(rec.minRecvWei) : ethers.parseEther(String(rec.amount * 0.9));
  if (a.amount < minWei) return false;
  if (Number(a.timelock) < Math.floor(Date.now() / 1000) + minSecsLeft) return false;
  return true;
}

/** Resumable second half: wait for the LP lock on the destination chain and redeem it. */
export async function waitAndClaim(rec, wallet, onStep, { waitMs = 10 * 60 * 1000 } = {}) {
  if (rec.claimed) { onStep('done'); return rec; }
  const toKey = rec.toChain;
  const read = htlcRead(toKey);

  onStep('wait');
  const from = rec.destFromBlock ?? Math.max(0, (await readProvider(toKey).getBlockNumber()) - 2000);
  let lock = null;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline && !lock) {
    const latest = await readProvider(toKey).getBlockNumber();
    const evs = await queryChunked(read, read.filters.SwapCreated(null, null, wallet), from, latest);
    lock = evs.find(e => isGenuineLpLock(e, rec)) || null;
    if (!lock) await sleep(4000);
  }
  if (!lock) {
    updateSwap(rec.hashlock, { status: 'lp-timeout' });
    const err = new Error('The liquidity provider did not lock funds in time. Your funds are safe: refund after the timelock from "My swaps".');
    err.code = 'LP_TIMEOUT';
    throw err;
  }
  updateSwap(rec.hashlock, { idB: lock.args.swapId, amountB: lock.args.amount.toString(), status: 'lp-locked' });

  onStep('claim');
  const state = await read.getSwap(lock.args.swapId);
  if (Number(state.status) !== 1) {
    updateSwap(rec.hashlock, { claimed: Number(state.status) === 2, status: 'done' });
    onStep('done');
    return loadSwaps().find(r => r.hashlock === rec.hashlock);
  }

  const destBalance = await nativeBalance(toKey, wallet);
  if (destBalance >= MIN_GAS_BALANCE_ETH) {
    // Self-claim: the user has gas on the destination chain.
    await ensureChain(toKey);
    const signer = await new ethers.BrowserProvider(window.ethereum).getSigner();
    const htlc = new ethers.Contract(HTLC_ADDRESSES[toKey], HTLC_ABI, signer);
    // The network switch can take a while: re-validate the lock right before revealing the secret.
    const fresh = await htlc.getSwap(lock.args.swapId);
    if (Number(fresh.status) !== 1 || fresh.recipient.toLowerCase() !== wallet.toLowerCase()
        || !isGenuineLock(fresh, rec, 120)) {
      const err = new Error('The destination lock changed or is about to expire; the secret was NOT revealed. Your funds are safe: refund from "My swaps" after the timelock.');
      err.code = 'LOCK_CHANGED';
      throw err;
    }
    const tx = await htlc.redeem(lock.args.swapId, rec.preimage);
    const rc = await tx.wait();
    updateSwap(rec.hashlock, { claimed: true, claimTx: rc.hash, status: 'done' });
  } else {
    // Gasless claim: hand the secret to the LP, which redeems for us and pays the gas.
    onStep('claim', 'gasless');
    await postRelay({ hashlock: rec.hashlock, preimage: rec.preimage, idB: lock.args.swapId });
    let redeemed = false;
    for (let i = 0; i < 45 && !redeemed; i++) {
      await sleep(4000);
      redeemed = Number((await read.getSwap(lock.args.swapId)).status) === 2;
    }
    if (!redeemed) {
      const err = new Error('The liquidity provider has not claimed for you yet. Retry from "My swaps", or add a little ETH on the destination chain to claim yourself.');
      err.code = 'RELAY_TIMEOUT';
      throw err;
    }
    updateSwap(rec.hashlock, { claimed: true, status: 'done', claimedBy: 'relay' });
  }
  onStep('done');
  return loadSwaps().find(r => r.hashlock === rec.hashlock);
}

async function postRelay(payload) {
  const res = await fetch(RELAY_URL, { method: 'POST', body: JSON.stringify(payload) });
  if (!res.ok) throw new Error('Could not reach the claim relay (' + res.status + ')');
}
