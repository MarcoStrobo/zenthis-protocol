/**
 * deploy.js — Zenthis Protocol full deployment
 * ─────────────────────────────────────────────────────────────────────────────
 *  Deploys:
 *    1. ZenthisToken    (100 M minted to deployer)
 *    2. ZenthisVesting  (receives full 100 M supply)
 *    3. ZenthisHTLC     (cross-chain atomic swap engine)
 *    4. Creates all 6 vesting schedules
 *    5. Saves addresses to deployments/<network>.json
 *    6. Auto-verifies on Etherscan (mainnet/sepolia)
 *
 *  Usage:
 *    npx hardhat run scripts/deploy.js --network sepolia    ← test first!
 *    npx hardhat run scripts/deploy.js --network mainnet    ← production
 *
 *  Required .env vars (see .env.example):
 *    MAINNET_RPC_URL  DEPLOYER_PRIVATE_KEY  TGE_TIMESTAMP
 *    WALLET_SEED  WALLET_IDO  WALLET_LIQUIDITY
 *    WALLET_TEAM  WALLET_TREASURY  WALLET_AIRDROPS
 *    MULTISIG_ADDRESS  (Gnosis Safe 2/2 — ownership transferred here)
 *
 *  Pre-flight checklist:
 *    □ npx hardhat test         → all tests pass
 *    □ Check gas price          → ethgasstation.info
 *    □ Deployer holds enough ETH (~0.08 ETH at 30 gwei)
 *    □ All WALLET_* addresses confirmed correct
 *    □ TGE_TIMESTAMP is in the future
 *    □ MULTISIG_ADDRESS is a valid Gnosis Safe 2/2
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { ethers, network, run } = require("hardhat");
const fs = require("fs");

// ── Tokenomics (must match ZenthisVesting.sol NatSpec + whitepaper) ───────────
//
//   Allocation        Total     TGE unlock   Cliff   Linear vest
//   ──────────────    ───────   ──────────   ─────   ────────────────────────────────────────
//   Seed               10.0 M      0 %        6 mo   24 months
//   IDO / Public       25.0 M     10 %        0 mo   18 months (on 90%)  ← was 20%, reduced
//   Liquidity          25.0 M     14 %        0 mo   48 months (on 86%)  LP tokens locked 12mo
//   Team (Founder)     10.0 M      0 %       12 mo   36 months           equity, no early exit
//   Treasury           18.2 M     11 %        0 mo   48 months (on 89%)  multi-sig 3/5
//   Founder Ops         1.8 M      0 %        0 mo   36 months           ~50,000 ZENTHIS/month
//   Airdrops           10.0 M     50 %        0 mo    6 months (on 50%)  ← was 100%, split
//   ──────────────    ───────
//   TOTAL             100.0 M ✓
//
//   Day-1 sell pressure: 2.5M (IDO TGE) + 2.0M (Treasury TGE) + 5.0M (Airdrop TGE) = 9.5M (9.5%)
//   Previous design: 21.5M (21.5%) → -56% reduction in launch dump risk

const M = (n) => ethers.parseEther((n * 1_000_000).toString());

const SCHEDULES = [
  //  key              totalVest      tgeAmount    cliffMonths  vestingMonths
  { key: "SEED", total: M(10), tge: M(0), cliff: 6n, vest: 24n },
  { key: "IDO", total: M(22.5), tge: M(2.5), cliff: 0n, vest: 18n }, // 10% TGE (was 20%)
  { key: "LIQUIDITY", total: M(21.5), tge: M(3.5), cliff: 0n, vest: 48n }, // LP tokens → lock 12mo on Team.Finance
  { key: "TEAM", total: M(10), tge: M(0), cliff: 12n, vest: 36n }, // Founder equity — no early exit
  { key: "TREASURY", total: M(16.2), tge: M(2), cliff: 0n, vest: 48n }, // Multi-sig 3/5 required
  { key: "FOUNDER_OPS", total: M(1.8), tge: M(0), cliff: 0n, vest: 36n }, // ~50,000 ZENTHIS/month salary
  { key: "AIRDROPS", total: M(5), tge: M(5), cliff: 0n, vest: 6n }, // 50% TGE + 50% over 6 months
];
// Sum: (10)+(22.5+2.5)+(21.5+3.5)+(10)+(16.2+2)+(1.8)+(5+5) = 100 M ✓

async function main() {
  const [deployer] = await ethers.getSigners();
  const netInfo = await ethers.provider.getNetwork();

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Zenthis Protocol — Full Deployment");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Network  : ${network.name} (chainId ${netInfo.chainId})`);
  console.log(`  Deployer : ${deployer.address}`);
  console.log(
    `  Balance  : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`,
  );
  console.log("═══════════════════════════════════════════════════════\n");

  // ── Load & validate env ───────────────────────────────────────────────────
  const wallets = {
    SEED: requireEnv("WALLET_SEED"),
    IDO: requireEnv("WALLET_IDO"),
    LIQUIDITY: requireEnv("WALLET_LIQUIDITY"),
    TEAM: requireEnv("WALLET_TEAM"),
    TREASURY: requireEnv("WALLET_TREASURY"),
    FOUNDER_OPS: requireEnv("WALLET_FOUNDER_OPS"),
    AIRDROPS: requireEnv("WALLET_AIRDROPS"),
  };

  const MULTISIG = requireEnv("MULTISIG_ADDRESS");
  if (!ethers.isAddress(MULTISIG)) {
    throw new Error(`Invalid MULTISIG_ADDRESS: "${MULTISIG}"`);
  }

  const TGE = BigInt(requireEnv("TGE_TIMESTAMP"));

  const isTestnet = ["hardhat", "localhost", "sepolia", "arbitrumSepolia"].includes(network.name);
  for (const [key, val] of Object.entries(wallets)) {
    if (!ethers.isAddress(val)) {
      if (isTestnet) {
        console.warn(`  ⚠  WALLET_${key} not set — using deployer (TESTNET ONLY)`);
        wallets[key] = deployer.address;
      } else {
        throw new Error(`Invalid address for WALLET_${key}: "${val}"`);
      }
    }
  }

  // ── [1/3] Deploy ZenthisToken ─────────────────────────────────────────────
  console.log("📦 [1/3] Deploying ZenthisToken...");
  const TokenFactory = await ethers.getContractFactory("ZenthisToken");
  const token = await TokenFactory.deploy(deployer.address);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log(`   ✓ ZenthisToken : ${tokenAddr}`);
  console.log(`   ✓ Supply       : ${ethers.formatEther(await token.totalSupply())} ZENTHIS`);

  // ── [2/3] Deploy ZenthisVesting ───────────────────────────────────────────
  console.log("\n📦 [2/3] Deploying ZenthisVesting...");
  const VestingFactory = await ethers.getContractFactory("ZenthisVesting");
  const vesting = await VestingFactory.deploy(tokenAddr, deployer.address);
  await vesting.waitForDeployment();
  const vestingAddr = await vesting.getAddress();
  console.log(`   ✓ ZenthisVesting : ${vestingAddr}`);

  console.log("\n   Transferring 100 M ZENTHIS → vesting contract...");
  const totalSupply = await token.totalSupply();
  await (await token.transfer(vestingAddr, totalSupply)).wait();
  console.log(
    `   ✓ Vesting balance : ${ethers.formatEther(await token.balanceOf(vestingAddr))} ZENTHIS`,
  );

  // ── [3/3] Deploy ZenthisHTLC ──────────────────────────────────────────────
  console.log("\n📦 [3/3] Deploying ZenthisHTLC...");
  const HTLCFactory = await ethers.getContractFactory("ZenthisHTLC");
  const htlc = await HTLCFactory.deploy();
  await htlc.waitForDeployment();
  const htlcAddr = await htlc.getAddress();
  console.log(`   ✓ ZenthisHTLC : ${htlcAddr}`);

  // ── [4/4] Create vesting schedules ───────────────────────────────────────
  console.log(
    `\n📋 [4/4] Creating vesting schedules (TGE: ${new Date(Number(TGE) * 1000).toISOString()})`,
  );
  console.log("");

  for (const s of SCHEDULES) {
    const id = await vesting[s.key]();
    const tx = await vesting.createSchedule(
      id,
      wallets[s.key],
      s.total,
      s.tge,
      TGE,
      s.cliff,
      s.vest,
    );
    await tx.wait();
    console.log(
      `   ✓ ${s.key.padEnd(10)}` +
        `  vest=${ethers.formatEther(s.total).padStart(14)}` +
        `  TGE=${ethers.formatEther(s.tge).padStart(12)}` +
        `  cliff=${String(s.cliff).padStart(2)}mo` +
        `  vest=${String(s.vest).padStart(2)}mo` +
        `  → ${wallets[s.key]}`,
    );
  }

  // ── Save deployment record ────────────────────────────────────────────────
  const deployment = {
    network: network.name,
    chainId: netInfo.chainId.toString(),
    deployedAt: new Date().toISOString(),
    tge: TGE.toString(),
    deployer: deployer.address,
    multisig: MULTISIG,
    contracts: {
      ZenthisToken: tokenAddr,
      ZenthisVesting: vestingAddr,
      ZenthisHTLC: htlcAddr,
    },
    wallets,
  };

  const dir = "./deployments";
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  fs.writeFileSync(`${dir}/${network.name}.json`, JSON.stringify(deployment, null, 2));
  console.log(`\n   ✓ Deployment record saved → deployments/${network.name}.json`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  ZenthisToken   : ${tokenAddr}`);
  console.log(`  ZenthisVesting : ${vestingAddr}`);
  console.log(`  ZenthisHTLC    : ${htlcAddr}`);
  console.log("═══════════════════════════════════════════════════════");

  // ── Auto-verify on Etherscan ──────────────────────────────────────────────
  if (!["hardhat", "localhost"].includes(network.name)) {
    console.log("\n⏳ Waiting 30s for Etherscan to index...");
    await new Promise((r) => setTimeout(r, 30_000));

    for (const [name, addr, args] of [
      ["ZenthisToken", tokenAddr, [deployer.address]],
      ["ZenthisVesting", vestingAddr, [tokenAddr, deployer.address]],
      ["ZenthisHTLC", htlcAddr, []],
    ]) {
      try {
        await run("verify:verify", { address: addr, constructorArguments: args });
        console.log(`   ✓ ${name} verified on Etherscan`);
      } catch (e) {
        console.log(`   ⚠  ${name} verification: ${e.message}`);
      }
    }
  }

  // ── [5/5] Transfer ownership to multi-sig ──────────────────────────────────
  console.log(`\n🔐 [5/5] Transferring ownership to multisig: ${MULTISIG}`);

  for (const [name, contract] of [
    ["ZenthisToken", token],
    ["ZenthisVesting", vesting],
    ["ZenthisHTLC", htlc],
  ]) {
    const currentOwner = await contract.owner();
    if (currentOwner.toLowerCase() === MULTISIG.toLowerCase()) {
      console.log(`   ✓ ${name.padEnd(14)} already owned by multisig`);
    } else {
      const tx = await contract.transferOwnership(MULTISIG);
      await tx.wait();
      console.log(`   ✓ ${name.padEnd(14)} ownership → ${MULTISIG}`);
    }
  }

  // Final sanity: verify all three are transferred
  for (const [name, contract] of [
    ["Token", token],
    ["Vesting", vesting],
    ["HTLC", htlc],
  ]) {
    const owner = await contract.owner();
    if (owner.toLowerCase() !== MULTISIG.toLowerCase()) {
      console.error(`   ✘ ${name} owner is STILL ${owner} — abort.`);
      process.exit(1);
    }
  }
  console.log("   ✓ All contracts owned by multisig — deployer key is now harmless.");

  console.log("\n  NEXT STEPS:");
  console.log("  1. Transfer WALLET_IDO tokens to PinkSale presale contract");
  console.log("  2. Configure presale on pinksale.finance");
  console.log("  3. Update .env MULTISIG_ADDRESS with recovery wallet if needed");
  console.log("");
}

function requireEnv(key) {
  const v = process.env[key];
  if (!v)
    throw new Error(`Missing env var: ${key}\n  copy .env.example to .env and fill in the value.`);
  return v;
}

main().catch((err) => {
  console.error("\n Deploy FAILED:", err.message);
  process.exit(1);
});
