const { ethers } = require("hardhat");
const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY);
console.log("Deployer address:", wallet.address);
console.log("Balance check: npx hardhat run scripts/check-balance.js --network arbitrumOne");
