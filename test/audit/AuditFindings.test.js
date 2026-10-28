/**
 * Tests for the findings of audit/AI_Assisted_Security_Review_2026-10-28.md.
 *
 * - HTLC-01..03, VEST-01/02, GEN-01: FIXED in the contracts; these tests prove the fix.
 * - HTLC-04, ZTS-01, ZTS-02: not fixable (design choice / deployed immutable token); these tests
 *   keep asserting the current behaviour so the finding stays reproducible.
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const swapIdFrom = (htlc, rc) =>
  rc.logs.map((l) => htlc.interface.parseLog(l)).find((e) => e?.name === "SwapCreated").args.swapId;

describe("Audit findings", () => {
  describe("ZenthisHTLC", () => {
    let htlc, owner, alice, bob, carol;
    beforeEach(async () => {
      [owner, alice, bob, carol] = await ethers.getSigners();
      htlc = await (await ethers.getContractFactory("ZenthisHTLC")).deploy();
    });
    const hl = (n) => ethers.sha256(ethers.zeroPadValue(ethers.toBeHex(n), 32));

    it("HTLC-01 (fixed): newSwapProtected reverts if the owner raised the fee above the user's max", async () => {
      await htlc.setFeeBps(20);
      const value = ethers.parseEther("1");
      await htlc.setFeeBps(500); // owner front-runs the user's transaction
      const now = await time.latest();
      await expect(
        htlc.connect(alice).newSwapProtected(bob.address, hl(1), now + 3600, 20, { value }),
      ).to.be.revertedWith("HTLC: fee above max");
      // with an adequate max the protected variant behaves like newSwap
      const rc = await (
        await htlc.connect(alice).newSwapProtected(bob.address, hl(1), now + 3600, 500, { value })
      ).wait();
      expect(swapIdFrom(htlc, rc)).to.not.equal(undefined);
      // the unprotected variant still takes whatever the current fee is (documented)
      const rc2 = await (
        await htlc.connect(alice).newSwap(bob.address, hl(2), now + 3600, { value })
      ).wait();
      const ev = rc2.logs
        .map((l) => htlc.interface.parseLog(l))
        .find((e) => e?.name === "SwapCreated");
      expect(ev.args.amount).to.equal((value * 9500n) / 10000n);
    });

    it("HTLC-01 (fixed): newSwapTokenProtected enforces the max fee for ERC-20", async () => {
      const tok = await (await ethers.getContractFactory("ZenthisToken")).deploy(owner.address);
      await tok.transfer(alice.address, ethers.parseEther("100"));
      await htlc.setFeeBps(500);
      await tok.connect(alice).approve(await htlc.getAddress(), ethers.parseEther("100"));
      const now = await time.latest();
      await expect(
        htlc
          .connect(alice)
          .newSwapTokenProtected(
            bob.address,
            await tok.getAddress(),
            ethers.parseEther("10"),
            hl(3),
            now + 3600,
            20,
          ),
      ).to.be.revertedWith("HTLC: fee above max");
    });

    it("HTLC-02 (fixed): a fee-on-transfer token is rejected instead of making the pool insolvent", async () => {
      const fot = await (await ethers.getContractFactory("FeeOnTransferToken")).deploy();
      await fot.transfer(alice.address, ethers.parseEther("1000"));
      await fot.connect(alice).approve(await htlc.getAddress(), ethers.parseEther("100"));
      const now = await time.latest();
      await expect(
        htlc
          .connect(alice)
          .newSwapToken(
            carol.address,
            await fot.getAddress(),
            ethers.parseEther("100"),
            hl(4),
            now + 3600,
          ),
      ).to.be.revertedWith("HTLC: unsupported token (fee-on-transfer)");
      expect(await fot.balanceOf(await htlc.getAddress())).to.equal(0n);
    });

    it("HTLC-03 (fixed): refund to an ETH-rejecting contract is credited and can be withdrawn elsewhere", async () => {
      const init = await (await ethers.getContractFactory("RejectingInitiator")).deploy();
      const now = await time.latest();
      const args = [await htlc.getAddress(), bob.address, hl(7), now + 3600];
      const swapId = await init.start.staticCall(...args, { value: ethers.parseEther("1") });
      await init.start(...args, { value: ethers.parseEther("1") });
      await time.increase(3601);

      await expect(htlc.refund(swapId)).to.emit(htlc, "RefundDeferred");
      expect(await htlc.isActive(swapId)).to.equal(false); // REFUNDED, no longer stuck
      expect(await htlc.pendingEthRefunds(await init.getAddress())).to.equal(
        ethers.parseEther("1"),
      );
      expect(await htlc.totalPendingEthRefunds()).to.equal(ethers.parseEther("1"));

      const before = await ethers.provider.getBalance(carol.address);
      await init.withdraw(await htlc.getAddress(), carol.address); // redirect to a wallet that can receive
      expect((await ethers.provider.getBalance(carol.address)) - before).to.equal(
        ethers.parseEther("1"),
      );
      expect(await htlc.pendingEthRefunds(await init.getAddress())).to.equal(0n);
      expect(await ethers.provider.getBalance(await htlc.getAddress())).to.equal(0n);
      await expect(init.withdraw(await htlc.getAddress(), carol.address)).to.be.revertedWith(
        "HTLC: nothing to withdraw",
      );
    });

    it("GEN-01 (fixed): ownership transfer is two-step", async () => {
      await htlc.transferOwnership(alice.address);
      expect(await htlc.owner()).to.equal(owner.address); // not yet
      await expect(htlc.connect(bob).acceptOwnership()).to.be.reverted;
      await htlc.connect(alice).acceptOwnership();
      expect(await htlc.owner()).to.equal(alice.address);
    });

    it("HTLC-04 (accepted design): the protocol fee is charged at creation and is not returned on refund", async () => {
      await htlc.setFeeBps(100);
      const now = await time.latest();
      const rc = await (
        await htlc
          .connect(alice)
          .newSwap(bob.address, hl(9), now + 3600, { value: ethers.parseEther("1") })
      ).wait();
      const id = swapIdFrom(htlc, rc);
      await time.increase(3601);
      const before = await ethers.provider.getBalance(alice.address);
      await htlc.connect(carol).refund(id);
      const back = (await ethers.provider.getBalance(alice.address)) - before;
      expect(back).to.equal(ethers.parseEther("0.99")); // 1% lost although the swap never executed
    });
  });

  describe("ZenthisToken (deployed, immutable)", () => {
    let token, owner, alice, mallory;
    beforeEach(async () => {
      [owner, alice, mallory] = await ethers.getSigners();
      token = await (await ethers.getContractFactory("ZenthisToken")).deploy(owner.address);
      await token.transfer(alice.address, ethers.parseEther("1000"));
      await token.transfer(mallory.address, ethers.parseEther("9000"));
    });

    it("ZTS-01 (open): fee sniping — stake right before depositFees, claim, unstake right after", async () => {
      await token.connect(alice).stake(ethers.parseEther("1000"));
      await token.connect(mallory).stake(ethers.parseEther("9000")); // sees depositFees in the mempool
      await token.depositFees({ value: ethers.parseEther("1") });
      await token.connect(mallory).claimRewards();
      await token.connect(mallory).unstake(ethers.parseEther("9000")); // no lock, no cooldown
      expect(await token.earned(alice.address)).to.equal(ethers.parseEther("0.1")); // long-term staker: 10%
    });

    it("ZTS-02 (open): ETH force-sent after stakers claimed can never be withdrawn", async () => {
      await token.connect(alice).stake(ethers.parseEther("1000"));
      await token.depositFees({ value: ethers.parseEther("1") });
      await token.connect(alice).claimRewards(); // balance back to 0, totalFeesDeposited stays 1 ETH
      await (
        await ethers.getContractFactory("ForceSend")
      ).deploy(await token.getAddress(), { value: ethers.parseEther("0.5") });
      expect(await ethers.provider.getBalance(await token.getAddress())).to.equal(
        ethers.parseEther("0.5"),
      );
      await expect(token.withdrawStuckETH()).to.be.revertedWithCustomError(token, "NoStuckETH");
    });
  });

  describe("ZenthisVesting", () => {
    let owner, ben, other, token, vesting;
    beforeEach(async () => {
      [owner, ben, other] = await ethers.getSigners();
      token = await (await ethers.getContractFactory("ZenthisToken")).deploy(owner.address);
      vesting = await (
        await ethers.getContractFactory("ZenthisVesting")
      ).deploy(await token.getAddress(), owner.address);
      await token.transfer(await vesting.getAddress(), ethers.parseEther("1000"));
    });

    it("VEST-01 (fixed): releasing reduces totalAllocated, so new schedules can use the free balance", async () => {
      const start = (await time.latest()) + 100;
      await vesting.createSchedule(
        ethers.id("A"),
        ben.address,
        0,
        ethers.parseEther("500"),
        start,
        0,
        0,
      );
      expect(await vesting.totalAllocated()).to.equal(ethers.parseEther("500"));
      await time.increaseTo(start + 1);
      await vesting.connect(ben).release(ethers.id("A"));
      expect(await vesting.totalAllocated()).to.equal(0n);
      const start2 = (await time.latest()) + 100;
      await vesting.createSchedule(
        ethers.id("B"),
        ben.address,
        0,
        ethers.parseEther("500"),
        start2,
        0,
        0,
      );
      await expect(
        vesting.createSchedule(
          ethers.id("C"),
          ben.address,
          0,
          ethers.parseEther("1"),
          start2,
          0,
          0,
        ),
      ).to.be.revertedWithCustomError(vesting, "InsufficientContractBalance"); // still protected when really full
    });

    it("VEST-02 (fixed): only the beneficiary can rotate the beneficiary; the owner cannot redirect funds", async () => {
      const start = (await time.latest()) + 100;
      await vesting.createSchedule(
        ethers.id("A"),
        ben.address,
        0,
        ethers.parseEther("100"),
        start,
        0,
        0,
      );
      await expect(
        vesting.transferBeneficiary(ethers.id("A"), other.address),
      ).to.be.revertedWithCustomError(vesting, "NotBeneficiary");
      await expect(
        vesting.connect(ben).transferBeneficiary(ethers.id("A"), ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(vesting, "ZeroAddress");
      await expect(vesting.connect(ben).transferBeneficiary(ethers.id("A"), other.address))
        .to.emit(vesting, "BeneficiaryTransferred")
        .withArgs(ethers.id("A"), ben.address, other.address);
      await time.increaseTo(start + 1);
      await expect(vesting.connect(ben).release(ethers.id("A"))).to.be.revertedWithCustomError(
        vesting,
        "NotBeneficiary",
      );
      await vesting.connect(other).release(ethers.id("A"));
      expect(await token.balanceOf(other.address)).to.equal(ethers.parseEther("100"));
    });

    it("GEN-01 (fixed): ownership transfer is two-step", async () => {
      await vesting.transferOwnership(other.address);
      expect(await vesting.owner()).to.equal(owner.address);
      await vesting.connect(other).acceptOwnership();
      expect(await vesting.owner()).to.equal(other.address);
    });
  });
});
