const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { LpBot } = require("../lp-bot/LpBot");

describe("LpBot — atomic swap liquidity provider", () => {
  const AMOUNT = ethers.parseEther("1");
  const TA = 2 * 3600;
  let deployer, alice, lp, htlcA, htlcB, store, bot, preimage, hashlock;

  const memStore = () => {
    let data = { cursorA: 0 };
    return { load: () => data, save: (d) => (data = d) };
  };
  const mkBot = (cfg = {}) =>
    new LpBot({
      htlcA: htlcA.connect(lp),
      htlcB: htlcB.connect(lp),
      lpAddress: lp.address,
      state: store,
      config: { confirmations: 0, ...cfg },
      log: () => {},
    });

  async function aliceLocksOnA({
    value = AMOUNT,
    delta = TA,
    to = lp.address,
    hl = hashlock,
  } = {}) {
    const now = await time.latest();
    const tx = await htlcA.connect(alice).newSwap(to, hl, now + delta, { value });
    const rc = await tx.wait();
    return rc.logs.map((l) => htlcA.interface.parseLog(l)).find((e) => e?.name === "SwapCreated")
      .args.swapId;
  }

  beforeEach(async () => {
    [deployer, alice, lp] = await ethers.getSigners();
    const F = await ethers.getContractFactory("ZenthisHTLC");
    htlcA = await F.deploy();
    htlcB = await F.deploy();
    store = memStore();
    bot = mkBot();
    preimage = ethers.hexlify(ethers.randomBytes(32));
    hashlock = ethers.sha256(preimage);
  });

  it("happy path: lock on B, user redeems, bot redeems on A", async () => {
    const idA = await aliceLocksOnA();
    await bot.tick();

    const rec = store.load().swaps[idA];
    expect(rec.status).to.equal("locked");
    const amountB = (AMOUNT * 9970n) / 10000n; // 0.30 % spread
    expect(BigInt(rec.amountB)).to.equal(amountB);
    expect(rec.timelockA - rec.timelockB).to.equal(3600);

    const aliceBefore = await ethers.provider.getBalance(alice.address);
    await htlcB.connect(deployer).redeem(rec.idB, preimage); // anyone may submit; Alice receives
    expect(await ethers.provider.getBalance(alice.address)).to.equal(aliceBefore + amountB);

    const lpBefore = await ethers.provider.getBalance(lp.address);
    await bot.tick();
    expect(store.load().swaps[idA].status).to.equal("completed");
    expect(await ethers.provider.getBalance(lp.address)).to.be.gt(
      lpBefore + AMOUNT - ethers.parseEther("0.01"),
    );
    expect((await htlcA.getSwap(idA)).status).to.equal(2n);
  });

  it("user abandons: bot refunds its own B lock after TB", async () => {
    const idA = await aliceLocksOnA();
    await bot.tick();
    const rec = store.load().swaps[idA];

    await bot.tick();
    expect(store.load().swaps[idA].status).to.equal("locked"); // still waiting

    await time.increase(3600 + 1);
    const lpBefore = await ethers.provider.getBalance(lp.address);
    await bot.tick();
    expect(store.load().swaps[idA].status).to.equal("refunded");
    expect(await ethers.provider.getBalance(lp.address)).to.be.gt(lpBefore);
    expect((await htlcB.getSwap(rec.idB)).status).to.equal(3n);
  });

  it("rejects: amount above max, expiry too close, reused hashlock", async () => {
    const big = await aliceLocksOnA({ value: ethers.parseEther("2") });
    const near = await aliceLocksOnA({ delta: 3600, hl: ethers.sha256("0x" + "11".repeat(32)) });
    await bot.tick();
    expect(store.load().swaps[big].reason).to.equal("amount above max");
    expect(store.load().swaps[near].reason).to.equal("timelock too close to expiry");

    const ok = await aliceLocksOnA();
    const dup = await aliceLocksOnA(); // same hashlock again
    await bot.tick();
    expect(store.load().swaps[ok].status).to.equal("locked");
    expect(store.load().swaps[dup].reason).to.equal("hashlock reused");
  });

  it("ignores swaps addressed to someone else", async () => {
    const idA = await aliceLocksOnA({ to: deployer.address });
    await bot.tick();
    expect(store.load().swaps[idA]).to.equal(undefined);
  });

  it("respects the open-exposure cap", async () => {
    bot = mkBot({ maxOpenExposure: ethers.parseEther("1") });
    const first = await aliceLocksOnA();
    const second = await aliceLocksOnA({ hl: ethers.sha256("0x" + "22".repeat(32)) });
    await bot.tick();
    expect(store.load().swaps[first].status).to.equal("locked");
    expect(store.load().swaps[second].reason).to.equal("exposure limit reached");
  });

  it("resumes after restart from persisted state without double-locking", async () => {
    const idA = await aliceLocksOnA();
    await bot.tick();
    const idB = store.load().swaps[idA].idB;

    const restarted = mkBot();
    await restarted.tick(); // cursor persisted, swap not re-processed
    expect(store.load().swaps[idA].idB).to.equal(idB);

    await htlcB.connect(deployer).redeem(idB, preimage);
    await restarted.tick();
    expect(store.load().swaps[idA].status).to.equal("completed");
  });

  it("marks failed (user funds stay refundable) if B-side lock reverts", async () => {
    await htlcB.connect(deployer).pause(); // lock on B will revert
    const idA = await aliceLocksOnA();
    await bot.tick();
    expect(store.load().swaps[idA].status).to.equal("failed");

    await time.increase(TA + 1);
    const before = await ethers.provider.getBalance(alice.address);
    await htlcA.connect(deployer).refund(idA); // anyone may trigger; Alice gets funds back
    expect(await ethers.provider.getBalance(alice.address)).to.equal(before + AMOUNT);
  });
});
