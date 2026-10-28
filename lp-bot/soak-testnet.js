"use strict";
/**
 * Soak test against a RUNNING lp-bot (node lp-bot/index.js), Base Sepolia -> Arbitrum Sepolia.
 * Deployer acts as N users: locks N swaps on A in parallel, redeems each LP lock on B,
 * then waits until every swap on A is redeemed by the bot.
 * Usage: node lp-bot/soak-testnet.js [count] [amountEth]
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ethers } = require("ethers");

const ABI = [
  "function newSwap(address recipient, bytes32 hashlock, uint256 timelock) payable returns (bytes32)",
  "function redeem(bytes32 swapId, bytes32 preimage)",
  "function getSwap(bytes32 swapId) view returns (tuple(address initiator,address recipient,address token,uint256 amount,bytes32 hashlock,uint256 timelock,uint8 status))",
  "event SwapCreated(bytes32 indexed swapId, address indexed initiator, address indexed recipient, address token, uint256 amount, bytes32 hashlock, uint256 timelock)",
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const N = Number(process.argv[2] || 5);
const AMOUNT = ethers.parseEther(process.argv[3] || "0.002");

async function main() {
  const pA = new ethers.JsonRpcProvider(process.env.LP_RPC_A);
  const pB = new ethers.JsonRpcProvider(process.env.LP_RPC_B);
  const user = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY);
  const lp = new ethers.Wallet(process.env.LP_PRIVATE_KEY).address;
  const nonceA = await pA.getTransactionCount(user.address);
  const A = new ethers.Contract(process.env.LP_HTLC_A, ABI, user.connect(pA));
  const B = new ethers.Contract(process.env.LP_HTLC_B, ABI, user.connect(pB));
  const t0 = Date.now();
  const now = (await pA.getBlock("latest")).timestamp;

  const swaps = Array.from({ length: N }, () => {
    const preimage = ethers.hexlify(ethers.randomBytes(32));
    return { preimage, hashlock: ethers.sha256(preimage) };
  });

  console.log(`Locking ${N} swaps of ${ethers.formatEther(AMOUNT)} ETH on A in parallel…`);
  await Promise.all(
    swaps.map(async (s, i) => {
      const tx = await A.newSwap(lp, s.hashlock, now + 2 * 3600, {
        value: AMOUNT,
        nonce: nonceA + i,
      });
      const rc = await tx.wait();
      s.idA = rc.logs
        .map((l) => A.interface.parseLog(l))
        .find((e) => e?.name === "SwapCreated").args.swapId;
    }),
  );
  console.log(`  locked in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const fromB = (await pB.getBlockNumber()) - 50;
  console.log("Waiting for the bot to lock on B, then redeeming…");
  for (const s of swaps) {
    for (let i = 0; i < 80 && !s.idB; i++) {
      const evs = await B.queryFilter(B.filters.SwapCreated(null, null, user.address), fromB);
      const m = evs.find((e) => e.args.hashlock === s.hashlock);
      if (m) s.idB = m.args.swapId;
      else await sleep(5000);
    }
    if (!s.idB) throw new Error("bot never locked on B for " + s.idA);
    for (let k = 1; ; k++) {
      try {
        await (await B.redeem(s.idB, s.preimage)).wait();
        break;
      } catch (e) {
        if (k >= 5) throw e;
        await sleep(4000);
      }
    }
    console.log(`  redeemed on B: ${s.idB.slice(0, 10)}…`);
  }

  console.log("Waiting for the bot to redeem all on A…");
  for (let i = 0; i < 80; i++) {
    const st = await Promise.all(swaps.map(async (s) => Number((await A.getSwap(s.idA)).status)));
    const done = st.filter((x) => x === 2).length;
    console.log(`  ${done}/${N} redeemed on A`);
    if (done === N) {
      console.log(`\nSOAK OK: ${N} swaps completed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      return;
    }
    await sleep(5000);
  }
  throw new Error("not all swaps were redeemed on A in time");
}
main().catch((e) => {
  console.error("SOAK FAILED:", e.shortMessage || e.message);
  process.exit(1);
});
