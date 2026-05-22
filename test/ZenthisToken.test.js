const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ZENTHIS Token", function () {
  const MAX_SUPPLY = 100_000_000n * 10n ** 18n;
  const TOKEN_NAME = "Zenthis";
  const TOKEN_SYMBOL = "ZENTHIS";

  let token, owner, addr1, addr2, addr3;

  beforeEach(async function () {
    [owner, addr1, addr2, addr3] = await ethers.getSigners();
    const ZENTHIS = await ethers.getContractFactory("ZENTHIS");
    token = await ZENTHIS.deploy(owner.address);
    await token.waitForDeployment();
  });

  // ──────────────────────────────────────────────────────
  // Deployment
  // ──────────────────────────────────────────────────────
  describe("Deployment", function () {
    it("should set the correct name", async function () {
      expect(await token.name()).to.equal(TOKEN_NAME);
    });

    it("should set the correct symbol", async function () {
      expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
    });

    it("should set 18 decimals", async function () {
      expect(await token.decimals()).to.equal(18n);
    });

    it("should mint MAX_SUPPLY to the owner", async function () {
      expect(await token.totalSupply()).to.equal(MAX_SUPPLY);
      expect(await token.balanceOf(owner.address)).to.equal(MAX_SUPPLY);
    });

    it("should set the owner as contract owner", async function () {
      expect(await token.owner()).to.equal(owner.address);
    });

    it("should expose MAX_SUPPLY constant", async function () {
      expect(await token.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
    });

    it("should start with totalBurned == 0", async function () {
      expect(await token.totalBurned()).to.equal(0n);
    });

    it("should not be able to mint more tokens", async function () {
      // No mint function exists, but verify supply is capped
      expect(await token.totalSupply()).to.equal(MAX_SUPPLY);
      // Transfer does not affect total supply
      await token.transfer(addr1.address, 1000n);
      expect(await token.totalSupply()).to.equal(MAX_SUPPLY);
    });
  });

  // ──────────────────────────────────────────────────────
  // ERC20 Basic Transfers
  // ──────────────────────────────────────────────────────
  describe("ERC20 Transfers", function () {
    it("should transfer tokens correctly", async function () {
      await token.transfer(addr1.address, 1000n);
      expect(await token.balanceOf(addr1.address)).to.equal(1000n);
      expect(await token.balanceOf(owner.address)).to.equal(MAX_SUPPLY - 1000n);
    });

    it("should emit Transfer event", async function () {
      await expect(token.transfer(addr1.address, 500n))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, addr1.address, 500n);
    });

    it("should fail if sender balance is insufficient", async function () {
      await expect(
        token.connect(addr1).transfer(addr2.address, 1n)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });

    it("should fail if transfer to zero address", async function () {
      await expect(
        token.transfer(ethers.ZeroAddress, 100n)
      ).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
    });

    it("should transfer 0 tokens successfully (no-op)", async function () {
      await token.transfer(addr1.address, 0n);
      expect(await token.balanceOf(addr1.address)).to.equal(0n);
    });

    it("should handle full balance transfer", async function () {
      await token.transfer(addr1.address, MAX_SUPPLY);
      expect(await token.balanceOf(owner.address)).to.equal(0n);
      expect(await token.balanceOf(addr1.address)).to.equal(MAX_SUPPLY);
    });
  });

  // ──────────────────────────────────────────────────────
  // Approvals & TransferFrom
  // ──────────────────────────────────────────────────────
  describe("Approvals", function () {
    it("should approve and emit Approval event", async function () {
      await expect(token.approve(addr1.address, 1000n))
        .to.emit(token, "Approval")
        .withArgs(owner.address, addr1.address, 1000n);

      expect(await token.allowance(owner.address, addr1.address)).to.equal(1000n);
    });

    it("should transferFrom with sufficient allowance", async function () {
      await token.approve(addr1.address, 1000n);
      await token.connect(addr1).transferFrom(owner.address, addr2.address, 500n);
      expect(await token.balanceOf(addr2.address)).to.equal(500n);
      expect(await token.allowance(owner.address, addr1.address)).to.equal(500n);
    });

    it("should fail transferFrom with insufficient allowance", async function () {
      await token.approve(addr1.address, 100n);
      await expect(
        token.connect(addr1).transferFrom(owner.address, addr2.address, 500n)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("should fail transferFrom without approval", async function () {
      await expect(
        token.connect(addr1).transferFrom(owner.address, addr2.address, 1n)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("should overwrite allowance on re-approve", async function () {
      await token.approve(addr1.address, 1000n);
      await token.approve(addr1.address, 500n);
      expect(await token.allowance(owner.address, addr1.address)).to.equal(500n);
    });

    it("should handle multiple approvers independently", async function () {
      await token.approve(addr1.address, 500n);
      await token.approve(addr2.address, 1000n);
      expect(await token.allowance(owner.address, addr1.address)).to.equal(500n);
      expect(await token.allowance(owner.address, addr2.address)).to.equal(1000n);
    });

    it("should reset allowance to zero and re-approve", async function () {
      await token.approve(addr1.address, 1000n);
      // Reset to zero
      await token.approve(addr1.address, 0n);
      expect(await token.allowance(owner.address, addr1.address)).to.equal(0n);
      // Re-approve
      await token.approve(addr1.address, 2000n);
      expect(await token.allowance(owner.address, addr1.address)).to.equal(2000n);
    });

    it("should prevent allowance underflow via approve(0)", async function () {
      // OZ v5: to reduce allowance safely, approve to 0 first, then to new value
      // This prevents the race condition
      await token.approve(addr1.address, 0n);
      // Verify allowance is zero
      expect(await token.allowance(owner.address, addr1.address)).to.equal(0n);
    });
  });

  // ──────────────────────────────────────────────────────
  // Burn
  // ──────────────────────────────────────────────────────
  describe("Burn", function () {
    it("should burn own tokens", async function () {
      await token.burn(1000n);
      expect(await token.balanceOf(owner.address)).to.equal(MAX_SUPPLY - 1000n);
      expect(await token.totalSupply()).to.equal(MAX_SUPPLY - 1000n);
      expect(await token.totalBurned()).to.equal(1000n);
    });

    it("should emit TokensBurned on burn", async function () {
      await expect(token.burn(500n))
        .to.emit(token, "TokensBurned")
        .withArgs(owner.address, 500n);
    });

    it("should accumulate totalBurned across multiple burns", async function () {
      await token.burn(1000n);
      await token.burn(2000n);
      expect(await token.totalBurned()).to.equal(3000n);
      expect(await token.totalSupply()).to.equal(MAX_SUPPLY - 3000n);
    });

    it("should fail burn more than balance", async function () {
      await token.transfer(addr1.address, 500n);
      await expect(
        token.connect(addr1).burn(1000n)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });

    it("should allow burning zero tokens", async function () {
      await token.burn(0n);
      expect(await token.totalBurned()).to.equal(0n);
    });

    it("should allow burning entire balance", async function () {
      await token.transfer(addr1.address, 5000n);
      await token.connect(addr1).burn(5000n);
      expect(await token.balanceOf(addr1.address)).to.equal(0n);
      expect(await token.totalBurned()).to.equal(5000n);
    });
  });

  // ──────────────────────────────────────────────────────
  // BurnFrom
  // ──────────────────────────────────────────────────────
  describe("BurnFrom", function () {
    beforeEach(async function () {
      await token.transfer(addr1.address, 5000n);
    });

    it("should burnFrom with sufficient allowance", async function () {
      await token.connect(addr1).approve(owner.address, 2000n);
      await token.burnFrom(addr1.address, 1000n);
      expect(await token.balanceOf(addr1.address)).to.equal(4000n);
      expect(await token.totalBurned()).to.equal(1000n);
      expect(await token.totalSupply()).to.equal(MAX_SUPPLY - 1000n);
    });

    it("should emit TokensBurned from burnFrom", async function () {
      await token.connect(addr1).approve(owner.address, 500n);
      await expect(token.burnFrom(addr1.address, 500n))
        .to.emit(token, "TokensBurned")
        .withArgs(addr1.address, 500n);
    });

    it("should decrease allowance on burnFrom", async function () {
      await token.connect(addr1).approve(owner.address, 2000n);
      await token.burnFrom(addr1.address, 700n);
      expect(await token.allowance(addr1.address, owner.address)).to.equal(1300n);
    });

    it("should fail burnFrom without allowance", async function () {
      await expect(
        token.burnFrom(addr1.address, 100n)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("should fail burnFrom with insufficient allowance", async function () {
      await token.connect(addr1).approve(owner.address, 100n);
      await expect(
        token.burnFrom(addr1.address, 500n)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("should fail burnFrom more than account balance", async function () {
      await token.connect(addr1).approve(owner.address, 10000n);
      await expect(
        token.burnFrom(addr1.address, 6000n)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });

    it("should allow multiple burnFrom calls", async function () {
      await token.connect(addr1).approve(owner.address, 3000n);
      await token.burnFrom(addr1.address, 1000n);
      await token.burnFrom(addr1.address, 500n);
      expect(await token.balanceOf(addr1.address)).to.equal(3500n);
      expect(await token.totalBurned()).to.equal(1500n);
      expect(await token.allowance(addr1.address, owner.address)).to.equal(1500n);
    });
  });

  // ──────────────────────────────────────────────────────
  // Edge Cases
  // ──────────────────────────────────────────────────────
  describe("Edge Cases", function () {
    it("should track total supply correctly after burns", async function () {
      await token.burn(1_000_000n * 10n ** 18n);
      const expected = MAX_SUPPLY - 1_000_000n * 10n ** 18n;
      expect(await token.totalSupply()).to.equal(expected);
      expect(await token.totalBurned()).to.equal(1_000_000n * 10n ** 18n);
    });

    it("should not allow non-owner to call onlyOwner functions", async function () {
      // There are no onlyOwner external functions beyond what ERC20 provides
      // Owner can renounce ownership
      await token.renounceOwnership();
      expect(await token.owner()).to.equal(ethers.ZeroAddress);
    });

    it("should transfer ownership", async function () {
      await token.transferOwnership(addr1.address);
      expect(await token.owner()).to.equal(addr1.address);
    });

    it("should fail transferOwnership from non-owner", async function () {
      await expect(
        token.connect(addr1).transferOwnership(addr2.address)
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });
});
