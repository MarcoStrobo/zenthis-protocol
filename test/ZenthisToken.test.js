const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ZenthisToken", function () {
  let token;
  let owner, treasury, alice, bob, attacker;

  const MAX_SUPPLY  = ethers.parseEther("100000000"); // 100M
  const STAKE_AMT   = ethers.parseEther("1000");
  const FEE_AMT     = ethers.parseEther("1"); // 1 ETH fee deposit

  beforeEach(async () => {
    [owner, treasury, alice, bob, attacker] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("ZenthisToken");
    token = await Token.deploy(treasury.address);
  });

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", () => {
    it("has correct name and symbol", async () => {
      expect(await token.name()).to.equal("Zenthis");
      expect(await token.symbol()).to.equal("ZTS");
    });

    it("mints the full supply to treasury", async () => {
      expect(await token.balanceOf(treasury.address)).to.equal(MAX_SUPPLY);
      expect(await token.totalSupply()).to.equal(MAX_SUPPLY);
    });

    it("has 18 decimals", async () => {
      expect(await token.decimals()).to.equal(18);
    });

    it("reverts on zero treasury address", async () => {
      const Token = await ethers.getContractFactory("ZenthisToken");
      await expect(Token.deploy(ethers.ZeroAddress)).to.be.reverted;
    });
  });

  // ── Staking ────────────────────────────────────────────────────────────────

  describe("Staking", () => {
    beforeEach(async () => {
      // Fund alice from treasury
      await token.connect(treasury).transfer(alice.address, STAKE_AMT);
      await token.connect(alice).approve(await token.getAddress(), STAKE_AMT);
    });

    it("allows staking and emits Staked event", async () => {
      await expect(token.connect(alice).stake(STAKE_AMT))
        .to.emit(token, "Staked")
        .withArgs(alice.address, STAKE_AMT);
    });

    it("updates totalStaked and stakedBalance", async () => {
      await token.connect(alice).stake(STAKE_AMT);
      expect(await token.totalStaked()).to.equal(STAKE_AMT);
      expect(await token.stakedBalance(alice.address)).to.equal(STAKE_AMT);
    });

    it("transfers tokens to contract on stake", async () => {
      await expect(
        token.connect(alice).stake(STAKE_AMT)
      ).to.changeTokenBalance(token, alice, -STAKE_AMT);
    });

    it("reverts on staking 0", async () => {
      await expect(token.connect(alice).stake(0))
        .to.be.revertedWithCustomError(token, "ZeroAmount");
    });

    it("allows unstaking and emits Unstaked event", async () => {
      await token.connect(alice).stake(STAKE_AMT);
      await expect(token.connect(alice).unstake(STAKE_AMT))
        .to.emit(token, "Unstaked")
        .withArgs(alice.address, STAKE_AMT);
    });

    it("returns tokens on unstake", async () => {
      await token.connect(alice).stake(STAKE_AMT);
      await expect(
        token.connect(alice).unstake(STAKE_AMT)
      ).to.changeTokenBalance(token, alice, STAKE_AMT);
    });

    it("reverts on unstaking more than staked", async () => {
      await token.connect(alice).stake(STAKE_AMT);
      await expect(
        token.connect(alice).unstake(STAKE_AMT + 1n)
      ).to.be.revertedWithCustomError(token, "InsufficientStakedBalance");
    });
  });

  // ── Fee distribution ───────────────────────────────────────────────────────

  describe("Fee distribution", () => {
    beforeEach(async () => {
      // Alice stakes 1000, Bob stakes 1000
      await token.connect(treasury).transfer(alice.address, STAKE_AMT);
      await token.connect(treasury).transfer(bob.address, STAKE_AMT);
      await token.connect(alice).approve(await token.getAddress(), STAKE_AMT);
      await token.connect(bob).approve(await token.getAddress(), STAKE_AMT);
      await token.connect(alice).stake(STAKE_AMT);
      await token.connect(bob).stake(STAKE_AMT);
    });

    it("distributes fees equally between two equal stakers", async () => {
      await token.connect(owner).depositFees({ value: FEE_AMT });

      // Both should have earned 0.5 ETH
      const halfFee = FEE_AMT / 2n;
      expect(await token.earned(alice.address)).to.be.closeTo(halfFee, ethers.parseEther("0.0001"));
      expect(await token.earned(bob.address)).to.be.closeTo(halfFee, ethers.parseEther("0.0001"));
    });

    it("allows claiming rewards", async () => {
      await token.connect(owner).depositFees({ value: FEE_AMT });

      await expect(token.connect(alice).claimRewards())
        .to.emit(token, "RewardClaimed");
    });

    it("sends ETH to claimer", async () => {
      await token.connect(owner).depositFees({ value: FEE_AMT });

      const halfFee = FEE_AMT / 2n;
      await expect(
        token.connect(alice).claimRewards()
      ).to.changeEtherBalance(alice, halfFee, { includeFee: false });
    });

    it("reverts if non-owner deposits fees", async () => {
      await expect(
        token.connect(attacker).depositFees({ value: FEE_AMT })
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("reverts claiming when no rewards", async () => {
      await expect(
        token.connect(alice).claimRewards()
      ).to.be.revertedWithCustomError(token, "ZeroAmount");
    });
  });

  // ── Burn ───────────────────────────────────────────────────────────────────

  describe("Burn", () => {
    it("allows token holders to burn their tokens", async () => {
      const burnAmt = ethers.parseEther("1000");
      await token.connect(treasury).burn(burnAmt);
      expect(await token.totalSupply()).to.equal(MAX_SUPPLY - burnAmt);
    });
  });

  // ── Governance ─────────────────────────────────────────────────────────────

  describe("Governance (ERC20Votes)", () => {
    it("allows delegating voting power", async () => {
      await token.connect(treasury).delegate(treasury.address);
      const votes = await token.getVotes(treasury.address);
      expect(votes).to.equal(MAX_SUPPLY);
    });
  });
});
