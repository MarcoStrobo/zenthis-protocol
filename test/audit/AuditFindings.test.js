/**
 * Proof-of-concept tests for the findings of audit/AI_Assisted_Security_Review_2026-10-28.md.
 * Each test ASSERTS THE CURRENT (VULNERABLE) BEHAVIOUR so the finding stays reproducible.
 * When a finding is fixed in a new contract version, flip the assertion.
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const swapIdFrom = (htlc, rc) =>
  rc.logs.map((l) => htlc.interface.parseLog(l)).find((e) => e?.name === "SwapCreated").args.swapId;

describe("Audit PoCs (current behaviour of the deployed code)", () => {
  describe("ZenthisHTLC", () => {
    let htlc, owner, alice, bob, carol;
    beforeEach(async () => {
      [owner, alice, bob, carol] = await ethers.getSigners();
      htlc = await (await ethers.getContractFactory("ZenthisHTLC")).deploy();
    });
    const hl = (n) => ethers.sha256(ethers.zeroPadValue(ethers.toBeHex(n), 32));

    it("HTLC-01: the owner can raise the fee to 5% instantly, after a user already quoted 0.20%", async () => {
      await htlc.setFeeBps(20);
      const value = ethers.parseEther("1");
      await htlc.setFeeBps(500); // owner front-runs the user's transaction
      const now = await time.latest();
      const rc = await (
        await htlc.connect(alice).newSwap(bob.address, hl(1), now + 3600, { value })
      ).wait();
      const ev = rc.logs
        .map((l) => htlc.interface.parseLog(l))
        .find((e) => e?.name === "SwapCreated");
      expect(ev.args.amount).to.equal((value * 9500n) / 10000n); // 5% taken, no slippage protection
    });

    it("HTLC-02: a fee-on-transfer token makes the pool insolvent; the last redeemer loses", async () => {
      const fot = await (await ethers.getContractFactory("FeeOnTransferToken")).deploy();
      await fot.transfer(alice.address, ethers.parseEther("1000"));
      await fot.transfer(bob.address, ethers.parseEther("1000"));
      const amount = ethers.parseEther("100");
      const now = await time.latest();
      const pa = ethers.hexlify(ethers.randomBytes(32));
      const pb = ethers.hexlify(ethers.randomBytes(32));
      const make = async (signer, pre) => {
        await fot.connect(signer).approve(await htlc.getAddress(), amount);
        const rc = await (
          await htlc
            .connect(signer)
            .newSwapToken(
              carol.address,
              await fot.getAddress(),
              amount,
              ethers.sha256(pre),
              now + 3600,
            )
        ).wait();
        return swapIdFrom(htlc, rc);
      };
      const idA = await make(alice, pa);
      const idB = await make(bob, pb);
      // recorded 100 + 100, but the contract only holds 90 + 90
      expect(await fot.balanceOf(await htlc.getAddress())).to.equal(ethers.parseEther("180"));
      await htlc.redeem(idA, pa); // pays 100 (arrives as 90) out of the shared pool
      await expect(htlc.redeem(idB, pb)).to.be.reverted; // 80 left, 100 owed
      expect(await htlc.isActive(idB)).to.equal(true);
      await time.increase(3601);
      await expect(htlc.refund(idB)).to.be.reverted; // refund fails too: funds locked
    });

    it("HTLC-03: an initiator contract that rejects ETH makes refund() revert forever", async () => {
      const init = await (await ethers.getContractFactory("RejectingInitiator")).deploy();
      const now = await time.latest();
      const swapId = await init.start.staticCall(
        await htlc.getAddress(),
        bob.address,
        hl(7),
        now + 3600,
        {
          value: ethers.parseEther("1"),
        },
      );
      await init.start(await htlc.getAddress(), bob.address, hl(7), now + 3600, {
        value: ethers.parseEther("1"),
      });
      await time.increase(3601);
      await expect(htlc.refund(swapId)).to.be.revertedWith("HTLC: ETH refund failed");
      expect(await htlc.isActive(swapId)).to.equal(true);
      expect(await ethers.provider.getBalance(await htlc.getAddress())).to.equal(
        ethers.parseEther("1"),
      );
    });

    it("HTLC-04: the protocol fee is charged at creation and is not returned on refund", async () => {
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

  describe("ZenthisToken", () => {
    let token, owner, alice, mallory;
    beforeEach(async () => {
      [owner, alice, mallory] = await ethers.getSigners();
      token = await (await ethers.getContractFactory("ZenthisToken")).deploy(owner.address);
      await token.transfer(alice.address, ethers.parseEther("1000"));
      await token.transfer(mallory.address, ethers.parseEther("9000"));
    });

    it("ZTS-01: fee sniping — stake right before depositFees, claim, unstake right after", async () => {
      await token.connect(alice).stake(ethers.parseEther("1000"));
      await token.connect(mallory).stake(ethers.parseEther("9000")); // sees depositFees in the mempool
      await token.depositFees({ value: ethers.parseEther("1") });
      await token.connect(mallory).claimRewards();
      await token.connect(mallory).unstake(ethers.parseEther("9000")); // no lock, no cooldown
      expect(await token.earned(alice.address)).to.equal(ethers.parseEther("0.1")); // long-term staker: 10%
    });

    it("ZTS-02: ETH force-sent after stakers claimed can never be withdrawn", async () => {
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
    it("VEST-01: totalAllocated is never reduced on release, blocking new schedules despite free balance", async () => {
      const [owner, ben] = await ethers.getSigners();
      const token = await (await ethers.getContractFactory("ZenthisToken")).deploy(owner.address);
      const vesting = await (
        await ethers.getContractFactory("ZenthisVesting")
      ).deploy(await token.getAddress(), owner.address);
      await token.transfer(await vesting.getAddress(), ethers.parseEther("1000"));
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
      await time.increaseTo(start + 1);
      await vesting.connect(ben).release(ethers.id("A")); // 500 leave, 500 remain free
      expect(await token.balanceOf(await vesting.getAddress())).to.equal(ethers.parseEther("500"));
      const start2 = (await time.latest()) + 100;
      await expect(
        vesting.createSchedule(
          ethers.id("B"),
          ben.address,
          0,
          ethers.parseEther("500"),
          start2,
          0,
          0,
        ),
      ).to.be.revertedWithCustomError(vesting, "InsufficientContractBalance");
    });
  });
});
