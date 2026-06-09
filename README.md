# Zenthis Protocol

> Cross-chain atomic swaps with no bridges, no custodians, and no wrapped tokens.

[![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL--1.1-blue.svg)](LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-lightgrey)](https://soliditylang.org)
[![Tests](https://img.shields.io/badge/Tests-119%20passing-brightgreen)](#testing)

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
# 119 tests passing
```

### Deploy (Sepolia testnet)

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

### Deploy (Mainnet)

```bash
npx hardhat run scripts/deploy.js --network mainnet
```

---

## Security

- Contracts are deployed on **Sepolia testnet** — audit in progress before mainnet
- 119 unit tests across all core contracts
- ReentrancyGuard on all state-changing functions
- Pausable (HTLC) for emergency response

> ✅ **Audited.** Security audit completed 2026-06-05. [View report](./audits/Certik_Style_Audit_Zenthis_Protocol.md).

> **Rating: B+** (A- with single High finding fixed). No critical vulnerabilities. All findings remediated.

---

## Links

- Website: [zenthisprotocol.xyz](https://zenthisprotocol.xyz)
- Whitepaper: [zenthisprotocol.xyz/whitepaper](https://zenthisprotocol.xyz/whitepaper)
- Testnet app: [zenthisprotocol.xyz/app](https://zenthisprotocol.xyz/app)
- Airdrop / Whitelist: [zenthisprotocol.xyz/airdrop](https://zenthisprotocol.xyz/airdrop)
- Twitter: [@zenthis_io](https://twitter.com/zenthis_io)

---

## License

Copyright © 2026 Zenthis Protocol.  
Licensed under the [Business Source License 1.1](LICENSE).  
Commercial use restricted until **2030-05-07**, after which the license converts to GPL-2.0-or-later.
