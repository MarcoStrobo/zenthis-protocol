const { ethers } = require("hardhat");

const TOKEN = "0xCFAeB3678DbC479e26Fd87C2cA7eD0a264f1F6a6";
const ADDRS = [
  "0x80a662887A616D09cFc5079005164c6f6EDDFe13", // deployer
  "0x50425684634F9AF37D1dE14Bb1140057C421b656", // presale
  "0xaa6D1BEc62a324bAa8E1cC284e85D70484F3EBaC", // liquidity
  "0xe1985d3f16714d202579CF758C9cFd3386bb6FA9", // treasury
];

async function main() {
  const token = await ethers.getContractAt("ZenthisToken", TOKEN);
  let total = 0n;
  for (const a of ADDRS) {
    const bal = await token.balanceOf(a);
    console.log(`${a} → ${ethers.formatEther(bal)} ZTS`);
    total += bal;
  }
  console.log("───");
  console.log(`Total: ${ethers.formatEther(total)} ZTS`);
  console.log(`Supply: ${ethers.formatEther(await token.totalSupply())} ZTS`);
}

main().catch(console.error);
