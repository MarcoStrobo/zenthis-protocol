const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Invariant Tests — ZenthisVesting
 *
 * Key invariants:
 *  1. released ≤ vested ≤ totalAmount for every schedule
 *  2. Only beneficiary can release
 *  3. Only owner can create/cancel schedules
 *  4. After cancel (before startTime), tokens return to owner
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function getTimestamp() {
  return (await ethers.provider.getBlock("latest")).timestamp;
}

async function jumpTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine");
}

const MONTH = 30 * 86400;

describe("ZenthisVesting — Invariant Tests", function () {
  let token, vesting;
  let owner, beneficiary;

  beforeEach(async function () {
    [owner, beneficiary] = await ethers.getSigners();

    const ZENTHIS = await ethers.getContractFactory("ZenthisToken");
    token = await ZENTHIS.deploy(owner.address);
    await token.waitForDeployment();

    const Vesting = await ethers.getContractFactory("ZenthisVesting");
    vesting = await Vesting.deploy(await token.getAddress(), owner.address);
    await vesting.waitForDeployment();

    await token.transfer(await vesting.getAddress(), ethers.parseEther("50000000"));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT 1: released ≤ vested ≤ totalAmount
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Invariant: released ≤ vested ≤ totalAmount", function () {
    it("should hold through multiple schedules and time jumps", async function () {
      for (let run = 0; run < 30; run++) {
        // Check if vesting contract has enough tokens left
        const vestingBalance = await token.balanceOf(await vesting.getAddress());
        const maxAllocation = ethers.parseEther("5000000"); // max possible
        if (vestingBalance < maxAllocation) break; // not enough tokens, skip remaining runs

        const schedId = ethers.randomBytes(32);
        const total = ethers.parseEther(String(randInt(1000, 5000000)));
        const tge = (total * BigInt(randInt(0, 30))) / 100n;
        const vestingMonths = randInt(1, 24);

        const now = await getTimestamp();
        const start = now + randInt(10, 86400);

        await vesting
          .connect(owner)
          .createSchedule(schedId, beneficiary.address, total, tge, start, 0, vestingMonths);

        // Jump forward multiple times and release
        for (let step = 0; step < 5; step++) {
          await jumpTime((vestingMonths * MONTH) / 5 + 60);
          try {
            await vesting.connect(beneficiary).release(schedId);
          } catch (_) {}

          const s = await vesting.getSchedule(schedId);
          const vested = await vesting.vestedAmount(schedId);
          expect(s.released).to.be.lte(vested);
        }

        // Jump past full vesting
        await jumpTime((vestingMonths + 12) * MONTH);

        // Release all remaining
        try {
          await vesting.connect(beneficiary).release(schedId);
        } catch (_) {}

        const s = await vesting.getSchedule(schedId);
        const vested = await vesting.vestedAmount(schedId);

        expect(vested).to.equal(total + tge);
        expect(s.released).to.equal(vested);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT 2: Only beneficiary can release
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Invariant: only beneficiary releases", function () {
    it("should revert when non-beneficiary tries to release", async function () {
      for (let run = 0; run < 15; run++) {
        const schedId = ethers.randomBytes(32);
        const total = ethers.parseEther(String(randInt(1000, 1000000)));
        const tge = (total * BigInt(randInt(0, 20))) / 100n;
        const vestingMonths = randInt(1, 12);

        const now = await getTimestamp();
        const start = now + 20;
        await vesting
          .connect(owner)
          .createSchedule(schedId, beneficiary.address, total, tge, start, 0, vestingMonths);

        // Jump forward
        await jumpTime((vestingMonths / 2) * MONTH + 60);

        // Non-beneficiary (owner) tries to release — should revert
        await expect(vesting.connect(owner).release(schedId)).to.be.reverted;
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT 3: Cancel (before startTime) returns all tokens to owner
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Invariant: cancel integrity", function () {
    it("should return all tokens to owner on cancel before startTime", async function () {
      for (let run = 0; run < 15; run++) {
        const schedId = ethers.randomBytes(32);
        const total = ethers.parseEther(String(randInt(1000, 1000000)));
        const tge = (total * BigInt(randInt(0, 20))) / 100n;

        const now = await getTimestamp();

        await vesting
          .connect(owner)
          .createSchedule(
            schedId,
            beneficiary.address,
            total,
            tge,
            now + randInt(3600, 86400 * 7),
            0,
            12,
          );

        const ownerBalBefore = await token.balanceOf(owner.address);
        await vesting.connect(owner).cancelSchedule(schedId);
        const ownerBalAfter = await token.balanceOf(owner.address);

        // Owner received back all tokens
        expect(ownerBalAfter - ownerBalBefore).to.equal(total + tge);
        const s = await vesting.getSchedule(schedId);
        expect(s.released).to.equal(total + tge);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT 4: Cannot release after all tokens released
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Invariant: no release after fully vested + claimed", function () {
    it("should revert when nothing left to release", async function () {
      for (let run = 0; run < 10; run++) {
        const schedId = ethers.randomBytes(32);
        const total = ethers.parseEther("100000");

        await vesting
          .connect(owner)
          .createSchedule(
            schedId,
            beneficiary.address,
            total,
            0n,
            (await getTimestamp()) + 30,
            0,
            4,
          );

        // Move past full vesting
        await jumpTime(5 * MONTH);
        await vesting.connect(beneficiary).release(schedId);

        const s = await vesting.getSchedule(schedId);
        expect(s.released).to.equal(total);

        // Try releasing again — should revert
        await expect(vesting.connect(beneficiary).release(schedId)).to.be.reverted;
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT 5: Linear vesting correctness
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Invariant: linear vesting math", function () {
    it("should vest proportionally to elapsed time", async function () {
      const schedId = ethers.randomBytes(32);
      const total = ethers.parseEther("1000000");
      const tge = total / 10n; // 10 %
      const vestingMonths = 12;
      const now = await getTimestamp();
      const startTime = now + 3600;

      await vesting
        .connect(owner)
        .createSchedule(schedId, beneficiary.address, total, tge, startTime, 0, vestingMonths);

      const durationSecs = BigInt(vestingMonths * MONTH);

      const checkpoints = [0, 25, 50, 75, 100];
      for (const pct of checkpoints) {
        // Jump exactly to the checkpoint position
        const elapsedSecs = BigInt(Math.floor((Number(durationSecs) * pct) / 100));
        // We need to go from current time: (startTime + elapsedSecs) - currentTime
        const target = startTime + Number(elapsedSecs);
        const current = await getTimestamp();
        const jump = Math.max(1, target - current);
        await jumpTime(jump);

        const expectedVested = tge + (total * BigInt(pct)) / 100n;
        const vested = await vesting.vestedAmount(schedId);

        // Allow small rounding tolerance (integer division in contract)
        const diff = expectedVested > vested ? expectedVested - vested : vested - expectedVested;
        expect(diff).to.be.lte(2n);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT 6: Schedule immutable fields after creation
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Invariant: schedule fields immutable after creation", function () {
    it("should not change beneficiary, totalAmount, startTime after creation", async function () {
      for (let run = 0; run < 15; run++) {
        const vestingBalance = await token.balanceOf(await vesting.getAddress());
        const maxAllocation = ethers.parseEther("500000");
        if (vestingBalance < maxAllocation) break;

        const schedId = ethers.randomBytes(32);
        const total = ethers.parseEther(String(randInt(10000, 500000)));
        const tge = total / 10n;
        const cliffMonths = randInt(1, 6);
        const vestingMonths = cliffMonths + randInt(1, 12);
        const startTime = (await getTimestamp()) + randInt(60, 86400);

        await vesting
          .connect(owner)
          .createSchedule(
            schedId,
            beneficiary.address,
            total,
            tge,
            startTime,
            cliffMonths,
            vestingMonths,
          );

        const s0 = await vesting.getSchedule(schedId);
        expect(s0.totalAmount).to.equal(total);
        expect(s0.startTime).to.equal(startTime);
        expect(s0.beneficiary).to.equal(beneficiary.address);

        // Jump far past full vesting and release
        await jumpTime((vestingMonths + 12) * MONTH);
        try {
          await vesting.connect(beneficiary).release(schedId);
        } catch (_) {}

        const s1 = await vesting.getSchedule(schedId);
        // Immutable fields unchanged
        expect(s1.totalAmount).to.equal(total);
        expect(s1.startTime).to.equal(startTime);
        expect(s1.beneficiary).to.equal(beneficiary.address);

        // Mutable fields
        const vested = await vesting.vestedAmount(schedId);
        expect(s1.released).to.be.gte(tge);
        expect(vested).to.equal(total + tge);
      }
    });
  });
});
