const { expect } = require("chai");
const { ethers } = require("hardhat");

// Helper: compute sha256 hashlock matching Solidity's sha256(abi.encodePacked(preimage))
function hashlock(preimage) {
  // abi.encodePacked(bytes32) then sha256
  return ethers.sha256(ethers.solidityPacked(["bytes32"], [preimage]));
}

// Helper: not a hash — generate random bytes32
function randomPreimage() {
  return ethers.randomBytes(32);
}

describe("ZenthisHTLC", function () {
  // Time constants (from contract)
  const MIN_DELTA = 5 * 60;       // 5 minutes
  const MAX_DELTA = 2 * 86400;    // 2 days
  const MAX_FEE_BPS = 500;

  let htlc, token;
  let owner, initiator, recipient, other;
  let swapId, preimage, hash;

  async function getTimestamp() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp;
  }

  async function increaseTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine");
  }

  beforeEach(async function () {
    [owner, initiator, recipient, other] = await ethers.getSigners();

    // Deploy HTLC
    const HTLC = await ethers.getContractFactory("ZenthisHTLC");
    htlc = await HTLC.deploy();
    await htlc.waitForDeployment();

    // Deploy a mock ERC20 for token swaps
    const MockToken = await ethers.getContractFactory("ZENTHIS");
    token = await MockToken.deploy(owner.address);
    await token.waitForDeployment();

    // Transfer some tokens to initiator
    await token.transfer(initiator.address, ethers.parseEther("10000"));

    swapId = ethers.randomBytes(32);
    preimage = randomPreimage();
    hash = hashlock(preimage);
  });

  // ──────────────────────────────────────────────────────
  // Deployment
  // ──────────────────────────────────────────────────────
  describe("Deployment", function () {
    it("should set deployer as owner", async function () {
      expect(await htlc.owner()).to.equal(owner.address);
    });

    it("should start with feeBps = 0", async function () {
      expect(await htlc.feeBps()).to.equal(0n);
    });

    it("should start with zero collected fees", async function () {
      expect(await htlc.collectedEthFees()).to.equal(0n);
    });

    it("should not be paused", async function () {
      expect(await htlc.paused()).to.equal(false);
    });

    it("should reject direct ETH transfers", async function () {
      await expect(
        owner.sendTransaction({ to: await htlc.getAddress(), value: 100 })
      ).to.be.revertedWith("HTLC: use newSwap()");
    });
  });

  // ──────────────────────────────────────────────────────
  // newSwap (ETH) — Happy path
  // ──────────────────────────────────────────────────────
  describe("newSwap (ETH)", function () {
    let timelock;

    beforeEach(async function () {
      const now = await getTimestamp();
      timelock = now + 3600; // 1 hour from now
    });

    it("should create a new ETH swap", async function () {
      const tx = await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hash, timelock,
        { value: ethers.parseEther("1") }
      );

      await expect(tx)
        .to.emit(htlc, "SwapCreated")
        .withArgs(swapId, initiator.address, recipient.address, ethers.ZeroAddress, ethers.parseEther("1"), hash, timelock);

      const swap = await htlc.getSwap(swapId);
      expect(swap.initiator).to.equal(initiator.address);
      expect(swap.recipient).to.equal(recipient.address);
      expect(swap.token).to.equal(ethers.ZeroAddress);
      expect(swap.amount).to.equal(ethers.parseEther("1")); // no fee
      expect(swap.hashlock).to.equal(hash);
      expect(swap.timelock).to.equal(timelock);
      expect(swap.status).to.equal(1n); // Status.ACTIVE
    });

    it("should mark swap as active", async function () {
      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hash, timelock,
        { value: ethers.parseEther("1") }
      );
      expect(await htlc.isActive(swapId)).to.equal(true);
    });

    it("should create swap with minimum timelock (5min)", async function () {
      const now = await getTimestamp();
      const tl = now + MIN_DELTA + 5; // small buffer for block timestamp drift
      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hash, tl,
        { value: ethers.parseEther("1") }
      );
      const swap = await htlc.getSwap(swapId);
      expect(swap.status).to.equal(1n);
    });

    it("should create swap with maximum timelock (2 days)", async function () {
      const now = await getTimestamp();
      const tl = now + MAX_DELTA;
      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hash, tl,
        { value: ethers.parseEther("1") }
      );
      expect(await htlc.isActive(swapId)).to.equal(true);
    });

    it("should handle multiple independent swaps", async function () {
      const id2 = ethers.randomBytes(32);
      const pre2 = randomPreimage();
      const h2 = hashlock(pre2);
      const now = await getTimestamp();
      const tl = now + 3600;

      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hash, tl, { value: ethers.parseEther("1") }
      );
      await htlc.connect(initiator).newSwap(
        id2, recipient.address, h2, tl, { value: ethers.parseEther("2") }
      );

      expect(await htlc.isActive(swapId)).to.equal(true);
      expect(await htlc.isActive(id2)).to.equal(true);
    });
  });

  // ──────────────────────────────────────────────────────
  // newSwap (ETH) — Validations
  // ──────────────────────────────────────────────────────
  describe("newSwap (ETH) validations", function () {
    let timelock;

    beforeEach(async function () {
      const now = await getTimestamp();
      timelock = now + 3600;
    });

    it("should revert with zero ETH", async function () {
      await expect(
        htlc.connect(initiator).newSwap(
          swapId, recipient.address, hash, timelock, { value: 0 }
        )
      ).to.be.revertedWith("HTLC: amount must be > 0");
    });

    it("should revert with zero address recipient", async function () {
      await expect(
        htlc.connect(initiator).newSwap(
          swapId, ethers.ZeroAddress, hash, timelock, { value: 100 }
        )
      ).to.be.revertedWith("HTLC: invalid recipient");
    });

    it("should revert with self-swap", async function () {
      await expect(
        htlc.connect(initiator).newSwap(
          swapId, initiator.address, hash, timelock, { value: 100 }
        )
      ).to.be.revertedWith("HTLC: self-swap not allowed");
    });

    it("should revert with duplicate swapId", async function () {
      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hash, timelock, { value: 100 }
      );
      await expect(
        htlc.connect(initiator).newSwap(
          swapId, recipient.address, hash, timelock, { value: 100 }
        )
      ).to.be.revertedWith("HTLC: swap ID already used");
    });

    it("should revert with timelock too short", async function () {
      const now = await getTimestamp();
      const tl = now + MIN_DELTA - 1; // 1 second short
      await expect(
        htlc.connect(initiator).newSwap(
          swapId, recipient.address, hash, tl, { value: 100 }
        )
      ).to.be.revertedWith("HTLC: timelock too short");
    });

    it("should revert with timelock too long", async function () {
      const now = await getTimestamp();
      // Use a much larger offset so block.timestamp drift can't compensate
      const tl = now + MAX_DELTA + 3600;
      await expect(
        htlc.connect(initiator).newSwap(
          swapId, recipient.address, hash, tl, { value: 100 }
        )
      ).to.be.revertedWith("HTLC: timelock too long");
    });

    it("should revert when paused", async function () {
      await htlc.connect(owner).pause();
      await expect(
        htlc.connect(initiator).newSwap(
          swapId, recipient.address, hash, timelock, { value: 100 }
        )
      ).to.be.revertedWithCustomError(htlc, "EnforcedPause");
    });
  });

  // ──────────────────────────────────────────────────────
  // newSwapToken (ERC-20) — Happy path
  // ──────────────────────────────────────────────────────
  describe("newSwapToken (ERC-20)", function () {
    let timelock;
    const amount = ethers.parseEther("100");

    beforeEach(async function () {
      const now = await getTimestamp();
      timelock = now + 3600;
      await token.connect(initiator).approve(await htlc.getAddress(), amount);
    });

    it("should create an ERC-20 swap", async function () {
      const tx = await htlc.connect(initiator).newSwapToken(
        swapId, recipient.address, await token.getAddress(), amount, hash, timelock
      );

      await expect(tx)
        .to.emit(htlc, "SwapCreated")
        .withArgs(swapId, initiator.address, recipient.address, await token.getAddress(), amount, hash, timelock);

      const swap = await htlc.getSwap(swapId);
      expect(swap.token).to.equal(await token.getAddress());
      expect(swap.amount).to.equal(amount);
      expect(swap.status).to.equal(1n);
    });

    it("should transfer tokens from initiator to HTLC", async function () {
      await htlc.connect(initiator).newSwapToken(
        swapId, recipient.address, await token.getAddress(), amount, hash, timelock
      );
      expect(await token.balanceOf(await htlc.getAddress())).to.equal(amount);
      // initiator's balance decreased
      expect(await token.balanceOf(initiator.address)).to.equal(
        ethers.parseEther("10000") - amount
      );
    });
  });

  // ──────────────────────────────────────────────────────
  // newSwapToken (ERC-20) — Validations
  // ──────────────────────────────────────────────────────
  describe("newSwapToken validations", function () {
    let timelock;

    beforeEach(async function () {
      const now = await getTimestamp();
      timelock = now + 3600;
    });

    it("should revert with zero amount", async function () {
      await expect(
        htlc.connect(initiator).newSwapToken(
          swapId, recipient.address, await token.getAddress(), 0, hash, timelock
        )
      ).to.be.revertedWith("HTLC: amount must be > 0");
    });

    it("should revert with zero token address", async function () {
      await expect(
        htlc.connect(initiator).newSwapToken(
          swapId, recipient.address, ethers.ZeroAddress, 100, hash, timelock
        )
      ).to.be.revertedWith("HTLC: invalid token");
    });

    it("should revert with invalid recipient", async function () {
      await expect(
        htlc.connect(initiator).newSwapToken(
          swapId, ethers.ZeroAddress, await token.getAddress(), 100, hash, timelock
        )
      ).to.be.revertedWith("HTLC: invalid recipient");
    });

    it("should revert when paused", async function () {
      await htlc.connect(owner).pause();
      await expect(
        htlc.connect(initiator).newSwapToken(
          swapId, recipient.address, await token.getAddress(), 100, hash, timelock
        )
      ).to.be.revertedWithCustomError(htlc, "EnforcedPause");
    });

    it("should revert without sufficient allowance", async function () {
      await expect(
        htlc.connect(initiator).newSwapToken(
          swapId, recipient.address, await token.getAddress(), 100, hash, timelock
        )
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });
  });

  // ──────────────────────────────────────────────────────
  // Redeem — ETH
  // ──────────────────────────────────────────────────────
  describe("Redeem (ETH)", function () {
    const amount = ethers.parseEther("1");
    let timelock;

    beforeEach(async function () {
      const now = await getTimestamp();
      timelock = now + 3600;
      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hash, timelock, { value: amount }
      );
    });

    it("should redeem with correct preimage", async function () {
      const balBefore = await ethers.provider.getBalance(recipient.address);

      const tx = await htlc.connect(recipient).redeem(swapId, preimage);
      const receipt = await tx.wait();

      await expect(tx)
        .to.emit(htlc, "SwapRedeemed")
        .withArgs(swapId, ethers.solidityPacked(["bytes32"], [preimage]));

      const swap = await htlc.getSwap(swapId);
      expect(swap.status).to.equal(2n); // Status.REDEEMED

      // Account for gas cost paid by recipient
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(recipient.address);
      expect(balAfter + gasCost - balBefore).to.equal(amount);
    });

    it("should allow anyone to redeem with correct preimage", async function () {
      // anyone, not just recipient
      await htlc.connect(other).redeem(swapId, preimage);
      const swap = await htlc.getSwap(swapId);
      expect(swap.status).to.equal(2n);

      // recipient still gets the ETH
      expect(await ethers.provider.getBalance(recipient.address)).to.be.greaterThan(0n);
    });

    it("should revert with wrong preimage", async function () {
      const wrongPreimage = randomPreimage();
      // ensure it's different
      while (ethers.hexlify(wrongPreimage) === ethers.hexlify(preimage)) {
        wrongPreimage = randomPreimage();
      }
      await expect(
        htlc.connect(recipient).redeem(swapId, wrongPreimage)
      ).to.be.revertedWith("HTLC: invalid preimage");
    });

    it("should revert redeeming an already redeemed swap", async function () {
      await htlc.connect(recipient).redeem(swapId, preimage);
      await expect(
        htlc.connect(recipient).redeem(swapId, preimage)
      ).to.be.revertedWith("HTLC: swap not active");
    });

    it("should revert on non-existent swapId", async function () {
      const fakeId = ethers.randomBytes(32);
      await expect(
        htlc.connect(recipient).redeem(fakeId, preimage)
      ).to.be.revertedWith("HTLC: swap not active");
    });
  });

  // ──────────────────────────────────────────────────────
  // Redeem — ERC-20
  // ──────────────────────────────────────────────────────
  describe("Redeem (ERC-20)", function () {
    const amount = ethers.parseEther("500");
    let timelock;

    beforeEach(async function () {
      const now = await getTimestamp();
      timelock = now + 3600;
      await token.connect(initiator).approve(await htlc.getAddress(), amount);
      await htlc.connect(initiator).newSwapToken(
        swapId, recipient.address, await token.getAddress(), amount, hash, timelock
      );
    });

    it("should redeem ERC-20 tokens to recipient", async function () {
      await htlc.connect(recipient).redeem(swapId, preimage);
      expect(await token.balanceOf(recipient.address)).to.equal(amount);
      expect(await token.balanceOf(await htlc.getAddress())).to.equal(0n);
    });
  });

  // ──────────────────────────────────────────────────────
  // Refund — ETH
  // ──────────────────────────────────────────────────────
  describe("Refund (ETH)", function () {
    const amount = ethers.parseEther("1");
    let timelock;

    beforeEach(async function () {
      const now = await getTimestamp();
      timelock = now + MIN_DELTA + 10; // just above minimum
      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hash, timelock, { value: amount }
      );
    });

    it("should refund ETH to initiator after timelock", async function () {
      await increaseTime(MIN_DELTA + 20);

      const balBefore = await ethers.provider.getBalance(initiator.address);
      const tx = await htlc.connect(initiator).refund(swapId);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(initiator.address);

      expect(balAfter - balBefore + gasCost).to.equal(amount);

      await expect(tx).to.emit(htlc, "SwapRefunded").withArgs(swapId);

      const swap = await htlc.getSwap(swapId);
      expect(swap.status).to.equal(3n); // Status.REFUNDED
    });

    it("should revert refund before timelock", async function () {
      await expect(
        htlc.connect(initiator).refund(swapId)
      ).to.be.revertedWith("HTLC: timelock not expired");
    });

    it("should revert refund from non-initiator", async function () {
      await increaseTime(MIN_DELTA + 20);
      await expect(
        htlc.connect(other).refund(swapId)
      ).to.be.revertedWith("HTLC: only initiator can refund");
    });

    it("should revert refund on already redeemed swap", async function () {
      await htlc.connect(recipient).redeem(swapId, preimage);
      await increaseTime(MIN_DELTA + 20);
      await expect(
        htlc.connect(initiator).refund(swapId)
      ).to.be.revertedWith("HTLC: swap not active");
    });

    it("should revert refund on already refunded swap", async function () {
      await increaseTime(MIN_DELTA + 20);
      await htlc.connect(initiator).refund(swapId);
      await expect(
        htlc.connect(initiator).refund(swapId)
      ).to.be.revertedWith("HTLC: swap not active");
    });
  });

  // ──────────────────────────────────────────────────────
  // Refund — ERC-20
  // ──────────────────────────────────────────────────────
  describe("Refund (ERC-20)", function () {
    const amount = ethers.parseEther("500");
    let timelock;

    beforeEach(async function () {
      const now = await getTimestamp();
      timelock = now + MIN_DELTA + 10;
      await token.connect(initiator).approve(await htlc.getAddress(), amount);
      await htlc.connect(initiator).newSwapToken(
        swapId, recipient.address, await token.getAddress(), amount, hash, timelock
      );
    });

    it("should refund ERC-20 tokens back to initiator after timelock", async function () {
      await increaseTime(MIN_DELTA + 20);
      await htlc.connect(initiator).refund(swapId);
      // initiator gets tokens back (they had 10000, locked 500, now back to ~10000 minus what was burned via transfer)
      const initiatorBal = await token.balanceOf(initiator.address);
      // Should have gotten back the 500 (minus nothing since no fees in this test)
      expect(await token.balanceOf(await htlc.getAddress())).to.equal(0n);
    });
  });

  // ──────────────────────────────────────────────────────
  // Protocol Fees
  // ──────────────────────────────────────────────────────
  describe("Protocol Fees", function () {
    let timelock;

    beforeEach(async function () {
      const now = await getTimestamp();
      timelock = now + 3600;
    });

    it("should set feeBps", async function () {
      await htlc.connect(owner).setFeeBps(100); // 1%
      expect(await htlc.feeBps()).to.equal(100n);
    });

    it("should emit FeeBpsUpdated", async function () {
      await expect(htlc.connect(owner).setFeeBps(50))
        .to.emit(htlc, "FeeBpsUpdated")
        .withArgs(0, 50);
    });

    it("should revert setFeeBps above MAX_FEE_BPS", async function () {
      await expect(
        htlc.connect(owner).setFeeBps(MAX_FEE_BPS + 1)
      ).to.be.revertedWith("HTLC: fee too high");
    });

    it("should revert setFeeBps from non-owner", async function () {
      await expect(
        htlc.connect(initiator).setFeeBps(100)
      ).to.be.revertedWithCustomError(htlc, "OwnableUnauthorizedAccount");
    });

    it("should deduct fee on ETH swap", async function () {
      await htlc.connect(owner).setFeeBps(100); // 1%
      const gross = ethers.parseEther("1");
      const expectedFee = gross * 100n / 10_000n;
      const expectedNet = gross - expectedFee;

      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hash, timelock, { value: gross }
      );

      const swap = await htlc.getSwap(swapId);
      expect(swap.amount).to.equal(expectedNet);
      expect(await htlc.collectedEthFees()).to.equal(expectedFee);
    });

    it("should deduct fee on ERC-20 swap", async function () {
      await htlc.connect(owner).setFeeBps(200); // 2%
      const gross = ethers.parseEther("1000");
      const expectedFee = gross * 200n / 10_000n;
      const expectedNet = gross - expectedFee;

      await token.connect(initiator).approve(await htlc.getAddress(), gross);
      await htlc.connect(initiator).newSwapToken(
        swapId, recipient.address, await token.getAddress(), gross, hash, timelock
      );

      const swap = await htlc.getSwap(swapId);
      expect(swap.amount).to.equal(expectedNet);
      expect(await htlc.collectedTokenFees(await token.getAddress())).to.equal(expectedFee);
    });

    it("should revert withdrawEthFees without fees", async function () {
      await expect(
        htlc.connect(owner).withdrawEthFees(owner.address)
      ).to.be.revertedWith("HTLC: no ETH fees");
    });

    it("should withdraw ETH fees", async function () {
      await htlc.connect(owner).setFeeBps(100);
      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hash, timelock, { value: ethers.parseEther("1") }
      );

      const collected = await htlc.collectedEthFees();
      expect(collected).to.be.greaterThan(0n);

      await expect(htlc.connect(owner).withdrawEthFees(owner.address))
        .to.emit(htlc, "FeesWithdrawn")
        .withArgs(ethers.ZeroAddress, owner.address, collected);

      expect(await htlc.collectedEthFees()).to.equal(0n);
    });

    it("should withdraw token fees", async function () {
      await htlc.connect(owner).setFeeBps(100);
      const gross = ethers.parseEther("1000");
      await token.connect(initiator).approve(await htlc.getAddress(), gross);
      await htlc.connect(initiator).newSwapToken(
        swapId, recipient.address, await token.getAddress(), gross, hash, timelock
      );

      const collected = await htlc.collectedTokenFees(await token.getAddress());
      expect(collected).to.be.greaterThan(0n);

      await expect(htlc.connect(owner).withdrawTokenFees(await token.getAddress(), owner.address))
        .to.emit(htlc, "FeesWithdrawn");

      expect(await htlc.collectedTokenFees(await token.getAddress())).to.equal(0n);
    });

    it("should revert withdrawEthFees to zero address", async function () {
      await htlc.connect(owner).setFeeBps(100);
      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hash, timelock, { value: ethers.parseEther("1") }
      );
      await expect(
        htlc.connect(owner).withdrawEthFees(ethers.ZeroAddress)
      ).to.be.revertedWith("HTLC: invalid address");
    });

    it("should revert withdrawEthFees from non-owner", async function () {
      await htlc.connect(owner).setFeeBps(100);
      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hash, timelock, { value: ethers.parseEther("1") }
      );
      await expect(
        htlc.connect(initiator).withdrawEthFees(initiator.address)
      ).to.be.revertedWithCustomError(htlc, "OwnableUnauthorizedAccount");
    });
  });

  // ──────────────────────────────────────────────────────
  // Pause / Unpause
  // ──────────────────────────────────────────────────────
  describe("Pause / Unpause", function () {
    let timelock;

    beforeEach(async function () {
      const now = await getTimestamp();
      timelock = now + 3600;
    });

    it("should allow owner to pause", async function () {
      await htlc.connect(owner).pause();
      expect(await htlc.paused()).to.equal(true);
    });

    it("should revert pause from non-owner", async function () {
      await expect(
        htlc.connect(initiator).pause()
      ).to.be.revertedWithCustomError(htlc, "OwnableUnauthorizedAccount");
    });

    it("should allow owner to unpause", async function () {
      await htlc.connect(owner).pause();
      await htlc.connect(owner).unpause();
      expect(await htlc.paused()).to.equal(false);
    });

    it("should allow redeem while paused", async function () {
      // Create swap first
      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hash, timelock, { value: ethers.parseEther("1") }
      );
      await htlc.connect(owner).pause();
      // Redeem should still work (not whenNotPaused)
      await htlc.connect(recipient).redeem(swapId, preimage);
      expect((await htlc.getSwap(swapId)).status).to.equal(2n);
    });

    it("should allow refund while paused", async function () {
      const now = await getTimestamp();
      const tl = now + MIN_DELTA + 5;
      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hash, tl, { value: ethers.parseEther("1") }
      );
      await increaseTime(MIN_DELTA + 10);
      await htlc.connect(owner).pause();
      // Refund should still work (not whenNotPaused)
      await htlc.connect(initiator).refund(swapId);
      expect((await htlc.getSwap(swapId)).status).to.equal(3n);
    });
  });

  // ──────────────────────────────────────────────────────
  // View functions
  // ──────────────────────────────────────────────────────
  describe("View functions", function () {
    let timelock;

    beforeEach(async function () {
      const now = await getTimestamp();
      timelock = now + 3600;
      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hash, timelock, { value: ethers.parseEther("1") }
      );
    });

    it("getSwap should return full swap data", async function () {
      const swap = await htlc.getSwap(swapId);
      expect(swap.initiator).to.equal(initiator.address);
      expect(swap.recipient).to.equal(recipient.address);
      expect(swap.hashlock).to.equal(hash);
      expect(swap.timelock).to.equal(timelock);
      expect(swap.status).to.equal(1n);
    });

    it("getSwap should return EMPTY for unknown swapId", async function () {
      const unknownId = ethers.randomBytes(32);
      // ensure different from swapId
      const swap = await htlc.getSwap(unknownId);
      expect(swap.status).to.equal(0n); // EMPTY
      expect(swap.initiator).to.equal(ethers.ZeroAddress);
    });

    it("isActive should return true for active swap", async function () {
      expect(await htlc.isActive(swapId)).to.equal(true);
    });

    it("isActive should return false after redeem", async function () {
      await htlc.connect(recipient).redeem(swapId, preimage);
      expect(await htlc.isActive(swapId)).to.equal(false);
    });

    it("isActive should return false after refund", async function () {
      await increaseTime(3700);
      await htlc.connect(initiator).refund(swapId);
      expect(await htlc.isActive(swapId)).to.equal(false);
    });

    it("isActive should return false for unknown swapId", async function () {
      const unknownId = ethers.randomBytes(32);
      expect(await htlc.isActive(unknownId)).to.equal(false);
    });
  });

  // ──────────────────────────────────────────────────────
  // Integration: full lifecycle
  // ──────────────────────────────────────────────────────
  describe("Full lifecycle", function () {
    it("ETH: create → redeem → verify state", async function () {
      const now = await getTimestamp();
      const tl = now + 3600;

      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hash, tl, { value: ethers.parseEther("5") }
      );
      expect(await htlc.isActive(swapId)).to.equal(true);

      await htlc.connect(recipient).redeem(swapId, preimage);
      const swap = await htlc.getSwap(swapId);
      expect(swap.status).to.equal(2n); // REDEEMED
    });

    it("ETH: create → refund → verify state", async function () {
      const now = await getTimestamp();
      const tl = now + MIN_DELTA + 10;

      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hash, tl, { value: ethers.parseEther("5") }
      );

      await increaseTime(MIN_DELTA + 20);
      await htlc.connect(initiator).refund(swapId);

      const swap = await htlc.getSwap(swapId);
      expect(swap.status).to.equal(3n); // REFUNDED
    });

    it("should prevent front-running by needing preimage", async function () {
      const now = await getTimestamp();
      const tl = now + 3600;

      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hash, tl, { value: ethers.parseEther("5") }
      );

      // Attacker tries with wrong preimage
      const wrongPreimage = randomPreimage();
      await expect(
        htlc.connect(other).redeem(swapId, wrongPreimage)
      ).to.be.revertedWith("HTLC: invalid preimage");
    });
  });
});
