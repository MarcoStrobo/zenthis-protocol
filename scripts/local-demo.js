const { ethers } = require("hardhat");

async function main() {
  const [owner] = await ethers.getSigners();
  console.log("\n═══════════════════════════════════════════");
  console.log("  LOCAL DEPLOY — Zenthis Full Stack");
  console.log("═══════════════════════════════════════════");
  console.log("Deployer:", owner.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(owner.address)), "ETH\n");

  // ── 1. Deploy Token ───────────────────────────────
  console.log("📦 Deploying ZenthisToken...");
  const Token = await ethers.getContractFactory("ZenthisToken");
  const token = await Token.deploy(owner.address);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("   ✓ Token:", tokenAddr);

  // ── 2. Deploy Presale ─────────────────────────────
  console.log("📦 Deploying ZenthisPresale...");
  const rate = ethers.parseEther("30000");
  const softCap = ethers.parseEther("66.67");
  const hardCap = ethers.parseEther("666.67");
  const minBuy = ethers.parseEther("0.01");
  const maxBuy = ethers.parseEther("3");
  const liqPct = 6000n;
  const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
  const start = now + 300n;
  const end = start + 604800n;
  const bonusPool = ethers.parseEther("1500000");
  const flatAirdrop = ethers.parseEther("2000");

  const Presale = await ethers.getContractFactory("ZenthisPresale");
  const presale = await Presale.deploy(
    tokenAddr, rate, softCap, hardCap, minBuy, maxBuy, liqPct,
    start, end, owner.address, owner.address,
    bonusPool, flatAirdrop,
    ethers.parseEther("0.1"), ethers.parseEther("500"),
    ethers.parseEther("0.333"), ethers.parseEther("1000"),
    ethers.parseEther("0.667"), ethers.parseEther("1500"),
    ethers.parseEther("1"), ethers.parseEther("2000"),
    ethers.parseEther("0.1")
  );
  await presale.waitForDeployment();
  const presaleAddr = await presale.getAddress();
  console.log("   ✓ Presale:", presaleAddr);

  // ── 3. Fund presale ───────────────────────────────
  console.log("💰 Funding presale...");
  const required = await presale.getRequiredZts();
  console.log("   Required ZTS:", ethers.formatEther(required));
  await (await token.transfer(presaleAddr, required)).wait();
  await presale.depositTokens();
  const bal = await token.balanceOf(presaleAddr);
  console.log("   ✓ Funded! Presale balance:", ethers.formatEther(bal), "ZTS");

  // ── 4. Simulate a contribution ────────────────────
  console.log("👤 Simulating contribution...");
  const [_, user] = await ethers.getSigners();
  
  // Advance time past start
  await ethers.provider.send("evm_setNextBlockTimestamp", [Number(start) + 1]);
  await ethers.provider.send("evm_mine", []);
  
  await presale.connect(user).contribute(ethers.ZeroAddress, { value: ethers.parseEther("1.5") });
  console.log("   ✓ User contributed 1.5 ETH");
  
  const contrib = await presale.contribution(user.address);
  console.log("   Contribution:", ethers.formatEther(contrib), "ETH");
  console.log("   Total raised:", ethers.formatEther(await presale.totalRaised()), "ETH");
  
  // ── 5. Check bonuses ──────────────────────────────
  console.log("🎁 Bonus info:");
  console.log("   Flat airdrop:", ethers.formatEther(await presale.getFlatBonus(user.address)), "ZTS");
  console.log("   Tier bonus:", ethers.formatEther(await presale.getTierBonus(user.address)), "ZTS");
  console.log("   Claimable:", ethers.formatEther(await presale.getClaimableAmount(user.address)), "ZTS");

  // ── 6. Fast forward to end, finalize ──────────────
  console.log("⏩ Fast-forwarding to end...");
  await ethers.provider.send("evm_setNextBlockTimestamp", [Number(end) + 1]);
  await ethers.provider.send("evm_mine", []);
  
  console.log("🔐 Requesting finalize...");
  await presale.requestFinalize();
  const readyAt = await presale.finalizeReadyAt();
  console.log("   Finalize ready at:", new Date(Number(readyAt) * 1000).toISOString());
  
  console.log("⏩ Fast-forwarding past timelock...");
  await ethers.provider.send("evm_setNextBlockTimestamp", [Number(readyAt) + 1]);
  await ethers.provider.send("evm_mine", []);
  
  console.log("✅ Finalizing...");
  await presale.finalize();
  console.log("   ✓ Presale finalized!");
  
  // ── 7. Claim ──────────────────────────────────────
  console.log("🏆 User claims ZTS...");
  const beforeBal = await token.balanceOf(user.address);
  await presale.connect(user).claim();
  const afterBal = await token.balanceOf(user.address);
  console.log("   ✓ Claimed:", ethers.formatEther(afterBal - beforeBal), "ZTS");

  console.log("\n═══════════════════════════════════════════");
  console.log("  ✅ LOCAL DEPLOY + FULL FLOW: SUCCESS");
  console.log("═══════════════════════════════════════════\n");
}

main().catch(console.error);
