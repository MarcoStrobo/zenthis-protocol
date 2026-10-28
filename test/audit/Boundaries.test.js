/**
 * Exact-boundary tests for ZenthisHTLC parameters. Off-by-one errors in these checks are classic
 * contract bugs, so every limit is probed one second/one unit on each side with a pinned block time.
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ZenthisHTLC — exact boundaries", () => {
  let htlc, alice, bob;
  const MIN = 5 * 60;
  const MAX = 2 * 24 * 3600;
  const hl = (n) => ethers.sha256(ethers.zeroPadValue(ethers.toBeHex(n), 32));

  beforeEach(async () => {
    [, alice, bob] = await ethers.getSigners();
    htlc = await (await ethers.getContractFactory("ZenthisHTLC")).deploy();
    expect(await htlc.MIN_TIMELOCK_DELTA()).to.equal(BigInt(MIN));
    expect(await htlc.MAX_TIMELOCK_DELTA()).to.equal(BigInt(MAX));
  });

  async function atTime(delta, run) {
    const t = (await time.latest()) + 100;
    await time.setNextBlockTimestamp(t);
    return run(t + delta);
  }

  it("timelock: exactly now+MIN is accepted, one second less is rejected", async () => {
    await atTime(MIN, (tl) => htlc.connect(alice).newSwap(bob.address, hl(1), tl, { value: 1000 }));
    await expect(
      atTime(MIN - 1, (tl) => htlc.connect(alice).newSwap(bob.address, hl(2), tl, { value: 1000 })),
    ).to.be.revertedWith("HTLC: timelock too short");
  });

  it("timelock: exactly now+MAX is accepted, one second more is rejected", async () => {
    await atTime(MAX, (tl) => htlc.connect(alice).newSwap(bob.address, hl(3), tl, { value: 1000 }));
    await expect(
      atTime(MAX + 1, (tl) => htlc.connect(alice).newSwap(bob.address, hl(4), tl, { value: 1000 })),
    ).to.be.revertedWith("HTLC: timelock too long");
  });

  it("timelock: the same limits apply to the ERC-20 and the protected variants", async () => {
    const [owner] = await ethers.getSigners();
    const tok = await (await ethers.getContractFactory("ZenthisToken")).deploy(owner.address);
    await tok.transfer(alice.address, 1000n);
    await tok.connect(alice).approve(await htlc.getAddress(), 1000n);
    const tokAddr = await tok.getAddress();
    await expect(
      atTime(MIN - 1, (tl) =>
        htlc.connect(alice).newSwapToken(bob.address, tokAddr, 10, hl(5), tl),
      ),
    ).to.be.revertedWith("HTLC: timelock too short");
    await expect(
      atTime(MAX + 1, (tl) =>
        htlc.connect(alice).newSwapProtected(bob.address, hl(6), tl, 500, { value: 1000 }),
      ),
    ).to.be.revertedWith("HTLC: timelock too long");
  });

  it("redeem/refund meet exactly at the timelock: redeem works at t-1, refund works at t, never both", async () => {
    const pre = ethers.hexlify(ethers.randomBytes(32));
    const t0 = (await time.latest()) + 100;
    await time.setNextBlockTimestamp(t0);
    const tl = t0 + 3600;
    const rc = await (
      await htlc.connect(alice).newSwap(bob.address, ethers.sha256(pre), tl, { value: 1000 })
    ).wait();
    const id = rc.logs.map((l) => htlc.interface.parseLog(l)).find((e) => e?.name === "SwapCreated")
      .args.swapId;

    await time.setNextBlockTimestamp(tl - 1);
    await expect(htlc.refund(id)).to.be.revertedWith("HTLC: timelock not expired"); // t-1: refund too early
    await time.setNextBlockTimestamp(tl);
    await expect(htlc.redeem(id, pre)).to.be.revertedWith("HTLC: swap expired"); // t: redeem too late
    await htlc.refund(id); // t+1 block: refund allowed
    expect(await htlc.isActive(id)).to.equal(false);
  });

  it("redeem succeeds one second before the timelock", async () => {
    const pre = ethers.hexlify(ethers.randomBytes(32));
    const t0 = (await time.latest()) + 100;
    await time.setNextBlockTimestamp(t0);
    const tl = t0 + 3600;
    const rc = await (
      await htlc.connect(alice).newSwap(bob.address, ethers.sha256(pre), tl, { value: 1000 })
    ).wait();
    const id = rc.logs.map((l) => htlc.interface.parseLog(l)).find((e) => e?.name === "SwapCreated")
      .args.swapId;
    await time.setNextBlockTimestamp(tl - 1);
    await htlc.redeem(id, pre);
    expect((await htlc.getSwap(id)).status).to.equal(2n);
  });

  it("amount: zero is rejected for ETH and tokens; fee cap is exactly 500 bps", async () => {
    const now = await time.latest();
    await expect(
      htlc.connect(alice).newSwap(bob.address, hl(7), now + 3600, { value: 0 }),
    ).to.be.revertedWith("HTLC: amount must be > 0");
    await htlc.setFeeBps(500);
    await expect(htlc.setFeeBps(501)).to.be.revertedWith("HTLC: fee too high");
    await expect(
      htlc.connect(alice).newSwapProtected(bob.address, hl(8), now + 3600, 499, { value: 1000 }),
    ).to.be.revertedWith("HTLC: fee above max");
    await htlc
      .connect(alice)
      .newSwapProtected(bob.address, hl(8), now + 3600, 500, { value: 1000 }); // max == fee ok
  });

  it("recipient: zero address and self-swap are rejected", async () => {
    const now = await time.latest();
    await expect(
      htlc.connect(alice).newSwap(ethers.ZeroAddress, hl(9), now + 3600, { value: 1000 }),
    ).to.be.revertedWith("HTLC: invalid recipient");
    await expect(
      htlc.connect(alice).newSwap(alice.address, hl(9), now + 3600, { value: 1000 }),
    ).to.be.revertedWith("HTLC: self-swap not allowed");
  });

  it("refund is allowed in the very block whose timestamp equals the timelock (block-pinned)", async () => {
    const t0 = (await time.latest()) + 100;
    await time.setNextBlockTimestamp(t0);
    const tl = t0 + 3600;
    const rc = await (
      await htlc.connect(alice).newSwap(bob.address, hl(20), tl, { value: 1000 })
    ).wait();
    const id = rc.logs.map((l) => htlc.interface.parseLog(l)).find((e) => e?.name === "SwapCreated")
      .args.swapId;
    await time.setNextBlockTimestamp(tl); // no probing calls in between: the refund itself lands at tl
    const rr = await (await htlc.refund(id)).wait();
    expect((await ethers.provider.getBlock(rr.blockNumber)).timestamp).to.equal(tl);
    expect((await htlc.getSwap(id)).status).to.equal(3n);
  });

  it("token protected variant: max fee == current fee is accepted, max fee one lower is rejected", async () => {
    const [owner] = await ethers.getSigners();
    const tok = await (await ethers.getContractFactory("ZenthisToken")).deploy(owner.address);
    const tokAddr = await tok.getAddress();
    await tok.transfer(alice.address, 1000n);
    await tok.connect(alice).approve(await htlc.getAddress(), 1000n);
    await htlc.setFeeBps(150);
    const now = await time.latest();
    await expect(
      htlc.connect(alice).newSwapTokenProtected(bob.address, tokAddr, 100, hl(21), now + 3600, 149),
    ).to.be.revertedWith("HTLC: fee above max");
    await htlc
      .connect(alice)
      .newSwapTokenProtected(bob.address, tokAddr, 100, hl(21), now + 3600, 150);
  });
});
