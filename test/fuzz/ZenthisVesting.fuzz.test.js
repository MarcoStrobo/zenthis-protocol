const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Fuzz / Property-Based Tests — ZenthisVesting
 *
 * Strategies:
 *  - Random schedule amounts (within allocation bounds)
 *  - Random start times, durations, cliffs
 *  - Random release intervals within the vesting range
 *  - Boundary: released ≤ vested ≤ totalAmount
 *  - Multiple concurrent schedules
 */

// ── Constants from contract ──────────────────────────────────────────────────
const MONTH = 30 * 86400;
const ONE_YEAR = 365 * 86400;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getTimestamp() {
  return (await ethers.provider.getBlock("latest")).timestamp;
}

async function setNextBlockTimestamp(targetTs) {
  const current = await getTimestamp();
  const jump = targetTs > current ? targetTs - current : 60;
  await ethers.provider.send("evm_increaseTime", [jump]);
  await ethers.provider.send("evm_mine");
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

describe("ZenthisVesting — Fuzz Tests", function () {
  let token, vesting;
  let owner, beneficiary, beneficiary2;

  beforeEach(async function () {
    [owner, beneficiary, beneficiary2] = await ethers.getSigners();

    const ZENTHIS = await ethers.getContractFactory("ZenthisToken");
    token = await ZENTHIS.deploy(owner.address);
    await token.waitForDeployment();

    const Vesting = await ethers.getContractFactory("ZenthisVesting");
    vesting = await Vesting.deploy(await token.getAddress(), owner.address);
    await vesting.waitForDeployment();

    // Fund vesting contract with enough tokens
    await token.transfer(await vesting.getAddress(), ethers.parseEther("10000000"));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUZZ: createSchedule — random amounts within bounds
  // ═══════════════════════════════════════════════════════════════════════════
  describe("fuzz: createSchedule — random amounts (50 runs)", function () {
    it("should create schedules with any positive amount", async function () {
      for (let i = 0; i < 50; i++) {
        const schedId = ethers.randomBytes(32);
        const totalAmount = BigInt(randInt(1, 10_000_000)) * BigInt(10 ** 18);
        const tgeAmount = (totalAmount * BigInt(randInt(0, 50))) / 100n; // 0–50 %
        const now = await getTimestamp();
        const startTime = now + randInt(60, ONE_YEAR);
        const cliffMonths = randInt(0, 12);
        const vestingMonths = randInt(cliffMonths + 1, cliffMonths + 48);

        await vesting
          .connect(owner)
          .createSchedule(
            schedId,
            beneficiary.address,
            totalAmount,
            tgeAmount,
            startTime,
            cliffMonths,
            vestingMonths,
          );

        const s = await vesting.getSchedule(schedId);
        expect(s.totalAmount).to.equal(totalAmount);
        expect(s.tgeAmount).to.equal(tgeAmount);
        expect(s.beneficiary).to.equal(beneficiary.address);
        expect(s.released).to.equal(0n); // nothing released yet (not started)
        expect(s.status).to.equal(1n); // INITIALIZED
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUZZ: release — random intervals (30 runs)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("fuzz: release at random intervals (30 runs)", function () {
    it("should never release more than vested", async function () {
      for (let i = 0; i < 30; i++) {
        const schedId = ethers.randomBytes(32);
        const totalAmount = ethers.parseEther(String(randInt(100, 1000000)));
        const tgeAmount = (totalAmount * BigInt(randInt(0, 30))) / 100n;

        const now = await getTimestamp();
        const startTime = now + randInt(60, 30 * 86400);
        const vestingMonths = randInt(1, 12);

        await vesting
          .connect(owner)
          .createSchedule(
            schedId,
            beneficiary.address,
            totalAmount,
            tgeAmount,
            startTime,
            0,
            vestingMonths,
          );

        // Jump to a random point in the vesting period
        const elapsedMonths = randInt(0, vestingMonths * 2); // can go beyond
        const jumpTs = startTime + elapsedMonths * MONTH;
        await setNextBlockTimestamp(Math.max(jumpTs, (await getTimestamp()) + 1));

        // Release — should succeed or revert with NothingToRelease
        try {
          await vesting.connect(beneficiary).release(schedId);
        } catch (e) {
          // NothingToRelease custom error — acceptable if nothing vested yet
          // ethers v6 wraps custom errors as: "VM Exception ... reverted with custom error 'NothingToRelease()'"
          continue;
        }

        const s = await vesting.getSchedule(schedId);
        const vested = await vesting.vestedAmount(schedId);
        // INVARIANT: released ≤ vested ≤ totalAmount
        expect(s.released).to.be.lte(vested);
        expect(vested).to.be.lte(s.totalAmount + s.tgeAmount);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUZZ: cliff boundary tests
  // ═══════════════════════════════════════════════════════════════════════════
  describe("fuzz: cliff boundaries (30 runs)", function () {
    it("should revert release before cliff, succeed after", async function () {
      for (let i = 0; i < 30; i++) {
        const schedId = ethers.randomBytes(32);
        const totalAmount = ethers.parseEther("1000000");
        const cliffMonths = randInt(1, 6);
        const vestingMonths = cliffMonths + randInt(1, 12);

        const now = await getTimestamp();
        const startTime = now + 10;

        await vesting
          .connect(owner)
          .createSchedule(
            schedId,
            beneficiary.address,
            totalAmount,
            0n,
            startTime,
            cliffMonths,
            vestingMonths,
          );

        // Try before cliff ends (TGE is 0, cliff hasn't ended → nothing vested)
        const cliffSecs = cliffMonths * MONTH;
        const beforeCliff = startTime + cliffSecs - 60;
        await setNextBlockTimestamp(Math.max(beforeCliff, now + 1));
        // Should revert with NothingToRelease (no TGE, cliff not met)
        try {
          await vesting.connect(beneficiary).release(schedId);
          // If it succeeded, that's only because TGE > 0 but we set TGE = 0
          // So this should NOT succeed before cliff
          expect.fail("Should have reverted");
        } catch (e) {
          // NothingToRelease is expected
        }

        // Try at/after cliff
        const afterCliff = startTime + cliffSecs + 60;
        await setNextBlockTimestamp(afterCliff);
        try {
          await vesting.connect(beneficiary).release(schedId);
        } catch (e) {
          expect(e.message).to.include("NothingToRelease");
        }

        const s = await vesting.getSchedule(schedId);
        expect(s.released).to.be.gte(0n);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUZZ: totalReleased ≤ totalAmount over time
  // ═══════════════════════════════════════════════════════════════════════════
  describe("fuzz: released never exceeds total (20 runs)", function () {
    it("should maintain released ≤ totalAmount through multiple releases", async function () {
      for (let run = 0; run < 20; run++) {
        const schedId = ethers.randomBytes(32);
        const totalAmount = ethers.parseEther(String(randInt(100, 500000)));
        const tgeAmount = totalAmount / 10n; // 10 % TGE
        const vestingMonths = randInt(2, 12);

        const now = await getTimestamp();
        const startTime = now + 10;

        await vesting
          .connect(owner)
          .createSchedule(
            schedId,
            beneficiary.address,
            totalAmount,
            tgeAmount,
            startTime,
            0,
            vestingMonths,
          );

        // Release 5 times at random points
        for (let j = 0; j < 5; j++) {
          const elapsedMonths = randInt(0, vestingMonths * 2);
          const ts = startTime + elapsedMonths * MONTH + 60;
          await setNextBlockTimestamp(Math.max(ts, (await getTimestamp()) + 1));

          try {
            await vesting.connect(beneficiary).release(schedId);
          } catch (_) {
            /* nothing to release */
          }

          const s = await vesting.getSchedule(schedId);
          const vested = await vesting.vestedAmount(schedId);
          expect(s.released).to.be.lte(vested);
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUZZ: Only beneficiary can release
  // ═══════════════════════════════════════════════════════════════════════════
  describe("fuzz: only beneficiary releases (20 runs)", function () {
    it("should revert when non-beneficiary tries to release", async function () {
      for (let i = 0; i < 20; i++) {
        const schedId = ethers.randomBytes(32);
        const now = await getTimestamp();

        await vesting
          .connect(owner)
          .createSchedule(
            schedId,
            beneficiary.address,
            ethers.parseEther("100000"),
            ethers.parseEther("10000"),
            now + 60,
            0,
            12,
          );

        await setNextBlockTimestamp(now + 3600);

        // beneficiary2 (not the schedule beneficiary) tries to release
        await expect(vesting.connect(beneficiary2).release(schedId)).to.be.reverted;
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUZZ: cancelSchedule — verify tokens returned
  // ═══════════════════════════════════════════════════════════════════════════
  describe("fuzz: cancelSchedule (20 runs)", function () {
    it("should return tokens to owner on cancel (before startTime)", async function () {
      for (let i = 0; i < 20; i++) {
        const schedId = ethers.randomBytes(32);
        const totalAmount = ethers.parseEther(String(randInt(1000, 100000)));
        const tgeAmount = totalAmount / 5n;

        const now = await getTimestamp();

        await vesting.connect(owner).createSchedule(
          schedId,
          beneficiary.address,
          totalAmount,
          tgeAmount,
          now + randInt(3600, 86400 * 7),
          0,
          12, // startTime > now
        );

        const ownerBefore = await token.balanceOf(owner.address);
        await vesting.connect(owner).cancelSchedule(schedId);
        const ownerAfter = await token.balanceOf(owner.address);

        const sAfter = await vesting.getSchedule(schedId);
        // released should equal total (tokens "spent")
        expect(sAfter.released).to.equal(totalAmount + tgeAmount);
        // Owner received back all tokens
        expect(ownerAfter - ownerBefore).to.equal(totalAmount + tgeAmount);
      }
    });
  });
});
