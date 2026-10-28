"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { LpBot } = require("./LpBot");

const ABI = [
  "function newSwap(address recipient, bytes32 hashlock, uint256 timelock) payable returns (bytes32)",
  "function redeem(bytes32 swapId, bytes32 preimage)",
  "function refund(bytes32 swapId)",
  "function isActive(bytes32 swapId) view returns (bool)",
  "event SwapCreated(bytes32 indexed swapId, address indexed initiator, address indexed recipient, address token, uint256 amount, bytes32 hashlock, uint256 timelock)",
  "event SwapRedeemed(bytes32 indexed swapId, bytes preimage)",
  "event SwapRefunded(bytes32 indexed swapId)",
];

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var ${name} (see lp-bot/README.md)`);
    process.exit(1);
  }
  return v;
}

function fileState(file) {
  return {
    load: () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}),
    save: (d) => fs.writeFileSync(file, JSON.stringify(d, null, 2)),
  };
}

async function main() {
  const provA = new ethers.JsonRpcProvider(need("LP_RPC_A"));
  const provB = new ethers.JsonRpcProvider(need("LP_RPC_B"));
  // Dedicated hot wallet. NEVER reuse DEPLOYER_PRIVATE_KEY here.
  const wallet = new ethers.Wallet(need("LP_PRIVATE_KEY"));
  const htlcA = new ethers.Contract(need("LP_HTLC_A"), ABI, wallet.connect(provA));
  const htlcB = new ethers.Contract(need("LP_HTLC_B"), ABI, wallet.connect(provB));

  const cfg = {};
  if (process.env.LP_SPREAD_BPS) cfg.spreadBps = BigInt(process.env.LP_SPREAD_BPS);
  if (process.env.LP_MIN_ETH) cfg.minAmount = ethers.parseEther(process.env.LP_MIN_ETH);
  if (process.env.LP_MAX_ETH) cfg.maxAmount = ethers.parseEther(process.env.LP_MAX_ETH);
  if (process.env.LP_MAX_EXPOSURE_ETH)
    cfg.maxOpenExposure = ethers.parseEther(process.env.LP_MAX_EXPOSURE_ETH);
  if (process.env.LP_CONFIRMATIONS) cfg.confirmations = Number(process.env.LP_CONFIRMATIONS);

  if (process.env.LP_MIN_BALANCE_B_ETH)
    cfg.minBalanceB = ethers.parseEther(process.env.LP_MIN_BALANCE_B_ETH);

  // Optional alerts: POST the message to any webhook (ntfy.sh topic, Discord/Slack-style URL).
  const hook = process.env.LP_ALERT_WEBHOOK;
  const alert = (msg) => {
    console.error(new Date().toISOString(), "[ALERT]", msg);
    if (!hook) return;
    fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `Zenthis LP: ${msg}`, text: `Zenthis LP: ${msg}` }),
    }).catch((e) => console.error("alert webhook failed:", e.message));
  };

  // Gasless-claim mailbox (ntfy.sh topic shared with the web app). One cursor per bot.
  const relayUrl = process.env.LP_RELAY_URL;
  const mkRelay = () => {
    if (!relayUrl) return null;
    let since = "30m";
    return {
      async claims() {
        const res = await fetch(`${relayUrl}/json?poll=1&since=${since}`);
        if (!res.ok) throw new Error(`relay HTTP ${res.status}`);
        const out = [];
        for (const line of (await res.text()).split("\n").filter(Boolean)) {
          const ev = JSON.parse(line);
          if (ev.time) since = String(ev.time);
          if (ev.event === "message") {
            try {
              out.push(JSON.parse(ev.message));
            } catch {}
          }
        }
        return out;
      },
    };
  };

  const mk = (A, B, file, tag) =>
    new LpBot({
      htlcA: A,
      htlcB: B,
      lpAddress: wallet.address,
      state: fileState(path.join(__dirname, file)),
      config: cfg,
      alert,
      relay: mkRelay(),
      log: (m) => console.log(new Date().toISOString(), `[${tag}]`, m),
    });

  // Bidirectional: A->B and B->A, in the same process. Ticks run one after another
  // so the shared LP wallet never sends two transactions on one chain at once.
  const bots = [mk(htlcA, htlcB, process.env.LP_STATE_FILE || "state.json", "A>B")];
  if (process.env.LP_BIDIRECTIONAL !== "0") {
    bots.push(mk(htlcB, htlcA, "state-reverse.json", "B>A"));
  }

  const pollMs = Number(process.env.LP_POLL_MS || 15_000);
  console.log(
    `LP ${wallet.address} | A=${await htlcA.getAddress()} B=${await htlcB.getAddress()} | routes=${bots.length}`,
  );
  console.log(
    `balances A=${ethers.formatEther(await provA.getBalance(wallet.address))} B=${ethers.formatEther(
      await provB.getBalance(wallet.address),
    )}`,
  );

  for (;;) {
    try {
      for (const bot of bots) await bot.tick();
    } catch (e) {
      console.error(new Date().toISOString(), "tick error:", e.shortMessage || e.message);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

main();
