const hre = require("hardhat");
const { ethers } = hre;

const TOKEN_ADDR = "0xCFAeB3678DbC479e26Fd87C2cA7eD0a264f1F6a6";
const SAFE_ADDR = "0x06C691900069c44B0c312179Fc1AfeAdc71Bc717";

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();

  console.log("\n" + "═".repeat(60));
  console.log("  🔑 TRANSFER TOKEN OWNERSHIP → SAFE");
  console.log("═".repeat(60));
  console.log(`  Token : ${TOKEN_ADDR}`);
  console.log(`  From  : ${deployerAddr}`);
  console.log(`  To    : ${SAFE_ADDR}`);
  console.log("═".repeat(60));

  // Check current owner
  const token = await ethers.getContractAt("ZenthisToken", TOKEN_ADDR, deployer);
  const currentOwner = await token.owner();
  console.log(`\n  Current owner: ${currentOwner}`);

  if (currentOwner.toLowerCase() === SAFE_ADDR.toLowerCase()) {
    console.log("  ✅ Already owned by Safe — nothing to do.");
    return;
  }

  // Transfer
  console.log(`\n  🚀 Transferring ownership to Safe...`);
  const tx = await token.transferOwnership(SAFE_ADDR);
  await tx.wait();
  console.log(`  ✅ Done!`);
  console.log(`  TX: ${tx.hash}`);

  // Verify
  const newOwner = await token.owner();
  console.log(`  New owner: ${newOwner}`);
  console.log(`  Match: ${newOwner.toLowerCase() === SAFE_ADDR.toLowerCase() ? "✅" : "❌"}`);
}

main().catch((err) => {
  console.error("\n❌ FAILED:", err.message || err);
  process.exit(1);
});
