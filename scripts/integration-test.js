/**
 * Zenthis Protocol — Integration Tests (against deployed contracts)
 *
 * Usage: npx hardhat run scripts/integration-test.js --network hardhat
 */

const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  // Load latest deployment output
  const fs = require("fs");
  const path = require("path");
  const outDir = path.join(__dirname, "..", "deploy_output");
  const files = fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith("deploy-"))
    .sort();
  const latestFile = path.join(outDir, files[files.length - 1]);
  const deployData = JSON.parse(fs.readFileSync(latestFile, "utf8"));
  console.log(`   Using: ${files[files.length - 1]}\n`);
  const [deployer, seed, ido, liquidity, team, treasury, founderOps, airdrops] =
    await ethers.getSigners();

  const token = await ethers.getContractAt("ZenthisToken", deployData.token);
  const vesting = await ethers.getContractAt("ZenthisVesting", deployData.vesting);
  const htlc = await ethers.getContractAt("ZenthisHTLC", deployData.htlc);

  // Helper: sha256 hashlock matching Solidity's sha256(abi.encodePacked(preimage))
  function hashlock(preimage) {
    return ethers.sha256(ethers.solidityPacked(["bytes32"], [preimage]));
  }
  function randomPreimage() {
    return ethers.randomBytes(32);
  }

  let passed = 0;
  let failed = 0;

  function check(name, condition) {
    if (condition) {
      console.log(`   ✅ ${name}`);
      passed++;
    } else {
      console.log(`   ❌ ${name}`);
      failed++;
    }
  }

  console.log("\n" + "═".repeat(55));
  console.log("  🔬 Integration Tests (against deployed contracts)");
  console.log("═".repeat(55) + "\n");

  // ── Token ───────────────────────────────────────────────
  console.log("📋 Token Tests");
  check("Total supply = 100M", (await token.totalSupply()) === ethers.parseEther("100000000"));
  check("Owner is deployer", (await token.owner()) === (await deployer.getAddress()));

  // Transfer
  await token.transfer(await team.getAddress(), ethers.parseEther("1000"));
  check(
    "Transfer 1000 ZENTHIS",
    (await token.balanceOf(await team.getAddress())) === ethers.parseEther("1000"),
  );

  // Burn
  const supplyBefore = await token.totalSupply();
  await token.burn(ethers.parseEther("500"));
  const supplyAfter = await token.totalSupply();
  check("Burn reduces totalSupply", supplyAfter === supplyBefore - ethers.parseEther("500"));

  // ── HTLC ─────────────────────────────────────────────────
  console.log("\n📋 HTLC Tests");
  check("Owner is deployer", (await htlc.owner()) === (await deployer.getAddress()));
  check("Fee is 0 bps", (await htlc.feeBps()) === 0n);

  // Set fee
  await htlc.setFeeBps(100);
  check("Set fee to 1%", (await htlc.feeBps()) === 100n);

  // Create ETH swap
  const preimage = randomPreimage();
  const hash = hashlock(preimage);
  const swapId = ethers.randomBytes(32);
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const timelock = now + 600; // 10 min

  await htlc.newSwap(swapId, await team.getAddress(), hash, timelock, {
    value: ethers.parseEther("1"),
  });
  check("HTLC swap active", await htlc.isActive(swapId));

  // Redeem
  await htlc.connect(team).redeem(swapId, preimage);
  check("HTLC swap redeemed", (await htlc.getSwap(swapId)).status === 2n);

  // Refund test
  const swapId2 = ethers.randomBytes(32);
  const tl2 = now + 310; // 5min10s
  await htlc.newSwap(swapId2, await deployer.getAddress(), hashlock(randomPreimage()), tl2, {
    value: ethers.parseEther("0.1"),
  });
  // Advance past timelock
  await ethers.provider.send("evm_increaseTime", [320]);
  await ethers.provider.send("evm_mine");
  await htlc.refund(swapId2);
  check("HTLC refund works", (await htlc.getSwap(swapId2)).status === 3n);

  // Withdraw fees
  await htlc.withdrawEthFees(await deployer.getAddress());
  check("Fee withdrawal", (await htlc.collectedEthFees()) === 0n);

  // ── Vesting ──────────────────────────────────────────────
  console.log("\n📋 Vesting Tests");
  const ids = await vesting.getScheduleIds();
  check("7 schedules created", ids.length === 7);

  // IDO schedule: total 12M, tge 1.2M, 12-month vesting
  const IDO = ethers.id("IDO");
  const idoSchedule = await vesting.getSchedule(IDO);
  check("IDO tge = 1.2M", idoSchedule.tgeAmount === ethers.parseEther("1200000"));
  check("IDO cliff = 0", idoSchedule.cliffDuration === 0n);

  // Jump to TGE time
  const tgeTime = deployData.tgeTimestamp;
  await ethers.provider.send("evm_setNextBlockTimestamp", [tgeTime + 1]);
  await ethers.provider.send("evm_mine");

  // IDO beneficiary should be able to claim TGE
  const idoReleasable = await vesting.releasableAmount(IDO);
  check("IDO TGE releasable > 0", idoReleasable >= ethers.parseEther("1200000"));

  if (idoReleasable > 0n) {
    await vesting.connect(ido).release(IDO);
    check("IDO released tokens", (await token.balanceOf(await ido.getAddress())) > 0n);
  }

  // AIRDROPS: pure TGE (5M)
  const AIRDROPS = ethers.id("AIRDROPS");
  const airdropReleasable = await vesting.releasableAmount(AIRDROPS);
  check("Airdrops fully releasable", airdropReleasable === ethers.parseEther("5000000"));

  // ── Summary ──────────────────────────────────────────────
  console.log("\n" + "═".repeat(55));
  console.log(`  Results: ${passed} ✅ / ${failed} ❌ (${passed + failed} total)`);
  console.log("═".repeat(55) + "\n");

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
