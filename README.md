# Zenthis Protocol — SolvX Core Infrastructure

[![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL--1.1-blue.svg)](LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-lightgrey)](https://soliditylang.org)
[![Tests](https://img.shields.io/badge/Tests-187%20passing-brightgreen)](https://github.com/suko/Solvx/actions)
[![Audit](https://img.shields.io/badge/Audit-A---success)](./audit/SECURITY_AUDIT.md)
[![Whitepaper](https://img.shields.io/badge/Whitepaper-v1.0-informational)](./docs/WHITEPAPER.md)

**Zenthis** is the native token and economic backbone of the SolvX ecosystem — a decentralized protocol suite combining **staking rewards**, **cross-chain atomic swaps**, and **programmatic token vesting**.

---

## Architecture

| Contract | Role |
|----------|------|
| `ZenthisToken` | ERC-20 token (100M supply) with staking, ETH fee distribution, burn, governance |
| `ZenthisHTLC` | Hash Time-Locked Contracts for trustless cross-chain swaps (Bitcoin-compatible SHA-256) |
| `ZenthisVesting` | 7-schedule linear vesting with cliffs, TGE unlocks, and cancel/rescue logic |

---

## Quick Start

### Prerequisites

```bash
node >= 18
npm install
```

### Compile

```bash
npx hardhat compile
```

### Test

```bash
npx hardhat test
# 187 tests passing (153 unit + 34 integration)
```

### Deploy (Sepolia testnet)

```bash
cp .env.example .env   # fill in your keys
npx hardhat run scripts/deploy.js --network sepolia
```

---

## Security

- ✅ **Internal audit** — Rating A-. [Full report](./audit/SECURITY_AUDIT.md)
- ✅ **187 tests** (153 unit + 34 integration) — 100% passing
- ✅ **Sepolia verified** — All 3 contracts on Etherscan
- ReentrancyGuard on all state-changing functions
- Pausable (HTLC) for emergency response
- All OWASP Smart Contract Top 10 categories covered

> ⚠️ External audit pending. Do not deploy to mainnet until the external audit is complete.

---

## Docs

| Document | Description |
|----------|-------------|
| [Whitepaper](./docs/WHITEPAPER.md) | Technical protocol specification (v1.0) |
| [Audit Report](./audit/SECURITY_AUDIT.md) | Internal security audit (May 2026) |

---

## License

Business Source License 1.1 — See [LICENSE](LICENSE).
