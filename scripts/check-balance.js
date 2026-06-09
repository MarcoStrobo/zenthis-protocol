const { ethers } = require("ethers");

async function main() {
  const provider = new ethers.JsonRpcProvider("https://ethereum-sepolia-rpc.publicnode.com");
  const addr = "0xBa54cfa02D491cf0f07edFea3fcD00ED8Af9Ac5a";

  try {
    const balance = await provider.getBalance(addr);
    console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
    if (balance === 0n) {
      console.log("\n❌ Wallet has 0 ETH. Fund it at:");
      console.log("   https://sepoliafaucet.com");
      console.log("   https://www.alchemy.com/faucets/ethereum-sepolia");
    } else {
      console.log(`\n✅ Wallet funded! Ready to deploy.`);
    }
  } catch (err) {
    console.error("RPC error:", err.message);
    console.log("Trying alternative RPC...");
    const p2 = new ethers.JsonRpcProvider("https://rpc.sepolia.org");
    const b2 = await p2.getBalance(addr);
    console.log(`Balance: ${ethers.formatEther(b2)} ETH`);
  }
}

main();
