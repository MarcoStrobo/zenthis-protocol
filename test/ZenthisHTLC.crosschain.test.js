const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Cross-chain atomic swap simulation.
 * Two ZenthisHTLC instances stand in for "chain A" and "chain B".
 * Alice (initiator) swaps ETH on A for Bob's (counterparty) ETH on B.
 * Rule: initiator timelock (A) must be longer than counterparty timelock (B).
 */
describe("ZenthisHTLC — cross-chain atomic swap (two instances)", () => {
  const AMOUNT_A = ethers.parseEther("1");
  const AMOUNT_B = ethers.parseEther("2");
  const T_A = 2 * 3600; // Alice's lock on chain A
  const T_B = 1 * 3600; // Bob's lock on chain B (shorter)

  let alice, bob, htlcA, htlcB, preimage, hashlock;

  beforeEach(async () => {
    [, alice, bob] = await ethers.getSigners();
    const F = await ethers.getContractFactory("ZenthisHTLC");
    htlcA = await F.deploy();
    htlcB = await F.deploy();
    preimage = ethers.hexlify(ethers.randomBytes(32));
    hashlock = ethers.sha256(preimage); // must be sha256, not keccak256
  });

  async function lock(htlc, signer, recipient, value, delta) {
    const now = await time.latest();
    const tx = await htlc.connect(signer).newSwap(recipient, hashlock, now + delta, { value });
    const rc = await tx.wait();
    const ev = rc.logs.map((l) => htlc.interface.parseLog(l)).find((e) => e?.name === "SwapCreated");
    return ev.args.swapId;
  }

  async function revealedPreimage(htlc, swapId) {
    const evs = await htlc.queryFilter(htlc.filters.SwapRedeemed(swapId));
    return evs[0].args.preimage;
  }

  it("happy path: both sides settle, preimage learned from chain B event", async () => {
    const idA = await lock(htlcA, alice, bob.address, AMOUNT_A, T_A);
    const idB = await lock(htlcB, bob, alice.address, AMOUNT_B, T_B);

    // Alice redeems on B, revealing the preimage
    await htlcB.connect(alice).redeem(idB, preimage);
    expect((await htlcB.getSwap(idB)).status).to.equal(2n); // REDEEMED

    // Bob reads the preimage from B's event and redeems on A
    const seen = await revealedPreimage(htlcB, idB);
    expect(seen).to.equal(preimage);
    const before = await ethers.provider.getBalance(bob.address);
    await htlcA.connect(alice).redeem(idA, seen); // anyone may submit; funds go to Bob
    expect(await ethers.provider.getBalance(bob.address)).to.equal(before + AMOUNT_A);
    expect((await htlcA.getSwap(idA)).status).to.equal(2n);
  });

  it("counterparty never locks: Alice refunds after her timelock", async () => {
    const idA = await lock(htlcA, alice, bob.address, AMOUNT_A, T_A);
    await expect(htlcA.refund(idA)).to.be.revertedWith("HTLC: timelock not expired");
    await time.increase(T_A + 1);
    const before = await ethers.provider.getBalance(alice.address);
    await htlcA.refund(idA);
    expect(await ethers.provider.getBalance(alice.address)).to.equal(before + AMOUNT_A);
  });

  it("initiator never reveals: both sides refund, nobody loses funds", async () => {
    const idA = await lock(htlcA, alice, bob.address, AMOUNT_A, T_A);
    const idB = await lock(htlcB, bob, alice.address, AMOUNT_B, T_B);

    await time.increase(T_A + 1);
    await expect(htlcB.connect(alice).redeem(idB, preimage)).to.be.revertedWith("HTLC: swap expired");

    const bobBefore = await ethers.provider.getBalance(bob.address);
    const aliceBefore = await ethers.provider.getBalance(alice.address);
    await htlcB.refund(idB);
    await htlcA.refund(idA);
    expect(await ethers.provider.getBalance(bob.address)).to.equal(bobBefore + AMOUNT_B);
    expect(await ethers.provider.getBalance(alice.address)).to.equal(aliceBefore + AMOUNT_A);
  });

  it("safe window: Bob can still redeem on A after Alice reveals on B near its expiry", async () => {
    const idA = await lock(htlcA, alice, bob.address, AMOUNT_A, T_A);
    const idB = await lock(htlcB, bob, alice.address, AMOUNT_B, T_B);

    await time.increase(T_B - 60); // Alice redeems just before B expires
    await htlcB.connect(alice).redeem(idB, preimage);

    // A's timelock is still open, Bob has the remaining margin to claim
    await htlcA.redeem(idA, await revealedPreimage(htlcB, idB));
    expect((await htlcA.getSwap(idA)).status).to.equal(2n);
  });

  it("DANGER if timelocks are inverted: Alice can redeem on B then refund on A", async () => {
    // Documents why the UI/relayer must enforce T_initiator > T_counterparty.
    const idA = await lock(htlcA, alice, bob.address, AMOUNT_A, T_B); // too short
    const idB = await lock(htlcB, bob, alice.address, AMOUNT_B, T_A); // too long

    await time.increase(T_B - 30);
    await htlcB.connect(alice).redeem(idB, preimage); // Alice takes B
    await time.increase(60); // A has now expired
    await expect(htlcA.redeem(idA, preimage)).to.be.revertedWith("HTLC: swap expired");
    await htlcA.refund(idA); // Alice gets A back too
    expect((await htlcA.getSwap(idA)).status).to.equal(3n); // REFUNDED
  });

  it("keccak256 hashlock cannot be redeemed (UI must use sha256)", async () => {
    const badLock = ethers.keccak256(preimage);
    const now = await time.latest();
    const tx = await htlcA.connect(alice).newSwap(bob.address, badLock, now + T_A, { value: AMOUNT_A });
    const rc = await tx.wait();
    const id = rc.logs.map((l) => htlcA.interface.parseLog(l)).find((e) => e?.name === "SwapCreated").args.swapId;
    await expect(htlcA.redeem(id, preimage)).to.be.revertedWith("HTLC: invalid preimage");
  });

  it("wrong preimage on either side leaves funds locked and refundable", async () => {
    const idA = await lock(htlcA, alice, bob.address, AMOUNT_A, T_A);
    const bad = ethers.hexlify(ethers.randomBytes(32));
    await expect(htlcA.redeem(idA, bad)).to.be.revertedWith("HTLC: invalid preimage");
    expect(await htlcA.isActive(idA)).to.equal(true);
  });
});
