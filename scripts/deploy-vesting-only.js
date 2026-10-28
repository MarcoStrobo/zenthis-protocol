/**
 * deploy-vesting-only.js — Deploy ZenthisVesting + ZenthisHTLC to Base mainnet
 *
 * For use after Token and Presale are already deployed.
 * Transfers ZTS from deployer to vesting, creates 7 schedules.
 *
 * Usage: npx hardhat run scripts/deploy-vesting-only.js --network base
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

// ── Constants ────────────────────────────────────────────────────────────────
const TOKEN_ADDR = "0xCFAeB3678DbC479e26Fd87C2cA7eD0a264f1F6a6";

const MILLION = (n) => ethers.parseEther((n * 1_000_000).toString());

const SCHEDULES = [
  { key: "SEED",         total: MILLION(10),   tge: 0n,             cliff: 6,  vest: 24 },
  { key: "IDO",          total: MILLION(22.5), tge: MILLION(2.5),  cliff: 0,  vest: 18 },
  { key: "LIQUIDITY",    total: MILLION(21.5), tge: MILLION(3.5),  cliff: 0,  vest: 48 },
  { key: "TEAM",         total: MILLION(10),   tge: 0n,             cliff: 12, vest: 36 },
  { key: "TREASURY",     total: MILLION(16.2), tge: MILLION(2),    cliff: 0,  vest: 48 },
  { key: "FOUNDER_OPS",  total: MILLION(1.8),  tge: 0n,             cliff: 0,  vest: 36 },
  { key: "AIRDROPS",     total: MILLION(5),    tge: MILLION(5),    cliff: 0,  vest: 6  },
];

const VESTING_FUND = ethers.parseEther("87000000"); // 87M ZTS total

// ── Wallet addresses from .env ───────────────────────────────────────────────
function getWallet(key) {
  const addr = process.env[`WALLET_${key}`];
  if (!addr) throw new Error(`Missing WALLET_${key} in .env`);
  return addr;
}

function requireEnv(key) {
  const v = process.env[key];
  if (!v) throw new Error(`Missing ${key} in .env`);
  return v;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();
  const bal = await ethers.provider.getBalance(deployerAddr);

  console.log("\n" + "═".repeat(60));
  console.log("  ZENTHIS — Deploy Vesting + HTLC (Base mainnet)");
  console.log("═".repeat(60));
  console.log(`  Deployer : ${deployerAddr}`);
  console.log(`  Balance  : ${ethers.formatEther(bal)} ETH`);
  console.log(`  Gas price: ${ethers.formatUnits((await ethers.provider.getFeeData()).gasPrice, "gwei")} gwei`);

  // ── TGE timestamp ──────────────────────────────────────────────────────────
  const tgeStr = requireEnv("TGE_TIMESTAMP");
  const tgeBN = BigInt(tgeStr);
  console.log(`  TGE      : ${new Date(Number(tgeBN) * 1000).toISOString()}`);

  // ── Token ──────────────────────────────────────────────────────────────────
  const token = await ethers.getContractAt("ZenthisToken", TOKEN_ADDR);
  const tokenBal = await token.balanceOf(deployerAddr);
  const tokenSupply = await token.totalSupply();
  console.log(`  Token    : ${TOKEN_ADDR}`);
  console.log(`  Supply   : ${ethers.formatEther(tokenSupply)} ZTS`);
  console.log(`  Deployer : ${ethers.formatEther(tokenBal)} ZTS`);

  if (tokenBal < VESTING_FUND) {
    console.error(`\n❌ Deployer only has ${ethers.formatEther(tokenBal)} ZTS, need ${ethers.formatEther(VESTING_FUND)}`);
    console.error("   Transfer ZTS to deployer and re-run.");
    process.exit(1);
  }

  // ── [1/3] Deploy ZenthisVesting ──────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("  📦 [1/3] Deploy ZenthisVesting");
  console.log("─".repeat(60));

  const Vesting = await ethers.getContractFactory("ZenthisVesting");
  const vesting = await Vesting.deploy(TOKEN_ADDR, deployerAddr);
  await vesting.waitForDeployment();
  const vestingAddr = await vesting.getAddress();
  console.log(`  ✅ Vesting : ${vestingAddr}`);

  // ── [2/3] Deploy ZenthisHTLC ────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("  📦 [2/3] Deploy ZenthisHTLC");
  console.log("─".repeat(60));

  const HTLC = await ethers.getContractFactory("ZenthisHTLC");
  const htlc = await HTLC.deploy();
  await htlc.waitForDeployment();
  const htlcAddr = await htlc.getAddress();
  console.log(`  ✅ HTLC    : ${htlcAddr}`);

  // ── [3/3] Fund vesting + create schedules ───────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("  📦 [3/3] Fund Vesting & Create Schedules");
  console.log("─".repeat(60));

  console.log(`  Transferring ${ethers.formatEther(VESTING_FUND)} ZTS → Vesting...`);
  const txFund = await token.transfer(vestingAddr, VESTING_FUND);
  await txFund.wait();
  console.log(`  ✅ Funded (tx: ${txFund.hash})`);
  console.log(`  Vesting balance: ${ethers.formatEther(await token.balanceOf(vestingAddr))} ZTS`);

  for (const s of SCHEDULES) {
    const beneficiary = getWallet(s.key);
    const id = ethers.id(s.key);

    console.log(`\n  ${s.key.padEnd(12)} → ${beneficiary}`);
    console.log(`           ${ethers.formatEther(s.total)} ZTS` +
      ` + TGE ${ethers.formatEther(s.tge)} ZTS` +
      ` | cliff ${s.cliff}mo | vest ${s.vest}mo`);

    const tx = await vesting.createSchedule(id, beneficiary, s.total, s.tge, tgeBN, s.cliff, s.vest);
    await tx.wait();
    console.log(`           ✅ created (tx: ${tx.hash})`);
  }

  const scheduleCount = (await vesting.getScheduleIds()).length;
  console.log(`\n  ✅ ${scheduleCount}/${SCHEDULES.length} schedules created`);

  // ── Save deployment ────────────────────────────────────────────────────────
  const deployDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deployDir)) fs.mkdirSync(deployDir);

  const deployment = {
    network: "base",
    chainId: "8453",
    deployedAt: new Date().toISOString(),
    deployer: deployerAddr,
    contracts: {
      ZenthisToken: TOKEN_ADDR,
      ZenthisVesting: vestingAddr,
      ZenthisHTLC: htlcAddr,
    },
    schedules: SCHEDULES.map((s) => ({
      key: s.key,
      total: s.total.toString(),
      tge: s.tge.toString(),
      cliff: s.cliff,
      vest: s.vest,
      beneficiary: getWallet(s.key),
    })),
    ztsVested: VESTING_FUND.toString(),
  };

  const deployPath = path.join(deployDir, "base-vesting.json");
  fs.writeFileSync(deployPath, JSON.stringify(deployment, null, 2));
  console.log(`\n📄 Saved → ${deployPath}`);

  // ── Done ───────────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("  ✅ DEPLOYMENT COMPLETE");
  console.log("═".repeat(60));
  console.log(`  ZenthisVesting : ${vestingAddr}`);
  console.log(`  ZenthisHTLC    : ${htlcAddr}`);
  console.log("═".repeat(60));

  // ── Verify ─────────────────────────────────────────────────────────────────
  console.log("\n⏳ Waiting 30s for Basescan indexing...");
  await new Promise((r) => setTimeout(r, 30_000));

  console.log("Verifying ZenthisVesting...");
  try {
    await hre.run("verify:verify", {
      address: vestingAddr,
      constructorArguments: [TOKEN_ADDR, deployerAddr],
    });
    console.log("  ✅ ZenthisVesting verified");
  } catch (e) {
    console.log(`  ⚠  Vesting verify: ${e.message}`);
  }

  console.log("Verifying ZenthisHTLC...");
  try {
    await hre.run("verify:verify", {
      address: htlcAddr,
      constructorArguments: [],
    });
    console.log("  ✅ ZenthisHTLC verified");
  } catch (e) {
    console.log(`  ⚠  HTLC verify: ${e.message}`);
  }

  console.log("\n✅ All done!");
}

main().catch((err) => {
  console.error("\n❌ FAILED:", err.message || err);
  process.exit(1);
});
