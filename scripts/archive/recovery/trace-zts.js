const { ethers } = require("hardhat");

const TOKEN = "0xCFAeB3678DbC479e26Fd87C2cA7eD0a264f1F6a6";
const DEPLOYER = "0x80a662887A616D09cFc5079005164c6f6EDDFe13";
const PRESALE = "0x50425684634F9AF37D1dE14Bb1140057C421b656";
const KNOWN = [
  DEPLOYER,
  PRESALE,
  "0xaa6D1BEc62a324bAa8E1cC284e85D70484F3EBaC",
  "0xe1985d3f16714d202579CF758C9cFd3386bb6FA9",
];

async function main() {
  const token = await ethers.getContractAt("ZenthisToken", TOKEN);
  const supply = await token.totalSupply();
  const deployerBal = await token.balanceOf(DEPLOYER);
  const presaleBal = await token.balanceOf(PRESALE);
  const accounted = deployerBal + presaleBal;

  console.log(`Supply:    ${ethers.formatEther(supply)}`);
  console.log(`Deployer:  ${ethers.formatEther(deployerBal)}`);
  console.log(`Presale:   ${ethers.formatEther(presaleBal)}`);
  console.log(`Accounted: ${ethers.formatEther(accounted)}`);
  console.log(`Missing:   ${ethers.formatEther(supply - accounted)}`);

  // The deployer token balance was at 100M at mint.
  // 20.3M sent to presale. 65.637M remaining.
  // 100 - 20.3 - 65.637 = 14.063M unaccounted.
  // Let me check the deployer's internal transactions to find where 14M went.

  // Check if deployer has approved any spender
  for (const spender of [
    PRESALE,
    "0xf9C31EBAEFED9b3103bB3A19f20172A55fdEB01A", // multisig
    "0x0000000000000000000000000000000000000001",
    "0x0000000000000000000000000000000000000002",
  ]) {
    try {
      const allowance = await token.allowance(DEPLOYER, spender);
      if (allowance > 0n) {
        console.log(`Allowance to ${spender}: ${ethers.formatEther(allowance)}`);
      }
    } catch (e) {}
  }
}

main().catch(console.error);
