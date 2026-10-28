/**
 * Tests added after mutation testing of ZenthisHTLC showed behaviours no test observed:
 * reentrancy guards, ETH-send failure handling, zero-address checks, pending-refund accounting and
 * owner-only admin. Each assertion pins behaviour a mutant (deleted require / removed modifier /
 * flipped operator) would change.
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const REENTRANCY = ethers.id("ReentrancyGuardReentrantCall()").slice(0, 10);
const idOf = (htlc, rc) =>
  rc.logs.map((l) => htlc.interface.parseLog(l)).find((e) => e?.name === "SwapCreated").args.swapId;

describe("ZenthisHTLC — mutation killers", () => {
  let htlc, htlcAddr, owner, alice, bob, carol;
  beforeEach(async () => {
    [owner, alice, bob, carol] = await ethers.getSigners();
    htlc = await (await ethers.getContractFactory("ZenthisHTLC")).deploy();
    htlcAddr = await htlc.getAddress();
  });
  const pre = () => ethers.hexlify(ethers.randomBytes(32));

  async function swap(signer, to, preimage, value = ethers.parseEther("1"), delta = 3600) {
    const now = await time.latest();
    const rc = await (
      await htlc.connect(signer).newSwap(to, ethers.sha256(preimage), now + delta, { value })
    ).wait();
    return idOf(htlc, rc);
  }

  describe("reentrancy guards are active", () => {
    it("redeem: a recipient that re-enters redeem/refund/withdraw gets ReentrancyGuardReentrantCall", async () => {
      const actor = await (await ethers.getContractFactory("ReentrantActor")).deploy();
      const otherPre = pre();
      const otherId = await swap(alice, bob.address, otherPre); // would pay bob if the re-entry worked
      const p = pre();
      const id = await swap(alice, await actor.getAddress(), p);
      await actor.arm(htlcAddr, otherId, otherPre, false);
      await htlc.connect(carol).redeem(id, p); // pays the actor -> receive() tries to re-enter
      expect(await actor.attempted()).to.equal(true);
      expect(await actor.redeemOk()).to.equal(false);
      expect(await actor.redeemReason()).to.equal(REENTRANCY);
      expect(await actor.refundReason()).to.equal(REENTRANCY);
      expect(await actor.withdrawReason()).to.equal(REENTRANCY);
      expect((await htlc.getSwap(otherId)).status).to.equal(1n); // other swap untouched
    });

    it("refund: an initiator contract that re-enters during the refund push is blocked", async () => {
      const actor = await (await ethers.getContractFactory("ReentrantActor")).deploy();
      const otherPre = pre();
      const otherId = await swap(alice, bob.address, otherPre, ethers.parseEther("1"), 600);
      const now = await time.latest();
      const p = pre();
      const rid = await actor.start.staticCall(htlcAddr, bob.address, ethers.sha256(p), now + 600, {
        value: ethers.parseEther("1"),
      });
      await actor.start(htlcAddr, bob.address, ethers.sha256(p), now + 600, {
        value: ethers.parseEther("1"),
      });
      await actor.arm(htlcAddr, otherId, otherPre, false);
      await time.increase(700);
      await htlc.connect(carol).refund(rid); // pushes ETH to the actor -> re-entry attempt
      expect(await actor.attempted()).to.equal(true);
      expect(await actor.refundOk()).to.equal(false);
      expect(await actor.refundReason()).to.equal(REENTRANCY);
      expect(await actor.redeemReason()).to.equal(REENTRANCY);
      expect((await htlc.getSwap(otherId)).status).to.equal(1n); // still active, not refunded via re-entry
    });

    it("withdrawPendingRefund: re-entering the pull is blocked", async () => {
      const actor = await (await ethers.getContractFactory("ReentrantActor")).deploy();
      const now = await time.latest();
      const p = pre();
      const rid = await actor.start.staticCall(htlcAddr, bob.address, ethers.sha256(p), now + 600, {
        value: ethers.parseEther("1"),
      });
      await actor.start(htlcAddr, bob.address, ethers.sha256(p), now + 600, {
        value: ethers.parseEther("1"),
      });
      await actor.arm(htlcAddr, rid, p, true); // reject the push so the refund is deferred
      await time.increase(700);
      await htlc.refund(rid);
      expect(await htlc.pendingEthRefunds(await actor.getAddress())).to.equal(
        ethers.parseEther("1"),
      );
      await actor.setReject(false);
      await actor.pull(htlcAddr); // htlc pays the actor -> receive() re-enters withdrawPendingRefund
      expect(await actor.withdrawOk()).to.equal(false);
      expect(await actor.withdrawReason()).to.equal(REENTRANCY);
      expect(await htlc.pendingEthRefunds(await actor.getAddress())).to.equal(0n);
      expect(await htlc.totalPendingEthRefunds()).to.equal(0n);
    });
  });

  describe("ETH send failures are not swallowed", () => {
    it("redeem: a recipient that rejects ETH makes redeem revert and the swap stays ACTIVE", async () => {
      const rej = await (await ethers.getContractFactory("RejectingInitiator")).deploy();
      const p = pre();
      const id = await swap(alice, await rej.getAddress(), p);
      await expect(htlc.redeem(id, p)).to.be.revertedWith("HTLC: ETH transfer failed");
      expect((await htlc.getSwap(id)).status).to.equal(1n);
      expect(await ethers.provider.getBalance(htlcAddr)).to.equal(ethers.parseEther("1"));
    });

    it("withdrawPendingRefund: zero address rejected; a rejecting destination reverts and keeps the credit", async () => {
      const rej = await (await ethers.getContractFactory("RejectingInitiator")).deploy();
      const rejAddr = await rej.getAddress();
      const now = await time.latest();
      const p = pre();
      const rid = await rej.start.staticCall(htlcAddr, bob.address, ethers.sha256(p), now + 600, {
        value: ethers.parseEther("1"),
      });
      await rej.start(htlcAddr, bob.address, ethers.sha256(p), now + 600, {
        value: ethers.parseEther("1"),
      });
      await time.increase(700);
      await htlc.refund(rid); // deferred credit
      expect(await htlc.totalPendingEthRefunds()).to.equal(ethers.parseEther("1"));

      await expect(rej.withdraw(htlcAddr, ethers.ZeroAddress)).to.be.revertedWith(
        "HTLC: invalid address",
      );
      await expect(rej.withdraw(htlcAddr, rejAddr)).to.be.revertedWith("HTLC: withdrawal failed");
      expect(await htlc.pendingEthRefunds(rejAddr)).to.equal(ethers.parseEther("1")); // credit preserved

      await rej.withdraw(htlcAddr, carol.address); // a working destination succeeds
      expect(await htlc.totalPendingEthRefunds()).to.equal(0n); // accounting goes back to zero
      expect(await htlc.pendingEthRefunds(rejAddr)).to.equal(0n);
    });

    it("withdrawEthFees: zero address and a rejecting destination both revert; fees stay", async () => {
      await htlc.setFeeBps(100);
      await swap(alice, bob.address, pre());
      const fees = await htlc.collectedEthFees();
      expect(fees).to.be.gt(0n);
      const rej = await (await ethers.getContractFactory("RejectingInitiator")).deploy();
      await expect(htlc.withdrawEthFees(ethers.ZeroAddress)).to.be.revertedWith(
        "HTLC: invalid address",
      );
      await expect(htlc.withdrawEthFees(await rej.getAddress())).to.be.revertedWith(
        "HTLC: ETH withdrawal failed",
      );
      expect(await htlc.collectedEthFees()).to.equal(fees);
    });

    it("withdrawTokenFees: zero address rejected, then a normal withdrawal works", async () => {
      const tok = await (await ethers.getContractFactory("ZenthisToken")).deploy(owner.address);
      await tok.transfer(alice.address, ethers.parseEther("100"));
      await tok.connect(alice).approve(htlcAddr, ethers.parseEther("100"));
      await htlc.setFeeBps(100);
      const now = await time.latest();
      await htlc
        .connect(alice)
        .newSwapToken(
          bob.address,
          await tok.getAddress(),
          ethers.parseEther("100"),
          ethers.sha256(pre()),
          now + 3600,
        );
      await expect(
        htlc.withdrawTokenFees(await tok.getAddress(), ethers.ZeroAddress),
      ).to.be.revertedWith("HTLC: invalid address");
      await htlc.withdrawTokenFees(await tok.getAddress(), carol.address);
      expect(await tok.balanceOf(carol.address)).to.equal(ethers.parseEther("1"));
    });
  });

  describe("owner-only administration", () => {
    it("pause and unpause are owner-only; creation is blocked while paused and works after unpause", async () => {
      await expect(htlc.connect(alice).pause()).to.be.reverted;
      await htlc.pause();
      await expect(htlc.connect(alice).unpause()).to.be.reverted;
      const now = await time.latest();
      await expect(
        htlc.connect(alice).newSwap(bob.address, ethers.sha256(pre()), now + 3600, { value: 1 }),
      ).to.be.revertedWithCustomError(htlc, "EnforcedPause");
      await htlc.unpause();
      await htlc
        .connect(alice)
        .newSwap(bob.address, ethers.sha256(pre()), now + 3600, { value: 1 });
    });

    it("existing swaps can still be redeemed and refunded while paused (users are never trapped)", async () => {
      const p = pre();
      const id = await swap(alice, bob.address, p);
      const id2 = await swap(alice, bob.address, pre(), 1000n, 600);
      await htlc.pause();
      await htlc.redeem(id, p);
      await time.increase(700);
      await htlc.refund(id2);
      expect((await htlc.getSwap(id)).status).to.equal(2n);
      expect((await htlc.getSwap(id2)).status).to.equal(3n);
    });
  });
});
