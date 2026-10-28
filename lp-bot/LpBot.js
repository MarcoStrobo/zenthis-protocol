"use strict";
/**
 * Liquidity-provider bot for ZenthisHTLC atomic swaps (native ETH <-> native ETH).
 *
 * Flow per swap (user = initiator on chain A, bot = LP):
 *   1. User locks X on A: recipient = LP, hashlock H, timelock TA.
 *   2. Bot sees SwapCreated(A), validates it, locks X*(1-spread) on B:
 *      recipient = user, same H, timelock TB = TA - safetyMargin (always < TA).
 *   3. User redeems on B, revealing the preimage in SwapRedeemed(B).
 *   4. Bot reads the preimage from B and redeems on A.
 *   5. If the user never redeems, bot refunds its own B lock after TB.
 *
 * All contracts are injected so the same class runs against real RPCs or two
 * hardhat deployments (see test/LpBot.test.js).
 */

const { sha256, ZeroAddress } = require("ethers");

const HEX32 = /^0x[0-9a-fA-F]{64}$/;

const SECONDS = 1;

const DEFAULTS = {
  spreadBps: 30n, // 0.30 %
  minAmount: 10n ** 15n, // wei (0.001 ETH): dust swaps cost the LP gas for no benefit
  maxAmount: 10n ** 18n, // 1 ETH
  maxOpenExposure: 5n * 10n ** 18n, // sum of B-side amounts currently locked
  maxOpenPerInitiator: 2n * 10n ** 17n, // wei per initiator address (limits capital-lock griefing)
  reconcileGrace: 600, // seconds before an unconfirmed B lock is declared failed
  largeAmount: 5n * 10n ** 16n, // wei: swaps at or above this wait for largeConfirmations (LP-03)
  largeConfirmations: 20, // blocks on chain A before locking funds for a large swap
  safetyMargin: 60 * 60 * SECONDS, // TA - TB
  minRemainingA: 90 * 60 * SECONDS, // required (TA - now) to accept a swap
  confirmations: 2, // blocks to wait on chain A before acting
  maxBlockRange: 2000, // eth_getLogs chunk size
  minBalanceB: 0n, // wei; alert when the LP balance on chain B drops below this (0 = off)
  alertCooldown: 3600, // seconds between repeated low-balance alerts
};

class LpBot {
  /**
   * @param {object} o
   * @param {import("ethers").Contract} o.htlcA  ZenthisHTLC on source chain, connected to LP signer
   * @param {import("ethers").Contract} o.htlcB  ZenthisHTLC on destination chain, connected to LP signer
   * @param {string} o.lpAddress                 LP address (same EOA on both chains)
   * @param {object} o.state                     { load():obj, save(obj) } persistence
   * @param {object} [o.config]                  overrides for DEFAULTS
   * @param {(msg:string)=>void} [o.log]
   */
  constructor({
    htlcA,
    htlcB,
    lpAddress,
    state,
    config = {},
    log = console.log,
    alert = () => {},
    relay = null,
  }) {
    this.A = htlcA;
    this.B = htlcB;
    this.lp = lpAddress.toLowerCase();
    this.store = state;
    this.cfg = { ...DEFAULTS, ...config };
    this.log = log;
    this.relay = relay; // optional { claims(): Promise<{hashlock, preimage}[]> } for gasless user claims
    this.alert = alert; // (message) => void; called for events needing attention
    this.s = this.store.load();
    if (!this.s.swaps) this.s.swaps = {};
    if (!this.s.hashlocks) this.s.hashlocks = [];
  }

  // -- helpers
  _save() {
    this.store.save(this.s);
  }
  async _ts(contract) {
    const b = await contract.runner.provider.getBlock("latest");
    return b.timestamp;
  }
  _openExposure(initiator = null) {
    return Object.values(this.s.swaps)
      .filter((x) => ["locked", "locking", "uncertain"].includes(x.status))
      .filter((x) => !initiator || x.initiator.toLowerCase() === initiator.toLowerCase())
      .reduce((a, x) => a + BigInt(x.amountB || 0), 0n);
  }

  /** Price quote: what the bot sends on B for `netA` received on A. */
  quote(netA) {
    return (netA * (10_000n - this.cfg.spreadBps)) / 10_000n;
  }

