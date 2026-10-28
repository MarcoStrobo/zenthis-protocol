// Check presale funding status
const { ethers } = require("hardhat");
async function main() {
  const [deployer] = await ethers.getSigners();
  const token = await ethers.getContractAt(
    "ZenthisToken",
    "0xCFAeB3678DbC479e26Fd87C2cA7eD0a264f1F6a6",
  );
  const presaleAddr = "0x50425684634F9AF37D1dE14Bb1140057C421b656";

  const deployerBal = await token.balanceOf(deployer.address);
  const presaleBal = await token.balanceOf(presaleAddr);
  const required = await ethers
    .getContractAt("ZenthisPresale", presaleAddr)
    .then((c) => c.getRequiredZts());

  console.log(`Deployer ZTS: ${ethers.formatEther(deployerBal)}`);
  console.log(`Presale ZTS: ${ethers.formatEther(presaleBal)}`);
  console.log(`Required ZTS: ${ethers.formatEther(required)}`);

  if (presaleBal < required) {
    console.log(`\n⚠️  Presale underfunded by ${ethers.formatEther(required - presaleBal)} ZTS`);
    if (deployerBal >= required - presaleBal) {
      console.log("\nFunding presale...");
      const tx = await token.transfer(presaleAddr, required - presaleBal);
      const r = await tx.wait();
      console.log(`✅ Funded! Tx: ${r.hash}`);
    }
  } else {
    console.log("✅ Presale fully funded");
  }

  const deployerEth = await ethers.provider.getBalance(deployer.address);
  console.log(`\nDeployer ETH remaining: ${ethers.formatEther(deployerEth)}`);
}

main().catch((e) => console.error(e));
