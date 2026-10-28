const { ethers } = require("hardhat");

const TOKEN = "0xCFAeB3678DbC479e26Fd87C2cA7eD0a264f1F6a6";
const ADDRS = [
  ["Deployer", "0x80a662887A616D09cFc5079005164c6f6EDDFe13"],
  ["Presale", "0x50425684634F9AF37D1dE14Bb1140057C421b656"],
  ["Liquidity", "0xaa6D1BEc62a324bAa8E1cC284e85D70484F3EBaC"],
  ["Treasury", "0xe1985d3f16714d202579CF758C9cFd3386bb6FA9"],
  ["Wallet Seed", "0x17eCC2493f15c7b8265889aC3f44D4b5aE1D0665"],
  ["Wallet Team", "0xebCc4B9b3417a5a818590fc0cb2A99478C2E8C79"],
  ["Wallet Founder", "0x47B4e2E8E413FA8444383A83ABDbbc9F370aA269"],
  ["Wallet Airdrop", "0x9E47207cFD0A15a863A2a28E664bb49801d5Ad7A"],
  ["Wallet IDO", "0xA8172F86764c34381371B950E4982ab62Cf91D86"],
  ["MultiSig", "0xf9C31EBAEFED9b3103bB3A19f20172A55fdEB01A"],
];

async function main() {
  const token = await ethers.getContractAt("ZenthisToken", TOKEN);
  let total = 0n;
  console.log("ZTS BALANCES ON BASE:");
  for (const [name, addr] of ADDRS) {
    const bal = await token.balanceOf(addr);
    console.log(`  ${name.padEnd(14)} ${addr} → ${ethers.formatEther(bal)} ZTS`);
    total += bal;
  }
  console.log("───");
  console.log(`  Total tracked: ${ethers.formatEther(total)} / 100,000,000 ZTS`);
  const supply = await token.totalSupply();
  console.log(`  Supply:        ${ethers.formatEther(supply)} ZTS`);
  if (supply > total) console.log(`  Missing:       ${ethers.formatEther(supply - total)} ZTS`);
}

main().catch(console.error);