  /** Returns a rejection reason or null if the swap is acceptable. */
  async _validate(ev, nowA) {
    const { amount, hashlock, timelock, initiator, token } = ev.args;
    // LP-05: SwapCreated is also emitted for ERC-20 swaps, whose `amount` is in token units.
    // Treating it as wei would let anyone lock real ETH on B against a worthless token.
    if (token !== ZeroAddress) return "not native ETH";
    if (initiator.toLowerCase() === this.lp) return "initiator is LP";
    if (amount < this.cfg.minAmount) return "amount below min";
    if (amount > this.cfg.maxAmount) return "amount above max";
    if (this._openExposure() + this.quote(amount) > this.cfg.maxOpenExposure)
      return "exposure limit reached";
    if (this.s.hashlocks.includes(hashlock)) return "hashlock reused";
    if (this._openExposure(initiator) + this.quote(amount) > this.cfg.maxOpenPerInitiator)
      return "initiator exposure limit reached";
    if (BigInt(timelock) - BigInt(nowA) < BigInt(this.cfg.minRemainingA))
      return "timelock too close to expiry";
    return null;
  }

  // -- main loop step
  async tick() {
    // LP-07: finishing swaps that already hold funds comes FIRST and must never be starved by a
    // failure in discovery (RPC down, bad relay data, ...). Each phase is isolated; the first
    // error is re-thrown at the end so the caller still logs it.
    const phases = [
      ["progress", () => this._progressSwaps()],
      ["relay", () => this._processRelay()],
      ["scan", () => this._scanChainA()],
      ["progress2", () => this._progressSwaps()], // pick up locks/redeems created by the phases above
      ["balance", () => this._checkBalance()],
    ];
    let firstErr = null;
    for (const [name, fn] of phases) {
      try {
        await fn();
      } catch (e) {
        if (!firstErr) firstErr = e;
        this.log(`[phase:${name}] ${e.shortMessage || e.message}`);
      }
    }
    if (firstErr) throw firstErr;
  }

  /**
   * getLogs with an adaptive range: public RPCs often reject wide ranges (e.g. >= 500 blocks).
   * On failure the chunk is halved (down to 10 blocks) and the smaller size is remembered.
   */
  async _logs(contract, filter, from, to) {
    const out = [];
    let step = this.cfg.maxBlockRange;
    let cur = from;
    while (cur <= to) {
      const end = Math.min(cur + step - 1, to);
      try {
        out.push(...(await contract.queryFilter(filter, cur, end)));
        cur = end + 1;
      } catch (e) {
        if (step <= 10) throw e;
        step = Math.floor(step / 2);
        this.cfg.maxBlockRange = step;
      }
    }
    return out;
  }

  /**
   * Gasless claim for users: redeem the lock we made on B on their behalf (redeem pays the
   * recipient regardless of caller). The preimage is validated against the stored hashlock.
   */
  async _processRelay() {
    if (!this.relay) return;
    let claims;
    try {
      claims = await this.relay.claims();
    } catch (e) {
      this.log(`[relay] poll failed: ${e.message}`);
      return;
    }
    if (!Array.isArray(claims)) return;
    for (const c of claims.slice(0, 200)) {
      // LP-06: relay data is untrusted. Validate shape, isolate each claim, never throw.
      try {
        if (!c || typeof c !== "object") continue;
        if (!HEX32.test(c.hashlock) || !HEX32.test(c.preimage)) continue;
        const rec = Object.values(this.s.swaps).find((x) => x.hashlock === c.hashlock);
        if (!rec || rec.status !== "locked" || (rec.relayAttempts || 0) >= 3) continue;
        if (sha256(c.preimage) !== rec.hashlock) continue;
        rec.relayAttempts = (rec.relayAttempts || 0) + 1;
        this._save();
        if (await this.B.isActive(rec.idB)) await (await this.B.redeem(rec.idB, c.preimage)).wait();
        this.log(`[relay-redeemed] B:${rec.idB}`);
      } catch (e) {
        this.log(`[relay] claim failed: ${e.shortMessage || e.message}`);
      }
    }
  }

