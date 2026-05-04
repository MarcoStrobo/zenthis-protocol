const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  // ─── ZENTHIS Token ────────────────────────────────────────────────────────
  const ZENTHIS = await ethers.getContractFactory("ZENTHIS");
  const zenthis = await ZENTHIS.deploy(deployer.address);
  await zenthis.waitForDeployment();
  console.log("ZENTHIS deployed to:", await zenthis.getAddress());

  // ─── HTLCVault ────────────────────────────────────────────────────────────
  // Fee recipient = deployer initially. Transfer to multisig before mainnet.
  const HTLCVault = await ethers.getContractFactory("HTLCVault");
  const vault = await HTLCVault.deploy(deployer.address);
  await vault.waitForDeployment();
  console.log("HTLCVault deployed to:", await vault.getAddress());

  console.log("\n✓ Deployment complete.");
  console.log("  Next: verify on Etherscan, transfer fee recipient to multisig, run audit.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
