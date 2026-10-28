/**
 * bridge-sepolia.js — Move Sepolia ETH to an L2 testnet via the official bridges.
 *
 * Usage (PowerShell):
 *   $env:BRIDGE_TARGET="base"; $env:BRIDGE_AMOUNT="0.02"; npx hardhat run scripts/bridge-sepolia.js --network sepolia
 *   $env:BRIDGE_TARGET="arbitrum"; ...
 *
 * base     -> L1StandardBridge depositETH(minGasLimit, extraData)
 * arbitrum -> Inbox.depositEth() (credits the sender address on L2)
 */
const { ethers } = require("hardhat");

const TARGETS = {
  base: {
    to: "0xfd0Bf71F60660E2f608ed56e1659C450eB113120",
    data: new ethers.Interface([
      "function depositETH(uint32 minGasLimit, bytes extraData) payable",
    ]).encodeFunctionData("depositETH", [200000, "0x"]),
  },
  arbitrum: {
    to: "0xaAe29B0366299461418F5324a79Afc425BE5ae21",
    data: new ethers.Interface(["function depositEth() payable"]).encodeFunctionData("depositEth"),
  },
};

async function main() {
  const target = process.env.BRIDGE_TARGET;
  const amount = process.env.BRIDGE_AMOUNT;
  if (!TARGETS[target] || !amount)
    throw new Error("Set BRIDGE_TARGET=base|arbitrum and BRIDGE_AMOUNT");
  const [signer] = await ethers.getSigners();
  const value = ethers.parseEther(amount);
  const bal = await ethers.provider.getBalance(signer.address);
  console.log(`${signer.address} Sepolia balance ${ethers.formatEther(bal)} ETH`);
  if (bal < value) throw new Error("Insufficient Sepolia balance");
  const tx = await signer.sendTransaction({
    to: TARGETS[target].to,
    data: TARGETS[target].data,
    value,
    gasLimit: target === "base" ? 1000000n : 200000n,
  });
  console.log(`Bridging ${amount} ETH to ${target}: ${tx.hash}`);
  await tx.wait();
  console.log("Confirmed on Sepolia. L2 credit arrives in ~1-15 min.");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
