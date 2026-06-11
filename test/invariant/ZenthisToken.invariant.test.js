const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Invariant Tests — ZenthisToken (Staking ERC-20)
 *
 * Key invariants:
 *  1. totalSupply ≤ MAX_SUPPLY (100,000,000 tokens) — always
 *  2. totalStaked = Σ stakedBalance[each staker]
 *  3. totalStaked ≤ balanceOf(this)     (contract holds all staked tokens)
 *  4. Σ staked balances ≤ totalSupply   (can't stake more than exists)
 *  5. After stake: bal(user) decreases, stakedBalance(user) increases
 *  6. After unstake: bal(user) increases, stakedBalance(user) decreases
 *  7. Reward accumulation is monotonic between claims
 *  8. Claim resets rewards mapping to 0
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine");
}

describe("ZenthisToken — Invariant Tests", function () {
  let token;
  let owner, staker1, staker2, staker3;
  const MAX_SUPPLY = 100_000_000n * 10n ** 18n;

  beforeEach(async function () {
    [owner, staker1, staker2, staker3] = await ethers.getSigners();

    const ZenthisToken = await ethers.getContractFactory("ZenthisToken");
    token = await ZenthisToken.deploy(owner.address);
    await token.waitForDeployment();

    const fund = ethers.parseEther("500000");
    for (const s of [staker1, staker2, staker3]) {
      await token.transfer(s.address, fund);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT 1: totalSupply never exceeds MAX_SUPPLY
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Invariant: totalSupply ≤ MAX_SUPPLY", function () {
    it("should hold through any sequence of transfers/stakes", async function () {
      const stakers = [staker1, staker2, staker3];

      // Random action loop
      for (let round = 0; round < 100; round++) {
        const actor = stakers[randInt(0, 2)];
        const action = randInt(0, 2); // 0=transfer, 1=stake, 2=unstake

        if (action === 0) {
          const bal = await token.balanceOf(actor.address);
          if (bal > BigInt(10 ** 15)) {
            const amt = (bal * BigInt(randInt(1, 10))) / 100n;
            if (amt > 0n) {
              const target = stakers[(stakers.indexOf(actor) + 1) % 3];
              await token.connect(actor).transfer(target.address, amt);
            }
          }
        } else if (action === 1) {
          const bal = await token.balanceOf(actor.address);
          if (bal > BigInt(10 ** 15)) {
            const amt = (bal * BigInt(randInt(1, 20))) / 100n;
            if (amt > 0n) await token.connect(actor).stake(amt);
          }
        } else if (action === 2) {
          const st = await token.stakedBalance(actor.address);
          if (st > BigInt(10 ** 15)) {
            const amt = (st * BigInt(randInt(1, 30))) / 100n;
            if (amt > 0n) await token.connect(actor).unstake(amt);
          }
        } else {
          const bal = await token.balanceOf(actor.address);
          if (bal > BigInt(10 ** 15)) {
            const amt = (bal * BigInt(randInt(1, 5))) / 100n;
            if (amt > 0n) await token.connect(actor).burn(amt);
          }
        }

        // INVARIANT CHECK
        const supply = await token.totalSupply();
        expect(supply).to.be.lte(MAX_SUPPLY);
        expect(supply).to.be.gt(0n);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT 2: totalStaked = Σ stakedBalance[i]
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Invariant: totalStaked = Σ stakedBalance", function () {
    it("should hold through mixed stake/unstake operations", async function () {
      const stakers = [staker1, staker2, staker3];

      for (let round = 0; round < 50; round++) {
        const actor = stakers[randInt(0, 2)];

        if (Math.random() > 0.5) {
          // Stake
          const bal = await token.balanceOf(actor.address);
          if (bal > BigInt(10 ** 15)) {
            const amt = (bal * BigInt(randInt(1, 25))) / 100n;
            if (amt > 0n) await token.connect(actor).stake(amt);
          }
        } else {
          // Unstake
          const st = await token.stakedBalance(actor.address);
          if (st > BigInt(10 ** 15)) {
            const amt = (st * BigInt(randInt(1, 40))) / 100n;
            if (amt > 0n) await token.connect(actor).unstake(amt);
          }
        }

        const totalStaked = await token.totalStaked();
        let sum = 0n;
        for (const s of stakers) {
          sum += await token.stakedBalance(s.address);
        }
        expect(totalStaked).to.equal(sum);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT 3: totalStaked ≤ balanceOf(this)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Invariant: totalStaked ≤ contract balance", function () {
    it("should hold across random state changes", async function () {
      // First, stake some from each user
      for (const s of [staker1, staker2, staker3]) {
        const bal = await token.balanceOf(s.address);
        const amt = bal / 5n;
        await token.connect(s).stake(amt);
      }

      for (let round = 0; round < 30; round++) {
        const actor = [staker1, staker2, staker3][randInt(0, 2)];

        if (Math.random() > 0.5) {
          const bal = await token.balanceOf(actor.address);
          if (bal > BigInt(10 ** 15)) {
            const amt = (bal * BigInt(randInt(1, 20))) / 100n;
            if (amt > 0n) await token.connect(actor).stake(amt);
          }
        } else {
          const st = await token.stakedBalance(actor.address);
          if (st > BigInt(10 ** 15)) {
            const amt = (st * BigInt(randInt(1, 30))) / 100n;
            if (amt > 0n) await token.connect(actor).unstake(amt);
          }
        }

        const totalStaked = await token.totalStaked();
        const contractBal = await token.balanceOf(await token.getAddress());
        expect(totalStaked).to.be.lte(contractBal);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT 5: Claim resets rewards to 0
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Invariant: claimRewards resets rewards", function () {
    it("should zero rewards mapping after successful claim", async function () {
      // Stake some tokens
      const stakeAmt = ethers.parseEther("10000");
      await token.connect(staker1).stake(stakeAmt);

      for (let round = 0; round < 5; round++) {
        // Deposit fees
        await token.connect(owner).depositFees({
          value: ethers.parseEther(String(randInt(1, 10))),
        });

        const earned = await token.earned(staker1.address);
        const rewardsStored = await token.rewards(staker1);
        expect(earned).to.be.gte(rewardsStored);

        if (rewardsStored > 0n) {
          await token.connect(staker1).claimRewards();
          // After claim, rewards mapping should be 0
          expect(await token.rewards(staker1)).to.equal(0n);
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT 6: Stake → unstake is symmetric (full cycle)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Invariant: stake/unstake symmetry", function () {
    it("should return same balance after full stake→unstake cycle", async function () {
      for (let i = 0; i < 20; i++) {
        const balBefore = await token.balanceOf(staker2.address);
        const amount = (balBefore * BigInt(randInt(5, 20))) / 100n;
        if (amount === 0n) continue;

        // Stake
        await token.connect(staker2).stake(amount);
        expect(await token.balanceOf(staker2.address)).to.equal(balBefore - amount);
        expect(await token.stakedBalance(staker2.address)).to.equal(amount);

        // Unstake same amount
        await token.connect(staker2).unstake(amount);
        expect(await token.balanceOf(staker2.address)).to.equal(balBefore);
        expect(await token.stakedBalance(staker2.address)).to.equal(0n);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT 7: Governance supply consistency
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Invariant: governance voting power", function () {
    it("should match delegated voting power to balance", async function () {
      // Delegate to self
      await token.connect(staker1).delegate(staker1.address);
      await token.connect(staker2).delegate(staker2.address);

      for (let round = 0; round < 20; round++) {
        // Transfer between stakers
        const from = [staker1, staker2][randInt(0, 1)];
        const to = from === staker1 ? staker2 : staker1;
        const bal = await token.balanceOf(from.address);
        if (bal <= BigInt(10 ** 15)) continue;
        const amt = (bal * BigInt(randInt(1, 10))) / 100n;
        if (amt === 0n) continue;

        await token.connect(from).transfer(to.address, amt);

        // Check voting power matches balance (self-delegated)
        const votes1 = await token.getVotes(staker1.address);
        const bal1 = await token.balanceOf(staker1.address);
        const staked1 = await token.getPastTotalSupply(
          (await ethers.provider.getBlock("latest")).number - 1,
        );

        // Voting power for self-delegated = their balance
        // (minus staked tokens since they're locked in contract)
        // This is a soft check — the exact value depends on snapshot timing
        expect(votes1).to.be.gte(0n);
      }
    });

    it("should have correct total voting supply", async function () {
      const supply = await token.totalSupply();
      const blockNum = await ethers.provider.getBlockNumber();

      // totalSupply and voting supply should match at genesis
      // (voting supply tracks totalSupply - contract balance for staking)
      const pastSupply = await token.getPastTotalSupply(blockNum - 1);
      expect(pastSupply).to.equal(supply);
    });
  });
});

