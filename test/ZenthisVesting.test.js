const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// ─── Constants ──────────────────────────────────────────────────────────────

const MONTH = 30n * 24n * 3600n; // 30 days in seconds

const T = {
  SEED: ethers.keccak256(ethers.toUtf8Bytes("SEED")),
  IDO: ethers.keccak256(ethers.toUtf8Bytes("IDO")),
  LIQUIDITY: ethers.keccak256(ethers.toUtf8Bytes("LIQUIDITY")),
  TEAM: ethers.keccak256(ethers.toUtf8Bytes("TEAM")),
  TREASURY: ethers.keccak256(ethers.toUtf8Bytes("TREASURY")),
  AIRDROPS: ethers.keccak256(ethers.toUtf8Bytes("AIRDROPS")),
};

const e18 = (n) => ethers.parseEther(String(n));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ZenthisVesting", function () {
  let token, vesting;
  let owner, alice, bob, attacker;
  let tge; // unix timestamp of TGE

  beforeEach(async () => {
    [owner, alice, bob, attacker] = await ethers.getSigners();

    // Deploy token (full supply to owner for easy transfer)
    const Token = await ethers.getContractFactory("ZenthisToken");
    token = await Token.deploy(owner.address);

    // Deploy vesting
    const Vesting = await ethers.getContractFactory("ZenthisVesting");
    vesting = await Vesting.deploy(await token.getAddress(), owner.address);

    // TGE = now + 5 minutes (avoids "startTime in past" revert)
    tge = BigInt(await time.latest()) + 300n;
  });

  // ── Helper: fund vesting contract ──────────────────────────────────────────

  async function fund(amount) {
    await token.connect(owner).transfer(await vesting.getAddress(), amount);
  }

  // ── Deployment ────────────────────────────────────────────────────────────

  describe("Deployment", () => {
    it("stores the correct token address", async () => {
      expect(await vesting.token()).to.equal(await token.getAddress());
    });

    it("sets the correct owner", async () => {
      expect(await vesting.owner()).to.equal(owner.address);
    });

    it("has no schedules initially", async () => {
      const ids = await vesting.getScheduleIds();
      expect(ids.length).to.equal(0);
    });

    it("exposes correct schedule ID constants", async () => {
      expect(await vesting.TEAM()).to.equal(T.TEAM);
      expect(await vesting.SEED()).to.equal(T.SEED);
      expect(await vesting.AIRDROPS()).to.equal(T.AIRDROPS);
    });
  });

  // ── createSchedule ────────────────────────────────────────────────────────

  describe("createSchedule", () => {
    it("creates a schedule and emits ScheduleCreated", async () => {
      await fund(e18(10_000_000));
      await expect(
        vesting
          .connect(owner)
          .createSchedule(T.TEAM, alice.address, e18(10_000_000), 0n, tge, 12n, 36n),
      )
        .to.emit(vesting, "ScheduleCreated")
        .withArgs(T.TEAM, alice.address, e18(10_000_000), 0n, tge, MONTH * 12n, MONTH * 36n);
    });

    it("stores correct schedule data", async () => {
      await fund(e18(10_000_000));
      await vesting
        .connect(owner)
        .createSchedule(T.TEAM, alice.address, e18(10_000_000), 0n, tge, 12n, 36n);
      const s = await vesting.getSchedule(T.TEAM);
      expect(s.beneficiary).to.equal(alice.address);
      expect(s.totalAmount).to.equal(e18(10_000_000));
      expect(s.tgeAmount).to.equal(0n);
      expect(s.startTime).to.equal(tge);
      expect(s.cliffDuration).to.equal(MONTH * 12n);
      expect(s.vestingDuration).to.equal(MONTH * 36n);
      expect(s.released).to.equal(0n);
      expect(s.status).to.equal(1n); // Status.INITIALIZED = 1
    });

    it("registers schedule ID in the list", async () => {
      await fund(e18(1_000_000));
      await vesting
        .connect(owner)
        .createSchedule(T.SEED, alice.address, e18(1_000_000), 0n, tge, 6n, 24n);
      const ids = await vesting.getScheduleIds();
      expect(ids).to.include(T.SEED);
    });

    it("reverts on duplicate schedule ID", async () => {
      await fund(e18(2_000_000));
      await vesting
        .connect(owner)
        .createSchedule(T.TEAM, alice.address, e18(1_000_000), 0n, tge, 12n, 36n);
      await expect(
        vesting
          .connect(owner)
          .createSchedule(T.TEAM, bob.address, e18(1_000_000), 0n, tge, 12n, 36n),
      ).to.be.revertedWithCustomError(vesting, "ScheduleAlreadyExists");
    });

    it("reverts on zero beneficiary", async () => {
      await expect(
        vesting
          .connect(owner)
          .createSchedule(T.TEAM, ethers.ZeroAddress, e18(1_000_000), 0n, tge, 12n, 36n),
      ).to.be.revertedWithCustomError(vesting, "ZeroAddress");
    });

    it("reverts on zero allocation (both totalAmount and tgeAmount = 0)", async () => {
      await expect(
        vesting.connect(owner).createSchedule(T.TEAM, alice.address, 0n, 0n, tge, 0n, 1n),
      ).to.be.revertedWithCustomError(vesting, "ZeroAllocation");
    });

    it("reverts when totalAmount > 0 but vestingMonths = 0", async () => {
      await expect(
        vesting
          .connect(owner)
          .createSchedule(T.TEAM, alice.address, e18(1_000_000), 0n, tge, 0n, 0n),
      ).to.be.revertedWithCustomError(vesting, "ZeroVestingDuration");
    });

    it("reverts when startTime is in the past", async () => {
      const pastTime = BigInt(await time.latest()) - 1n;
      await expect(
        vesting
          .connect(owner)
          .createSchedule(T.TEAM, alice.address, e18(1_000_000), 0n, pastTime, 12n, 36n),
      ).to.be.revertedWithCustomError(vesting, "StartTimeInPast");
    });

    it("reverts if called by non-owner", async () => {
      await expect(
        vesting
          .connect(attacker)
          .createSchedule(T.TEAM, attacker.address, e18(1_000_000), 0n, tge, 12n, 36n),
      ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount");
    });

    it("allows TGE-only schedule (totalAmount = 0)", async () => {
      await fund(e18(10_000_000));
      // totalAmount = 0, vestingMonths = 0 — allowed because ZeroVestingDuration
      // only reverts when totalAmount > 0
      await expect(
        vesting
          .connect(owner)
          .createSchedule(T.AIRDROPS, alice.address, 0n, e18(10_000_000), tge, 0n, 1n),
      ).to.emit(vesting, "ScheduleCreated");
    });
  });

  // ── release — TEAM (12-month cliff, 36-month linear, 0 TGE) ─────────────

  describe("release — TEAM schedule (cliff + linear, no TGE)", () => {
    beforeEach(async () => {
      await fund(e18(10_000_000));
      await vesting
        .connect(owner)
        .createSchedule(T.TEAM, alice.address, e18(10_000_000), 0n, tge, 12n, 36n);
    });

    it("releases 0 before TGE", async () => {
      expect(await vesting.releasableAmount(T.TEAM)).to.equal(0n);
    });

    it("releases 0 during cliff (6 months after TGE)", async () => {
      await time.increaseTo(tge + MONTH * 6n);
      expect(await vesting.releasableAmount(T.TEAM)).to.equal(0n);
    });

    it("releases 0 at cliff end (12 months)", async () => {
      await time.increaseTo(tge + MONTH * 12n);
      expect(await vesting.releasableAmount(T.TEAM)).to.equal(0n);
    });

    it("releases ~1/36 of total after 1 month post-cliff", async () => {
      await time.increaseTo(tge + MONTH * 13n); // cliff + 1 month
      const releasable = await vesting.releasableAmount(T.TEAM);
      const expected = e18(10_000_000) / 36n;
      // Allow ±0.1% tolerance for integer division
      expect(releasable).to.be.closeTo(expected, expected / 1000n);
    });

    it("releases 50% after 18 months post-cliff", async () => {
      await time.increaseTo(tge + MONTH * 30n); // cliff(12) + 18
      const releasable = await vesting.releasableAmount(T.TEAM);
      const expected = e18(5_000_000);
      expect(releasable).to.be.closeTo(expected, expected / 1000n);
    });

    it("releases 100% after full vesting (12+36 months)", async () => {
      await time.increaseTo(tge + MONTH * 48n + 1n);
      expect(await vesting.releasableAmount(T.TEAM)).to.equal(e18(10_000_000));
    });

    it("release() transfers tokens to beneficiary", async () => {
      await time.increaseTo(tge + MONTH * 48n + 1n);
      await expect(vesting.connect(alice).release(T.TEAM))
        .to.emit(vesting, "TokensReleased")
        .withArgs(T.TEAM, alice.address, e18(10_000_000));
      expect(await token.balanceOf(alice.address)).to.equal(e18(10_000_000));
    });

    it("release() marks tokens as released", async () => {
      await time.increaseTo(tge + MONTH * 48n + 1n);
      await vesting.connect(alice).release(T.TEAM);
      const s = await vesting.getSchedule(T.TEAM);
      expect(s.released).to.equal(e18(10_000_000));
    });

    it("does not double-release", async () => {
      await time.increaseTo(tge + MONTH * 48n + 1n);
      await vesting.connect(alice).release(T.TEAM);
      await expect(vesting.connect(alice).release(T.TEAM)).to.be.revertedWithCustomError(
        vesting,
        "NothingToRelease",
      );
    });

    it("partial release then full release works correctly", async () => {
      // 1st claim at 18 months post-cliff
      await time.increaseTo(tge + MONTH * 30n);
      await vesting.connect(alice).release(T.TEAM);
      const balAfterFirst = await token.balanceOf(alice.address);

      // 2nd claim at full vesting
      await time.increaseTo(tge + MONTH * 48n + 1n);
      await vesting.connect(alice).release(T.TEAM);
      const balAfterSecond = await token.balanceOf(alice.address);

      expect(balAfterSecond).to.equal(e18(10_000_000));
      // Second claim = remainder
      expect(balAfterSecond - balAfterFirst).to.be.closeTo(e18(5_000_000), e18(5_000_000) / 1000n);
    });

    it("reverts if non-beneficiary calls release", async () => {
      await time.increaseTo(tge + MONTH * 48n + 1n);
      await expect(vesting.connect(attacker).release(T.TEAM)).to.be.revertedWithCustomError(
        vesting,
        "NotBeneficiary",
      );
    });

    it("reverts release on unknown schedule", async () => {
      const unknownId = ethers.keccak256(ethers.toUtf8Bytes("UNKNOWN"));
      await expect(vesting.connect(alice).release(unknownId)).to.be.revertedWithCustomError(
        vesting,
        "ScheduleNotFound",
      );
    });
  });

  // ── release — IDO (0 cliff, 20% TGE, 18-month linear on 80%) ────────────

  describe("release — IDO schedule (TGE unlock + linear)", () => {
    const TOTAL = e18(20_000_000); // tokens subject to vesting
    const TGE = e18(5_000_000); // 20% of 25M total IDO allocation

    beforeEach(async () => {
      await fund(TOTAL + TGE);
      await vesting.connect(owner).createSchedule(T.IDO, alice.address, TOTAL, TGE, tge, 0n, 18n);
    });

    it("releases TGE amount immediately at startTime", async () => {
      await time.increaseTo(tge);
      expect(await vesting.releasableAmount(T.IDO)).to.equal(TGE);
    });

    it("releases TGE + pro-rata after 9 months (50% of linear)", async () => {
      await time.increaseTo(tge + MONTH * 9n);
      const releasable = await vesting.releasableAmount(T.IDO);
      const expected = TGE + TOTAL / 2n;
      expect(releasable).to.be.closeTo(expected, expected / 1000n);
    });

    it("releases full amount after 18 months", async () => {
      await time.increaseTo(tge + MONTH * 18n + 1n);
      expect(await vesting.releasableAmount(T.IDO)).to.equal(TOTAL + TGE);
    });

    it("beneficiary can claim TGE portion immediately", async () => {
      await time.increaseTo(tge);
      await vesting.connect(alice).release(T.IDO);
      // Allow ≤1 token tolerance: at tge+1 block, 1s of linear vesting (~0.43 tokens) may have accrued
      expect(await token.balanceOf(alice.address)).to.be.closeTo(TGE, ethers.parseEther("1"));
    });
  });

  // ── release — AIRDROPS (100% TGE, no vesting) ────────────────────────────

  describe("release — AIRDROPS schedule (100% TGE)", () => {
    const AIRDROP = e18(10_000_000);

    beforeEach(async () => {
      await fund(AIRDROP);
      await vesting
        .connect(owner)
        .createSchedule(T.AIRDROPS, alice.address, 0n, AIRDROP, tge, 0n, 1n);
    });

    it("releases 0 before TGE", async () => {
      expect(await vesting.releasableAmount(T.AIRDROPS)).to.equal(0n);
    });

    it("releases 100% at TGE", async () => {
      await time.increaseTo(tge);
      expect(await vesting.releasableAmount(T.AIRDROPS)).to.equal(AIRDROP);
    });

    it("beneficiary claims full amount at TGE", async () => {
      await time.increaseTo(tge);
      await vesting.connect(alice).release(T.AIRDROPS);
      expect(await token.balanceOf(alice.address)).to.equal(AIRDROP);
    });
  });

  // ── vestedAmount view ─────────────────────────────────────────────────────

  describe("vestedAmount", () => {
    beforeEach(async () => {
      await fund(e18(10_000_000));
      await vesting
        .connect(owner)
        .createSchedule(T.TEAM, alice.address, e18(10_000_000), 0n, tge, 12n, 36n);
    });

    it("returns 0 for unknown schedule", async () => {
      const unknown = ethers.keccak256(ethers.toUtf8Bytes("NONE"));
      expect(await vesting.vestedAmount(unknown)).to.equal(0n);
    });

    it("returns 0 before TGE", async () => {
      expect(await vesting.vestedAmount(T.TEAM)).to.equal(0n);
    });

    it("accounts for already released tokens", async () => {
      await time.increaseTo(tge + MONTH * 13n); // cliff + 1 month
      await vesting.connect(alice).release(T.TEAM);
      const released = (await vesting.getSchedule(T.TEAM)).released;
      // vestedAmount should still reflect total vested (not subtracting released)
      const vested = await vesting.vestedAmount(T.TEAM);
      expect(vested).to.be.gte(released);
    });
  });

  // ── Multiple schedules ────────────────────────────────────────────────────

  describe("multiple concurrent schedules", () => {
    it("manages TEAM and SEED schedules independently", async () => {
      await fund(e18(25_000_000)); // 15M seed + 10M team
      await vesting
        .connect(owner)
        .createSchedule(T.SEED, alice.address, e18(15_000_000), 0n, tge, 6n, 24n);
      await vesting
        .connect(owner)
        .createSchedule(T.TEAM, bob.address, e18(10_000_000), 0n, tge, 12n, 36n);

      const ids = await vesting.getScheduleIds();
      expect(ids.length).to.equal(2);

      // SEED: past cliff at 7 months, TEAM: still in cliff
      await time.increaseTo(tge + MONTH * 7n);

      const seedReleasable = await vesting.releasableAmount(T.SEED);
      const teamReleasable = await vesting.releasableAmount(T.TEAM);

      expect(seedReleasable).to.be.gt(0n); // 1/24 of 15M
      expect(teamReleasable).to.equal(0n); // still in cliff
    });

    it("one beneficiary releasing does not affect another schedule", async () => {
      await fund(e18(25_000_000));
      await vesting
        .connect(owner)
        .createSchedule(T.SEED, alice.address, e18(15_000_000), 0n, tge, 6n, 24n);
      await vesting
        .connect(owner)
        .createSchedule(T.TEAM, bob.address, e18(10_000_000), 0n, tge, 12n, 36n);

      await time.increaseTo(tge + MONTH * 7n);
      await vesting.connect(alice).release(T.SEED);

      // Bob's schedule is unaffected
      const teamSchedule = await vesting.getSchedule(T.TEAM);
      expect(teamSchedule.released).to.equal(0n);
    });
  });

  // ── cancelSchedule ────────────────────────────────────────────────────────

  describe("cancelSchedule", () => {
    it("reverts if called after startTime", async () => {
      await fund(e18(10_000_000));
      await vesting
        .connect(owner)
        .createSchedule(T.TEAM, alice.address, e18(10_000_000), 0n, tge, 12n, 36n);
      await time.increaseTo(tge);
      await expect(vesting.connect(owner).cancelSchedule(T.TEAM)).to.be.revertedWithCustomError(
        vesting,
        "ScheduleActive",
      );
    });

    it("cancels and recovers tokens before startTime", async () => {
      await fund(e18(10_000_000));
      await vesting
        .connect(owner)
        .createSchedule(T.TEAM, alice.address, e18(10_000_000), 0n, tge, 12n, 36n);
      // Cancel before TGE
      await expect(vesting.connect(owner).cancelSchedule(T.TEAM)).to.changeTokenBalance(
        token,
        owner,
        e18(10_000_000),
      );
      // Schedule status is now CANCELLED
      const s = await vesting.getSchedule(T.TEAM);
      expect(s.status).to.equal(2n); // Status.CANCELLED
    });

    it("reduces totalAllocated on cancel", async () => {
      await fund(e18(10_000_000));
      await vesting
        .connect(owner)
        .createSchedule(T.TEAM, alice.address, e18(10_000_000), 0n, tge, 12n, 36n);
      expect(await vesting.totalAllocated()).to.equal(e18(10_000_000));
      await vesting.connect(owner).cancelSchedule(T.TEAM);
      expect(await vesting.totalAllocated()).to.equal(0n);
    });

    it("removes scheduleId from list on cancel", async () => {
      await fund(e18(10_000_000));
      await vesting
        .connect(owner)
        .createSchedule(T.SEED, alice.address, e18(10_000_000), 0n, tge, 6n, 24n);
      expect((await vesting.getScheduleIds()).length).to.equal(1n);
      await vesting.connect(owner).cancelSchedule(T.SEED);
      const ids = await vesting.getScheduleIds();
      expect(ids.length).to.equal(0n);
      expect(ids).not.to.include(T.SEED);
    });

    it("reverts on unknown schedule", async () => {
      const unknown = ethers.keccak256(ethers.toUtf8Bytes("NONE"));
      await expect(vesting.connect(owner).cancelSchedule(unknown)).to.be.revertedWithCustomError(
        vesting,
        "ScheduleNotFound",
      );
    });

    it("reverts if non-owner tries to cancel", async () => {
      await fund(e18(10_000_000));
      await vesting
        .connect(owner)
        .createSchedule(T.TEAM, alice.address, e18(10_000_000), 0n, tge, 12n, 36n);
      await expect(vesting.connect(attacker).cancelSchedule(T.TEAM)).to.be.revertedWithCustomError(
        vesting,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  // ── Balance validation ─────────────────────────────────────────────────────

  describe("createSchedule — balance checks", () => {
    it("reverts if contract lacks sufficient balance", async () => {
      // Don't fund the contract — balance is 0
      await expect(
        vesting
          .connect(owner)
          .createSchedule(T.TEAM, alice.address, e18(10_000_000), 0n, tge, 12n, 36n),
      ).to.be.revertedWithCustomError(vesting, "InsufficientContractBalance");
    });

    it("rejects over-allocation beyond contract balance", async () => {
      await fund(e18(5_000_000)); // only 5M tokens
      // First schedule uses 5M — fine
      await vesting
        .connect(owner)
        .createSchedule(T.SEED, alice.address, e18(5_000_000), 0n, tge, 6n, 24n);
      // Second schedule needs 10M — insufficient
      await expect(
        vesting
          .connect(owner)
          .createSchedule(T.TEAM, bob.address, e18(10_000_000), 0n, tge, 12n, 36n),
      ).to.be.revertedWithCustomError(vesting, "InsufficientContractBalance");
    });
  });

  // ── rescueERC20 ──────────────────────────────────────────────────────────────

  describe("rescueERC20", () => {
    it("allows owner to recover non-vesting ERC-20 tokens", async () => {
      // Deploy dummy token and send 5000 to vesting contract
      const Token = await ethers.getContractFactory("ZenthisToken");
      const dummy = await Token.deploy(owner.address);
      await dummy.connect(owner).transfer(await vesting.getAddress(), e18(5000));

      await expect(
        vesting.connect(owner).rescueERC20(await dummy.getAddress(), owner.address),
      ).to.changeTokenBalance(dummy, owner, e18(5000));
    });

    it("reverts when trying to rescue the vesting token itself", async () => {
      await expect(
        vesting.connect(owner).rescueERC20(await token.getAddress(), owner.address),
      ).to.be.revertedWithCustomError(vesting, "CannotRescueVestingToken");
    });

    it("reverts on zero recipient", async () => {
      const Token = await ethers.getContractFactory("ZenthisToken");
      const dummy = await Token.deploy(owner.address);
      await expect(
        vesting.connect(owner).rescueERC20(await dummy.getAddress(), ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(vesting, "ZeroAddress");
    });

    it("reverts if non-owner calls rescueERC20", async () => {
      const Token = await ethers.getContractFactory("ZenthisToken");
      const dummy = await Token.deploy(owner.address);
      await expect(
        vesting.connect(attacker).rescueERC20(await dummy.getAddress(), owner.address),
      ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount");
    });
  });
});
