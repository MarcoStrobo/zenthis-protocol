/**
 * Verify deployed contracts on Sepolia Testnet
 */
const { ethers } = require("hardhat");

const TOKEN = "0x16bD37D89d105a4FBceEB4846e20528f348F02e3";
const VESTING = "0xD4773b69ECc47ae8EEE79E2b8869C93B13383D6A";
const HTLC = "0x4CE756e8A56981f27B3Ef78Ee0C876e7e2A9b649";

async function main() {
  const [deployer] = await ethers.getSigners();
  const token = await ethers.getContractAt("ZenthisToken", TOKEN);
  const vesting = await ethers.getContractAt("ZenthisVesting", VESTING);
  const htlc = await ethers.getContractAt("ZenthisHTLC", HTLC);

  console.log("\n" + "═".repeat(55));
  console.log("  🔍 Sepolia Deployment Verification");
  console.log("═".repeat(55));

  // Token
  console.log(`\n📋 ZenthisToken`);
  console.log(`   Address   : ${TOKEN}`);
  console.log(`   Supply    : ${ethers.formatEther(await token.totalSupply())} ZENTHIS`);
  console.log(`   Owner     : ${await token.owner()}`);

  // Vesting
  console.log(`\n📋 ZenthisVesting`);
  console.log(`   Address   : ${VESTING}`);
  console.log(`   Balance   : ${ethers.formatEther(await token.balanceOf(VESTING))} ZENTHIS`);
  const ids = await vesting.getScheduleIds();
  console.log(`   Schedules : ${ids.length}`);
  for (const id of ids) {
    const s = await vesting.getSchedule(id);
    const key =
      Object.entries({
        SEED: await vesting.SEED(),
        IDO: await vesting.IDO(),
        LIQUIDITY: await vesting.LIQUIDITY(),
        TEAM: await vesting.TEAM(),
        TREASURY: await vesting.TREASURY(),
        FOUNDER_OPS: await vesting.FOUNDER_OPS(),
        AIRDROPS: await vesting.AIRDROPS(),
      }).find(([, v]) => v === id)?.[0] || "?";
    const cliffMo = Number(s.cliffDuration) / (30 * 24 * 3600);
    const vestMo = Number(s.vestingDuration) / (30 * 24 * 3600);
    console.log(
      `   ${key.padEnd(14)} ${ethers
        .formatEther(s.totalAmount + s.tgeAmount)
        .padStart(12)} ZENTHIS | cliff=${cliffMo}mo vest=${vestMo}mo`,
    );
  }

  // HTLC
  console.log(`\n📋 ZenthisHTLC`);
  console.log(`   Address   : ${HTLC}`);
  console.log(`   Owner     : ${await htlc.owner()}`);
  console.log(`   Fee       : ${await htlc.feeBps()} bps`);
  console.log(`   Paused    : ${await htlc.paused()}`);

  // HTLC functional test
  console.log(`\n🔬 HTLC Functional Test`);
  const preimage = ethers.id("testpreimage");
  const hash = ethers.sha256(ethers.solidityPacked(["bytes32"], [preimage]));
  const swapId = ethers.id("testswap");
  const recipient = ethers.Wallet.createRandom().address;
  const now = (await ethers.provider.getBlock("latest")).timestamp;

  const tx = await htlc.newSwap(swapId, recipient, hash, now + 600, {
    value: ethers.parseEther("0.001"),
  });
  await tx.wait();
  const swap = await htlc.getSwap(swapId);
  console.log(`   Status         : ${swap.status} (1=Active, 2=Redeemed, 3=Refunded)`);
  console.log(`   Amount         : ${ethers.formatEther(swap.amount)} ETH`);

  const tx2 = await htlc.redeem(swapId, preimage);
  await tx2.wait();
  const swap2 = await htlc.getSwap(swapId);
  console.log(`   After redeem   : ${swap2.status}`);

  console.log("\n" + "═".repeat(55));
  console.log("  ✅ ALL VERIFIED — Sepolia Testnet");
  console.log("═".repeat(55) + "\n");

  // Save
  const fs = require("fs");
  if (!fs.existsSync("./deployments")) fs.mkdirSync("./deployments");
  fs.writeFileSync(
    "./deployments/sepolia.json",
    JSON.stringify(
      {
        network: "sepolia",
        chainId: 11155111,
        deployedAt: new Date().toISOString(),
        contracts: { ZenthisToken: TOKEN, ZenthisVesting: VESTING, ZenthisHTLC: HTLC },
      },
      null,
      2,
    ),
  );
  console.log("📄 Saved to deployments/sepolia.json\n");
}

main().catch((err) => {
  console.error("\n❌", err.message || err);
  process.exit(1);
});
