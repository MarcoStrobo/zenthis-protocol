const { ethers } = require("ethers");

const wallet = ethers.Wallet.createRandom();

console.log("# ── Generated Deployer Wallet ──");
console.log(`DEPLOYER_PRIVATE_KEY=${wallet.privateKey}`);
console.log(`DEPLOYER_ADDRESS=${wallet.address}`);
console.log("");
console.log("# Fund this wallet with Sepolia ETH at:");
console.log("#   https://sepoliafaucet.com");
console.log("#   https://www.alchemy.com/faucets/ethereum-sepolia");
console.log("");
console.log("# Public Sepolia RPCs (no signup needed):");
console.log("#   https://rpc.sepolia.org");
console.log("#   https://ethereum-sepolia-rpc.publicnode.com");
