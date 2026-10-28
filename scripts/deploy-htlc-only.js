/**
 * deploy-htlc-only.js — Deploy ZenthisHTLC to a single chain
 *
 * Usage:
 *   npx hardhat run scripts/deploy-htlc-only.js --network base
 *   npx hardhat run scripts/deploy-htlc-only.js --network ethereum
 *   npx hardhat run scripts/deploy-htlc-only.js --network arbitrum
 *   ...
 */

const { ethers, network, run } = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await ethers.getSigners();
  const netInfo = await ethers.provider.getNetwork();

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  ZenthisHTLC — Single Chain Deploy");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Network : ${network.name} (chainId ${netInfo.chainId})`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(
    `  Balance : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`,
  );
  console.log("═══════════════════════════════════════════════════════\n");

  // ── Deploy ZenthisHTLC ─────────────────────────────────────────
  console.log("📦 Deploying ZenthisHTLC...");
  const HTLCFactory = await ethers.getContractFactory("ZenthisHTLC");
  const htlc = await HTLCFactory.deploy();
  await htlc.waitForDeployment();
  const htlcAddr = await htlc.getAddress();
  console.log(`   ✓ ZenthisHTLC : ${htlcAddr}`);

  // Set fee to 0.20% (20 bps) from default 0.10% (10 bps)
  console.log("\n⚙️  Setting fee to 20 bps (0.20%)...");
  const tx = await htlc.setFeeBps(20);
  await tx.wait();
  const feeBps = await htlc.feeBps();
  console.log(`   ✓ FeeBps : ${feeBps} bps (${Number(feeBps) / 100}%)`);

  // ── Save deployment record ─────────────────────────────────────
  const deployment = {
    network: network.name,
    chainId: netInfo.chainId.toString(),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      ZenthisHTLC: htlcAddr,
    },
    config: {
      feeBps: Number(feeBps),
    },
  };

  const dir = "./deployments";
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(`${dir}/htlc-${network.name}.json`, JSON.stringify(deployment, null, 2));
  console.log(`\n   ✓ Record saved → deployments/htlc-${network.name}.json`);

  // ── Summary ────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  DEPLOY COMPLETE");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  ZenthisHTLC : ${htlcAddr}`);
  console.log(`  Fee         : ${Number(feeBps)} bps`);
  console.log(`  Network     : ${network.name} (${netInfo.chainId})`);
  console.log("═══════════════════════════════════════════════════════\n");

  // ── Auto-verify on Etherscan ───────────────────────────────────
  if (!["hardhat", "localhost"].includes(network.name)) {
    console.log("⏳ Waiting 30s for block explorer to index...");
    await new Promise((r) => setTimeout(r, 30_000));

    try {
      await run("verify:verify", { address: htlcAddr, constructorArguments: [] });
      console.log(`   ✓ ZenthisHTLC verified on block explorer`);
    } catch (e) {
      console.log(`   ⚠  Verification: ${e.message}`);
    }
  }
}

main().catch((err) => {
  console.error("\n✘ Deploy FAILED:", err.message);
  process.exit(1);
});
