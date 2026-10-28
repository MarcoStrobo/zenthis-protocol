# Zenthis LP bot

Liquidity provider for `ZenthisHTLC` atomic swaps, native ETH on chain A to native ETH on chain B.

## Flow
1. User locks on A: `recipient = LP`, `hashlock = sha256(preimage)`, timelock `TA`.
2. Bot locks on B for the user: same hashlock, `TB = TA - 1h`, amount = net A x (1 - spread).
3. User redeems on B, revealing the preimage on-chain.
4. Bot reads the preimage and redeems on A.
5. If the user never redeems, bot refunds its own B lock after `TB`.

If the bot goes offline or the B lock fails, the user refunds on A after `TA`. Nobody can lose funds.

## Run (testnet first)
Add to `.env` (use a **dedicated hot wallet**, never the deployer key):

```
LP_PRIVATE_KEY=0x...
LP_RPC_A=https://sepolia.base.org
LP_RPC_B=https://sepolia-rollup.arbitrum.io/rpc
LP_HTLC_A=0x...            # ZenthisHTLC on chain A
LP_HTLC_B=0x...            # ZenthisHTLC on chain B
LP_START_BLOCK_A=...       # block of the HTLC A deployment
# optional
LP_SPREAD_BPS=30           # 0.30 %
LP_MIN_ETH=0.001
LP_MAX_ETH=0.1
LP_MAX_EXPOSURE_ETH=0.5
LP_CONFIRMATIONS=2
LP_POLL_MS=15000
LP_MIN_BALANCE_B_ETH=0.02   # alert when the LP balance on chain B drops below this
LP_ALERT_WEBHOOK=https://ntfy.sh/your-private-topic   # optional, free; any URL accepting a JSON POST
```

```bash
node lp-bot/index.js
```

State is stored in `lp-bot/state.json` (git-ignored). Fund the wallet on chain B with at least `LP_MAX_EXPOSURE_ETH` plus gas, and a little on chain A for gas.

## Run at login (free, Windows)

```powershell
powershell -ExecutionPolicy Bypass -File lp-bot\install-windows-task.ps1
Start-ScheduledTask -TaskName ZenthisLpBot
```

The task restarts the bot if it stops. Remove it with `Unregister-ScheduledTask -TaskName ZenthisLpBot -Confirm:$false`.

## Alerts

The bot logs and optionally POSTs a message to `LP_ALERT_WEBHOOK` when it cannot lock on B, misses a redeem window on A, or the B balance falls below `LP_MIN_BALANCE_B_ETH` (throttled to once per hour).

## Guards
min/max amount, open-exposure cap, hashlock reuse, minimum remaining time on A (90 min), safety margin TA - TB (60 min).

## Limits (v1)
- Native ETH only. ERC-20 and Bitcoin legs are not implemented.
- The user receives on B at the same address they used on A (EOAs only; smart-contract wallets may differ per chain).
- Single LP, fixed spread, no price oracle (valid for ETH to ETH).
