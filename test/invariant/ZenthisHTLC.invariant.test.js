const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Invariant Tests — ZenthisHTLC
 *
 * Key invariants:
 *  1. Σ active swap amounts ≤ ETH balance + Σ active ERC20 token balances
 *  2. Swap IDs are never reused (no double-creation)
 *  3. A swap in ACTIVE state has amount > 0
 *  4. After redeem: status is REDEEMED, funds go to recipient
 *  5. After refund: status is REFUNDED, funds go back to initiator
 *  6. Swap states follow valid transitions: EMPTY→ACTIVE→{REDEEMED,REFUNDED}
 *  7. Fees are additive: collectedEthFees is monotonic
 *  8. Only non-reverted statuses have non-zero amounts stored
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function hashlock(preimage) {
  return ethers.sha256(ethers.solidityPacked(["bytes32"], [preimage]));
}
function randomPreimage() {
  return ethers.randomBytes(32);
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function getTimestamp() {
  return (await ethers.provider.getBlock("latest")).timestamp;
}
async function increaseTime(s) {
  await ethers.provider.send("evm_increaseTime", [s]);
  await ethers.provider.send("evm_mine");
}

const MIN_DELTA = 5 * 60;
const MAX_DELTA = 2 * 86400;

describe("ZenthisHTLC — Invariant Tests", function () {
  let htlc, token;
  let owner, initiator, recipient;

  beforeEach(async function () {
    [owner, initiator, recipient] = await ethers.getSigners();

    const HTLC = await ethers.getContractFactory("ZenthisHTLC");
    htlc = await HTLC.deploy();
    await htlc.waitForDeployment();

    const MockToken = await ethers.getContractFactory("ZENTHIS");
    token = await MockToken.deploy(owner.address);
    await token.waitForDeployment();

    await token.transfer(initiator.address, ethers.parseEther("50000"));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT 1: Swap state transition integrity
  //   EMPTY(0) → ACTIVE(1) → REDEEMED(2) or REFUNDED(3)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Invariant: state transitions", function () {
    it("should only allow EMPTY→ACTIVE→{REDEEMED,REFUNDED}", async function () {
      for (let i = 0; i < 30; i++) {
        const now = await getTimestamp();
        const id = ethers.randomBytes(32);
        const pre = randomPreimage();
        const h = hashlock(pre);
        // Use a short timelock (just above min) so either path works
        const tl = now + MIN_DELTA + 30;

        // EMPTY → ACTIVE
        await htlc
          .connect(initiator)
          .newSwap(id, recipient.address, h, tl, { value: ethers.parseEther("1") });
        expect((await htlc.getSwap(id)).status).to.equal(1n);

        // Randomly redeem or refund
        if (Math.random() > 0.5) {
          await htlc.connect(recipient).redeem(id, pre);
          expect((await htlc.getSwap(id)).status).to.equal(2n);
        } else {
          await increaseTime(MIN_DELTA + 30);
          await htlc.connect(initiator).refund(id);
          expect((await htlc.getSwap(id)).status).to.equal(3n);
        }

        // Cannot transition from terminal state back to ACTIVE
        const newId = ethers.randomBytes(32);
        // Try to re-create with same id → should fail
        await expect(
          htlc.connect(initiator).newSwap(id, recipient.address, h, tl + 3600, { value: 100n }),
        ).to.be.revertedWith("HTLC: swap ID already used");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT 2: Active swap amounts ≤ contract balance
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Invariant: contract balance covers active swaps", function () {
    it("should hold: Σ(active ETH amounts) ≤ contract ETH balance", async function () {
      const now = await getTimestamp();
      const activeIds = [];
      let sumActive = 0n;

      for (let i = 0; i < 10; i++) {
        const id = ethers.randomBytes(32);
        const pre = randomPreimage();
        const h = hashlock(pre);
        const tl = now + 3600;
        const amount = ethers.parseEther(String(i + 1));

        await htlc.connect(initiator).newSwap(id, recipient.address, h, tl, { value: amount });

        activeIds.push({ id, pre, amount });
        sumActive += amount;
      }

      // Check invariant before any resolution
      const ethBalance = await ethers.provider.getBalance(await htlc.getAddress());
      expect(ethBalance).to.be.gte(sumActive);

      // Redeem half, re-check
      for (let i = 0; i < 5; i++) {
        const { id, pre, amount } = activeIds[i];
        await htlc.connect(recipient).redeem(id, pre);
        sumActive -= amount;
      }

      const ethBalance2 = await ethers.provider.getBalance(await htlc.getAddress());
      expect(ethBalance2).to.be.gte(sumActive);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT 3: Swap amounts are immutable after creation
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Invariant: swap amount immutable", function () {
    it("should never alter amount after creation", async function () {
      for (let i = 0; i < 20; i++) {
        const now = await getTimestamp();
        const id = ethers.randomBytes(32);
        const pre = randomPreimage();
        const h = hashlock(pre);
        const tl = now + 3600;
        const amount = ethers.parseEther(String(i + 1));

        await htlc.connect(initiator).newSwap(id, recipient.address, h, tl, { value: amount });

        const swap = await htlc.getSwap(id);
        expect(swap.amount).to.equal(amount); // no fee by default

        // Redeem or refund — amount should not change
        if (i % 2 === 0) {
          await htlc.connect(recipient).redeem(id, pre);
        } else {
          await increaseTime(3600);
          await htlc.connect(initiator).refund(id);
        }

        const swapAfter = await htlc.getSwap(id);
        expect(swapAfter.amount).to.equal(amount);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT 4: Fee collection monotonic
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Invariant: fees are additive", function () {
    it("should have monotonically increasing collectedEthFees", async function () {
      await htlc.connect(owner).setFeeBps(100); // 1 %
      const now = await getTimestamp();
      let prevFees = 0n;

      for (let i = 0; i < 15; i++) {
        const id = ethers.randomBytes(32);
        const pre = randomPreimage();
        const h = hashlock(pre);
        const tl = now + 3600;
        const gross = ethers.parseEther(String(i + 1));

        await htlc.connect(initiator).newSwap(id, recipient.address, h, tl, { value: gross });

        const currentFees = await htlc.collectedEthFees();
        expect(currentFees).to.be.gte(prevFees);
        prevFees = currentFees;
      }
    });

    it("should zero fees after withdrawal and restart accumulation", async function () {
      await htlc.connect(owner).setFeeBps(100);
      const now = await getTimestamp();

      // Create some swaps with fees
      for (let i = 0; i < 5; i++) {
        const id = ethers.randomBytes(32);
        const pre = randomPreimage();
        const h = hashlock(pre);
        await htlc
          .connect(initiator)
          .newSwap(id, recipient.address, h, now + 3600, { value: ethers.parseEther("10") });
      }

      const feesBefore = await htlc.collectedEthFees();
      expect(feesBefore).to.be.gt(0n);

      await htlc.connect(owner).withdrawEthFees(owner.address);
      expect(await htlc.collectedEthFees()).to.equal(0n);

      // Create more swaps → fees accumulate again
      for (let i = 0; i < 3; i++) {
        const id = ethers.randomBytes(32);
        const pre = randomPreimage();
        const h = hashlock(pre);
        await htlc
          .connect(initiator)
          .newSwap(id, recipient.address, h, now + 7200, { value: ethers.parseEther("5") });
      }

      expect(await htlc.collectedEthFees()).to.be.gt(0n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT 5: Recipient receives correct amount on redeem
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Invariant: redeem transfers correct amount to recipient", function () {
    it("should transfer exactly swap.amount to recipient", async function () {
      const now = await getTimestamp();

      for (let i = 0; i < 15; i++) {
        const id = ethers.randomBytes(32);
        const pre = randomPreimage();
        const h = hashlock(pre);
        const tl = now + 3600;
        const amount = ethers.parseEther(String(i + 1));

        await htlc.connect(initiator).newSwap(id, recipient.address, h, tl, { value: amount });

        const balBefore = await ethers.provider.getBalance(recipient.address);
        const tx = await htlc.connect(recipient).redeem(id, pre);
        const receipt = await tx.wait();
        const gasCost = receipt.gasUsed * receipt.gasPrice;
        const balAfter = await ethers.provider.getBalance(recipient.address);

        expect(balAfter + gasCost - balBefore).to.equal(amount);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT 6: Refund returns correct amount to initiator
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Invariant: refund returns correct amount to initiator", function () {
    it("should return exactly swap.amount to initiator", async function () {
      for (let i = 0; i < 15; i++) {
        const id = ethers.randomBytes(32);
        const pre = randomPreimage();
        const h = hashlock(pre);
        const now_i = await getTimestamp();
        const tl = now_i + MIN_DELTA + 5;

        const amount = ethers.parseEther(String(i + 1));
        await htlc.connect(initiator).newSwap(id, recipient.address, h, tl, { value: amount });

        await increaseTime(MIN_DELTA + 10);

        const balBefore = await ethers.provider.getBalance(initiator.address);
        const tx = await htlc.connect(initiator).refund(id);
        const receipt = await tx.wait();
        const gasCost = receipt.gasUsed * receipt.gasPrice;
        const balAfter = await ethers.provider.getBalance(initiator.address);

        expect(balAfter + gasCost - balBefore).to.equal(amount);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT 7: Pause state integrity
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Invariant: pause prevents new swaps only", function () {
    it("should reject new swaps when paused but allow existing redeems", async function () {
      const now = await getTimestamp();
      const id = ethers.randomBytes(32);
      const pre = randomPreimage();
      const h = hashlock(pre);
      const tl = now + 3600;

      // Create swap before pause
      await htlc
        .connect(initiator)
        .newSwap(id, recipient.address, h, tl, { value: ethers.parseEther("1") });

      // Pause
      await htlc.connect(owner).pause();
      expect(await htlc.paused()).to.equal(true);

      // New swap should revert
      const id2 = ethers.randomBytes(32);
      await expect(
        htlc.connect(initiator).newSwap(id2, recipient.address, h, tl, { value: 100n }),
      ).to.be.revertedWithCustomError(htlc, "EnforcedPause");

      // Existing swap can still be redeemed
      await htlc.connect(recipient).redeem(id, pre);
      expect((await htlc.getSwap(id)).status).to.equal(2n);

      // Unpause → new swaps work again
      await htlc.connect(owner).unpause();
      await htlc.connect(initiator).newSwap(id2, recipient.address, h, tl, { value: 100n });
      expect(await htlc.isActive(id2)).to.equal(true);
    });
  });
});
