/**
 * Stateful fuzz of ZenthisHTLC v2. Random (seeded, reproducible) sequences of hostile and honest
 * operations; after EVERY step the on-chain state is checked against an independent model and the
 * solvency / conservation invariants:
 *
 *   ETH:    balance(htlc)   == Σ active ETH swaps + collectedEthFees + totalPendingEthRefunds
 *   token:  balanceOf(htlc) == Σ active token swaps + collectedTokenFees
 *   tokens: Σ balances of all actors + htlc == total minted            (no value created or lost)
 *   status: every swap's on-chain status equals the model's (EMPTY→ACTIVE→{REDEEMED,REFUNDED}, terminal)
 *   redeem pays exactly `amount` to the recipient; refund pays exactly `amount` to the initiator
 *   a wrong preimage, an expired redeem, an early refund and a repeated settle always revert
 *
 * Reproduce a failing run with the printed seed.
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEEDS = process.env.FUZZ_SEEDS
  ? process.env.FUZZ_SEEDS.split(",").map(Number)
  : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const STEPS = Number(process.env.FUZZ_STEPS || 120);
const ACTIVE = 1n;
const REDEEMED = 2n;
const REFUNDED = 3n;

describe("ZenthisHTLC — stateful fuzz (invariants after every step)", function () {
  this.timeout(600000);

  for (const seed of SEEDS) {
    it(`seed ${seed}: ${STEPS} random operations keep every invariant`, async () => {
      const rnd = prng(seed);
      const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
      const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

      const signers = await ethers.getSigners();
      const [owner, ...rest] = signers;
      const users = rest.slice(0, 5);
      const htlc = await (await ethers.getContractFactory("ZenthisHTLC")).deploy();
      const htlcAddr = await htlc.getAddress();
      const token = await (await ethers.getContractFactory("ZenthisToken")).deploy(owner.address);
      const tokenAddr = await token.getAddress();
      const rejecting = await (await ethers.getContractFactory("RejectingInitiator")).deploy();
      const TOTAL = await token.totalSupply();
      for (const u of users) await token.transfer(u.address, ethers.parseEther("100000"));
      for (const u of users) await token.connect(u).approve(htlcAddr, ethers.MaxUint256);

      const model = []; // { id, token, net, status, initiator, recipient, preimage, timelock, viaContract }
      const knownAddrs = [
        owner.address,
        htlcAddr,
        await rejecting.getAddress(),
        ...users.map((u) => u.address),
      ];
      let feeBps = 0n;
      let paused = false;
      let collectedEth = 0n;
      let collectedTok = 0n;

      const idFrom = (rc) =>
        rc.logs.map((l) => htlc.interface.parseLog(l)).find((e) => e?.name === "SwapCreated").args;
      const fee = (g) => (g * feeBps) / 10000n;

      async function checkInvariants(label) {
        const activeEth = model.filter(
          (s) => s.status === ACTIVE && s.token === ethers.ZeroAddress,
        );
        const activeTok = model.filter(
          (s) => s.status === ACTIVE && s.token !== ethers.ZeroAddress,
        );
        const sumEth = activeEth.reduce((a, s) => a + s.net, 0n);
        const sumTok = activeTok.reduce((a, s) => a + s.net, 0n);
        const pending = await htlc.totalPendingEthRefunds();
        const ctx = `seed ${seed} after ${label}`;
        expect(await ethers.provider.getBalance(htlcAddr), `ETH solvency, ${ctx}`).to.equal(
          sumEth + (await htlc.collectedEthFees()) + pending,
        );
        expect(await htlc.collectedEthFees(), `ETH fee model, ${ctx}`).to.equal(collectedEth);
        expect(await token.balanceOf(htlcAddr), `token solvency, ${ctx}`).to.equal(
          sumTok + (await htlc.collectedTokenFees(tokenAddr)),
        );
        expect(await htlc.collectedTokenFees(tokenAddr), `token fee model, ${ctx}`).to.equal(
          collectedTok,
        );
        let held = 0n;
        for (const a of knownAddrs) held += await token.balanceOf(a);
        expect(held, `token conservation, ${ctx}`).to.equal(TOTAL);
        for (const s of model) {
          const onchain = await htlc.getSwap(s.id);
          expect(onchain.status, `status of ${s.id}, ${ctx}`).to.equal(s.status);
          expect(onchain.amount, `amount immutable, ${ctx}`).to.equal(s.net);
        }
      }

      const nowTs = async () => BigInt(await time.latest());
      const active = () => model.filter((s) => s.status === ACTIVE);

      const ops = {
        async newEth() {
          if (paused) return "skip";
          const u = pick(users);
          const rcp = pick(users.filter((x) => x.address !== u.address));
          const value = ethers.parseEther((int(1, 2000) / 1000).toString());
          const pre = ethers.hexlify(ethers.randomBytes(32));
          const tl = Number(await nowTs()) + int(300, 86400);
          const protectedCall = rnd() < 0.4;
          const maxFee = BigInt(int(0, 600));
          if (protectedCall && feeBps > maxFee) {
            await expect(
              htlc
                .connect(u)
                .newSwapProtected(rcp.address, ethers.sha256(pre), tl, maxFee, { value }),
            ).to.be.revertedWith("HTLC: fee above max");
            return "protected-revert";
          }
          const call = protectedCall
            ? htlc
                .connect(u)
                .newSwapProtected(rcp.address, ethers.sha256(pre), tl, maxFee, { value })
            : htlc.connect(u).newSwap(rcp.address, ethers.sha256(pre), tl, { value });
          const a = idFrom(await (await call).wait());
          const f = fee(value);
          collectedEth += f;
          model.push({
            id: a.swapId,
            token: ethers.ZeroAddress,
            net: value - f,
            status: ACTIVE,
            initiator: u.address,
            recipient: rcp.address,
            preimage: pre,
            timelock: BigInt(tl),
          });
          expect(a.amount).to.equal(value - f);
          return "newEth";
        },
        async newToken() {
          if (paused) return "skip";
          const u = pick(users);
          const rcp = pick(users.filter((x) => x.address !== u.address));
          const amt = ethers.parseEther(int(1, 5000).toString());
          const pre = ethers.hexlify(ethers.randomBytes(32));
          const tl = Number(await nowTs()) + int(300, 86400);
          const a = idFrom(
            await (
              await htlc
                .connect(u)
                .newSwapToken(rcp.address, tokenAddr, amt, ethers.sha256(pre), tl)
            ).wait(),
          );
          const f = fee(amt);
          collectedTok += f;
          model.push({
            id: a.swapId,
            token: tokenAddr,
            net: amt - f,
            status: ACTIVE,
            initiator: u.address,
            recipient: rcp.address,
            preimage: pre,
            timelock: BigInt(tl),
          });
          return "newToken";
        },
        async newViaContract() {
          if (paused) return "skip";
          const rcp = pick(users);
          const value = ethers.parseEther((int(1, 1000) / 1000).toString());
          const pre = ethers.hexlify(ethers.randomBytes(32));
          const tl = Number(await nowTs()) + int(300, 86400);
          const args = [htlcAddr, rcp.address, ethers.sha256(pre), tl];
          const id = await rejecting.start.staticCall(...args, { value: value + 0n });
          await rejecting.connect(pick(users)).start(...args, { value });
          const f = fee(value);
          collectedEth += f;
          model.push({
            id,
            token: ethers.ZeroAddress,
            net: value - f,
            status: ACTIVE,
            initiator: await rejecting.getAddress(),
            recipient: rcp.address,
            preimage: pre,
            timelock: BigInt(tl),
            viaContract: true,
          });
          return "newViaContract";
        },
        async redeemOk() {
          const live = active();
          if (!live.length) return "skip";
          const s = pick(live);
          if ((await nowTs()) >= s.timelock) {
            await expect(htlc.redeem(s.id, s.preimage)).to.be.revertedWith("HTLC: swap expired");
            return "redeem-expired-revert";
          }
          const callers = [owner, ...users].filter((x) => x.address !== s.recipient);
          const caller = pick(callers);
          const isEth = s.token === ethers.ZeroAddress;
          const before = isEth
            ? await ethers.provider.getBalance(s.recipient)
            : await token.balanceOf(s.recipient);
          await htlc.connect(caller).redeem(s.id, s.preimage);
          const after = isEth
            ? await ethers.provider.getBalance(s.recipient)
            : await token.balanceOf(s.recipient);
          expect(after - before, "recipient paid exactly net").to.equal(s.net);
          s.status = REDEEMED;
          // terminal: cannot be settled again
          await expect(htlc.redeem(s.id, s.preimage)).to.be.revertedWith("HTLC: swap not active");
          await expect(htlc.refund(s.id)).to.be.revertedWith("HTLC: swap not active");
          return "redeem";
        },
        async redeemWrong() {
          const live = active();
          if (!live.length) return "skip";
          const s = pick(live);
          const bad = ethers.hexlify(ethers.randomBytes(32));
          const err =
            (await nowTs()) >= s.timelock ? "HTLC: swap expired" : "HTLC: invalid preimage";
          await expect(htlc.connect(pick(users)).redeem(s.id, bad)).to.be.revertedWith(err);
          return "redeem-wrong";
        },
        async refund() {
          const live = active();
          if (!live.length) return "skip";
          const s = pick(live);
          if ((await nowTs()) < s.timelock) {
            await expect(htlc.refund(s.id)).to.be.revertedWith("HTLC: timelock not expired");
            return "refund-early-revert";
          }
          const isEth = s.token === ethers.ZeroAddress;
          const caller = pick([owner, ...users].filter((x) => x.address !== s.initiator));
          const before =
            isEth && !s.viaContract
              ? await ethers.provider.getBalance(s.initiator)
              : await token.balanceOf(s.initiator);
          await htlc.connect(caller).refund(s.id);
          if (s.viaContract) {
            // ETH-rejecting initiator: refund is credited, then withdrawn to a normal address
            expect(await htlc.pendingEthRefunds(s.initiator)).to.be.gte(s.net);
            const to = pick(users);
            const b0 = await ethers.provider.getBalance(to.address);
            const owed = await htlc.pendingEthRefunds(s.initiator);
            await rejecting.withdraw(htlcAddr, to.address);
            expect((await ethers.provider.getBalance(to.address)) - b0).to.equal(owed);
            expect(await htlc.pendingEthRefunds(s.initiator)).to.equal(0n);
          } else {
            const after = isEth
              ? await ethers.provider.getBalance(s.initiator)
              : await token.balanceOf(s.initiator);
            expect(after - before, "initiator refunded exactly net").to.equal(s.net);
          }
          s.status = REFUNDED;
          await expect(htlc.refund(s.id)).to.be.revertedWith("HTLC: swap not active");
          return "refund";
        },
        async warp() {
          await time.increase(int(1, 40000));
          return "warp";
        },
        async setFee() {
          const bps = BigInt(int(0, 500));
          await htlc.setFeeBps(bps);
          feeBps = bps;
          return "setFee";
        },
        async tooHighFee() {
          await expect(htlc.setFeeBps(501)).to.be.revertedWith("HTLC: fee too high");
          return "fee-cap";
        },
        async nonOwnerAdmin() {
          const u = pick(users);
          await expect(htlc.connect(u).setFeeBps(1)).to.be.reverted;
          await expect(htlc.connect(u).pause()).to.be.reverted;
          await expect(htlc.connect(u).withdrawEthFees(u.address)).to.be.reverted;
          return "non-owner-denied";
        },
        async withdrawFees() {
          if (collectedEth > 0n && rnd() < 0.5) {
            const to = pick(users);
            const b0 = await ethers.provider.getBalance(to.address);
            await htlc.withdrawEthFees(to.address);
            expect((await ethers.provider.getBalance(to.address)) - b0).to.equal(collectedEth);
            collectedEth = 0n;
          }
          if (collectedTok > 0n && rnd() < 0.5) {
            const to = pick(users);
            const b0 = await token.balanceOf(to.address);
            await htlc.withdrawTokenFees(tokenAddr, to.address);
            expect((await token.balanceOf(to.address)) - b0).to.equal(collectedTok);
            collectedTok = 0n;
          }
          return "withdrawFees";
        },
        async togglePause() {
          if (paused) await htlc.unpause();
          else await htlc.pause();
          paused = !paused;
          return "pause-toggle";
        },
        async createWhilePaused() {
          if (!paused) return "skip";
          await expect(
            htlc
              .connect(pick(users))
              .newSwap(pick(users).address, ethers.sha256("0x01"), Number(await nowTs()) + 3600, {
                value: 1,
              }),
          ).to.be.reverted;
          return "paused-denied";
        },
      };
      const weighted = [
        ["newEth", 8],
        ["newToken", 6],
        ["newViaContract", 2],
        ["redeemOk", 8],
        ["redeemWrong", 3],
        ["refund", 6],
        ["warp", 5],
        ["setFee", 2],
        ["tooHighFee", 1],
        ["nonOwnerAdmin", 1],
        ["withdrawFees", 2],
        ["togglePause", 1],
        ["createWhilePaused", 1],
      ].flatMap(([n, w]) => Array(w).fill(n));

      const counts = {};
      for (let i = 0; i < STEPS; i++) {
        const name = pick(weighted);
        const done = await ops[name]();
        counts[done] = (counts[done] || 0) + 1;
        await checkInvariants(`${name}#${i}`);
      }
      // drain: expire everything and refund / redeem the rest; invariants must still hold
      await time.increase(3 * 86400);
      for (const s of active()) {
        await htlc.refund(s.id);
        s.status = REFUNDED;
      }
      await checkInvariants("final drain");
      const live = model.length;
      expect(live, "the run actually created swaps").to.be.greaterThan(0);
      console.log(`      seed ${seed}: ${live} swaps; ops ${JSON.stringify(counts)}`);
    });
  }
});
