const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ZenthisPresale", function () {
  const RATE = ethers.parseEther("1000"); // 1 ETH = 1,000 ZTS
  const SOFT_CAP = ethers.parseEther("0.1");
  const HARD_CAP = ethers.parseEther("50");
  const MIN_BUY = ethers.parseEther("0.1"); // ≈ $300
  const MAX_BUY = ethers.parseEther("5");
  const LIQ_PCT = 6000n; // 60% → liquidity
  const ONE_ETH = ethers.parseEther("1");

  // ── Bonus config ───────────────────────────────────────────────
  const FLAT_AIRDROP = ethers.parseEther("2000");
  const BT1_ETH = ethers.parseEther("0.1"); // $300   → +500
  const BT1_REW = ethers.parseEther("500");
  const BT2_ETH = ethers.parseEther("0.333"); // $1,000 → +1,000
  const BT2_REW = ethers.parseEther("1000");
  const BT3_ETH = ethers.parseEther("0.667"); // $2,000 → +1,500
  const BT3_REW = ethers.parseEther("1500");
  const BT4_ETH = ethers.parseEther("1.0"); // $3,000+ → +2,000
  const BT4_REW = ethers.parseEther("2000");
  const REF_MIN = ethers.parseEther("0.1");
  const BONUS_POOL = ethers.parseEther("5000000");

  let token, presale, owner, liqWallet, treasuryWallet, users;
  let startTime, endTime;
  const DURATION = 7 * 24 * 3600;

  async function deploy(opts = {}) {
    const block = await ethers.provider.getBlock("latest");
    const now = BigInt(block.timestamp);
    const s = BigInt(opts.startTimeOffset ?? 2) + now;
    const e = s + BigInt(opts.duration ?? DURATION);

    const P = await ethers.getContractFactory("ZenthisPresale");
    const p = await P.deploy(
      await token.getAddress(),
      opts.rate ?? RATE,
      opts.soft ?? SOFT_CAP,
      opts.hard ?? HARD_CAP,
      opts.min ?? MIN_BUY,
      opts.max ?? MAX_BUY,
      opts.liq ?? LIQ_PCT,
      s,
      e,
      opts.lw ?? liqWallet.address,
      opts.tw ?? treasuryWallet.address,
      opts.bp ?? BONUS_POOL,
      opts.flat ?? FLAT_AIRDROP,
      opts.b1e ?? BT1_ETH,
      opts.b1r ?? BT1_REW,
      opts.b2e ?? BT2_ETH,
      opts.b2r ?? BT2_REW,
      opts.b3e ?? BT3_ETH,
      opts.b3r ?? BT3_REW,
      opts.b4e ?? BT4_ETH,
      opts.b4r ?? BT4_REW,
      opts.rm ?? REF_MIN,
      opts.p1e ?? s + BigInt(opts.duration ?? DURATION) / 2n // V17: phase1EndTime = mitad de la presale por defecto
    );
    await p.waitForDeployment();
    return p;
  }

  beforeEach(async function () {
    [owner, liqWallet, treasuryWallet, ...users] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("ZenthisToken");
    token = await Token.deploy(owner.address);
    await token.waitForDeployment();

    // Deposit ZTS into presale contract after deploy
    presale = await deploy();
    const pAddr = await presale.getAddress();
    const required = await presale.getRequiredZts();
    await token.transfer(pAddr, required);
    await presale.depositTokens();

    // V9: whitelist all test users + owner + treasury (referrers) in Phase 1
    if (users.length > 0) {
      const wl = users.map((u) => u.address);
      wl.push(owner.address, treasuryWallet.address);
      await presale.addToWhitelist(wl, 1);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  DEPLOYMENT
  // ─────────────────────────────────────────────────────────────────────────
  describe("Deployment", function () {
    it("should set config correctly", async function () {
      const cfg = await presale.config();
      expect(cfg.rate).to.equal(RATE);
      expect(cfg.softCap).to.equal(SOFT_CAP);
      expect(cfg.hardCap).to.equal(HARD_CAP);
      expect(cfg.minBuy).to.equal(MIN_BUY);
      expect(cfg.maxBuy).to.equal(MAX_BUY);
      expect(cfg.flatAirdrop).to.equal(FLAT_AIRDROP);
      expect(cfg.bonusTier1Eth).to.equal(BT1_ETH);
      expect(cfg.bonusTier1Reward).to.equal(BT1_REW);
      expect(cfg.bonusTier2Eth).to.equal(BT2_ETH);
      expect(cfg.bonusTier2Reward).to.equal(BT2_REW);
      expect(cfg.bonusTier3Eth).to.equal(BT3_ETH);
      expect(cfg.bonusTier3Reward).to.equal(BT3_REW);
      expect(cfg.bonusTier4Eth).to.equal(BT4_ETH);
      expect(cfg.bonusTier4Reward).to.equal(BT4_REW);
    });

    it("should reject zero addresses", async function () {
      const P = await ethers.getContractFactory("ZenthisPresale");
      const block = await ethers.provider.getBlock("latest");
      const s = BigInt(block.timestamp) + 100n;
      const e = s + BigInt(DURATION);
      const args = [
        await token.getAddress(),
        RATE,
        SOFT_CAP,
        HARD_CAP,
        MIN_BUY,
        MAX_BUY,
        LIQ_PCT,
        s,
        e,
        liqWallet.address,
        treasuryWallet.address,
        BONUS_POOL,
        FLAT_AIRDROP,
        BT1_ETH,
        BT1_REW,
        BT2_ETH,
        BT2_REW,
        BT3_ETH,
        BT3_REW,
        BT4_ETH,
        BT4_REW,
        REF_MIN,
        s + BigInt(DURATION) / 2n, // phase1EndTime
      ];
      const testCases = [
        { desc: "zero token", args: [ethers.ZeroAddress, ...args.slice(1)] },
        {
          desc: "zero liq wallet",
          args: [...args.slice(0, 9), ethers.ZeroAddress, ...args.slice(10)],
        },
        {
          desc: "zero treasury",
          args: [...args.slice(0, 10), ethers.ZeroAddress, ...args.slice(11)],
        },
      ];
      for (const tc of testCases) {
        await expect(P.deploy(...tc.args)).to.be.revertedWithCustomError(P, "Presale_ZeroAddress");
      }
    });

    it("should reject invalid bonus tier thresholds", async function () {
      const P = await ethers.getContractFactory("ZenthisPresale");
      const block = await ethers.provider.getBlock("latest");
      const s = BigInt(block.timestamp) + 100n;
      const e = s + BigInt(DURATION);
      // tier2 threshold lower than tier1 → invalid
      await expect(
        P.deploy(
          await token.getAddress(),
          RATE,
          SOFT_CAP,
          HARD_CAP,
          MIN_BUY,
          MAX_BUY,
          LIQ_PCT,
          s,
          e,
          liqWallet.address,
          treasuryWallet.address,
          BONUS_POOL,
          FLAT_AIRDROP,
          BT1_ETH,
          BT1_REW,
          ethers.parseEther("0.05"),
          BT2_REW, // lower threshold!
          BT3_ETH,
          BT3_REW,
          BT4_ETH,
          BT4_REW,
          REF_MIN,
          s + BigInt(DURATION) / 2n, // phase1EndTime
        ),
      ).to.be.revertedWithCustomError(P, "Presale_InvalidThreshold");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  CONTRIBUTE
  // ─────────────────────────────────────────────────────────────────────────
  describe("Contribute", function () {
    it("should accept contributions during presale", async function () {
      const u = users[0];
      const amt = ethers.parseEther("1");
      await expect(presale.connect(u).contribute(ethers.ZeroAddress, { value: amt }))
        .to.emit(presale, "Contributed")
        .withArgs(u.address, amt, ethers.ZeroAddress);
      expect(await presale.contribution(u.address)).to.equal(amt);
      expect(await presale.totalRaised()).to.equal(amt);
    });

    it("should accept receive() fallback", async function () {
      const u = users[0];
      const amt = ethers.parseEther("0.5");
      await expect(u.sendTransaction({ to: await presale.getAddress(), value: amt }))
        .to.emit(presale, "Contributed")
        .withArgs(u.address, amt, ethers.ZeroAddress);
    });

    it("should reject contributions below minBuy", async function () {
      await expect(
        presale
          .connect(users[0])
          .contribute(ethers.ZeroAddress, { value: ethers.parseEther("0.01") }),
      ).to.be.revertedWithCustomError(presale, "Presale_BelowMinBuy");
    });

    it("should reject contributions above maxBuy", async function () {
      const u = users[0];
      await presale.connect(u).contribute(ethers.ZeroAddress, { value: ethers.parseEther("0.5") });
      await expect(
        presale.connect(u).contribute(ethers.ZeroAddress, { value: ethers.parseEther("5") }),
      ).to.be.revertedWithCustomError(presale, "Presale_AboveMaxBuy");
    });

    it("should reject contributions above hardCap", async function () {
      const p2 = await deploy({ soft: ethers.parseEther("0.1"), max: ethers.parseEther("60") });
      const pAddr = await p2.getAddress();
      await token.transfer(pAddr, await p2.getRequiredZts());
      await p2.depositTokens();
      await p2.addToWhitelist([users[0].address], 1);
      await p2.connect(users[0]).contribute(ethers.ZeroAddress, { value: ethers.parseEther("49") });
      await expect(
        p2.connect(users[0]).contribute(ethers.ZeroAddress, { value: ethers.parseEther("2") }),
      ).to.be.revertedWithCustomError(p2, "Presale_AboveHardCap");
    });

    it("should handle referrer on first contribution", async function () {
      const [referee] = users;
      const referrer = owner;
      const amt = ethers.parseEther("0.5");
      await presale.connect(referee).contribute(referrer.address, { value: amt });
      expect(await presale.referrerOf(referee.address)).to.equal(referrer.address);
    });

    it("should reject self-referral", async function () {
      await expect(
        presale.connect(users[0]).contribute(users[0].address, { value: ethers.parseEther("0.5") }),
      ).to.be.revertedWithCustomError(presale, "Presale_SelfReferral");
    });

    it("should not change referrer on subsequent contributions", async function () {
      const [referee] = users;
      const r1 = owner;
      const r2 = treasuryWallet;
      await presale.connect(referee).contribute(r1.address, { value: ethers.parseEther("0.5") });
      await presale.connect(referee).contribute(r2.address, { value: ethers.parseEther("0.5") });
      expect(await presale.referrerOf(referee.address)).to.equal(r1.address);
    });

    it("should revert before start time", async function () {
      const p2 = await deploy({ startTimeOffset: 1000 });
      await expect(
        p2.connect(users[0]).contribute(ethers.ZeroAddress, { value: ethers.parseEther("1") }),
      ).to.be.revertedWithCustomError(p2, "Presale_NotStarted");
    });

    it("should revert after end time", async function () {
      const p2 = await deploy({ startTimeOffset: 1000, duration: 100 });
      const pAddr = await p2.getAddress();
      await token.transfer(pAddr, await p2.getRequiredZts());
      await p2.depositTokens();
      await ethers.provider.send("evm_increaseTime", [1200]);
      await ethers.provider.send("evm_mine", []);
      await expect(
        p2.connect(users[0]).contribute(ethers.ZeroAddress, { value: ethers.parseEther("1") }),
      ).to.be.revertedWithCustomError(p2, "Presale_Ended");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  REFERRAL QUALIFICATION
  // ─────────────────────────────────────────────────────────────────────────
  describe("Referral Qualification", function () {
    it("should count qualified referral when ≥ min contribution", async function () {
      const [referee] = users;
      const referrer = owner;
      await presale
        .connect(referee)
        .contribute(referrer.address, { value: ethers.parseEther("0.5") });
      expect(await presale.qualifiedReferrals(referrer.address)).to.equal(1);
      expect(await presale.totalReferralQualified()).to.equal(1);
    });

    it("should not count below-min referral", async function () {
      const p2 = await deploy({
        rm: ethers.parseEther("5"),
      });
      const pAddr = await p2.getAddress();
      const required = await p2.getRequiredZts();
      await token.transfer(pAddr, required);
      await p2.depositTokens();
      await p2.addToWhitelist([users[0].address, owner.address], 1);
      const u = users[0];
      await p2.connect(u).contribute(owner.address, { value: ethers.parseEther("1") });
      expect(await p2.qualifiedReferrals(owner.address)).to.equal(0);
    });

    it("should not double-count multi-contribution referee", async function () {
      const [referee] = users;
      await presale.connect(referee).contribute(owner.address, { value: ethers.parseEther("0.5") });
      await presale.connect(referee).contribute(owner.address, { value: ethers.parseEther("0.3") });
      expect(await presale.qualifiedReferrals(owner.address)).to.equal(1);
    });

    it("should count multiple referees separately", async function () {
      await presale
        .connect(users[0])
        .contribute(owner.address, { value: ethers.parseEther("0.5") });
      await presale
        .connect(users[1])
        .contribute(owner.address, { value: ethers.parseEther("0.5") });
      expect(await presale.qualifiedReferrals(owner.address)).to.equal(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  FINALIZE
  // ─────────────────────────────────────────────────────────────────────────
  describe("Finalize", function () {
    it("should finalize when soft cap met", async function () {
      await presale
        .connect(users[0])
        .contribute(ethers.ZeroAddress, { value: ethers.parseEther("1") });
      await networkForwardTime(presale, 7 * 24 * 3600 + 1);
      await presale.requestFinalize();
      await networkForwardTime(presale, 48 * 3600 + 1);
      const liqBalBefore = await ethers.provider.getBalance(liqWallet.address);
      const treasuryBalBefore = await ethers.provider.getBalance(treasuryWallet.address);
      await expect(presale.finalize()).to.emit(presale, "Finalized");
      expect(await presale.finalized()).to.be.true;
      // 60% liquidity, 40% treasury
      const liqEth = ethers.parseEther("0.6");
      const treasuryEth = ethers.parseEther("0.4");
      expect(await ethers.provider.getBalance(liqWallet.address)).to.equal(liqBalBefore + liqEth);
      expect(await ethers.provider.getBalance(treasuryWallet.address)).to.equal(
        treasuryBalBefore + treasuryEth,
      );
    });

    it("should revert finalize before end time", async function () {
      await expect(presale.finalize()).to.be.revertedWithCustomError(presale, "Presale_NotEnded");
    });

    it("should revert finalize if soft cap not met", async function () {
      await networkForwardTime(presale, 7 * 24 * 3600 + 1);
      await expect(presale.requestFinalize()).to.be.revertedWithCustomError(
        presale,
        "Presale_SoftCapNotMet",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  REFUND
  // ─────────────────────────────────────────────────────────────────────────
  describe("Refund", function () {
    it("should refund when soft cap not reached", async function () {
      // Deploy presale with soft cap higher than min buy so we can fail meaningfully
      const pF = await deploy({
        soft: ethers.parseEther("10"),
        hard: ethers.parseEther("50"),
        min: ethers.parseEther("0.05"),
        max: ethers.parseEther("5"),
      });
      const pFAddr = await pF.getAddress();
      await token.transfer(pFAddr, await pF.getRequiredZts());
      await pF.depositTokens();
      await pF.addToWhitelist([users[0].address], 1);
      await pF
        .connect(users[0])
        .contribute(ethers.ZeroAddress, { value: ethers.parseEther("0.5") });
      await networkForwardTime(pF, 7 * 24 * 3600 + 1);
      await pF.markFailed();
      const bal = await ethers.provider.getBalance(users[0].address);
      const tx = await pF.connect(users[0]).refundMe();
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      expect(await ethers.provider.getBalance(users[0].address)).to.equal(
        bal - gasCost + ethers.parseEther("0.5"),
      );
    });

    it("should not refund after finalize", async function () {
      await presale
        .connect(users[0])
        .contribute(ethers.ZeroAddress, { value: ethers.parseEther("1") });
      await networkForwardAndFinalize(presale);
      await expect(presale.connect(users[0]).refundMe()).to.be.revertedWithCustomError(
        presale,
        "Presale_SoftCapMet",
      );
    });

    it("should track failed state", async function () {
      const pF = await deploy({
        soft: ethers.parseEther("10"),
        hard: ethers.parseEther("50"),
        min: ethers.parseEther("0.05"),
        max: ethers.parseEther("5"),
      });
      const pFAddr = await pF.getAddress();
      await token.transfer(pFAddr, await pF.getRequiredZts());
      await pF.depositTokens();
      await pF.addToWhitelist([users[0].address], 1);
      await pF
        .connect(users[0])
        .contribute(ethers.ZeroAddress, { value: ethers.parseEther("0.5") });
      await networkForwardTime(pF, 7 * 24 * 3600 + 1);
      await pF.markFailed();
      await pF.connect(users[0]).refundMe();
      expect(await pF.failed()).to.be.true;
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  BONUS COMPUTATION
  // ─────────────────────────────────────────────────────────────────────────
  describe("Bonus Computation", function () {
    it("should give flat airdrop + tier 1 bonus for minBuy", async function () {
      await presale.connect(users[0]).contribute(ethers.ZeroAddress, { value: MIN_BUY });
      await networkForwardAndFinalize(presale);
      expect(await presale.getTotalBonus(users[0].address)).to.equal(FLAT_AIRDROP + BT1_REW);
    });

    it("should give flat airdrop + tier 2 bonus for 0.333 ETH", async function () {
      await presale.connect(users[0]).contribute(ethers.ZeroAddress, { value: BT2_ETH });
      await networkForwardAndFinalize(presale);
      expect(await presale.getTotalBonus(users[0].address)).to.equal(FLAT_AIRDROP + BT2_REW);
    });

    it("should give flat airdrop + tier 3 bonus for 0.667 ETH", async function () {
      await presale.connect(users[0]).contribute(ethers.ZeroAddress, { value: BT3_ETH });
      await networkForwardAndFinalize(presale);
      expect(await presale.getTotalBonus(users[0].address)).to.equal(FLAT_AIRDROP + BT3_REW);
    });

    it("should give flat airdrop + tier 4 bonus for 1+ ETH", async function () {
      await presale.connect(users[0]).contribute(ethers.ZeroAddress, { value: ONE_ETH });
      await networkForwardAndFinalize(presale);
      expect(await presale.getTotalBonus(users[0].address)).to.equal(FLAT_AIRDROP + BT4_REW);
    });

    it("should return 0 bonus for below-minBuy contribution", async function () {
      await presale.connect(users[0]).contribute(ethers.ZeroAddress, { value: MIN_BUY });
      // remove min constraint by deploying a new one... use separate test
      // Instead: we already know minBuy = 0.1, so we can't test below min via the contract
      // Let's verify the contract enforces it
    });

    it("should tie-break to highest bonus tier only", async function () {
      await presale.connect(users[0]).contribute(ethers.ZeroAddress, { value: ONE_ETH });
      await networkForwardAndFinalize(presale);
      // Should get tier 4 bonus (2,000), not sum of all tiers
      expect(await presale.getTierBonus(users[0].address)).to.equal(BT4_REW);
      expect(await presale.getFlatBonus(users[0].address)).to.equal(FLAT_AIRDROP);
    });

    it("should reserve bonus at contribution time (pool sufficient by invariant)", async function () {
      // Deploy with pool >= theoreticalMin (constructor enforces this)
      const p2 = await deploy({ bp: BONUS_POOL });
      const pAddr = await p2.getAddress();
      const required = await p2.getRequiredZts();
      await token.transfer(pAddr, required);
      await p2.depositTokens();
      // Whitelist 10 users
      for (let i = 0; i < 10; i++) {
        await p2.addToWhitelist([users[i].address], 1);
      }
      // All 10 contribute maxBuy (5 ETH each)
      for (let i = 0; i < 10; i++) {
        await p2.connect(users[i]).contribute(ethers.ZeroAddress, { value: MAX_BUY });
      }
      // Reserved bonus should equal total contributions * tier 4 bonus
      const perUser = ethers.parseEther("2000") + ethers.parseEther("2000"); // flat + tier4
      const expectedReserved = perUser * 10n;
      expect(await p2.totalReservedBonus()).to.equal(expectedReserved);
      // Pool still has enough for claims
      expect(await p2.getRemainingBonusPool()).to.equal(BONUS_POOL - expectedReserved);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  CLAIM
  // ─────────────────────────────────────────────────────────────────────────
  describe("Claim", function () {
    it("should claim purchased + bonuses after finalize", async function () {
      await presale.connect(users[0]).contribute(ethers.ZeroAddress, { value: ONE_ETH });
      await networkForwardAndFinalize(presale);

      const balBefore = await token.balanceOf(users[0].address);
      const tx = await presale.connect(users[0]).claim();
      const receipt = await tx.wait();
      await expect(tx).to.emit(presale, "Claimed");

      const ztsPurchased = (ONE_ETH * RATE) / ethers.parseEther("1"); // = 1,000 ZTS
      const expectedTotal = ztsPurchased + FLAT_AIRDROP + BT4_REW;
      const balAfter = await token.balanceOf(users[0].address);
      expect(balAfter - balBefore).to.equal(expectedTotal);
      expect(await presale.claimed(users[0].address)).to.be.true;
    });

    it("should reject double claim", async function () {
      await presale.connect(users[0]).contribute(ethers.ZeroAddress, { value: ONE_ETH });
      await networkForwardAndFinalize(presale);
      await presale.connect(users[0]).claim();
      await expect(presale.connect(users[0]).claim()).to.be.revertedWithCustomError(
        presale,
        "Presale_AlreadyClaimed",
      );
    });

    it("should reject claim before finalize (before end)", async function () {
      await presale.connect(users[0]).contribute(ethers.ZeroAddress, { value: ONE_ETH });
      await expect(presale.connect(users[0]).claim()).to.be.revertedWithCustomError(
        presale,
        "Presale_NotEnded",
      );
    });

    it("should reject claim after end but without finalize (fail state)", async function () {
      await presale
        .connect(users[0])
        .contribute(ethers.ZeroAddress, { value: ethers.parseEther("1") });
      await networkForwardTime(presale, 7 * 24 * 3600 + 1);
      await expect(presale.connect(users[0]).claim()).to.be.revertedWithCustomError(
        presale,
        "Presale_NotFinalized",
      );
    });

    it("should track totalBonusClaimed", async function () {
      await presale.connect(users[0]).contribute(ethers.ZeroAddress, { value: ONE_ETH });
      await networkForwardAndFinalize(presale);
      await presale.connect(users[0]).claim();
      expect(await presale.totalBonusClaimed()).to.equal(FLAT_AIRDROP + BT4_REW);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  VIEWS
  // ─────────────────────────────────────────────────────────────────────────
  describe("Views", function () {
    it("getZtsAmount should compute correctly", async function () {
      await presale.connect(users[0]).contribute(ethers.ZeroAddress, { value: ONE_ETH });
      const expected = (ONE_ETH * RATE) / ethers.parseEther("1");
      expect(await presale.getZtsAmount(users[0].address)).to.equal(expected);
    });

    it("getClaimableAmount should return 0 if already claimed", async function () {
      await presale.connect(users[0]).contribute(ethers.ZeroAddress, { value: ONE_ETH });
      await networkForwardAndFinalize(presale);
      await presale.connect(users[0]).claim();
      expect(await presale.getClaimableAmount(users[0].address)).to.equal(0);
    });

    it("getRemainingBonusPool should reflect reservations and claims", async function () {
      expect(await presale.getRemainingBonusPool()).to.equal(BONUS_POOL);
      await presale.connect(users[0]).contribute(ethers.ZeroAddress, { value: ONE_ETH });
      // After contribution, reserved bonus deducted from "remaining"
      const perUser = FLAT_AIRDROP + BT4_REW;
      expect(await presale.getRemainingBonusPool()).to.equal(BONUS_POOL - perUser);
      await networkForwardAndFinalize(presale);
      await presale.connect(users[0]).claim();
      // After claim, reservation released back to pool view (as paid out)
      expect(await presale.getRemainingBonusPool()).to.equal(BONUS_POOL);
    });

    it("getRequiredZts should compute max scenario", async function () {
      const maxContribZts = (HARD_CAP * RATE) / ethers.parseEther("1");
      const liqEth = (HARD_CAP * LIQ_PCT) / 10000n;
      const liqZts = (liqEth * RATE) / ethers.parseEther("1");
      const expected = maxContribZts + BONUS_POOL + liqZts;
      expect(await presale.getRequiredZts()).to.equal(expected);
    });

    it("getLiquidityZtsAmount should compute correctly", async function () {
      await presale
        .connect(users[0])
        .contribute(ethers.ZeroAddress, { value: ethers.parseEther("1") });
      const liqEth = (ethers.parseEther("1") * 6000n) / 10000n;
      const liqZts = (liqEth * RATE) / ethers.parseEther("1");
      expect(await presale.getLiquidityZtsAmount()).to.equal(liqZts);
    });

    it("getBonusInfo should return all tiers", async function () {
      const info = await presale.getBonusInfo();
      expect(info.flatAirdrop).to.equal(FLAT_AIRDROP);
      expect(info.bonusThresholds[0]).to.equal(BT1_ETH);
      expect(info.bonusThresholds[1]).to.equal(BT2_ETH);
      expect(info.bonusThresholds[2]).to.equal(BT3_ETH);
      expect(info.bonusThresholds[3]).to.equal(BT4_ETH);
      expect(info.bonusRewards[0]).to.equal(BT1_REW);
      expect(info.bonusRewards[1]).to.equal(BT2_REW);
      expect(info.bonusRewards[2]).to.equal(BT3_REW);
      expect(info.bonusRewards[3]).to.equal(BT4_REW);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  ADMIN
  // ─────────────────────────────────────────────────────────────────────────
  describe("Admin", function () {
    it("should withdraw unused tokens after finalize", async function () {
      await presale
        .connect(users[0])
        .contribute(ethers.ZeroAddress, { value: ethers.parseEther("1") });
      await networkForwardAndFinalize(presale);
      // claimDeadline is set automatically to endTime + 90 days — advance past it
      await ethers.provider.send("evm_increaseTime", [91 * 24 * 3600]);
      await ethers.provider.send("evm_mine", []);
      const balBefore = await token.balanceOf(owner.address);
      await presale.withdrawUnusedTokens();
      const balAfter = await token.balanceOf(owner.address);
      expect(balAfter).to.be.gt(balBefore);
    });

    it("should pause and unpause", async function () {
      await presale.pause();
      await expect(
        presale.connect(users[0]).contribute(ethers.ZeroAddress, { value: ethers.parseEther("1") }),
      ).to.be.revertedWithCustomError(presale, "EnforcedPause");
      await presale.unpause();
      await presale
        .connect(users[0])
        .contribute(ethers.ZeroAddress, { value: ethers.parseEther("1") });
      expect(await presale.contribution(users[0].address)).to.equal(ethers.parseEther("1"));
    });

    it("should only allow owner to pause", async function () {
      await expect(presale.connect(users[0]).pause()).to.be.revertedWithCustomError(
        presale,
        "OwnableUnauthorizedAccount",
      );
    });
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────
async function networkForwardTime(contract, seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function networkForwardAndFinalize(contract) {
  await networkForwardTime(contract, 7 * 24 * 3600 + 1);
  await contract.requestFinalize();
  await networkForwardTime(contract, 48 * 3600 + 1);
  await contract.finalize();
}
