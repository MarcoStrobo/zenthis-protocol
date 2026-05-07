const { expect }        = require("chai");
const { ethers }        = require("hardhat");
const { time }          = require("@nomicfoundation/hardhat-network-helpers");

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePreimage() {
  return ethers.randomBytes(32);
}

function makeHashlock(preimage) {
  return ethers.solidityPackedKeccak256(["bytes32"], [preimage]); // for testing
  // In production the contract uses sha256 — see note below
}

// The contract uses sha256(abi.encodePacked(preimage)).
// In Solidity: sha256(abi.encodePacked(preimage))
// In JS: ethers.sha256(preimage)
function soliditySha256(preimage) {
  return ethers.sha256(preimage); // sha256 of raw bytes
}

function makeHashlockSha256(preimage) {
  return soliditySha256(preimage);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ZenthisHTLC", function () {
  let htlc;
  let owner, initiator, recipient, attacker;
  let swapId, preimage, hashlock, timelock;

  const ONE_ETH = ethers.parseEther("1.0");
  const HALF_ETH = ethers.parseEther("0.5");

  beforeEach(async () => {
    [owner, initiator, recipient, attacker] = await ethers.getSigners();

    const HTLC = await ethers.getContractFactory("ZenthisHTLC");
    htlc = await HTLC.deploy();

    // Fresh swap params for each test
    swapId   = ethers.randomBytes(32);
    preimage = makePreimage();
    hashlock = makeHashlockSha256(preimage);
    timelock = (await time.latest()) + 3600; // 1 hour from now
  });

  // ── Deployment ────────────────────────────────────────────────────────────

  describe("Deployment", () => {
    it("sets the correct owner", async () => {
      expect(await htlc.owner()).to.equal(owner.address);
    });

    it("is not paused by default", async () => {
      expect(await htlc.paused()).to.be.false;
    });

    it("rejects direct ETH sends", async () => {
      await expect(
        initiator.sendTransaction({ to: await htlc.getAddress(), value: ONE_ETH })
      ).to.be.revertedWith("HTLC: use newSwap()");
    });
  });

  // ── newSwap ───────────────────────────────────────────────────────────────

  describe("newSwap (ETH)", () => {
    it("creates a swap and emits SwapCreated", async () => {
      await expect(
        htlc.connect(initiator).newSwap(
          swapId, recipient.address, hashlock, timelock,
          { value: ONE_ETH }
        )
      )
        .to.emit(htlc, "SwapCreated")
        .withArgs(
          swapId,
          initiator.address,
          recipient.address,
          ethers.ZeroAddress,
          ONE_ETH,
          hashlock,
          timelock
        );
    });

    it("stores correct swap data", async () => {
      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hashlock, timelock,
        { value: ONE_ETH }
      );

      const swap = await htlc.getSwap(swapId);
      expect(swap.initiator).to.equal(initiator.address);
      expect(swap.recipient).to.equal(recipient.address);
      expect(swap.amount).to.equal(ONE_ETH);
      expect(swap.hashlock).to.equal(hashlock);
      expect(swap.timelock).to.equal(timelock);
      expect(swap.status).to.equal(1); // ACTIVE
    });

    it("marks swap as active", async () => {
      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hashlock, timelock,
        { value: ONE_ETH }
      );
      expect(await htlc.isActive(swapId)).to.be.true;
    });

    it("locks ETH in the contract", async () => {
      const htlcAddress = await htlc.getAddress();
      await expect(
        htlc.connect(initiator).newSwap(
          swapId, recipient.address, hashlock, timelock,
          { value: ONE_ETH }
        )
      ).to.changeEtherBalance(htlc, ONE_ETH);
    });

    it("reverts on zero value", async () => {
      await expect(
        htlc.connect(initiator).newSwap(
          swapId, recipient.address, hashlock, timelock,
          { value: 0 }
        )
      ).to.be.revertedWith("HTLC: amount must be > 0");
    });

    it("reverts on zero recipient", async () => {
      await expect(
        htlc.connect(initiator).newSwap(
          swapId, ethers.ZeroAddress, hashlock, timelock,
          { value: ONE_ETH }
        )
      ).to.be.revertedWith("HTLC: invalid recipient");
    });

    it("reverts on self-swap", async () => {
      await expect(
        htlc.connect(initiator).newSwap(
          swapId, initiator.address, hashlock, timelock,
          { value: ONE_ETH }
        )
      ).to.be.revertedWith("HTLC: self-swap not allowed");
    });

    it("reverts on duplicate swap ID", async () => {
      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hashlock, timelock,
        { value: HALF_ETH }
      );
      await expect(
        htlc.connect(initiator).newSwap(
          swapId, recipient.address, hashlock, timelock,
          { value: HALF_ETH }
        )
      ).to.be.revertedWith("HTLC: swap ID already used");
    });

    it("reverts when timelock is too short", async () => {
      const shortTimelock = (await time.latest()) + 60; // 1 minute
      await expect(
        htlc.connect(initiator).newSwap(
          swapId, recipient.address, hashlock, shortTimelock,
          { value: ONE_ETH }
        )
      ).to.be.revertedWith("HTLC: timelock too short");
    });

    it("reverts when timelock is too long", async () => {
      const longTimelock = (await time.latest()) + 3 * 24 * 3600; // 3 days
      await expect(
        htlc.connect(initiator).newSwap(
          swapId, recipient.address, hashlock, longTimelock,
          { value: ONE_ETH }
        )
      ).to.be.revertedWith("HTLC: timelock too long");
    });
  });

  // ── redeem ─────────────────────────────────────────────────────────────────

  describe("redeem", () => {
    beforeEach(async () => {
      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hashlock, timelock,
        { value: ONE_ETH }
      );
    });

    it("transfers ETH to recipient and emits SwapRedeemed", async () => {
      await expect(htlc.connect(recipient).redeem(swapId, preimage))
        .to.emit(htlc, "SwapRedeemed")
        .withArgs(swapId, ethers.hexlify(preimage));
    });

    it("sends correct ETH amount to recipient", async () => {
      await expect(
        htlc.connect(recipient).redeem(swapId, preimage)
      ).to.changeEtherBalance(recipient, ONE_ETH);
    });

    it("marks swap as REDEEMED", async () => {
      await htlc.connect(recipient).redeem(swapId, preimage);
      const swap = await htlc.getSwap(swapId);
      expect(swap.status).to.equal(2); // REDEEMED
    });

    it("reverts on wrong preimage", async () => {
      const wrongPreimage = makePreimage();
      await expect(
        htlc.connect(recipient).redeem(swapId, wrongPreimage)
      ).to.be.revertedWith("HTLC: invalid preimage");
    });

    it("reverts on double-redeem", async () => {
      await htlc.connect(recipient).redeem(swapId, preimage);
      await expect(
        htlc.connect(recipient).redeem(swapId, preimage)
      ).to.be.revertedWith("HTLC: swap not active");
    });

    it("allows any address to redeem with correct preimage", async () => {
      // The validator or anyone holding the preimage can trigger settlement
      await expect(
        htlc.connect(attacker).redeem(swapId, preimage)
      ).to.changeEtherBalance(recipient, ONE_ETH);
    });
  });

  // ── refund ─────────────────────────────────────────────────────────────────

  describe("refund", () => {
    beforeEach(async () => {
      await htlc.connect(initiator).newSwap(
        swapId, recipient.address, hashlock, timelock,
        { value: ONE_ETH }
      );
    });

    it("refunds ETH to initiator after timelock and emits SwapRefunded", async () => {
      await time.increaseTo(timelock + 1);
      await expect(htlc.connect(initiator).refund(swapId))
        .to.emit(htlc, "SwapRefunded")
        .withArgs(swapId);
    });

    it("sends correct ETH amount back to initiator", async () => {
      await time.increaseTo(timelock + 1);
      await expect(
        htlc.connect(initiator).refund(swapId)
      ).to.changeEtherBalance(initiator, ONE_ETH);
    });

    it("marks swap as REFUNDED", async () => {
      await time.increaseTo(timelock + 1);
      await htlc.connect(initiator).refund(swapId);
      const swap = await htlc.getSwap(swapId);
      expect(swap.status).to.equal(3); // REFUNDED
    });

    it("reverts before timelock expires", async () => {
      await expect(
        htlc.connect(initiator).refund(swapId)
      ).to.be.revertedWith("HTLC: timelock not expired");
    });

    it("reverts if called by non-initiator", async () => {
      await time.increaseTo(timelock + 1);
      await expect(
        htlc.connect(attacker).refund(swapId)
      ).to.be.revertedWith("HTLC: only initiator can refund");
    });

    it("reverts on double-refund", async () => {
      await time.increaseTo(timelock + 1);
      await htlc.connect(initiator).refund(swapId);
      await expect(
        htlc.connect(initiator).refund(swapId)
      ).to.be.revertedWith("HTLC: swap not active");
    });
  });

  // ── pause ──────────────────────────────────────────────────────────────────

  describe("pause / unpause", () => {
    it("owner can pause and unpause", async () => {
      await htlc.connect(owner).pause();
      expect(await htlc.paused()).to.be.true;

      await htlc.connect(owner).unpause();
      expect(await htlc.paused()).to.be.false;
    });

    it("reverts newSwap when paused", async () => {
      await htlc.connect(owner).pause();
      await expect(
        htlc.connect(initiator).newSwap(
          swapId, recipient.address, hashlock, timelock,
          { value: ONE_ETH }
        )
      ).to.be.revertedWithCustomError(htlc, "EnforcedPause");
    });

    it("non-owner cannot pause", async () => {
      await expect(
        htlc.connect(attacker).pause()
      ).to.be.revertedWithCustomError(htlc, "OwnableUnauthorizedAccount");
    });
  });

  // ── getSwap on unknown ID ──────────────────────────────────────────────────

  describe("edge cases", () => {
    it("returns EMPTY status for unknown swap ID", async () => {
      const unknownId = ethers.randomBytes(32);
      const swap = await htlc.getSwap(unknownId);
      expect(swap.status).to.equal(0); // EMPTY
    });

    it("isActive returns false for unknown swap ID", async () => {
      const unknownId = ethers.randomBytes(32);
      expect(await htlc.isActive(unknownId)).to.be.false;
    });
  });
});
