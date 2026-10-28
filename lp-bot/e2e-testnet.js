"use strict";
/**
 * End-to-end atomic swap on testnets: Base Sepolia (A) -> Arbitrum Sepolia (B).
 * Deployer acts as the user, the LP wallet from .env runs the bot in-process.
 * Usage: node lp-bot/e2e-testnet.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ethers } = require("ethers");
const { LpBot } = require("./LpBot");

const ABI = [
  "function newSwap(address recipient, bytes32 hashlock, uint256 timelock) payable returns (bytes32)",
  "function redeem(bytes32 swapId, bytes32 preimage)",
  "function refund(bytes32 swapId)",
  "function isActive(bytes32 swapId) view returns (bool)",
  "function getSwap(bytes32 swapId) view returns (tuple(address initiator,address recipient,address token,uint256 amount,bytes32 hashlock,uint256 timelock,uint8 status))",
  "event SwapCreated(bytes32 indexed swapId, address indexed initiator, address indexed recipient, address token, uint256 amount, bytes32 hashlock, uint256 timelock)",
  "event SwapRedeemed(bytes32 indexed swapId, bytes preimage)",
  "event SwapRefunded(bytes32 indexed swapId)",
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AMOUNT = ethers.parseEther(process.env.E2E_AMOUNT_ETH || "0.01");

async function main() {
  const pA = new ethers.JsonRpcProvider(process.env.LP_RPC_A);
  const pB = new ethers.JsonRpcProvider(process.env.LP_RPC_B);
  const user = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY);
  const lp = new ethers.Wallet(process.env.LP_PRIVATE_KEY);
  const userA = new ethers.Contract(process.env.LP_HTLC_A, ABI, user.connect(pA));
  const userB = new ethers.Contract(process.env.LP_HTLC_B, ABI, user.connect(pB));

  let data = {};
  const bot = new LpBot({
    htlcA: new ethers.Contract(process.env.LP_HTLC_A, ABI, lp.connect(pA)),
    htlcB: new ethers.Contract(process.env.LP_HTLC_B, ABI, lp.connect(pB)),
    lpAddress: lp.address,
    state: { load: () => data, save: (d) => (data = d) },
    config: { confirmations: 1, maxAmount: ethers.parseEther("0.1") },
    log: (m) => console.log("  [bot]", m),
  });

  const preimage = ethers.hexlify(ethers.randomBytes(32));
  const hashlock = ethers.sha256(preimage);
  const now = (await pA.getBlock("latest")).timestamp;
  const balB0 = await pB.getBalance(user.address);

  console.log(
    `1. User locks ${ethers.formatEther(AMOUNT)} ETH on Base Sepolia -> LP ${lp.address}`,
  );
  const startBlock = await pA.getBlockNumber();
  data.cursorA = startBlock - 1;
  const tx = await userA.newSwap(lp.address, hashlock, now + 2 * 3600, { value: AMOUNT });
  const rc = await tx.wait();
  const idA = rc.logs.map((l) => userA.interface.parseLog(l)).find((e) => e?.name === "SwapCreated")
    .args.swapId;
  console.log("   swapId A:", idA, "tx", tx.hash);

  console.log("2. Waiting for the bot to lock on Arbitrum Sepolia…");
  let rec;
  for (let i = 0; i < 40 && !(rec = data.swaps?.[idA])?.idB; i++) {
    await bot.tick();
    if (rec?.status === "rejected" || rec?.status === "failed")
      throw new Error("bot: " + rec.reason);
    await sleep(3000);
  }
  if (!rec?.idB) throw new Error("bot did not lock in time");
  console.log("   swapId B:", rec.idB, "amountB", ethers.formatEther(rec.amountB));

  console.log("3. User redeems on B (reveals preimage)");
  for (let i = 1; ; i++) {
    try {
      await (await userB.redeem(rec.idB, preimage)).wait();
      break;
    } catch (e) {
      console.log(
        `   redeem attempt ${i} failed:`,
        e.code,
        e.info?.error?.message || e.shortMessage || e.message,
      );
      if (i >= 6) throw e;
      await sleep(5000);
    }
  }
  const gained = (await pB.getBalance(user.address)) - balB0;
  console.log("   user B balance change (incl. gas):", ethers.formatEther(gained));

  console.log("4. Waiting for the bot to redeem on A…");
  for (let i = 0; i < 40 && data.swaps[idA].status !== "completed"; i++) {
    await bot.tick();
    await sleep(3000);
  }
  const final = await userA.getSwap(idA);
  console.log(
    "   bot status:",
    data.swaps[idA].status,
    "| A swap on-chain status:",
    Number(final.status),
    "(2 = redeemed)",
  );
  if (data.swaps[idA].status !== "completed" || Number(final.status) !== 2) process.exit(1);
  console.log("\nE2E OK: atomic swap completed on both chains.");
}
main().catch((e) => {
  console.error("E2E FAILED:", e.shortMessage || e.message);
  process.exit(1);
});
