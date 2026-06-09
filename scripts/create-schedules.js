/**
 * Fix: Create vesting schedules on deployed contracts
 * Usage: npx hardhat run scripts/create-schedules.js --network sepolia
 */

const { ethers, network } = require("hardhat");

const VESTING_ADDR = "0xD4773b69ECc47ae8EEE79E2b8869C93B13383D6A";
const TOKEN_ADDR = "0x16bD37D89d105a4FBceEB4846e20528f348F02e3";

// June 1, 2026 00:00 UTC = 1780272000
const TGE = 1780272000n;
const M = (n) => ethers.parseEther((n * 1_000_000).toString());

const SCHEDULES = [
  { key: "SEED", total: M(10), tge: 0n, cliff: 6n, vest: 24n },
  { key: "IDO", total: M(22.5), tge: M(2.5), cliff: 0n, vest: 18n },
  { key: "LIQUIDITY", total: M(21.5), tge: M(3.5), cliff: 0n, vest: 48n },
  { key: "TEAM", total: M(10), tge: 0n, cliff: 12n, vest: 36n },
  { key: "TREASURY", total: M(16.2), tge: M(2), cliff: 0n, vest: 48n },
  { key: "FOUNDER_OPS", total: M(1.8), tge: 0n, cliff: 0n, vest: 36n },
  { key: "AIRDROPS", total: M(5), tge: M(5), cliff: 0n, vest: 6n },
];

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log(`\nConnecting to Vesting at ${VESTING_ADDR}...`);
  const vesting = await ethers.getContractAt("ZenthisVesting", VESTING_ADDR);
  const token = await ethers.getContractAt("ZenthisToken", TOKEN_ADDR);

  console.log(
    `Vesting balance: ${ethers.formatEther(await token.balanceOf(VESTING_ADDR))} ZENTHIS`,
  );
  console.log(`Existing schedules: ${(await vesting.getScheduleIds()).length}`);
  console.log(`TGE: ${new Date(Number(TGE) * 1000).toISOString()}\n`);

  for (const s of SCHEDULES) {
    const id = await vesting[s.key]();

    // Check if schedule already exists
    try {
      const existing = await vesting.getSchedule(id);
      if (existing.initialized) {
        console.log(`   ⏭  ${s.key.padEnd(10)} already exists — skipping`);
        continue;
      }
    } catch (e) {}

    // For testnet, all wallets go to deployer
    const tx = await vesting.createSchedule(
      id,
      deployer.address,
      s.total,
      s.tge,
      TGE,
      s.cliff,
      s.vest,
    );
    const receipt = await tx.wait();
    console.log(
      `   ✓ ${s.key.padEnd(12)}` +
        ` vest=${ethers.formatEther(s.total).padStart(14)}` +
        ` TGE=${ethers.formatEther(s.tge).padStart(12)}` +
        ` cliff=${s.cliff}mo vest=${s.vest}mo` +
        `  gas=${receipt.gasUsed}`,
    );
  }

  console.log(`\n✅ Done! ${(await vesting.getScheduleIds()).length} schedules created.`);
}

main().catch((err) => {
  console.error("\n❌", err.message);
  process.exit(1);
});
