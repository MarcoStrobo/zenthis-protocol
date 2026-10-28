"use strict";
/**
 * Creates a dedicated LP hot wallet, appends LP_* vars to .env (key is never printed)
 * and funds it from the deployer on testnets.
 * Usage: node lp-bot/setup-lp-wallet.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ENV = path.join(__dirname, "..", ".env");
const RPC_A = "https://sepolia.base.org";
const RPC_B = "https://sepolia-rollup.arbitrum.io/rpc";
const FUND = ethers.parseEther(process.env.LP_FUND_ETH || "0.1");

async function main() {
  if (process.env.LP_PRIVATE_KEY) throw new Error("LP_PRIVATE_KEY already set in .env");
  const lp = ethers.Wallet.createRandom();
  const htlc = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", "htlc-baseSepolia.json")),
  ).contracts.ZenthisHTLC;
  fs.appendFileSync(
    ENV,
    `\n# LP bot (testnet) — dedicated hot wallet, never reuse the deployer key\nLP_PRIVATE_KEY=${lp.privateKey}\nLP_RPC_A=${RPC_A}\nLP_RPC_B=${RPC_B}\nLP_HTLC_A=${htlc}\nLP_HTLC_B=${htlc}\n`,
  );
  console.log("LP address:", lp.address);
  for (const rpc of [RPC_A, RPC_B]) {
    const p = new ethers.JsonRpcProvider(rpc);
    const dep = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, p);
    const tx = await dep.sendTransaction({ to: lp.address, value: FUND });
    await tx.wait();
    console.log(`funded ${ethers.formatEther(FUND)} ETH on ${rpc}: ${tx.hash}`);
  }
}
main().catch((e) => {
  console.error(e.shortMessage || e.message);
  process.exit(1);
});
