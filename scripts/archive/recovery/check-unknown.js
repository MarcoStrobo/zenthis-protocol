const { ethers } = require("hardhat");

const TOKEN = "0xCFAeB3678DbC479e26Fd87C2cA7eD0a264f1F6a6";
const DEPLOYER = "0x80a662887A616D09cFc5079005164c6f6EDDFe13";
const ADDR = "0xb1998cb0e9f0c1e548d52dbeca85d23639cf5eef";

async function main() {
  const token = await ethers.getContractAt("ZenthisToken", TOKEN);
  const bal = await token.balanceOf(ADDR);
  console.log(`${ADDR}: ${ethers.formatEther(bal)} ZTS`);

  const deployerBal = await token.balanceOf(DEPLOYER);
  console.log(`Deployer: ${ethers.formatEther(deployerBal)} ZTS`);

  const presaleBal = await token.balanceOf("0x50425684634F9AF37D1dE14Bb1140057C421b656");
  console.log(`Presale:  ${ethers.formatEther(presaleBal)} ZTS`);

  const total = deployerBal + presaleBal + bal;
  const supply = await token.totalSupply();
  console.log(`---`);
  console.log(`Sum:      ${ethers.formatEther(total)} ZTS`);
  console.log(`Supply:   ${ethers.formatEther(supply)} ZTS`);
  if (total < supply)
    console.log(`Remaining: ${ethers.formatEther(supply - total)} ZTS (lost or burned)`);
}

main().catch(console.error);
