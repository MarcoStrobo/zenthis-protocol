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

const { sha256 } = require("ethers");

const SECONDS = 1;

const DEFAULTS = {
  spreadBps: 30n, // 0.30 %
  minAmount: 0n, // wei, net amount locked on A
  maxAmount: 10n ** 18n, // 1 ETH
  maxOpenExposure: 5n * 10n ** 18n, // sum of B-side amounts currently locked
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
  _openExposure() {
    return Object.values(this.s.swaps)
      .filter((x) => x.status === "locked")
      .reduce((a, x) => a + BigInt(x.amountB), 0n);
  }

  /** Price quote: what the bot sends on B for `netA` received on A. */
  quote(netA) {
    return (netA * (10_000n - this.cfg.spreadBps)) / 10_000n;
  }

  /** Returns a rejection reason or null if the swap is acceptable. */
  async _validate(ev, nowA) {
    const { amount, hashlock, timelock, initiator } = ev.args;
    if (initiator.toLowerCase() === this.lp) return "initiator is LP";
    if (amount < this.cfg.minAmount) return "amount below min";
    if (amount > this.cfg.maxAmount) return "amount above max";
    if (this._openExposure() + this.quote(amount) > this.cfg.maxOpenExposure)
      return "exposure limit reached";
    if (this.s.hashlocks.includes(hashlock)) return "hashlock reused";
    if (BigInt(timelock) - BigInt(nowA) < BigInt(this.cfg.minRemainingA))
      return "timelock too close to expiry";
    return null;
  }

  // -- main loop step
  async tick() {
    await this._scanChainA();
    await this._processRelay();
    await this._progressSwaps();
    await this._checkBalance();
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
    for (const c of claims) {
      const rec = Object.values(this.s.swaps).find((x) => x.hashlock === c.hashlock);
      if (!rec || rec.status !== "locked" || (rec.relayAttempts || 0) >= 3) continue;
      if (typeof c.preimage !== "string" || sha256(c.preimage) !== rec.hashlock) continue;
      rec.relayAttempts = (rec.relayAttempts || 0) + 1;
      try {
        if (await this.B.isActive(rec.idB)) await (await this.B.redeem(rec.idB, c.preimage)).wait();
        this.log(`[relay-redeemed] B:${rec.idB}`);
      } catch (e) {
        this.log(`[relay] redeem B ${rec.idB}: ${e.shortMessage || e.message}`);
      }
      this._save();
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
      for (const ev of events) await this._handleNewSwap(ev);
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
    try {
      const tx = await this.B.newSwap(rec.initiator, rec.hashlock, timelockB, { value: amountB });
      const rc = await tx.wait();
      const created = rc.logs
        .map((l) => {
          try {
            return this.B.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((e) => e && e.name === "SwapCreated");
      rec.idB = created.args.swapId;
      rec.blockB = rc.blockNumber;
      rec.amountB = amountB.toString();
      rec.timelockB = timelockB;
      rec.status = "locked";
      this.log(`[locked] A:${idA} -> B:${rec.idB} amountB=${amountB}`);
    } catch (e) {
      rec.status = "failed";
      rec.reason = `lock on B failed: ${e.shortMessage || e.message}`;
      this.log(`[fail] ${idA} ${rec.reason}`);
      this.alert(`Could not lock on B for swap ${idA}: ${rec.reason}`);
    }
    this._save();
  }

  async _progressSwaps() {
    for (const rec of Object.values(this.s.swaps)) {
      try {
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
