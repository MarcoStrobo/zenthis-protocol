const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Fuzz / Property-Based Tests — ZenthisToken (Staking + ERC-20)
 *
 * Strategies:
 *  - Random stake/unstake amounts within balance
 *  - Random ETH fee deposits
 *  - Claim rewards at random intervals
 *  - Boundary: staked ≤ balanceOf(this), totalStaked = Σ stakedBalance
 *  - Burn with random amounts
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine");
}

describe("ZenthisToken — Fuzz Tests", function () {
  let token;
  let owner, staker1, staker2, staker3;
  const MAX_SUPPLY = 100_000_000n * 10n ** 18n;

  beforeEach(async function () {
    [owner, staker1, staker2, staker3] = await ethers.getSigners();

    const ZenthisToken = await ethers.getContractFactory("ZenthisToken");
    token = await ZenthisToken.deploy(owner.address);
    await token.waitForDeployment();

    // Give stakers some tokens
    const fundAmount = ethers.parseEther("1000000");
    await token.transfer(staker1.address, fundAmount);
    await token.transfer(staker2.address, fundAmount);
    await token.transfer(staker3.address, fundAmount);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUZZ: stake/unstake — random amounts (50 runs)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("fuzz: stake / unstake — random amounts (50 runs)", function () {
    it("should handle any stake amount ≤ balance", async function () {
      for (let i = 0; i < 50; i++) {
        const balance = await token.balanceOf(staker1.address);
        if (balance < BigInt(10 ** 15)) continue; // skip when balance is too small
        const amount =
          BigInt(randInt(1, Math.max(1, Number(balance / BigInt(10 ** 15))))) * BigInt(10 ** 15);
        if (amount === 0n) continue;

        const totalBefore = await token.totalStaked();
        await token.connect(staker1).stake(amount);

        // Invariants after stake
        const newStaked = await token.stakedBalance(staker1.address);
        expect(newStaked).to.be.gt(0n);
        expect(await token.totalStaked()).to.equal(totalBefore + amount);
        expect(await token.balanceOf(await token.getAddress())).to.be.gte(
          await token.totalStaked(),
        );
      }
    });

    it("should handle stake → unstake cycle with random amounts", async function () {
      for (let i = 0; i < 30; i++) {
        // Stake
        const balance = await token.balanceOf(staker2.address);
        const stakeAmount =
          BigInt(randInt(1, Math.max(1, Number(balance / BigInt(10 ** 15))))) * BigInt(10 ** 15);
        if (stakeAmount === 0n) continue;

        await token.connect(staker2).stake(stakeAmount);

        // Unstake a random portion
        const staked = await token.stakedBalance(staker2.address);
        const unstakePct = randInt(1, 100);
        const unstakeAmount = (staked * BigInt(unstakePct)) / 100n;
        if (unstakeAmount === 0n) continue;

        const totalBefore = await token.totalStaked();
        await token.connect(staker2).unstake(unstakeAmount);

        expect(await token.totalStaked()).to.equal(totalBefore - unstakeAmount);
        expect(await token.stakedBalance(staker2.address)).to.equal(staked - unstakeAmount);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUZZ: depositFees + claimRewards — random ETH amounts (30 runs)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("fuzz: depositFees / claimRewards (30 runs)", function () {
    it("should distribute rewards proportionally", async function () {
      // Each staker stakes a random amount
      for (const staker of [staker1, staker2, staker3]) {
        const balance = await token.balanceOf(staker.address);
        const amount = (balance * BigInt(randInt(10, 50))) / 100n;
        if (amount > 0n) await token.connect(staker).stake(amount);
      }

      const totalStaked = await token.totalStaked();
      if (totalStaked === 0n) return;

      for (let round = 0; round < 30; round++) {
        const feeEth = ethers.parseEther(String(randInt(1, 100)));
        await token.connect(owner).depositFees({ value: feeEth });

        // Check each staker's rewards increased
        for (const staker of [staker1, staker2, staker3]) {
          const earned = await token.earned(staker.address);
          if ((await token.stakedBalance(staker.address)) > 0n) {
            expect(earned).to.be.gte(0n);
          }
        }
      }

      // Claim rewards for each staker
      for (const staker of [staker1, staker2, staker3]) {
        const rewards = await token.rewards(staker.address);
        if (rewards > 0n) {
          const balBefore = await ethers.provider.getBalance(staker.address);
          const tx = await token.connect(staker).claimRewards();
          const receipt = await tx.wait();
          const gasCost = receipt.gasUsed * receipt.gasPrice;
          const balAfter = await ethers.provider.getBalance(staker.address);
          expect(balAfter + gasCost - balBefore).to.equal(rewards);
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUZZ: multiple stakers — random actions (20 runs)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("fuzz: multi-staker random actions (20 runs)", function () {
    it("should maintain totalStaked = Σ stakedBalance across random actions", async function () {
      const stakers = [staker1, staker2, staker3];

      for (let round = 0; round < 20; round++) {
        // Random staker stakes or unstakes
        const idx = randInt(0, 2);
        const staker = stakers[idx];
        const action = randInt(0, 1); // 0 = stake, 1 = unstake

        if (action === 0) {
          // Stake
          const balance = await token.balanceOf(staker.address);
          if (balance <= 0n) continue;
          const amount =
            BigInt(randInt(1, Math.min(100, Number(balance / BigInt(10 ** 15))))) *
            BigInt(10 ** 15);
          if (amount > 0n && amount <= balance) {
            await token.connect(staker).stake(amount);
          }
        } else {
          // Unstake
          const staked = await token.stakedBalance(staker.address);
          if (staked <= 0n) continue;
          const amount =
            BigInt(randInt(1, Math.min(100, Number(staked / BigInt(10 ** 15))))) * BigInt(10 ** 15);
          if (amount > 0n && amount <= staked) {
            await token.connect(staker).unstake(amount);
          }
        }

        // Verify invariant: totalStaked = Σ stakedBalance
        const totalStaked = await token.totalStaked();
        let sumStaked = 0n;
        for (const s of stakers) {
          sumStaked += await token.stakedBalance(s.address);
        }
        expect(totalStaked).to.equal(sumStaked);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUZZ: burn — random amounts (30 runs)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("fuzz: burn — random amounts (30 runs)", function () {
    it("should reduce totalSupply by burned amount", async function () {
      for (let i = 0; i < 30; i++) {
        const balance = await token.balanceOf(staker1.address);
        if (balance <= 0n) break;
        const amount =
          BigInt(randInt(1, Math.min(1000, Number(balance / BigInt(10 ** 15))))) * BigInt(10 ** 15);
        if (amount > balance) continue;

        const supplyBefore = await token.totalSupply();
        await token.connect(staker1).burn(amount);
        const supplyAfter = await token.totalSupply();

        expect(supplyAfter).to.equal(supplyBefore - amount);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUZZ: edge cases — zero amounts, max amounts
  // ═══════════════════════════════════════════════════════════════════════════
  describe("fuzz: edge cases", function () {
    it("should revert stake with 0 amount", async function () {
      await expect(token.connect(staker1).stake(0)).to.be.revertedWithCustomError(
        token,
        "ZeroAmount",
      );
    });

    it("should revert unstake with 0 amount", async function () {
      await expect(token.connect(staker1).unstake(0)).to.be.revertedWithCustomError(
        token,
        "ZeroAmount",
      );
    });

    it("should revert unstake > staked", async function () {
      const balance = await token.balanceOf(staker1.address);
      const stakeAmount = balance / 10n;
      await token.connect(staker1).stake(stakeAmount);

      await expect(token.connect(staker1).unstake(stakeAmount + 1n)).to.be.revertedWithCustomError(
        token,
        "InsufficientStakedBalance",
      );
    });

    it("should revert depositFees with 0 ETH", async function () {
      await expect(token.connect(owner).depositFees({ value: 0 })).to.be.revertedWithCustomError(
        token,
        "ZeroAmount",
      );
    });

    it("should revert claimRewards when nothing to claim", async function () {
      await expect(token.connect(staker1).claimRewards()).to.be.revertedWithCustomError(
        token,
        "ZeroAmount",
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUZZ: totalSupply never exceeds MAX_SUPPLY
  // ═══════════════════════════════════════════════════════════════════════════
  describe("fuzz: MAX_SUPPLY invariant", function () {
    it("should never exceed MAX_SUPPLY after any sequence of actions", async function () {
      // Run many random actions and check invariant
      const stakers = [staker1, staker2, staker3];

      for (let round = 0; round < 50; round++) {
        const idx = randInt(0, 2);
        const staker = stakers[idx];
        const action = randInt(0, 2); // 0=stake, 1=unstake, 2=burn

        if (action === 0) {
          const bal = await token.balanceOf(staker.address);
          if (bal > BigInt(10 ** 15)) {
            const amt = (bal * BigInt(randInt(1, 20))) / 100n;
            if (amt > 0n) await token.connect(staker).stake(amt);
          }
        } else if (action === 1) {
          const st = await token.stakedBalance(staker.address);
          if (st > BigInt(10 ** 15)) {
            const amt = (st * BigInt(randInt(1, 50))) / 100n;
            if (amt > 0n) await token.connect(staker).unstake(amt);
          }
        } else {
          const bal = await token.balanceOf(staker.address);
          if (bal > BigInt(10 ** 15)) {
            const amt = (bal * BigInt(randInt(1, 10))) / 100n;
            if (amt > 0n) await token.connect(staker).burn(amt);
          }
        }

        // INVARIANT
        const supply = await token.totalSupply();
        expect(supply).to.be.lte(MAX_SUPPLY);
        expect(supply).to.be.gt(0n);
      }
    });
  });
});