  async _checkBalance() {
    if (this.cfg.minBalanceB <= 0n) return;
    const bal = await this.B.runner.provider.getBalance(this.lp);
    const now = Math.floor(Date.now() / 1000);
    if (
      bal < this.cfg.minBalanceB &&
      now - (this.s.lastLowBalance || 0) >= this.cfg.alertCooldown
    ) {
      this.s.lastLowBalance = now;
      this.alert(`LP balance on chain B is low: ${bal} wei (min ${this.cfg.minBalanceB})`);
      this._save();
    }
  }

  async _scanChainA() {
    const provider = this.A.runner.provider;
    const latest = await provider.getBlockNumber();
    const safe = latest - this.cfg.confirmations;
    if (this.s.cursorA === undefined) this.s.cursorA = Math.max(0, safe - 1);
    let from = this.s.cursorA + 1;
    if (from > safe) return;

    const filter = this.A.filters.SwapCreated(null, null, this.lp);
    while (from <= safe) {
      const to = Math.min(from + this.cfg.maxBlockRange - 1, safe);
      const events = await this._logs(this.A, filter, from, to);
      // LP-03: a large swap is only acted on once it is buried deeper, so a shallow L2 reorg
      // cannot leave us with a lock on B and nothing on A. The cursor stays before it.
      let deferredFrom = null;
      for (const ev of events) {
        const large = BigInt(ev.args.amount) >= this.cfg.largeAmount;
        if (large && ev.blockNumber > latest - this.cfg.largeConfirmations) {
          if (deferredFrom === null) deferredFrom = ev.blockNumber;
          continue;
        }
        await this._handleNewSwap(ev);
      }
      if (deferredFrom !== null) {
        this.s.cursorA = deferredFrom - 1; // already-handled events are skipped on rescan
        this._save();
        return;
      }
      this.s.cursorA = to;
      this._save();
      from = to + 1;
    }
  }

  async _handleNewSwap(ev) {
    const idA = ev.args.swapId;
    if (this.s.swaps[idA]) return;
    const nowA = await this._ts(this.A);
    const reason = await this._validate(ev, nowA);
    const rec = {
      idA,
      initiator: ev.args.initiator,
      amountA: ev.args.amount.toString(),
      hashlock: ev.args.hashlock,
      timelockA: Number(ev.args.timelock),
      status: "rejected",
    };
    this.s.swaps[idA] = rec;
    if (reason) {
      rec.reason = reason;
      this.log(`[reject] ${idA} ${reason}`);
      return this._save();
    }
    this.s.hashlocks.push(rec.hashlock);

    const amountB = this.quote(ev.args.amount);
    const timelockB = rec.timelockA - this.cfg.safetyMargin;

    // Write-ahead: persist the intent BEFORE sending funds. If the process dies or the RPC
    // answers ambiguously after broadcast, the swap is reconciled from chain data instead of
    // being re-locked (a second lock with the same hashlock would be redeemable twice).
    rec.status = "locking";
    rec.amountB = amountB.toString();
    rec.timelockB = timelockB;
    rec.lockingAt = Math.floor(Date.now() / 1000);
    rec.blockHintB = await this.B.runner.provider.getBlockNumber();
    this._save();

    let tx;
    try {
      tx = await this.B.newSwap(rec.initiator, rec.hashlock, timelockB, { value: amountB });
    } catch (e) {
      const text = `${e.message} ${e.shortMessage || ""} ${e.info?.error?.message || ""}`;
      // Definitive = rejected before broadcast (revert on gas estimation, no funds). Anything
      // else (timeouts, "could not coalesce error", ...) may have reached the network.
      const definitive =
        ["CALL_EXCEPTION", "INSUFFICIENT_FUNDS", "ACTION_REJECTED"].includes(e.code) ||
        /revert|insufficient funds/i.test(text);
      if (definitive) {
        rec.status = "failed";
        rec.reason = `lock on B failed: ${e.shortMessage || e.message}`;
        this.log(`[fail] ${idA} ${rec.reason}`);
        this.alert(`Could not lock on B for swap ${idA}: ${rec.reason}`);
      } else {
        rec.status = "uncertain";
        this.log(`[uncertain] ${idA} send error: ${e.shortMessage || e.message}`);
      }
      return this._save();
    }
    rec.txB = tx.hash;
    this._save();
    try {
      this._adoptLock(rec, await tx.wait());
      this.log(`[locked] A:${idA} -> B:${rec.idB} amountB=${amountB}`);
    } catch (e) {
      rec.status = "uncertain"; // may or may not be mined: reconcile on the next ticks
      this.log(`[uncertain] ${idA} wait error: ${e.shortMessage || e.message}`);
    }
    this._save();
  }

