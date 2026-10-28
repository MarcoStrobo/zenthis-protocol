# Zenthis Protocol

> Cross-chain atomic swaps with no bridges, no custodians, and no wrapped tokens.

[![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL--1.1-blue.svg)](LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-lightgrey)](https://soliditylang.org)
[![Tests](https://img.shields.io/badge/Tests-263%20passing-brightgreen)](#testing)

---

## How It Works

Zenthis uses **Hash Time-Lock Contracts (HTLCs)** to enable trustless cross-chain swaps.

1. **Lock** — Initiator locks tokens on Chain A with a cryptographic hashlock + timelock
2. **Match** — Counterparty locks equivalent tokens on Chain B using the same hash
3. **Reveal** — Initiator reveals the preimage, both sides settle atomically
4. **Timeout** — If either side fails, both locks auto-refund. Nobody loses anything.

No bridge. No wrapped tokens. No custodian. Not even us.

---

## Contracts

| Contract | Description |
|----------|-------------|
| `ZenthisToken.sol` | ERC-20 with staking, ETH fee distribution, ERC20Votes, ERC20Permit |
| `ZenthisHTLC.sol` | Cross-chain atomic swap engine (ETH + ERC-20, protocol fees) |
| `ZenthisVesting.sol` | Multi-schedule linear vesting with cliff and TGE unlock |
| `ZenthisPresale.sol` | ETH presale with whitelist phases and bonus pool (deployed on Base, not yet funded/launched) |

**License:** [BUSL-1.1](LICENSE) — commercial use restricted until 2030-05-07, then GPL-2.0-or-later.

---

## Tokenomics

| Allocation | Tokens | TGE Unlock | Cliff | Linear Vesting |
|-----------|--------|-----------|-------|---------------|
| Seed | 10 M | 0% | 6 mo | 24 months |
| IDO (Public Sale) | 25 M | 20% | — | 18 months |
| Liquidity & Reserves | 25 M | 14% | — | 48 months |
| Team | 10 M | 0% | 12 mo | 36 months |
| Treasury | 20 M | 15% | — | 48 months |
| Airdrops | 10 M | 100% | — | — |
| **Total** | **100 M** | | | |

IDO price: **$0.10 USDC** | Hard cap: **$2,000,000**

---

## Development

### Prerequisites

```bash
node >= 18
npm install
cp .env.example .env   # fill in your keys
```

### Testing

```bash
npx hardhat test
# 263 tests passing (unit, fuzz, invariant, two-chain atomic swap simulation, LP bot)
```

### Deploy

```bash
# Single-chain HTLC deploy (sets fee to 0.20 % and verifies on the explorer)
npx hardhat run scripts/deploy-htlc-only.js --network baseSepolia
npx hardhat run scripts/deploy-htlc-only.js --network arbitrumSepolia
# Other networks: ethereum, arbitrum, polygon, bsc, avalanche, base
```

Deployment records live in `deployments/`. Safe (multisig) and ownership helpers are in `scripts/ops/`.

---

## Atomic swap testnet

`ZenthisHTLC` is deployed and verified on:

| Network | Address |
|---------|---------|
| Base Sepolia | [`0x789b6fd580b1C507386EdCf676D5dc46D0158aea`](https://sepolia.basescan.org/address/0x789b6fd580b1C507386EdCf676D5dc46D0158aea#code) |
| Arbitrum Sepolia | [`0xC5FC2E804DFdbCf30F9DfC645fB2dD67Dea2BCf7`](https://sepolia.arbiscan.io/address/0xC5FC2E804DFdbCf30F9DfC645fB2dD67Dea2BCf7#code) |

Native ETH swaps between the two work end to end (user locks on A, LP locks on B, user redeems revealing the secret, LP redeems on A).

- **UI:** open `/app.html?testnet=1`. "My swaps" shows stored swaps, lets you claim on the destination chain or refund after expiry, and exports a backup of the swap secrets.
- **LP bot:** see [`lp-bot/README.md`](lp-bot/README.md). Run `node lp-bot/e2e-testnet.js` for a scripted end-to-end swap.
- **Bridge test ETH:** `scripts/bridge-sepolia.js` moves Sepolia ETH to Base / Arbitrum Sepolia via the official bridges.

Rule enforced by the bot and UI: the initiator's timelock must outlive the counterparty's (UI uses 2 h, LP uses TA - 1 h).

---

## Security

- `ZenthisHTLC` is on **Base Sepolia / Arbitrum Sepolia** testnets; token and presale are on Base mainnet
- 263 tests across all core contracts
- ReentrancyGuard on all state-changing functions
- Pausable (HTLC) for emergency response

> **Security reviews:** a self-conducted internal review (June 2026) and an AI-assisted review (Claude, 2026-10-28) with proof-of-concept tests: [`audit/AI_Assisted_Security_Review_2026-10-28.md`](audit/AI_Assisted_Security_Review_2026-10-28.md). Neither is an independent audit and neither was performed or endorsed by any external firm. An external audit is still pending and required before any mainnet HTLC deployment.

---

## Links

- Website: [zenthisprotocol.xyz](https://zenthisprotocol.xyz)
- Whitepaper: [zenthisprotocol.xyz/whitepaper](https://zenthisprotocol.xyz/whitepaper)
- Testnet app: [zenthisprotocol.xyz/app?testnet=1](https://zenthisprotocol.xyz/app?testnet=1)
- Twitter: [@zenthis_io](https://twitter.com/zenthis_io)

---

## License

Copyright © 2026 Zenthis Protocol.  
Licensed under the [Business Source License 1.1](LICENSE).  
Commercial use restricted until **2030-05-07**, after which the license converts to GPL-2.0-or-later.
