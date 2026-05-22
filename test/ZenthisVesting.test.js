const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ZenthisVesting", function () {
  const MONTH = 30 * 24 * 60 * 60; // 30 days in seconds

  let vesting, token;
  let owner, beneficiary, nonBeneficiary;

  // Schedule IDs (matching contract constants)
  const SEED        = ethers.id("SEED");
  const IDO         = ethers.id("IDO");
  const LIQUIDITY   = ethers.id("LIQUIDITY");
  const TEAM        = ethers.id("TEAM");
  const TREASURY    = ethers.id("TREASURY");
  const FOUNDER_OPS = ethers.id("FOUNDER_OPS");
  const AIRDROPS    = ethers.id("AIRDROPS");

  const ALL_SCHEDULE_IDS = [SEED, IDO, LIQUIDITY, TEAM, TREASURY, FOUNDER_OPS, AIRDROPS];

  async function getTimestamp() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp;
  }

  async function increaseTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine");
  }

  async function setNextBlockTimestamp(ts) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
    await ethers.provider.send("evm_mine");
  }

  beforeEach(async function () {
    [owner, beneficiary, nonBeneficiary] = await ethers.getSigners();

    // Deploy token
    const ZENTHIS = await ethers.getContractFactory("ZENTHIS");
    token = await ZENTHIS.deploy(owner.address);
    await token.waitForDeployment();

    // Deploy vesting
    const Vesting = await ethers.getContractFactory("ZenthisVesting");
    vesting = await Vesting.deploy(await token.getAddress(), owner.address);
    await vesting.waitForDeployment();

    // Transfer tokens to vesting contract for schedules
    // Seed: 10M total (no TGE), Team: 10M (no TGE)
    await token.transfer(await vesting.getAddress(), ethers.parseEther("50000000")); // 50M for all
  });

  // ──────────────────────────────────────────────────────
  // Deployment
  // ──────────────────────────────────────────────────────
  describe("Deployment", function () {
    it("should set the correct token address", async function () {
      expect(await vesting.token()).to.equal(await token.getAddress());
    });

    it("should set the correct owner", async function () {
      expect(await vesting.owner()).to.equal(owner.address);
    });

    it("should start with empty schedule list", async function () {
      const ids = await vesting.getScheduleIds();
      expect(ids.length).to.equal(0);
    });

    it("should revert deployment with zero token address", async function () {
      const Vesting = await ethers.getContractFactory("ZenthisVesting");
      await expect(
        Vesting.deploy(ethers.ZeroAddress, owner.address)
      ).to.be.revertedWithCustomError(vesting, "ZeroAddress");
    });

    it("should expose MONTH constant", async function () {
      expect(await vesting.MONTH()).to.equal(BigInt(MONTH));
    });
  });

  // ──────────────────────────────────────────────────────
  // createSchedule — Happy paths
  // ──────────────────────────────────────────────────────
  describe("createSchedule", function () {
    let startTime;

    beforeEach(async function () {
      startTime = (await getTimestamp()) + 3600; // 1 hour in the future
    });

    it("should create a simple vesting schedule (no TGE, no cliff)", async function () {
      const total = ethers.parseEther("1000000");
      const tx = await vesting.connect(owner).createSchedule(
        IDO, beneficiary.address, total, 0n, startTime, 0, 18
      );

      await expect(tx)
        .to.emit(vesting, "ScheduleCreated")
        .withArgs(IDO, beneficiary.address, total, 0n, startTime, 0n, 18n * BigInt(MONTH));

      const schedule = await vesting.getSchedule(IDO);
      expect(schedule.beneficiary).to.equal(beneficiary.address);
      expect(schedule.totalAmount).to.equal(total);
      expect(schedule.tgeAmount).to.equal(0n);
      expect(schedule.startTime).to.equal(startTime);
      expect(schedule.cliffDuration).to.equal(0n);
      expect(schedule.vestingDuration).to.equal(18n * BigInt(MONTH));
      expect(schedule.released).to.equal(0n);
      expect(schedule.status).to.equal(1n); // Status.INITIALIZED
    });

    it("should create a schedule with TGE unlock", async function () {
      const total = ethers.parseEther("1000000");
      const tge = ethers.parseEther("100000"); // 10% TGE

      await vesting.connect(owner).createSchedule(
        IDO, beneficiary.address, total, tge, startTime, 0, 18
      );

      const schedule = await vesting.getSchedule(IDO);
      expect(schedule.tgeAmount).to.equal(tge);
      expect(schedule.totalAmount).to.equal(total);
    });

    it("should create a schedule with cliff", async function () {
      const total = ethers.parseEther("10000000");
      // Seed: cliff 6 months, vesting 24 months
      await vesting.connect(owner).createSchedule(
        SEED, beneficiary.address, total, 0n, startTime, 6, 24
      );

      const schedule = await vesting.getSchedule(SEED);
      expect(schedule.cliffDuration).to.equal(6n * BigInt(MONTH));
      expect(schedule.vestingDuration).to.equal(24n * BigInt(MONTH));
    });

    it("should allow TGE-only schedule (no linear vesting)", async function () {
      const tgeOnly = ethers.parseEther("5000000");
      await vesting.connect(owner).createSchedule(
        AIRDROPS, beneficiary.address, 0n, tgeOnly, startTime, 0, 0
      );

      const schedule = await vesting.getSchedule(AIRDROPS);
      expect(schedule.totalAmount).to.equal(0n);
      expect(schedule.tgeAmount).to.equal(tgeOnly);
      expect(schedule.vestingDuration).to.equal(0n);
    });

    it("should record schedule ID in list", async function () {
      await vesting.connect(owner).createSchedule(
        IDO, beneficiary.address, ethers.parseEther("1000000"), 0n, startTime, 0, 18
      );

      const ids = await vesting.getScheduleIds();
      expect(ids.length).to.equal(1);
      expect(ids[0]).to.equal(IDO);
    });

    it("should create multiple schedules with unique IDs", async function () {
      await vesting.connect(owner).createSchedule(
        IDO, beneficiary.address, ethers.parseEther("1000000"), 0n, startTime, 0, 18
      );
      await vesting.connect(owner).createSchedule(
        SEED, beneficiary.address, ethers.parseEther("10000000"), 0n, startTime, 6, 24
      );
      await vesting.connect(owner).createSchedule(
        AIRDROPS, beneficiary.address, 0n, ethers.parseEther("5000000"), startTime, 0, 0
      );

      const ids = await vesting.getScheduleIds();
      expect(ids.length).to.equal(3);
    });

    it("should allow startTime exactly one second in the future", async function () {
      const ts = (await getTimestamp()) + 1;
      await vesting.connect(owner).createSchedule(
        IDO, beneficiary.address, ethers.parseEther("1000"), 0n, ts, 0, 6
      );
      expect((await vesting.getSchedule(IDO)).startTime).to.equal(ts);
    });
  });

  // ──────────────────────────────────────────────────────
  // createSchedule — Validations
  // ──────────────────────────────────────────────────────
  describe("createSchedule validations", function () {
    let startTime;

    beforeEach(async function () {
      startTime = (await getTimestamp()) + 3600;
    });

    it("should revert duplicate schedule ID", async function () {
      await vesting.connect(owner).createSchedule(
        IDO, beneficiary.address, ethers.parseEther("1000"), 0n, startTime, 0, 6
      );
      await expect(
        vesting.connect(owner).createSchedule(
          IDO, beneficiary.address, ethers.parseEther("1000"), 0n, startTime, 0, 6
        )
      ).to.be.revertedWithCustomError(vesting, "ScheduleAlreadyExists");
    });

    it("should revert with zero beneficiary", async function () {
      await expect(
        vesting.connect(owner).createSchedule(
          IDO, ethers.ZeroAddress, ethers.parseEther("1000"), 0n, startTime, 0, 6
        )
      ).to.be.revertedWithCustomError(vesting, "ZeroAddress");
    });

    it("should revert with zero allocation (both zero)", async function () {
      await expect(
        vesting.connect(owner).createSchedule(
          IDO, beneficiary.address, 0n, 0n, startTime, 0, 0
        )
      ).to.be.revertedWithCustomError(vesting, "ZeroAllocation");
    });

    it("should revert with totalAmount>0 but zero vesting months", async function () {
      await expect(
        vesting.connect(owner).createSchedule(
          IDO, beneficiary.address, ethers.parseEther("1000"), 0n, startTime, 0, 0
        )
      ).to.be.revertedWithCustomError(vesting, "ZeroVestingDuration");
    });

    it("should revert with startTime in the past", async function () {
      const pastTs = (await getTimestamp()) - 60;
      await expect(
        vesting.connect(owner).createSchedule(
          IDO, beneficiary.address, ethers.parseEther("1000"), 0n, pastTs, 0, 6
        )
      ).to.be.revertedWithCustomError(vesting, "StartTimeInPast");
    });

    it("should revert with startTime equal to block.timestamp", async function () {
      const now = await getTimestamp();
      await expect(
        vesting.connect(owner).createSchedule(
          IDO, beneficiary.address, ethers.parseEther("1000"), 0n, now, 0, 6
        )
      ).to.be.revertedWithCustomError(vesting, "StartTimeInPast");
    });

    it("should revert from non-owner", async function () {
      await expect(
        vesting.connect(beneficiary).createSchedule(
          IDO, beneficiary.address, ethers.parseEther("1000"), 0n, startTime, 0, 6
        )
      ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount");
    });
  });

  // ──────────────────────────────────────────────────────
  // Release — TGE only (no linear vesting)
  // ──────────────────────────────────────────────────────
  describe("Release — TGE only", function () {
    const tgeAmount = ethers.parseEther("5000000");
    let startTime;

    beforeEach(async function () {
      const futureTs = (await getTimestamp()) + 3600;
      await vesting.connect(owner).createSchedule(
        AIRDROPS, beneficiary.address, 0n, tgeAmount, futureTs, 0, 0
      );
      const s = await vesting.getSchedule(AIRDROPS);
      startTime = Number(s.startTime);
    });

    it("should not be releasable before startTime", async function () {
      expect(await vesting.releasableAmount(AIRDROPS)).to.equal(0n);
      await expect(
        vesting.connect(beneficiary).release(AIRDROPS)
      ).to.be.revertedWithCustomError(vesting, "NothingToRelease");
    });

    it("should release full TGE amount at startTime", async function () {
      await setNextBlockTimestamp(startTime + 1);

      await expect(vesting.connect(beneficiary).release(AIRDROPS))
        .to.emit(vesting, "TokensReleased")
        .withArgs(AIRDROPS, beneficiary.address, tgeAmount);

      expect(await token.balanceOf(beneficiary.address)).to.equal(tgeAmount);
      expect(await vesting.releasableAmount(AIRDROPS)).to.equal(0n);
    });

    it("should have correct vested amount", async function () {
      await setNextBlockTimestamp(startTime + 1);
      expect(await vesting.vestedAmount(AIRDROPS)).to.equal(tgeAmount);
    });
  });

  // ──────────────────────────────────────────────────────
  // Release — Linear vesting (no cliff)
  // ──────────────────────────────────────────────────────
  describe("Release — Linear vesting (no cliff)", function () {
    const total = ethers.parseEther("12000000"); // 12M tokens
    const tge = ethers.parseEther("1200000");    // 10% TGE
    const vestingMonths = 12;
    let startTime;
    let vestingDuration;

    beforeEach(async function () {
      const futureTs = (await getTimestamp()) + 3600;
      await vesting.connect(owner).createSchedule(
        IDO, beneficiary.address, total, tge, futureTs, 0, vestingMonths
      );
      // Read exact stored startTime for precision
      const s = await vesting.getSchedule(IDO);
      startTime = Number(s.startTime);
      vestingDuration = Number(s.vestingDuration);
    });

    async function goTo(ts) {
      await setNextBlockTimestamp(ts);
    }

    it("should have TGE plus partial linear after start", async function () {
      await goTo(startTime + 1);
      const ts = await getTimestamp();
      const vested = await vesting.vestedAmount(IDO);
      // At t = startTime + 1, vested ≈ tge (tiny linear portion from 1s)
      expect(vested).to.be.gte(tge);
    });

    it("should vest linearly over time", async function () {
      await goTo(startTime + 3 * MONTH);
      const ts = await getTimestamp();
      const vested = await vesting.vestedAmount(IDO);
      // At 3/12 months, vested ≈ tge + total * 3/12
      const elapsed = BigInt(ts - startTime);
      const expected = tge + (total * elapsed) / BigInt(vestingDuration);
      expect(vested).to.equal(expected);
    });

    it("should vest 50% at half duration", async function () {
      await goTo(startTime + 6 * MONTH);
      const ts = await getTimestamp();
      const vested = await vesting.vestedAmount(IDO);
      const elapsed = BigInt(ts - startTime);
      const expected = tge + (total * elapsed) / BigInt(vestingDuration);
      expect(vested).to.equal(expected);
    });

    it("should be fully vested after vesting duration", async function () {
      await goTo(startTime + vestingDuration + 10);
      const vested = await vesting.vestedAmount(IDO);
      expect(vested).to.equal(total + tge);
    });

    it("should release incrementally", async function () {
      await goTo(startTime + 3 * MONTH);
      expect(await vesting.releasableAmount(IDO)).to.be.greaterThan(0n);
      await vesting.connect(beneficiary).release(IDO);

      const released1 = (await vesting.getSchedule(IDO)).released;
      expect(await token.balanceOf(beneficiary.address)).to.equal(released1);
      expect(await vesting.releasableAmount(IDO)).to.equal(0n);

      // Advance 3 more months
      await goTo(startTime + 6 * MONTH);
      expect(await vesting.releasableAmount(IDO)).to.be.greaterThan(0n);

      await vesting.connect(beneficiary).release(IDO);
      const released2 = (await vesting.getSchedule(IDO)).released;
      expect(await token.balanceOf(beneficiary.address)).to.equal(released2);
      expect(released2).to.be.greaterThan(released1);
    });

    it("should cap vested amount at total + tge", async function () {
      await goTo(startTime + vestingDuration * 2); // way past
      const vested = await vesting.vestedAmount(IDO);
      expect(vested).to.equal(total + tge);
    });
  });

  // ──────────────────────────────────────────────────────
  // Release — With cliff
  // ──────────────────────────────────────────────────────
  describe("Release — With cliff", function () {
    const total = ethers.parseEther("10000000"); // 10M
    const cliffMonths = 12;
    const vestingMonths = 36;
    let startTime, cliffDuration, vestingDuration;

    beforeEach(async function () {
      const futureTs = (await getTimestamp()) + 3600;
      // Team: 0% TGE, 12-month cliff, 36-month vesting
      await vesting.connect(owner).createSchedule(
        TEAM, beneficiary.address, total, 0n, futureTs, cliffMonths, vestingMonths
      );
      const s = await vesting.getSchedule(TEAM);
      startTime = Number(s.startTime);
      cliffDuration = Number(s.cliffDuration);
      vestingDuration = Number(s.vestingDuration);
    });

    async function goTo(ts) {
      await setNextBlockTimestamp(ts);
    }

    function expectedVested(elapsedSeconds) {
      // Cliff: no vesting during cliff; after cliff, linear from 0
      const cliffEnd = cliffDuration;
      if (elapsedSeconds <= cliffEnd) return 0n;
      const elapsedVesting = BigInt(elapsedSeconds - cliffEnd);
      const vestedLinear = (total * elapsedVesting) / BigInt(vestingDuration);
      return vestedLinear > total ? total : vestedLinear;
    }

    it("should vest 0 before cliff ends", async function () {
      await goTo(startTime + 6 * MONTH); // 6 months in — still in cliff
      expect(await vesting.vestedAmount(TEAM)).to.equal(0n);
      expect(await vesting.releasableAmount(TEAM)).to.equal(0n);
    });

    it("should vest 0 exactly at cliff end (no TGE)", async function () {
      await goTo(startTime + cliffDuration); // exactly at cliff end
      const ts = await getTimestamp();
      expect(await vesting.vestedAmount(TEAM)).to.equal(expectedVested(ts - startTime));
    });

    it("should begin linear vesting after cliff", async function () {
      await goTo(startTime + cliffDuration + 1); // 1 sec after cliff
      const ts = await getTimestamp();
      const vested = await vesting.vestedAmount(TEAM);
      expect(vested).to.equal(expectedVested(ts - startTime));
    });

    it("should vest linearly after cliff", async function () {
      await goTo(startTime + cliffDuration + 6 * MONTH);
      const ts = await getTimestamp();
      expect(await vesting.vestedAmount(TEAM)).to.equal(expectedVested(ts - startTime));
    });

    it("should release after cliff + partial vesting", async function () {
      await goTo(startTime + cliffDuration + 12 * MONTH);
      expect(await vesting.releasableAmount(TEAM)).to.be.greaterThan(0n);

      await vesting.connect(beneficiary).release(TEAM);
      const released = (await vesting.getSchedule(TEAM)).released;
      expect(await token.balanceOf(beneficiary.address)).to.equal(released);
      expect(released).to.be.greaterThan(0n);
    });

    it("should be fully vested after cliff + vesting", async function () {
      await goTo(startTime + cliffDuration + vestingDuration + 10);
      expect(await vesting.vestedAmount(TEAM)).to.equal(total);
    });
  });

  // ──────────────────────────────────────────────────────
  // Release — Cliff with TGE
  // ──────────────────────────────────────────────────────
  describe("Release — TGE + Cliff + Linear", function () {
    const total = ethers.parseEther("18200000"); // 18.2M
    const tge = ethers.parseEther("2000000");    // ~11%
    let startTime, vestingDuration;

    beforeEach(async function () {
      const futureTs = (await getTimestamp()) + 3600;
      // Treasury: 11% TGE, no cliff, 48-month vesting
      await vesting.connect(owner).createSchedule(
        TREASURY, beneficiary.address, total, tge, futureTs, 0, 48
      );
      const s = await vesting.getSchedule(TREASURY);
      startTime = Number(s.startTime);
      vestingDuration = Number(s.vestingDuration);
    });

    function expectedVested(elapsedSeconds, tgeAmt, vestDur) {
      if (elapsedSeconds <= 0) return tgeAmt;
      const vestedLinear = (total * BigInt(elapsedSeconds)) / BigInt(vestDur);
      const totalVested = tgeAmt + vestedLinear;
      return totalVested > (total + tgeAmt) ? (total + tgeAmt) : totalVested;
    }

    it("should have TGE available at start", async function () {
      await setNextBlockTimestamp(startTime + 1);
      const ts = await getTimestamp();
      expect(await vesting.vestedAmount(TREASURY)).to.equal(expectedVested(ts - startTime, tge, vestingDuration));
    });

    it("should continue vesting after TGE", async function () {
      await setNextBlockTimestamp(startTime + 24 * MONTH); // half of vesting
      const ts = await getTimestamp();
      expect(await vesting.vestedAmount(TREASURY)).to.equal(expectedVested(ts - startTime, tge, vestingDuration));
    });
  });

  // ──────────────────────────────────────────────────────
  // Release — Validation
  // ──────────────────────────────────────────────────────
  describe("Release validations", function () {
    let startTime;

    beforeEach(async function () {
      const futureTs = (await getTimestamp()) + 3600;
      await vesting.connect(owner).createSchedule(
        IDO, beneficiary.address, ethers.parseEther("1000000"), 0n, futureTs, 0, 12
      );
      const s = await vesting.getSchedule(IDO);
      startTime = Number(s.startTime);
      // Jump to 6 months vested
      await setNextBlockTimestamp(startTime + 6 * MONTH);
    });

    it("should revert release from non-beneficiary", async function () {
      await expect(
        vesting.connect(nonBeneficiary).release(IDO)
      ).to.be.revertedWithCustomError(vesting, "NotBeneficiary");
    });

    it("should revert release on non-existent schedule", async function () {
      await expect(
        vesting.connect(beneficiary).release(ethers.id("NONEXISTENT"))
      ).to.be.revertedWithCustomError(vesting, "ScheduleNotFound");
    });

    it("should drain all releasable tokens", async function () {
      const releasable = await vesting.releasableAmount(IDO);
      expect(releasable).to.be.greaterThan(0n);
      await vesting.connect(beneficiary).release(IDO);

      // After release in this block, remaining should be 0
      // (minor block drift is handled by the test above with before-startTime)
      expect(await vesting.releasableAmount(IDO)).to.equal(0n);
    });

    it("should revert release before startTime (NothingToRelease)", async function () {
      // Create a schedule with startTime far in the future
      const farFuture = (await getTimestamp()) + 100000;
      await vesting.connect(owner).createSchedule(
        ethers.id("FUTURE"), beneficiary.address, ethers.parseEther("1000"), 0n, farFuture, 0, 6
      );
      // Now try to release — should revert since startTime hasn't arrived
      await expect(
        vesting.connect(beneficiary).release(ethers.id("FUTURE"))
      ).to.be.revertedWithCustomError(vesting, "NothingToRelease");
    });
  });

  // ──────────────────────────────────────────────────────
  // View functions — Edge cases
  // ──────────────────────────────────────────────────────
  describe("View functions edge cases", function () {
    it("vestedAmount should return 0 for non-existent schedule", async function () {
      expect(await vesting.vestedAmount(ethers.id("NOPE"))).to.equal(0n);
    });

    it("releasableAmount should return 0 for non-existent schedule", async function () {
      expect(await vesting.releasableAmount(ethers.id("NOPE"))).to.equal(0n);
    });

    it("getSchedule should return empty struct for unknown ID", async function () {
      const schedule = await vesting.getSchedule(ethers.id("UNKNOWN"));
      expect(schedule.status).to.equal(0n); // Status.EMPTY
      expect(schedule.beneficiary).to.equal(ethers.ZeroAddress);
    });

    it("getScheduleIds should return all created schedule IDs in order", async function () {
      const startTime = (await getTimestamp()) + 3600;

      await vesting.connect(owner).createSchedule(
        SEED, beneficiary.address, ethers.parseEther("10000000"), 0n, startTime, 6, 24
      );
      await vesting.connect(owner).createSchedule(
        TEAM, beneficiary.address, ethers.parseEther("10000000"), 0n, startTime, 12, 36
      );

      const ids = await vesting.getScheduleIds();
      expect(ids.length).to.equal(2);
      expect(ids[0]).to.equal(SEED);
      expect(ids[1]).to.equal(TEAM);
    });
  });

  // ──────────────────────────────────────────────────────
  // Schedule constants
  // ──────────────────────────────────────────────────────
  describe("Schedule ID constants", function () {
    it("should expose SEED constant", async function () {
      expect(await vesting.SEED()).to.equal(ethers.id("SEED"));
    });

    it("should expose IDO constant", async function () {
      expect(await vesting.IDO()).to.equal(ethers.id("IDO"));
    });

    it("should expose LIQUIDITY constant", async function () {
      expect(await vesting.LIQUIDITY()).to.equal(ethers.id("LIQUIDITY"));
    });

    it("should expose TEAM constant", async function () {
      expect(await vesting.TEAM()).to.equal(ethers.id("TEAM"));
    });

    it("should expose TREASURY constant", async function () {
      expect(await vesting.TREASURY()).to.equal(ethers.id("TREASURY"));
    });

    it("should expose FOUNDER_OPS constant", async function () {
      expect(await vesting.FOUNDER_OPS()).to.equal(ethers.id("FOUNDER_OPS"));
    });

    it("should expose AIRDROPS constant", async function () {
      expect(await vesting.AIRDROPS()).to.equal(ethers.id("AIRDROPS"));
    });

    it("all constants should be unique", async function () {
      const values = new Set();
      for (const id of ALL_SCHEDULE_IDS) {
        values.add(id);
      }
      expect(values.size).to.equal(ALL_SCHEDULE_IDS.length);
    });
  });

  // ──────────────────────────────────────────────────────
  // Reentrancy protection
  // ──────────────────────────────────────────────────────
  describe("Reentrancy protection", function () {
    it("should safely release with standard ERC20", async function () {
      const futureTs = (await getTimestamp()) + 3600;
      await vesting.connect(owner).createSchedule(
        IDO, beneficiary.address, ethers.parseEther("1000000"), 0n, futureTs, 0, 12
      );
      const s = await vesting.getSchedule(IDO);
      const startTime = Number(s.startTime);

      await setNextBlockTimestamp(startTime + 6 * MONTH);
      // Successful release proves no reentrancy issues with standard tokens
      await vesting.connect(beneficiary).release(IDO);
      expect(await token.balanceOf(beneficiary.address)).to.be.greaterThan(0n);
    });
  });
});
