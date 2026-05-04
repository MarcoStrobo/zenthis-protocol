const { expect }  = require("chai");
const { ethers }  = require("hardhat");
const { time }    = require("@nomicfoundation/hardhat-network-helpers");

describe("HTLCVault", function () {
  let vault, token, owner, alice, bob, feeAcc;

  // Helpers
  const MIN_TIMELOCK = 600;              // 10 minutes in seconds
  const MAX_TIMELOCK = 48 * 3600;       // 48 hours
  const AMOUNT       = ethers.parseEther("1000");
  const FEE_BPS      = 10n;
  const BPS_DENOM    = 10_000n;

  function makeSwapId() {
    return ethers.randomBytes(32);
  }

  function makeHashlock() {
    const preimage = ethers.randomBytes(32);
    const hashlock = ethers.sha256(preimage);
    return { preimage, hashlock };
  }

  beforeEach(async () => {
    [owner, alice, bob, feeAcc] = await ethers.getSigners();

    // Deploy mock ERC-20 (ZENTHIS) — owner gets full supply
    const TokenFactory = await ethers.getContractFactory("ZENTHIS");
    token = await TokenFactory.deploy(owner.address);

    // Deploy vault with feeAcc as fee recipient
    const VaultFactory = await ethers.getContractFactory("HTLCVault");
    vault = await VaultFactory.deploy(feeAcc.address);

    // Fund alice with tokens and approve vault
    await token.transfer(alice.address, ethers.parseEther("10000"));
    await token.connect(alice).approve(vault.target, ethers.MaxUint256);
  });

  // ─── Deployment ────────────────────────────────────────────────────────────

  it("16. stores correct feeRecipient", async () => {
    expect(await vault.feeRecipient()).to.equal(feeAcc.address);
  });

  it("17. reverts constructor with zero feeRecipient", async () => {
    const Factory = await ethers.getContractFactory("HTLCVault");
    await expect(Factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      vault, "ZeroAddress"
    );
  });

  it("18. FEE_BPS is 10", async () => {
    expect(await vault.FEE_BPS()).to.equal(10n);
  });

  // ─── initSwap ──────────────────────────────────────────────────────────────

  it("19. initSwap creates swap with correct parameters", async () => {
    const swapId = makeSwapId();
    const { preimage, hashlock } = makeHashlock();
    await vault.connect(alice).initSwap(swapId, bob.address, token.target, AMOUNT, hashlock, MIN_TIMELOCK);
    const swap = await vault.getSwap(swapId);
    expect(swap.initiator).to.equal(alice.address);
    expect(swap.recipient).to.equal(bob.address);
    expect(swap.amount).to.equal(AMOUNT);
    expect(swap.hashlock).to.equal(hashlock);
    expect(swap.state).to.equal(0); // PENDING
  });

  it("20. initSwap transfers tokens from initiator to vault", async () => {
    const swapId = makeSwapId();
    const { hashlock } = makeHashlock();
    const before = await token.balanceOf(alice.address);
    await vault.connect(alice).initSwap(swapId, bob.address, token.target, AMOUNT, hashlock, MIN_TIMELOCK);
    expect(await token.balanceOf(alice.address)).to.equal(before - AMOUNT);
    expect(await token.balanceOf(vault.target)).to.equal(AMOUNT);
  });

  it("21. initSwap emits SwapInitiated event", async () => {
    const swapId = makeSwapId();
    const { hashlock } = makeHashlock();
    await expect(
      vault.connect(alice).initSwap(swapId, bob.address, token.target, AMOUNT, hashlock, MIN_TIMELOCK)
    ).to.emit(vault, "SwapInitiated");
  });

  it("22. initSwap reverts if swap ID already exists", async () => {
    const swapId = makeSwapId();
    const { hashlock } = makeHashlock();
    await vault.connect(alice).initSwap(swapId, bob.address, token.target, AMOUNT, hashlock, MIN_TIMELOCK);
    await expect(
      vault.connect(alice).initSwap(swapId, bob.address, token.target, AMOUNT, hashlock, MIN_TIMELOCK)
    ).to.be.revertedWithCustomError(vault, "SwapAlreadyExists");
  });

  it("23. initSwap reverts with zero recipient", async () => {
    const swapId = makeSwapId();
    const { hashlock } = makeHashlock();
    await expect(
      vault.connect(alice).initSwap(swapId, ethers.ZeroAddress, token.target, AMOUNT, hashlock, MIN_TIMELOCK)
    ).to.be.revertedWithCustomError(vault, "ZeroAddress");
  });

  it("24. initSwap reverts with zero token address", async () => {
    const swapId = makeSwapId();
    const { hashlock } = makeHashlock();
    await expect(
      vault.connect(alice).initSwap(swapId, bob.address, ethers.ZeroAddress, AMOUNT, hashlock, MIN_TIMELOCK)
    ).to.be.revertedWithCustomError(vault, "ZeroAddress");
  });

  it("25. initSwap reverts with zero amount", async () => {
    const swapId = makeSwapId();
    const { hashlock } = makeHashlock();
    await expect(
      vault.connect(alice).initSwap(swapId, bob.address, token.target, 0, hashlock, MIN_TIMELOCK)
    ).to.be.revertedWithCustomError(vault, "InvalidAmount");
  });

  it("26. initSwap reverts with zero hashlock", async () => {
    const swapId = makeSwapId();
    await expect(
      vault.connect(alice).initSwap(swapId, bob.address, token.target, AMOUNT, ethers.ZeroHash, MIN_TIMELOCK)
    ).to.be.revertedWithCustomError(vault, "InvalidHashlock");
  });

  it("27. initSwap reverts if timelock duration too short", async () => {
    const swapId = makeSwapId();
    const { hashlock } = makeHashlock();
    await expect(
      vault.connect(alice).initSwap(swapId, bob.address, token.target, AMOUNT, hashlock, MIN_TIMELOCK - 1)
    ).to.be.revertedWithCustomError(vault, "InvalidTimelock");
  });

  it("28. initSwap reverts if timelock duration too long", async () => {
    const swapId = makeSwapId();
    const { hashlock } = makeHashlock();
    await expect(
      vault.connect(alice).initSwap(swapId, bob.address, token.target, AMOUNT, hashlock, MAX_TIMELOCK + 1)
    ).to.be.revertedWithCustomError(vault, "InvalidTimelock");
  });

  // ─── claim ─────────────────────────────────────────────────────────────────

  async function setupSwap() {
    const swapId = makeSwapId();
    const { preimage, hashlock } = makeHashlock();
    await vault.connect(alice).initSwap(swapId, bob.address, token.target, AMOUNT, hashlock, MIN_TIMELOCK);
    return { swapId, preimage, hashlock };
  }

  it("29. claim transfers amountOut to recipient", async () => {
    const { swapId, preimage } = await setupSwap();
    const fee       = (AMOUNT * FEE_BPS) / BPS_DENOM;
    const amountOut = AMOUNT - fee;
    const before    = await token.balanceOf(bob.address);
    await vault.claim(swapId, preimage);
    expect(await token.balanceOf(bob.address)).to.equal(before + amountOut);
  });

  it("30. claim transfers fee to feeRecipient", async () => {
    const { swapId, preimage } = await setupSwap();
    const fee    = (AMOUNT * FEE_BPS) / BPS_DENOM;
    const before = await token.balanceOf(feeAcc.address);
    await vault.claim(swapId, preimage);
    expect(await token.balanceOf(feeAcc.address)).to.equal(before + fee);
  });

  it("31. claim updates totalFeeCollected correctly", async () => {
    const { swapId, preimage } = await setupSwap();
    const fee = (AMOUNT * FEE_BPS) / BPS_DENOM;
    await vault.claim(swapId, preimage);
    expect(await vault.totalFeeCollected()).to.equal(fee);
  });

  it("32. claim sets swap state to CLAIMED", async () => {
    const { swapId, preimage } = await setupSwap();
    await vault.claim(swapId, preimage);
    const swap = await vault.getSwap(swapId);
    expect(swap.state).to.equal(1); // CLAIMED
  });

  it("33. claim emits SwapClaimed event", async () => {
    const { swapId, preimage } = await setupSwap();
    await expect(vault.claim(swapId, preimage))
      .to.emit(vault, "SwapClaimed");
  });

  it("34. fee is exactly 0.10% of swap amount", async () => {
    const { swapId, preimage } = await setupSwap();
    const fee = (AMOUNT * FEE_BPS) / BPS_DENOM;
    // 0.10% of 1000 tokens = 1 token
    expect(fee).to.equal(ethers.parseEther("1"));
    await vault.claim(swapId, preimage);
    expect(await vault.totalFeeCollected()).to.equal(fee);
  });

  it("35. claim reverts with wrong preimage", async () => {
    const { swapId } = await setupSwap();
    const wrongPreimage = ethers.randomBytes(32);
    await expect(vault.claim(swapId, wrongPreimage))
      .to.be.revertedWithCustomError(vault, "WrongPreimage");
  });

  it("36. claim reverts if timelock has expired", async () => {
    const { swapId, preimage } = await setupSwap();
    await time.increase(MIN_TIMELOCK + 1);
    await expect(vault.claim(swapId, preimage))
      .to.be.revertedWithCustomError(vault, "TimelockExpired");
  });

  it("37. claim reverts if swap already claimed", async () => {
    const { swapId, preimage } = await setupSwap();
    await vault.claim(swapId, preimage);
    await expect(vault.claim(swapId, preimage))
      .to.be.revertedWithCustomError(vault, "SwapNotPending");
  });

  it("38. claim reverts if swap not found", async () => {
    const unknownId = ethers.randomBytes(32);
    await expect(vault.claim(unknownId, ethers.randomBytes(32)))
      .to.be.revertedWithCustomError(vault, "SwapNotFound");
  });

  // ─── refund ────────────────────────────────────────────────────────────────

  it("39. refund returns full amount to initiator", async () => {
    const { swapId } = await setupSwap();
    const before = await token.balanceOf(alice.address);
    await time.increase(MIN_TIMELOCK + 1);
    await vault.connect(alice).refund(swapId);
    expect(await token.balanceOf(alice.address)).to.equal(before + AMOUNT);
  });

  it("40. refund sets swap state to REFUNDED", async () => {
    const { swapId } = await setupSwap();
    await time.increase(MIN_TIMELOCK + 1);
    await vault.connect(alice).refund(swapId);
    const swap = await vault.getSwap(swapId);
    expect(swap.state).to.equal(2); // REFUNDED
  });

  it("41. refund emits SwapRefunded event", async () => {
    const { swapId } = await setupSwap();
    await time.increase(MIN_TIMELOCK + 1);
    await expect(vault.connect(alice).refund(swapId))
      .to.emit(vault, "SwapRefunded");
  });

  it("42. refund reverts before timelock expires", async () => {
    const { swapId } = await setupSwap();
    await expect(vault.connect(alice).refund(swapId))
      .to.be.revertedWithCustomError(vault, "TimelockNotExpired");
  });

  it("43. refund reverts if called by non-initiator", async () => {
    const { swapId } = await setupSwap();
    await time.increase(MIN_TIMELOCK + 1);
    await expect(vault.connect(bob).refund(swapId))
      .to.be.revertedWithCustomError(vault, "NotInitiator");
  });

  it("44. refund reverts if swap already refunded", async () => {
    const { swapId } = await setupSwap();
    await time.increase(MIN_TIMELOCK + 1);
    await vault.connect(alice).refund(swapId);
    await expect(vault.connect(alice).refund(swapId))
      .to.be.revertedWithCustomError(vault, "SwapNotPending");
  });

  it("45. refund reverts if swap already claimed", async () => {
    const { swapId, preimage } = await setupSwap();
    await vault.claim(swapId, preimage);
    await time.increase(MIN_TIMELOCK + 1);
    await expect(vault.connect(alice).refund(swapId))
      .to.be.revertedWithCustomError(vault, "SwapNotPending");
  });

  it("46. refund reverts if swap not found", async () => {
    const unknownId = ethers.randomBytes(32);
    await expect(vault.connect(alice).refund(unknownId))
      .to.be.revertedWithCustomError(vault, "SwapNotFound");
  });

  // ─── View functions ────────────────────────────────────────────────────────

  it("47. isClaimable returns true for a valid pending swap", async () => {
    const { swapId, preimage } = await setupSwap();
    expect(await vault.isClaimable(swapId, preimage)).to.equal(true);
  });

  it("48. isRefundable returns true after timelock expires", async () => {
    const { swapId } = await setupSwap();
    expect(await vault.isRefundable(swapId)).to.equal(false);
    await time.increase(MIN_TIMELOCK + 1);
    expect(await vault.isRefundable(swapId)).to.equal(true);
  });
});
