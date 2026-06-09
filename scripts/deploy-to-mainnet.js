/**
 * Zenthis Protocol — Production Deploy Script
 *
 * Works on Ethereum Mainnet, Arbitrum One, Base, and any EVM network.
 *
 * Usage:
 *   1. cp .env.example .env  →  fill in all vars
 *   2. npx hardhat run scripts/deploy-to-mainnet.js --network mainnet
 *      npx hardhat run scripts/deploy-to-mainnet.js --network arbitrumOne
 *      npx hardhat run scripts/deploy-to-mainnet.js --network base
 *   3. Verify: npx hardhat run scripts/verify-deployment.js --network <name>
 *
 * Deploy order: ZenthisToken → ZenthisVesting → ZenthisHTLC
 * Post-deploy: funds vesting, creates 7 schedules, saves deployment JSON.
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION — edit these or set via .env
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // TGE timestamp (Unix seconds) — MUST be in the future at deploy time
  tgeTimestamp: process.env.TGE_TIMESTAMP
    ? parseInt(process.env.TGE_TIMESTAMP, 10)
    : Math.floor(Date.now() / 1000) + 86400, // default: 24h from now

  // 7 beneficiary wallet addresses (set in .env)
  wallets: {
    SEED: process.env.WALLET_SEED || "",
    IDO: process.env.WALLET_IDO || "",
    LIQUIDITY: process.env.WALLET_LIQUIDITY || "",
    TEAM: process.env.WALLET_TEAM || "",
    TREASURY: process.env.WALLET_TREASURY || "",
    FOUNDER_OPS: process.env.WALLET_FOUNDER_OPS || "",
    AIRDROPS: process.env.WALLET_AIRDROPS || "",
  },
};

// Whitepaper allocation (100M total)
const MILLION = (n) => ethers.parseEther((n * 1_000_000).toString());

const SCHEDULES = [
  // key              total          tge         cliff(months)  vest(months)
  { key: "SEED", total: MILLION(10), tge: 0n, cliff: 6, vest: 24 },
  { key: "IDO", total: MILLION(22.5), tge: MILLION(2.5), cliff: 0, vest: 18 },
  { key: "LIQUIDITY", total: MILLION(21.5), tge: MILLION(3.5), cliff: 0, vest: 48 },
  { key: "TEAM", total: MILLION(10), tge: 0n, cliff: 12, vest: 36 },
  { key: "TREASURY", total: MILLION(16.2), tge: MILLION(2), cliff: 0, vest: 48 },
  { key: "FOUNDER_OPS", total: MILLION(1.8), tge: 0n, cliff: 0, vest: 36 },
  { key: "AIRDROPS", total: MILLION(5), tge: MILLION(5), cliff: 0, vest: 6 },
];

// Total vesting allocation = sum of SCHEDULES totals = ~87M (incl. TGE)
const VESTING_FUND = ethers.parseEther("87000000");

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

function validateConfig(deployerAddr) {
  const errors = [];

  // Check all wallet addresses are set and valid
  for (const [name, addr] of Object.entries(CONFIG.wallets)) {
    if (!addr || addr === "") {
      errors.push(`WALLET_${name} is empty — set it in .env`);
    } else if (!ethers.isAddress(addr)) {
      errors.push(`WALLET_${name}=${addr} is not a valid Ethereum address`);
    } else if (ethers.getAddress(addr) === ethers.getAddress(deployerAddr)) {
      errors.push(`WALLET_${name} must NOT be the deployer address (use dedicated wallets)`);
    }
  }

  // Check TGE is in the future
  const now = Math.floor(Date.now() / 1000);
  if (CONFIG.tgeTimestamp <= now) {
    errors.push(`TGE_TIMESTAMP (${CONFIG.tgeTimestamp}) is in the past — set a future date`);
  }

  if (errors.length > 0) {
    console.error("\n❌ CONFIGURATION ERRORS:");
    errors.forEach((e) => console.error(`   - ${e}`));
    console.error("\nFix the above and re-run.\n");
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();
  const deployerBal = await ethers.provider.getBalance(deployerAddr);

  console.log("\n" + "═".repeat(60));
  console.log("  🚀 ZENTHIS PROTOCOL — MAINNET DEPLOY");
  console.log("═".repeat(60));
  console.log(`  Deployer  : ${deployerAddr}`);
  console.log(`  ETH balance: ${ethers.formatEther(deployerBal)} ETH`);
  console.log(`  TGE        : ${new Date(CONFIG.tgeTimestamp * 1000).toISOString()}`);
  console.log(`  Network    : ${hre.network.name} (chainId: ${hre.network.config.chainId})`);
  console.log("═".repeat(60));

  // ═══════════════════════════════════════════════════════════════
  // VALIDATE
  // ═══════════════════════════════════════════════════════════════
  validateConfig(deployerAddr);

  // Check deployer has enough ETH for gas
  // L2s (Arbitrum, Base) need ~0.01 ETH; Mainnet needs ~0.05+ ETH
  const isL2 = [42161, 8453, 10, 137, 43114].includes(hre.network.config.chainId);
  const minEth = isL2 ? ethers.parseEther("0.005") : ethers.parseEther("0.5");
  if (deployerBal < minEth) {
    console.warn(
      `\n⚠️  WARNING: Deployer has < ${ethers.formatEther(minEth)} ETH. ` +
        `Deploy may fail due to gas.`,
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 1: DEPLOY TOKEN
  // ═══════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("  📦 PHASE 1: Deploy ZenthisToken (100M supply)");
  console.log("─".repeat(60));

  console.log("Deploying ZenthisToken...");
  const TokenFactory = await ethers.getContractFactory("ZenthisToken");
  const token = await TokenFactory.deploy(deployerAddr); // treasury = deployer temporarily
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log(`  ✅ Token       : ${tokenAddr}`);
  console.log(`  ✅ Supply      : ${ethers.formatEther(await token.totalSupply())} ZENTHIS`);
  console.log(`  ✅ Owner       : ${await token.owner()}`);

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2: DEPLOY VESTING
  // ═══════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("  📦 PHASE 2: Deploy ZenthisVesting");
  console.log("─".repeat(60));

  console.log("Deploying ZenthisVesting...");
  const VestingFactory = await ethers.getContractFactory("ZenthisVesting");
  const vesting = await VestingFactory.deploy(tokenAddr, deployerAddr);
  await vesting.waitForDeployment();
  const vestingAddr = await vesting.getAddress();
  console.log(`  ✅ Vesting     : ${vestingAddr}`);

  // ═══════════════════════════════════════════════════════════════
  // PHASE 3: DEPLOY HTLC
  // ═══════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("  📦 PHASE 3: Deploy ZenthisHTLC");
  console.log("─".repeat(60));

  console.log("Deploying ZenthisHTLC...");
  const HTLCFactory = await ethers.getContractFactory("ZenthisHTLC");
  const htlc = await HTLCFactory.deploy();
  await htlc.waitForDeployment();
  const htlcAddr = await htlc.getAddress();
  console.log(`  ✅ HTLC        : ${htlcAddr}`);

  // ═══════════════════════════════════════════════════════════════
  // PHASE 4: FUND VESTING
  // ═══════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("  📦 PHASE 4: Fund Vesting Contract");
  console.log("─".repeat(60));

  console.log(`Transferring ${ethers.formatEther(VESTING_FUND)} ZENTHIS to Vesting...`);
  const txFund = await token.transfer(vestingAddr, VESTING_FUND);
  await txFund.wait();
  console.log(`  ✅ Funded (tx: ${txFund.hash})`);
  console.log(
    `  ✅ Vesting balance: ${ethers.formatEther(await token.balanceOf(vestingAddr))} ZENTHIS`,
  );

  // ═══════════════════════════════════════════════════════════════
  // PHASE 5: CREATE VESTING SCHEDULES
  // ═══════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("  📦 PHASE 5: Create 7 Vesting Schedules");
  console.log("─".repeat(60));

  const tgeBN = BigInt(CONFIG.tgeTimestamp);

  for (const s of SCHEDULES) {
    const beneficiary = CONFIG.wallets[s.key];
    const id = ethers.id(s.key);

    console.log(
      `  ${s.key.padEnd(12)} → ${beneficiary}  (${ethers.formatEther(s.total)} ZENTHIS, cliff=${
        s.cliff
      }mo, vest=${s.vest}mo)`,
    );

    const tx = await vesting.createSchedule(
      id,
      beneficiary,
      s.total,
      s.tge,
      tgeBN,
      s.cliff,
      s.vest,
    );
    await tx.wait();
    console.log(`           ✅ created (tx: ${tx.hash})`);
  }

  const scheduleCount = (await vesting.getScheduleIds()).length;
  console.log(`\n  ✅ ${scheduleCount} schedules created`);

  // ═══════════════════════════════════════════════════════════════
  // DONE — SAVE & PRINT
  // ═══════════════════════════════════════════════════════════════
  console.log("\n" + "═".repeat(60));
  console.log("  ✅ ALL CONTRACTS DEPLOYED SUCCESSFULLY");
  console.log("═".repeat(60));
  console.log(`  ZenthisToken   : ${tokenAddr}`);
  console.log(`  ZenthisVesting : ${vestingAddr}`);
  console.log(`  ZenthisHTLC    : ${htlcAddr}`);
  console.log("═".repeat(60));

  // Save deployment file
  const deployDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deployDir)) fs.mkdirSync(deployDir);

  const deployment = {
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    deployedAt: new Date().toISOString(),
    tgeTimestamp: CONFIG.tgeTimestamp,
    deployer: deployerAddr,
    contracts: {
      ZenthisToken: tokenAddr,
      ZenthisVesting: vestingAddr,
      ZenthisHTLC: htlcAddr,
    },
  };

  const deployPath = path.join(deployDir, `${hre.network.name}.json`);
  fs.writeFileSync(deployPath, JSON.stringify(deployment, null, 2));
  console.log(`\n📄 Saved to ${deployPath}`);

  // ═══════════════════════════════════════════════════════════════
  // POST-DEPLOY INSTRUCTIONS
  // ═══════════════════════════════════════════════════════════════
  console.log("\n" + "═".repeat(60));
  console.log(`  📋 NEXT STEPS (${hre.network.name})`);
  console.log("═".repeat(60));
  const net = hre.network.name;
  const verifyUrl =
    net === "arbitrumOne"
      ? "arbiscan.io"
      : net === "base"
        ? "basescan.org"
        : net === "mainnet"
          ? "etherscan.io"
          : `${net}.etherscan.io`;

  console.log(`
  1. VERIFY (${verifyUrl}):
     npx hardhat verify --network ${net} ${tokenAddr} ${deployerAddr}
     npx hardhat verify --network ${net} ${vestingAddr} ${tokenAddr} ${deployerAddr}
     npx hardhat verify --network ${net} ${htlcAddr}

  2. TRANSFER OWNERSHIP TO GNOSIS SAFE (${process.env.GNOSIS_SAFE_ADDRESS || "NOT SET"}):
     ZenthisToken  → token.transferOwnership(GNOSIS_SAFE_ADDR)
     ZenthisVesting → vesting.transferOwnership(GNOSIS_SAFE_ADDR)
     ZenthisHTLC   → htlc.transferOwnership(GNOSIS_SAFE_ADDR)

  3. SAVED:
     ${deployPath}

  4. UPDATE .env:
     TOKEN_ADDRESS=${tokenAddr}
     VESTING_ADDRESS=${vestingAddr}
     HTLC_ADDRESS=${htlcAddr}
`);
}

main().catch((err) => {
  console.error("\n❌ DEPLOY FAILED:", err.message || err);
  process.exit(1);
});
