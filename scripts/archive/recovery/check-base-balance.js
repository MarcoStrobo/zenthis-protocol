const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance : ${ethers.formatEther(bal)} ETH`);
  console.log(`Token   : ${process.env.TOKEN_ADDRESS || "not set"}`);
}

main().catch(console.error);
