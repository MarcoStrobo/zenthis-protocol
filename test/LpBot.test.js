const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, mine } = require("@nomicfoundation/hardhat-network-helpers");
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
      config: {
        confirmations: 0,
        maxOpenPerInitiator: ethers.parseEther("100"),
        largeAmount: ethers.parseEther("1000000"),
        ...cfg,
      },
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

  it("raises alerts: failed B lock and low LP balance on B", async () => {
    const alerts = [];
    await htlcB.connect(deployer).pause();
    bot = mkBot({ minBalanceB: ethers.parseEther("1000000") });
    bot.alert = (m) => alerts.push(m);
    await aliceLocksOnA();
    await bot.tick();
    expect(alerts.some((m) => m.includes("Could not lock on B"))).to.equal(true);
    expect(alerts.some((m) => m.includes("balance on chain B is low"))).to.equal(true);

    const before = alerts.length;
    await bot.tick(); // low-balance alert is throttled by the cooldown
    expect(alerts.length).to.equal(before);
  });

  it("gasless claim: LP redeems on B for the user from a relay message, then redeems on A", async () => {
    let queue = [];
    bot.relay = { claims: async () => queue.splice(0) };
    const idA = await aliceLocksOnA();
    await bot.tick();
    const rec = store.load().swaps[idA];
    expect(rec.status).to.equal("locked");

    // junk and a wrong preimage are ignored
    queue = [
      { hashlock: "0x" + "00".repeat(32), preimage: preimage },
      { hashlock, preimage: ethers.hexlify(ethers.randomBytes(32)) },
    ];
    await bot.tick();
    expect((await htlcB.getSwap(rec.idB)).status).to.equal(1n); // still ACTIVE

    const aliceBefore = await ethers.provider.getBalance(alice.address);
    queue = [{ hashlock, preimage }];
    await bot.tick(); // redeems B for Alice and completes A in the same tick
    expect(await ethers.provider.getBalance(alice.address)).to.equal(
      aliceBefore + BigInt(rec.amountB),
    );
    expect(store.load().swaps[idA].status).to.equal("completed");
    expect((await htlcA.getSwap(idA)).status).to.equal(2n);
  });

  it("caps open exposure per initiator (capital-lock griefing)", async () => {
    bot = mkBot({ maxOpenPerInitiator: ethers.parseEther("1") });
    const first = await aliceLocksOnA({ value: ethers.parseEther("0.6") });
    const second = await aliceLocksOnA({
      value: ethers.parseEther("0.6"),
      hl: ethers.sha256("0x" + "33".repeat(32)),
    });
    await bot.tick();
    expect(store.load().swaps[first].status).to.equal("locked");
    expect(store.load().swaps[second].reason).to.equal("initiator exposure limit reached");
  });

  it("ambiguous RPC after broadcast: reconciles from chain, never double-locks", async () => {
    // The lock tx is broadcast and mined, but the RPC errors while waiting for the receipt.
    const real = htlcB.connect(lp);
    const flaky = new Proxy(real, {
      get(t, p) {
        const v = Reflect.get(t, p, t);
        if (p === "newSwap") {
          return async (...args) => {
            const tx = await t.newSwap(...args);
            return {
              hash: tx.hash,
              wait: async () => {
                throw new Error("could not coalesce error");
              },
            };
          };
        }
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    bot = new LpBot({
      htlcA: htlcA.connect(lp),
      htlcB: flaky,
      lpAddress: lp.address,
      state: store,
      config: {
        confirmations: 0,
        maxOpenPerInitiator: ethers.parseEther("100"),
        largeAmount: ethers.parseEther("1000000"),
      },
      log: () => {},
    });

    const idA = await aliceLocksOnA();
    await bot.tick(); // lock mined, receipt lookup "failed" -> uncertain, then reconciled in the same tick
    expect(store.load().swaps[idA].status).to.equal("locked");

    await bot.tick();
    await bot.tick();
    const created = await htlcB.queryFilter(
      htlcB.filters.SwapCreated(null, lp.address, alice.address),
    );
    expect(created.length).to.equal(1); // exactly one lock on B

    await htlcB.connect(deployer).redeem(store.load().swaps[idA].idB, preimage);
    await bot.tick();
    expect(store.load().swaps[idA].status).to.equal("completed");
  });

  it("LP-03: a large swap is deferred until it has enough confirmations; small ones are not", async () => {
    bot = mkBot({ largeAmount: ethers.parseEther("0.5"), largeConfirmations: 5 });
    const big = await aliceLocksOnA({ value: ethers.parseEther("1") });
    const small = await aliceLocksOnA({
      value: ethers.parseEther("0.1"),
      hl: ethers.sha256("0x" + "44".repeat(32)),
    });
    await bot.tick();
    expect(store.load().swaps[small].status).to.equal("locked"); // not delayed
    expect(store.load().swaps[big]).to.equal(undefined); // deferred, cursor stays before it

    await mine(6);
    await bot.tick();
    expect(store.load().swaps[big].status).to.equal("locked");
    const created = await htlcB.queryFilter(
      htlcB.filters.SwapCreated(null, lp.address, alice.address),
    );
    expect(created.length).to.equal(2); // exactly one lock per swap
  });

  it("LP-05: an ERC-20 swap addressed to the LP is never treated as native ETH", async () => {
    // attacker: worthless token, "amount" 0.5e18 units. Without a token check the LP would lock ~0.5 ETH.
    const junk = await (await ethers.getContractFactory("ZenthisToken")).deploy(deployer.address);
    await junk.transfer(alice.address, ethers.parseEther("1"));
    await junk.connect(alice).approve(await htlcA.getAddress(), ethers.parseEther("1"));
    const now = await time.latest();
    const rc = await (
      await htlcA
        .connect(alice)
        .newSwapToken(
          lp.address,
          await junk.getAddress(),
          ethers.parseEther("0.5"),
          hashlock,
          now + TA,
        )
    ).wait();
    const idA = rc.logs
      .map((l) => htlcA.interface.parseLog(l))
      .find((e) => e?.name === "SwapCreated").args.swapId;
    await bot.tick();
    expect(store.load().swaps[idA].reason).to.equal("not native ETH");
    const onB = await htlcB.queryFilter(htlcB.filters.SwapCreated(null, lp.address, alice.address));
    expect(onB.length).to.equal(0); // nothing locked on B
  });

  it("LP-06: malformed relay messages cannot abort the tick; a valid claim after them still works", async () => {
    let queue = [];
    bot.relay = { claims: async () => queue.splice(0) };
    const idA = await aliceLocksOnA();
    await bot.tick();
    const rec = store.load().swaps[idA];
    queue = [
      null,
      "just a string",
      { hashlock: 5, preimage: 7 },
      { hashlock: rec.hashlock, preimage: "zzz" }, // not hex: sha256() would throw
      { hashlock: rec.hashlock, preimage: "0x" + "g".repeat(64) },
      { hashlock: rec.hashlock, preimage },
    ];
    await bot.tick(); // must not throw
    expect(store.load().swaps[idA].status).to.equal("completed");
  });

  it("LP-07: a failing chain-A scan cannot starve redemptions of swaps that already hold funds", async () => {
    const idA = await aliceLocksOnA();
    await bot.tick();
    const idB = store.load().swaps[idA].idB;
    await htlcB.connect(deployer).redeem(idB, preimage); // user revealed the secret on B
    bot._scanChainA = async () => {
      throw new Error("rpc down");
    };
    let threw = false;
    try {
      await bot.tick();
    } catch (e) {
      threw = e.message.includes("rpc down"); // the failure is still reported...
    }
    expect(threw).to.equal(true);
    expect(store.load().swaps[idA].status).to.equal("completed"); // ...but A was redeemed first
  });
});
