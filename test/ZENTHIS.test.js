const { expect }  = require("chai");
const { ethers }  = require("hardhat");

describe("ZENTHIS", function () {
  let zenthis, owner, alice, bob;
  const MAX_SUPPLY = ethers.parseEther("100000000"); // 100M

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("ZENTHIS");
    zenthis = await Factory.deploy(owner.address);
  });

  // ─── Deployment ────────────────────────────────────────────────────────────

  it("1. has correct name", async () => {
    expect(await zenthis.name()).to.equal("Zenthis");
  });

  it("2. has correct symbol", async () => {
    expect(await zenthis.symbol()).to.equal("ZENTHIS");
  });

  it("3. mints MAX_SUPPLY to owner on deployment", async () => {
    expect(await zenthis.balanceOf(owner.address)).to.equal(MAX_SUPPLY);
  });

  it("4. MAX_SUPPLY equals 100 million tokens", async () => {
    expect(await zenthis.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
  });

  it("5. totalBurned starts at zero", async () => {
    expect(await zenthis.totalBurned()).to.equal(0n);
  });

  // ─── Transfers ─────────────────────────────────────────────────────────────

  it("6. transfer moves tokens between accounts", async () => {
    const amount = ethers.parseEther("1000");
    await zenthis.transfer(alice.address, amount);
    expect(await zenthis.balanceOf(alice.address)).to.equal(amount);
  });

  it("7. transferFrom reverts without allowance", async () => {
    await expect(
      zenthis.connect(alice).transferFrom(owner.address, bob.address, 1n)
    ).to.be.reverted;
  });

  it("8. transferFrom moves correct amount after approval", async () => {
    const amount = ethers.parseEther("500");
    await zenthis.approve(alice.address, amount);
    await zenthis.connect(alice).transferFrom(owner.address, bob.address, amount);
    expect(await zenthis.balanceOf(bob.address)).to.equal(amount);
  });

  it("9. transfer reduces sender balance", async () => {
    const amount = ethers.parseEther("1000");
    const before = await zenthis.balanceOf(owner.address);
    await zenthis.transfer(alice.address, amount);
    expect(await zenthis.balanceOf(owner.address)).to.equal(before - amount);
  });

  // ─── Burn ──────────────────────────────────────────────────────────────────

  it("10. burn reduces caller balance", async () => {
    const amount = ethers.parseEther("1000");
    const before = await zenthis.balanceOf(owner.address);
    await zenthis.burn(amount);
    expect(await zenthis.balanceOf(owner.address)).to.equal(before - amount);
  });

  it("11. burn increases totalBurned", async () => {
    const amount = ethers.parseEther("1000");
    await zenthis.burn(amount);
    expect(await zenthis.totalBurned()).to.equal(amount);
  });

  it("12. burn reduces totalSupply", async () => {
    const amount = ethers.parseEther("1000");
    await zenthis.burn(amount);
    expect(await zenthis.totalSupply()).to.equal(MAX_SUPPLY - amount);
  });

  it("13. burn emits TokensBurned event", async () => {
    const amount = ethers.parseEther("1000");
    await expect(zenthis.burn(amount))
      .to.emit(zenthis, "TokensBurned")
      .withArgs(owner.address, amount);
  });

  // ─── BurnFrom ──────────────────────────────────────────────────────────────

  it("14. burnFrom works with sufficient allowance", async () => {
    const amount = ethers.parseEther("500");
    await zenthis.transfer(alice.address, amount);
    await zenthis.connect(alice).approve(bob.address, amount);
    await zenthis.connect(bob).burnFrom(alice.address, amount);
    expect(await zenthis.balanceOf(alice.address)).to.equal(0n);
  });

  it("15. burnFrom reverts without allowance", async () => {
    const amount = ethers.parseEther("500");
    await zenthis.transfer(alice.address, amount);
    await expect(
      zenthis.connect(bob).burnFrom(alice.address, amount)
    ).to.be.reverted;
  });
});
