/**
 * Zenthis Protocol — Local Testnet Full Deployment
 * 
 * Deploys all contracts to the Hardhat local network,
 * creates all 7 vesting schedules, and runs integration checks.
 * 
 * Usage: npx hardhat run scripts/deploy-local.js --network hardhat
 */

const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  // ── Signers ────────────────────────────────────────────
  const [deployer, seed, ido, liquidity, team, treasury, founderOps, airdrops] =
    await ethers.getSigners();

  const deployerAddr = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddr);

  console.log("\n" + "═".repeat(55));
  console.log("  Zenthis Protocol — Local Testnet Full Deployment");
  console.log("═".repeat(55));
  console.log(`  Network  : hardhat (chainId 31337)`);
  console.log(`  Deployer : ${deployerAddr}`);
  console.log(`  Balance  : ${ethers.formatEther(balance)} ETH`);
  console.log("═".repeat(55) + "\n");

  // ── 1. Deploy Token ────────────────────────────────────
  console.log("📦 [1/5] Deploying ZenthisToken...");
  const TokenFactory = await ethers.getContractFactory("ZenthisToken");
  const token = await TokenFactory.deploy(deployerAddr);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log(`   ✓ Token         : ${tokenAddr}`);
  console.log(`   ✓ Supply        : ${ethers.formatEther(await token.totalSupply())} ZENTHIS`);
  console.log(`   ✓ Owner         : ${await token.owner()}\n`);

  // ── 2. Deploy Vesting ──────────────────────────────────
  console.log("📦 [2/5] Deploying ZenthisVesting...");
  const VestingFactory = await ethers.getContractFactory("ZenthisVesting");
  const vesting = await VestingFactory.deploy(tokenAddr, deployerAddr);
  await vesting.waitForDeployment();
  const vestingAddr = await vesting.getAddress();
  console.log(`   ✓ Vesting       : ${vestingAddr}\n`);

  // ── 3. Fund Vesting ────────────────────────────────────
  console.log("📦 [3/5] Funding vesting contract (100M ZENTHIS)...");
  const fundAmount = ethers.parseEther("100000000");
  const txFund = await token.transfer(vestingAddr, fundAmount);
  await txFund.wait();
  console.log(`   ✓ Vesting bal   : ${ethers.formatEther(await token.balanceOf(vestingAddr))} ZENTHIS\n`);

  // ── 4. Deploy HTLC ─────────────────────────────────────
  console.log("📦 [4/5] Deploying ZenthisHTLC...");
  const HTLCFactory = await ethers.getContractFactory("ZenthisHTLC");
  const htlc = await HTLCFactory.deploy();
  await htlc.waitForDeployment();
  const htlcAddr = await htlc.getAddress();
  console.log(`   ✓ HTLC          : ${htlcAddr}\n`);

  // ── 5. Create Vesting Schedules ────────────────────────
  console.log("📦 [5/5] Creating 7 vesting schedules...\n");

  const MONTH = 30 * 24 * 60 * 60; // seconds in 30 days
  const TGE = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

  const schedules = [
    {
      id: ethers.id("SEED"),
      beneficiary: await seed.getAddress(),
      total: ethers.parseEther("10000000"),   // 10M
      tge: 0n,
      cliff: 12,
      vesting: 24,
      label: "SEED",
    },
    {
      id: ethers.id("IDO"),
      beneficiary: await ido.getAddress(),
      total: ethers.parseEther("12000000"),   // 12M
      tge: ethers.parseEther("1200000"),
      cliff: 0,
      vesting: 12,
      label: "IDO",
    },
    {
      id: ethers.id("LIQUIDITY"),
      beneficiary: await liquidity.getAddress(),
      total: ethers.parseEther("20000000"),   // 20M
      tge: ethers.parseEther("10000000"),
      cliff: 0,
      vesting: 6,
      label: "LIQUIDITY",
    },
    {
      id: ethers.id("TEAM"),
      beneficiary: await team.getAddress(),
      total: ethers.parseEther("10000000"),   // 10M
      tge: 0n,
      cliff: 12,
      vesting: 36,
      label: "TEAM",
    },
    {
      id: ethers.id("TREASURY"),
      beneficiary: await treasury.getAddress(),
      total: ethers.parseEther("18200000"),   // 18.2M
      tge: ethers.parseEther("2000000"),
      cliff: 0,
      vesting: 48,
      label: "TREASURY",
    },
    {
      id: ethers.id("FOUNDER_OPS"),
      beneficiary: await founderOps.getAddress(),
      total: ethers.parseEther("8000000"),    // 8M
      tge: 0n,
      cliff: 6,
      vesting: 30,
      label: "FOUNDER_OPS",
    },
    {
      id: ethers.id("AIRDROPS"),
      beneficiary: await airdrops.getAddress(),
      total: 0n,
      tge: ethers.parseEther("5000000"),      // 5M pure TGE
      cliff: 0,
      vesting: 0,
      label: "AIRDROPS",
    },
  ];

  let totalAllocated = 0n;
  for (const s of schedules) {
    const tx = await vesting.createSchedule(
      s.id, s.beneficiary, s.total, s.tge, TGE, s.cliff, s.vesting
    );
    await tx.wait();

    totalAllocated += s.total + s.tge;
    console.log(`   ✓ ${s.label.padEnd(14)} → ${s.beneficiary}`);
    console.log(`     Total: ${ethers.formatEther(s.total + s.tge)} ZENTHIS | Cliff: ${s.cliff}m | Vesting: ${s.vesting}m`);
  }

  const scheduleIds = await vesting.getScheduleIds();
  console.log(`\n   ✓ Schedules created: ${scheduleIds.length}`);
  console.log(`   ✓ Total allocated : ${ethers.formatEther(totalAllocated)} ZENTHIS`);
  console.log(`   ✓ TGE timestamp   : ${TGE} (${new Date(TGE * 1000).toISOString()})`);

  // ── Output ─────────────────────────────────────────────
  console.log("\n" + "═".repeat(55));
  console.log("  Deploy Complete — Contract Addresses");
  console.log("═".repeat(55));
  console.log(`  TOKEN_ADDRESS   = ${tokenAddr}`);
  console.log(`  VESTING_ADDRESS = ${vestingAddr}`);
  console.log(`  HTLC_ADDRESS    = ${htlcAddr}`);
  console.log("═".repeat(55) + "\n");

  // Save to deploy output
  const deployData = {
    network: "hardhat",
    chainId: 31337,
    token: tokenAddr,
    vesting: vestingAddr,
    htlc: htlcAddr,
    tgeTimestamp: TGE,
    schedules: schedules.map(s => ({
      id: s.id,
      beneficiary: s.beneficiary,
      total: s.total.toString(),
      tge: s.tge.toString(),
    })),
    deployedAt: new Date().toISOString(),
  };

  const fs = require("fs");
  const path = require("path");
  const outDir = path.join(__dirname, "..", "deploy_output");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `deploy-${Date.now()}.json`),
    JSON.stringify(deployData, null, 2)
  );
  console.log("📄 Deployment saved to deploy_output/\n");

  return deployData;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Deploy FAILED:", err.message);
    process.exit(1);
  });
