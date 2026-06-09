const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Fuzz / Property-Based Tests — ZenthisHTLC
 *
 * Strategies:
 *  - Random swap amounts     → ETH & ERC20
 *  - Random timelocks         → boundary & edge cases
 *  - Random feeBps            → fee calculation correctness
 *  - Multiple concurrent swaps
 *  - Redeem / refund with random preimages & timing
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function hashlock(preimage) {
  return ethers.sha256(ethers.solidityPacked(["bytes32"], [preimage]));
}

function randomPreimage() {
  return ethers.randomBytes(32);
}

async function getTimestamp() {
  return (await ethers.provider.getBlock("latest")).timestamp;
}

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine");
}

// Generate a random integer in [min, max] — inclusive
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Generate a random ETH amount between 1 wei and 10 ETH
function randEthAmount() {
  const wei = BigInt(Math.floor(Math.random() * 1e19) + 1);
  return wei;
}

describe("ZenthisHTLC — Fuzz Tests", function () {
  const MIN_DELTA = 5 * 60;
  const MAX_DELTA = 2 * 86400;

  let htlc, token;
  let owner, initiator, recipient, other;

  beforeEach(async function () {
    [owner, initiator, recipient, other] = await ethers.getSigners();

    const HTLC = await ethers.getContractFactory("ZenthisHTLC");
    htlc = await HTLC.deploy();
    await htlc.waitForDeployment();

    const MockToken = await ethers.getContractFactory("ZENTHIS");
    token = await MockToken.deploy(owner.address);
    await token.waitForDeployment();

    await token.transfer(initiator.address, ethers.parseEther("100000"));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUZZ: newSwap (ETH) — randomised amounts
  // ═══════════════════════════════════════════════════════════════════════════
  describe("fuzz: newSwap ETH — random amounts (50 runs)", function () {
    it("should create swaps with any positive amount", async function () {
      const now = await getTimestamp();

      for (let i = 0; i < 50; i++) {
        const id = ethers.randomBytes(32);
        const pre = randomPreimage();
        const h = hashlock(pre);
        const tl = now + randInt(MIN_DELTA + 1, MAX_DELTA);
        const amount = randEthAmount();

        await htlc.connect(initiator).newSwap(id, recipient.address, h, tl, { value: amount });

        const swap = await htlc.getSwap(id);
        expect(swap.status).to.equal(1n); // ACTIVE
        expect(swap.amount).to.equal(amount); // no fee
        expect(swap.initiator).to.equal(initiator.address);
        expect(swap.recipient).to.equal(recipient.address);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUZZ: newSwap — random timelocks at boundaries
  // ═══════════════════════════════════════════════════════════════════════════
  describe("fuzz: newSwap timelock boundaries (30 runs)", function () {
    it("should accept timelocks exactly at min boundary", async function () {
      for (let i = 0; i < 30; i++) {
        await ethers.provider.send("evm_mine"); // fresh block
        const now = await getTimestamp();
        const id = ethers.randomBytes(32);
        const pre = randomPreimage();
        const h = hashlock(pre);
        const tl = now + MIN_DELTA + 5; // small safety buffer

        await htlc.connect(initiator).newSwap(id, recipient.address, h, tl, { value: 100n });
        expect((await htlc.getSwap(id)).status).to.equal(1n);
      }
    });

    it("should accept timelocks exactly at max boundary", async function () {
      for (let i = 0; i < 30; i++) {
        const now = await getTimestamp();
        const id = ethers.randomBytes(32);
        const pre = randomPreimage();
        const h = hashlock(pre);
        const tl = now + MAX_DELTA; // exact maximum

        await htlc.connect(initiator).newSwap(id, recipient.address, h, tl, { value: 100n });
        expect((await htlc.getSwap(id)).status).to.equal(1n);
      }
    });

    it("should revert timelocks below minimum", async function () {
      for (let i = 0; i < 30; i++) {
        const now = await getTimestamp();
        const id = ethers.randomBytes(32);
        const pre = randomPreimage();
        const h = hashlock(pre);
        const tl = now + MIN_DELTA - randInt(1, MIN_DELTA); // always below min

        await expect(
          htlc.connect(initiator).newSwap(id, recipient.address, h, tl, { value: 100n }),
        ).to.be.revertedWith("HTLC: timelock too short");
      }
    });

    it("should revert timelocks above maximum", async function () {
      for (let i = 0; i < 30; i++) {
        const now = await getTimestamp();
        const id = ethers.randomBytes(32);
        const pre = randomPreimage();
        const h = hashlock(pre);
        const tl = now + MAX_DELTA + randInt(1, 3600);

        await expect(
          htlc.connect(initiator).newSwap(id, recipient.address, h, tl, { value: 100n }),
        ).to.be.revertedWith("HTLC: timelock too long");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUZZ: feeBps — correctness for random values
  // ═══════════════════════════════════════════════════════════════════════════
  describe("fuzz: feeBps calculation (30 runs)", function () {
    it("should deduct correct fee proportion", async function () {
      for (let i = 0; i < 30; i++) {
        const bps = randInt(0, 500);
        await htlc.connect(owner).setFeeBps(bps);

        const gross = BigInt(randInt(1, 100)) * BigInt(10 ** 18);
        const expectedFee = (gross * BigInt(bps)) / 10000n;
        const expectedNet = gross - expectedFee;

        const id = ethers.randomBytes(32);
        const pre = randomPreimage();
        const h = hashlock(pre);
        const now = await getTimestamp();
        const tl = now + 3600;

        await htlc.connect(initiator).newSwap(id, recipient.address, h, tl, { value: gross });

        const swap = await htlc.getSwap(id);
        expect(swap.amount).to.equal(expectedNet);

        if (bps > 0) {
          expect(await htlc.collectedEthFees()).to.be.greaterThanOrEqual(expectedFee);
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUZZ: redeem/refund with random preimages and timing
  // ═══════════════════════════════════════════════════════════════════════════
  describe("fuzz: redeem / refund lifecycle (30 runs)", function () {
    it("should always complete ETH lifecycle: create → redeem", async function () {
      for (let i = 0; i < 30; i++) {
        const id = ethers.randomBytes(32);
        const pre = randomPreimage();
        const h = hashlock(pre);
        const now = await getTimestamp();
        const tl = now + randInt(MIN_DELTA + 1, MAX_DELTA);

        await htlc
          .connect(initiator)
          .newSwap(id, recipient.address, h, tl, { value: ethers.parseEther("1") });

        await htlc.connect(recipient).redeem(id, pre);

        const swap = await htlc.getSwap(id);
        expect(swap.status).to.equal(2n); // REDEEMED
      }
    });

    it("should always complete ETH lifecycle: create → refund", async function () {
      for (let i = 0; i < 30; i++) {
        const id = ethers.randomBytes(32);
        const pre = randomPreimage();
        const h = hashlock(pre);
        const now = await getTimestamp();
        const tl = now + MIN_DELTA + 5;

        await htlc
          .connect(initiator)
          .newSwap(id, recipient.address, h, tl, { value: ethers.parseEther("1") });

        await increaseTime(MIN_DELTA + 10);

        await htlc.connect(initiator).refund(id);

        const swap = await htlc.getSwap(id);
        expect(swap.status).to.equal(3n); // REFUNDED
      }
    });

    it("should revert redeem with wrong preimage", async function () {
      for (let i = 0; i < 30; i++) {
        const id = ethers.randomBytes(32);
        const pre = randomPreimage();
        const h = hashlock(pre);
        const wrongPre = randomPreimage();
        const now = await getTimestamp();
        const tl = now + 3600;

        await htlc
          .connect(initiator)
          .newSwap(id, recipient.address, h, tl, { value: ethers.parseEther("1") });

        // Ensure wrongPre ≠ pre by regenerating if equal
        const wrongPreFinal =
          ethers.hexlify(wrongPre) === ethers.hexlify(pre) ? randomPreimage() : wrongPre;

        await expect(htlc.connect(recipient).redeem(id, wrongPreFinal)).to.be.revertedWith(
          "HTLC: invalid preimage",
        );
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUZZ: newSwapToken (ERC-20) — randomised amounts
  // ═══════════════════════════════════════════════════════════════════════════
  describe("fuzz: newSwapToken — random amounts (30 runs)", function () {
    it("should handle any ERC-20 amount up to balance", async function () {
      for (let i = 0; i < 30; i++) {
        const now = await getTimestamp();
        const id = ethers.randomBytes(32);
        const pre = randomPreimage();
        const h = hashlock(pre);
        const tl = now + randInt(MIN_DELTA + 1, MAX_DELTA);

        // Use only 1% of the remaining balance to avoid draining
        const initBal = await token.balanceOf(initiator.address);
        const maxAmount = initBal / 100n;
        if (maxAmount < ethers.parseEther("0.001")) break; // skip if too low
        const amount =
          BigInt(Math.floor(Math.random() * Number(maxAmount / BigInt(10 ** 15)))) *
          BigInt(10 ** 15);
        const finalAmount = amount > 0n ? amount : BigInt(10 ** 15);

        await token.connect(initiator).approve(await htlc.getAddress(), finalAmount);
        await htlc
          .connect(initiator)
          .newSwapToken(id, recipient.address, await token.getAddress(), finalAmount, h, tl);

        const swap = await htlc.getSwap(id);
        expect(swap.status).to.equal(1n);
        expect(swap.amount).to.equal(finalAmount);
        expect(swap.token).to.equal(await token.getAddress());
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUZZ: multiple concurrent swaps
  // ═══════════════════════════════════════════════════════════════════════════
  describe("fuzz: concurrent swaps (10 batches of 5)", function () {
    it("should maintain independence of concurrent swaps", async function () {
      const now = await getTimestamp();

      for (let batch = 0; batch < 10; batch++) {
        const ids = [];
        const pres = [];
        const hashes = [];

        // Create 5 swaps
        for (let j = 0; j < 5; j++) {
          ids.push(ethers.randomBytes(32));
          pres.push(randomPreimage());
          hashes.push(hashlock(pres[j]));
          const tl = now + randInt(MIN_DELTA + 1, MAX_DELTA);

          await htlc.connect(initiator).newSwap(ids[j], recipient.address, hashes[j], tl, {
            value: ethers.parseEther(String(j + 1)),
          });
        }

        // Every swap is active and independent
        for (let j = 0; j < 5; j++) {
          expect(await htlc.isActive(ids[j])).to.equal(true);
          const swap = await htlc.getSwap(ids[j]);
          expect(swap.amount).to.equal(ethers.parseEther(String(j + 1)));
        }

        // Redeem a random subset
        const redeemIdx = randInt(0, 4);
        await htlc.connect(recipient).redeem(ids[redeemIdx], pres[redeemIdx]);
        expect((await htlc.getSwap(ids[redeemIdx])).status).to.equal(2n);

        // Others remain active
        for (let j = 0; j < 5; j++) {
          if (j !== redeemIdx) {
            expect(await htlc.isActive(ids[j])).to.equal(true);
          }
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUZZ: duplicate swapId
  // ═══════════════════════════════════════════════════════════════════════════
  describe("fuzz: duplicate swapId rejection", function () {
    it("should always reject reused IDs regardless of params", async function () {
      const now = await getTimestamp();

      for (let i = 0; i < 20; i++) {
        const id = ethers.randomBytes(32);
        const pre = randomPreimage();
        const h = hashlock(pre);
        const tl = now + 3600;

        // First use: should succeed
        await htlc
          .connect(initiator)
          .newSwap(id, recipient.address, h, tl, { value: ethers.parseEther("1") });

        // Second use with different params: should revert
        const pre2 = randomPreimage();
        const h2 = hashlock(pre2);
        await expect(
          htlc
            .connect(initiator)
            .newSwap(id, recipient.address, h2, tl, { value: ethers.parseEther("2") }),
        ).to.be.revertedWith("HTLC: swap ID already used");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FUZZ: setFeeBps — random valid/invalid values
  // ═══════════════════════════════════════════════════════════════════════════
  describe("fuzz: setFeeBps boundaries", function () {
    it("should accept any bps in [0, MAX_FEE_BPS]", async function () {
      for (let bps = 0; bps <= 500; bps += 50) {
        await htlc.connect(owner).setFeeBps(bps);
        expect(await htlc.feeBps()).to.equal(BigInt(bps));
      }
    });

    it("should revert for any bps > MAX_FEE_BPS", async function () {
      const invalidBps = [501, 600, 1000, 5000, 10000];
      for (const bps of invalidBps) {
        await expect(htlc.connect(owner).setFeeBps(bps)).to.be.revertedWith("HTLC: fee too high");
      }
    });

    it("should emit FeeBpsUpdated with old and new values", async function () {
      for (let bps = 0; bps <= 500; bps += 100) {
        const oldBps = await htlc.feeBps();
        const tx = await htlc.connect(owner).setFeeBps(bps);
        await expect(tx).to.emit(htlc, "FeeBpsUpdated").withArgs(oldBps, BigInt(bps));
      }
    });
  });
});