  _adoptLock(rec, receipt) {
    const created = receipt.logs
      .map((l) => {
        try {
          return this.B.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "SwapCreated");
    if (!created) throw new Error("no SwapCreated in receipt");
    rec.idB = created.args.swapId;
    rec.blockB = receipt.blockNumber;
    rec.status = "locked";
  }

  /** Resolve 'locking' / 'uncertain' swaps from chain data. Never re-sends a lock. */
  async _reconcile(rec) {
    const provider = this.B.runner.provider;
    if (rec.txB) {
      const receipt = await provider.getTransactionReceipt(rec.txB);
      if (receipt) {
        if (receipt.status === 1) {
          this._adoptLock(rec, receipt);
          this.log(`[reconciled] A:${rec.idA} -> B:${rec.idB}`);
        } else {
          rec.status = "failed";
          rec.reason = "lock tx reverted on B";
        }
        return;
      }
    }
    const latest = await provider.getBlockNumber();
    const lpAddr = await this.B.runner.getAddress();
    const evs = await this._logs(
      this.B,
      this.B.filters.SwapCreated(null, lpAddr, rec.initiator),
      rec.blockHintB || 0,
      latest,
    );
    const found = evs.find((e) => e.args.hashlock === rec.hashlock);
    if (found) {
      rec.idB = found.args.swapId;
      rec.blockB = found.blockNumber;
      rec.status = "locked";
      this.log(`[reconciled] A:${rec.idA} -> B:${rec.idB}`);
      return;
    }
    if (Math.floor(Date.now() / 1000) - rec.lockingAt > this.cfg.reconcileGrace) {
      rec.status = "failed";
      rec.reason = "lock on B not found after grace period";
      this.alert(`Lock on B for swap ${rec.idA} never confirmed; marked failed (verify manually)`);
    }
  }

  async _progressSwaps() {
    for (const rec of Object.values(this.s.swaps)) {
      try {
        if (rec.status === "locking" || rec.status === "uncertain") await this._reconcile(rec);
        if (rec.status === "locked") await this._progressLocked(rec);
        else if (rec.status === "revealed") await this._redeemOnA(rec);
      } catch (e) {
        this.log(`[retry] ${rec.idA}: ${e.shortMessage || e.message}`);
      }
    }
    this._save();
  }

  async _progressLocked(rec) {
    const latestB = await this.B.runner.provider.getBlockNumber();
    const evs = await this._logs(
      this.B,
      this.B.filters.SwapRedeemed(rec.idB),
      rec.blockB || 0,
      latestB,
    );
    if (evs.length) {
      rec.preimage = evs[0].args.preimage;
      rec.status = "revealed";
      this.log(`[revealed] B:${rec.idB}`);
      return this._redeemOnA(rec);
    }
    const nowB = await this._ts(this.B);
    if (nowB >= rec.timelockB && (await this.B.isActive(rec.idB))) {
      await (await this.B.refund(rec.idB)).wait();
      rec.status = "refunded";
      this.log(`[refunded] B:${rec.idB}`);
    }
  }

  async _redeemOnA(rec) {
    const nowA = await this._ts(this.A);
    if (!(await this.A.isActive(rec.idA))) {
      rec.status = "completed";
      return;
    }
    if (nowA >= rec.timelockA) {
      rec.status = "missed"; // should never happen given the safety margin; alert!
      this.log(`[ALERT] missed redeem window on A for ${rec.idA}`);
      this.alert(`Missed redeem window on A for swap ${rec.idA}`);
      return;
    }
    try {
      await (await this.A.redeem(rec.idA, rec.preimage)).wait();
      rec.status = "completed";
      this.log(`[completed] A:${rec.idA}`);
    } catch (e) {
      this.log(`[retry] redeem A ${rec.idA}: ${e.shortMessage || e.message}`);
    }
  }
}

module.exports = { LpBot, DEFAULTS };
