const { ethers } = require("hardhat");

async function main() {
  const tx = await ethers.provider.getTransaction(
    "0x9afeef5a89d3c29e93c32daf2eb8284fe04f6d32a2d2de5ac2b30efc18a99065",
  );
  console.log("To:", tx.to);
  console.log("From:", tx.from);
  console.log("Data:", tx.data);

  // Decode function selector
  const data = tx.data;
  const sel = data.slice(0, 10);

  // Calculate transfer() selector
  const transferSel = ethers.id("transfer(address,uint256)").slice(0, 10);
  console.log(`\nSelector: ${sel}`);
  console.log(`transfer(): ${transferSel}`);

  // Check if this was a transfer call
  if (sel === transferSel) {
    const toAddr = "0x" + data.slice(34, 74);
    const amount = ethers.toBigInt("0x" + data.slice(74));
    console.log(`\nThis is transfer(to=${toAddr}, amount=${ethers.formatEther(amount)})`);
  }
}

main().catch(console.error);
