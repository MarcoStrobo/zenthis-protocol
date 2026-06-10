/**
 * deploy-presale.js — Deploy ZenthisPresale contract
 * ─────────────────────────────────────────────────────────────────────────────
 *  Deploys position:
 *    1. ZenthisPresale (standalone or after main deploy)
 *    2. Funds it with the required ZTS allocation from the treasury
 *    3. Verifies on Etherscan
 *
 *  Usage:
 *    npx hardhat run scripts/deploy-presale.js --network sepolia
 *    npx hardhat run scripts/deploy-presale.js --network mainnet
 *
 *  Required .env vars (see .env.example):
 *    DEPLOYER_PRIVATE_KEY  PRESALE_RATE  PRESALE_SOFT_CAP  PRESALE_HARD_CAP
 *    PRESALE_MIN_BUY  PRESALE_MAX_BUY  PRESALE_LIQUIDITY_PCT
 *    PRESALE_START_TIME  PRESALE_END_TIME
 *    PRESALE_LIQUIDITY_WALLET  PRESALE_TREASURY_WALLET
 *    PRESALE_BONUS_POOL  PRESALE_TIER[1-4]_ETH  PRESALE_TIER[1-4]_REWARD
 *    PRESALE_REFERRAL_MIN_ETH
 *    TOKEN_ADDRESS  VESTING_ADDRESS  (or run after deploy.js)
 *
 *  Pre-flight checklist:
 *    □ npx hardhat test            → all tests pass
 *    □ TOKEN_ADDRESS is the deployed ZenthisToken
 *    □ Presale parameters reviewed
 *    □ Liquidity wallet = Gnosis Safe 2/2
 *    □ Treasury wallet confirmed
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { ethers, network, run } = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await ethers.getSigners();
  const netInfo = await ethers.provider.getNetwork();

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Zenthis Protocol — Presale Deploy");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Network  : ${network.name} (chainId ${netInfo.chainId})`);
  console.log(`  Deployer : ${deployer.address}`);
  console.log(
    `  Balance  : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`,
  );
  console.log("═══════════════════════════════════════════════════════\n");

  // ── Load env ───────────────────────────────────────────────────
  const tokenAddr = requireEnv("TOKEN_ADDRESS");
  const vestingAddr = requireEnv("VESTING_ADDRESS");
  const rate = ethers.parseEther(requireEnv("PRESALE_RATE"));
  const softCap = ethers.parseEther(requireEnv("PRESALE_SOFT_CAP"));
  const hardCap = ethers.parseEther(requireEnv("PRESALE_HARD_CAP"));
  const minBuy = ethers.parseEther(requireEnv("PRESALE_MIN_BUY"));
  const maxBuy = ethers.parseEther(requireEnv("PRESALE_MAX_BUY"));
  const liqPct = BigInt(requireEnv("PRESALE_LIQUIDITY_PCT"));
  const startTime = BigInt(requireEnv("PRESALE_START_TIME"));
  const endTime = BigInt(requireEnv("PRESALE_END_TIME"));
  const liqWallet = requireEnv("PRESALE_LIQUIDITY_WALLET");
  const treasuryWallet = requireEnv("PRESALE_TREASURY_WALLET");

  // ── Bonus & Referral params ──────────────────────────────────
  const bonusPoolSize = ethers.parseEther(requireEnv("PRESALE_BONUS_POOL"));
  const flatAirdrop = ethers.parseEther(requireEnv("PRESALE_FLAT_AIRDROP"));
  const bonusTier1Eth = ethers.parseEther(requireEnv("PRESALE_BONUS_TIER1_ETH"));
  const bonusTier1Reward = ethers.parseEther(requireEnv("PRESALE_BONUS_TIER1_REWARD"));
  const bonusTier2Eth = ethers.parseEther(requireEnv("PRESALE_BONUS_TIER2_ETH"));
  const bonusTier2Reward = ethers.parseEther(requireEnv("PRESALE_BONUS_TIER2_REWARD"));
  const bonusTier3Eth = ethers.parseEther(requireEnv("PRESALE_BONUS_TIER3_ETH"));
  const bonusTier3Reward = ethers.parseEther(requireEnv("PRESALE_BONUS_TIER3_REWARD"));
  const bonusTier4Eth = ethers.parseEther(requireEnv("PRESALE_BONUS_TIER4_ETH"));
  const bonusTier4Reward = ethers.parseEther(requireEnv("PRESALE_BONUS_TIER4_REWARD"));
  const referralMinEth = ethers.parseEther(requireEnv("PRESALE_REFERRAL_MIN_ETH"));

  // ── Phase 2 params (v9: whitelist phases) ────────────────────
  const p2Flat = ethers.parseEther(requireEnv("P2_FLAT_AIRDROP"));
  const p2T1E = ethers.parseEther(requireEnv("P2_BONUS_TIER1_ETH"));
  const p2T1R = ethers.parseEther(requireEnv("P2_BONUS_TIER1_REWARD"));
  const p2T2E = ethers.parseEther(requireEnv("P2_BONUS_TIER2_ETH"));
  const p2T2R = ethers.parseEther(requireEnv("P2_BONUS_TIER2_REWARD"));
  const p2T3E = ethers.parseEther(requireEnv("P2_BONUS_TIER3_ETH"));
  const p2T3R = ethers.parseEther(requireEnv("P2_BONUS_TIER3_REWARD"));

  // ── Validate ───────────────────────────────────────────────────
  if (!ethers.isAddress(tokenAddr)) throw new Error(`Invalid TOKEN_ADDRESS: ${tokenAddr}`);
  if (!ethers.isAddress(vestingAddr)) throw new Error(`Invalid VESTING_ADDRESS: ${vestingAddr}`);
  if (!ethers.isAddress(liqWallet)) throw new Error(`Invalid PRESALE_LIQUIDITY_WALLET`);
  if (!ethers.isAddress(treasuryWallet)) throw new Error(`Invalid PRESALE_TREASURY_WALLET`);

  const token = await ethers.getContractAt("ZenthisToken", tokenAddr);

  // ── [1/2] Deploy ZenthisPresale ────────────────────────────────
  console.log("📦 [1/2] Deploying ZenthisPresale...");
  const Presale = await ethers.getContractFactory("ZenthisPresale");
  const presale = await Presale.deploy(
    tokenAddr,
    rate,
    softCap,
    hardCap,
    minBuy,
    maxBuy,
    liqPct,
    startTime,
    endTime,
    liqWallet,
    treasuryWallet,
    bonusPoolSize,
    flatAirdrop,
    bonusTier1Eth,
    bonusTier1Reward,
    bonusTier2Eth,
    bonusTier2Reward,
    bonusTier3Eth,
    bonusTier3Reward,
    bonusTier4Eth,
    bonusTier4Reward,
    referralMinEth,
  );
  await presale.waitForDeployment();
  const presaleAddr = await presale.getAddress();
  console.log(`   ✓ ZenthisPresale : ${presaleAddr}`);

  // ── Configure Phase 2 params (v9) ─────────────────────────────
  console.log("   ⚙  Setting Phase 2 bonus params...");
  await (await presale.setPhase2Config(p2Flat, p2T1E, p2T1R, p2T2E, p2T2R, p2T3E, p2T3R)).wait();
  console.log(
    `   ✓ Phase 2: flat=${ethers.formatEther(p2Flat)} ZTS, tiers=[${ethers.formatEther(p2T1R)},${ethers.formatEther(p2T2R)},${ethers.formatEther(p2T3R)}] ZTS`,
  );

  // ── [2/2] Fund presale with ZTS ────────────────────────────────
  const required = await presale.getRequiredZts();
  const treasuryBalance = await token.balanceOf(deployer.address);

  // Check if tokens are in the vesting contract or still with deployer
  let tokenSource;
  if (treasuryBalance >= required) {
    tokenSource = deployer;
    console.log(`   ✓ Using deployer balance: ${ethers.formatEther(treasuryBalance)} ZTS`);
  } else {
    // Tokens may be in the vesting contract — we need to withdraw first
    // Vesting contract's rescueERC20 or cancel + withdraw approach
    // For simplicity, check if the treasury wallet (owner) still holds enough
    throw new Error(
      `Insufficient ZTS in deployer wallet. Have ${ethers.formatEther(treasuryBalance)}, ` +
        `need ${ethers.formatEther(required)}.\n` +
        `Transfer ZTS to deployer first, or run after main deploy without vesting transfer.`,
    );
  }

  console.log(`   Transferring ${ethers.formatEther(required)} ZTS → presale contract...`);
  await (await token.transfer(presaleAddr, required)).wait();
  const presaleBalance = await token.balanceOf(presaleAddr);
  console.log(`   ✓ Presale balance : ${ethers.formatEther(presaleBalance)} ZTS`);

  // ── Save deployment record ─────────────────────────────────────
  const deployment = {
    network: network.name,
    chainId: netInfo.chainId.toString(),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      ZenthisPresale: presaleAddr,
    },
    presaleParams: {
      rate: rate.toString(),
      softCap: softCap.toString(),
      hardCap: hardCap.toString(),
      minBuy: minBuy.toString(),
      maxBuy: maxBuy.toString(),
      liqPct: liqPct.toString(),
      startTime: startTime.toString(),
      endTime: endTime.toString(),
      dateRange: `${new Date(Number(startTime) * 1000).toISOString()} → ${new Date(
        Number(endTime) * 1000,
      ).toISOString()}`,
    },
    wallets: {
      liquidity: liqWallet,
      treasury: treasuryWallet,
    },
    ztsRequired: required.toString(),
  };

  const dir = "./deployments";
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const recordPath = `${dir}/${network.name}-presale.json`;
  fs.writeFileSync(recordPath, JSON.stringify(deployment, null, 2));
  console.log(`\n   ✓ Deployment record → ${recordPath}`);

  // ── Summary ────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  PRESALE DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Presale contract : ${presaleAddr}`);
  console.log(`  Rate             : ${ethers.formatEther(rate)} ZTS per ETH`);
  console.log(`  Soft cap         : ${ethers.formatEther(softCap)} ETH`);
  console.log(`  Hard cap         : ${ethers.formatEther(hardCap)} ETH`);
  console.log(`  Liquidity        : ${liqPct / 100n}% → ${liqWallet}`);
  console.log(`  Start            : ${new Date(Number(startTime) * 1000).toISOString()}`);
  console.log(`  End              : ${new Date(Number(endTime) * 1000).toISOString()}`);
  console.log(`  Flat airdrop     : ${ethers.formatEther(flatAirdrop)} ZTS per contributor`);
  console.log("═══════════════════════════════════════════════════════\n");

  console.log("  NEXT STEPS:");
  console.log(`  1. Share presale address: ${presaleAddr}`);
  console.log("  2. Monitor contributions - verify on Etherscan");
  console.log("  3. After end time, call finalize() from the multisig");
  console.log("  4. Users call claim() to receive ZTS");
  console.log("  5. Create Uniswap V3 pool with the liquidity funds");
  console.log("");

  // ── Auto-verify ────────────────────────────────────────────────
  if (!["hardhat", "localhost"].includes(network.name)) {
    console.log("\n⏳ Waiting 30s for Etherscan to index...");
    await new Promise((r) => setTimeout(r, 30_000));
    const args = [
      tokenAddr,
      rate,
      softCap,
      hardCap,
      minBuy,
      maxBuy,
      liqPct,
      startTime,
      endTime,
      liqWallet,
      treasuryWallet,
      bonusPoolSize,
      flatAirdrop,
      bonusTier1Eth,
      bonusTier1Reward,
      bonusTier2Eth,
      bonusTier2Reward,
      bonusTier3Eth,
      bonusTier3Reward,
      bonusTier4Eth,
      bonusTier4Reward,
      referralMinEth,
    ];
    try {
      await run("verify:verify", { address: presaleAddr, constructorArguments: args });
      console.log("   ✓ ZenthisPresale verified on Etherscan");
    } catch (e) {
      console.log(`   ⚠  Verification: ${e.message}`);
    }
  }
}

function requireEnv(key) {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}\n  Add it to .env and try again.`);
  return v;
}

main().catch((err) => {
  console.error("\n Presale deploy FAILED:", err.message);
  process.exit(1);
});
