# Zenthis Protocol — Technical Whitepaper

**v1.0 — May 2026**

---

## Abstract

Zenthis is a decentralized finance protocol built on Ethereum, comprising a native ERC-20 token with integrated staking, a cross-chain atomic swap engine (HTLC), and a multi-schedule linear vesting system. The protocol is designed to serve as the economic backbone of the SolvX ecosystem, providing liquidity infrastructure, programmable token distribution, and trust-minimized cross-chain settlement.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Zenthis Protocol                      │
├───────────────┬───────────────────┬─────────────────────┤
│  ZenthisToken │   ZenthisHTLC     │   ZenthisVesting    │
│  (ERC-20)     │  (Atomic Swaps)   │  (Token Distribution)│
├───────────────┼───────────────────┼─────────────────────┤
│ • Staking     │ • ETH swaps       │ • 7 schedules       │
│ • Fee dist.   │ • ERC-20 swaps    │ • Linear vesting    │
│ • Burn        │ • sha256 hashlock │ • Cliff support     │
│ • Governance  │ • Refund mechanism│ • TGE unlock        │
│ • Permit      │ • Protocol fees   │ • Cancel/rescue     │
└───────────────┴───────────────────┴─────────────────────┘
```

The protocol consists of three smart contracts, each with a single responsibility:

| Contract | Lines | Responsibility |
|----------|-------|----------------|
| `ZenthisToken` | 177 | Token issuance, staking, fee distribution, burn |
| `ZenthisHTLC` | 242 | Hashed Time-Locked Contracts for cross-chain atomic swaps |
| `ZenthisVesting` | 237 | Programmatic token distribution with cliffs and linear vesting |

---

## 2. ZenthisToken — The Native Asset

### 2.1 Token Parameters

| Parameter | Value |
|-----------|-------|
| Name | Zenthis |
| Symbol | ZENTHIS |
| Decimals | 18 |
| Max Supply | 100,000,000 ZENTHIS |
| Standard | ERC-20 + ERC-20Permit + ERC-20Votes |
| Minting | One-time at genesis (100M) |
| Burn | Yes — any holder can burn their tokens |

The entire 100M supply is minted to a treasury address at deployment. No further minting is possible — the `MAX_SUPPLY` constant is immutable.

### 2.2 Standards Implemented

- **ERC-20**: Standard fungible token interface
- **ERC-20Permit (EIP-2612)**: Gasless approvals via signed permits
- **ERC-20Votes (EIP-5805)**: On-chain governance voting power, delegated by token balance
- **Ownable (OpenZeppelin)**: Single-owner administrative control

### 2.3 Staking Mechanism

ZENTHIS holders can stake tokens to earn protocol fees (ETH). The staking system uses a continuous reward accumulator pattern:

```
stake(amount)     → locks ZENTHIS, begins earning
unstake(amount)   → unlocks ZENTHIS, stops earning
claimRewards()    → withdraws accumulated ETH
```

**Reward Formula** (Synthetix-style accumulator):

```
rewardPerToken = accumulated ETH fees / totalStaked
earned(account) = stakedBalance × (rewardPerToken - userSnapshot) / 1e18
```

Fees are distributed via `depositFees()` (owner-only), which increases the global accumulator. Each staker's pending rewards are computed from their personal snapshot delta.

### 2.4 Fee Distribution

Protocol fees (ETH) flow through `depositFees()`:

1. Owner collects protocol revenue off-chain
2. Owner calls `depositFees{value: eth}()` on-chain
3. Accumulator updates proportionally: `rewardPerTokenStored += msg.value × 1e18 / totalStaked`
4. Stakers claim their share via `claimRewards()`

### 2.5 ETH Safety

The contract includes a `withdrawStuckETH()` function (owner-only) to recover ETH mistakenly sent outside the fee distribution mechanism.

---

## 3. ZenthisHTLC — Cross-Chain Atomic Swaps

### 3.1 Overview

The Hash Time-Locked Contract enables trust-minimized asset exchange between two parties on the same chain, or across chains when paired with a counterparty contract on another network. The protocol uses SHA-256 preimage locks for Bitcoin cross-chain compatibility.

### 3.2 Swap Lifecycle

```
                    ┌─────────────┐
                    │   ACTIVE    │
                    └──┬──────┬───┘
         preimage ✓    │      │  timelock expired
                    ┌──▼──┐ ┌─▼──────┐
                    │REDEEM│ │REFUNDED│
                    └─────┘ └────────┘
```

1. **Initiate**: Party A locks ETH or ERC-20 tokens with a SHA-256 hashlock and an expiry timelock
2. **Redeem**: Party B (or anyone) reveals the preimage → tokens transferred to Party B
3. **Refund**: After timelock expires, Party A can reclaim their locked tokens

### 3.3 Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| Hash function | SHA-256 | Bitcoin-compatible |
| Min timelock | 5 minutes | Prevents instant refunds |
| Max timelock | 2 days | Caps fund lockup duration |
| Max fee | 500 bps (5%) | Owner-configurable |
| Token support | ETH + any ERC-20 | Separate `newSwapToken()` path |
| Pausable | Yes | Emergency stop for new swaps |

### 3.4 Protocol Fees

The owner can set a fee in basis points (`feeBps`), capped at 5%. Fees are deducted at swap creation:

- **ETH swaps**: `storedAmount = msg.value - (msg.value × feeBps / 10000)`
- **ERC-20 swaps**: `storedAmount = amount - (amount × feeBps / 10000)`

Collected fees are withdrawable via `withdrawEthFees()` and `withdrawTokenFees()`.

### 3.5 Security Properties

- **Non-custodial**: The initiator controls refund; the recipient controls redeem
- **Preimage-resistant**: SHA-256 prevents preimage recovery from hashlock
- **Time-bound**: Funds unlock after timelock regardless of counterparty cooperation
- **Reentrancy-safe**: All external state-changing functions use `nonReentrant`
- **Pausable**: New swap creation can be halted in emergencies

---

## 4. ZenthisVesting — Programmatic Distribution

### 4.1 Overview

The vesting contract manages long-term token distribution across 7 stakeholder categories. Each schedule supports:

- **TGE Unlock**: Immediate token availability at TGE
- **Cliff Period**: No vesting until cliff duration elapses
- **Linear Vesting**: Continuous vesting over N months post-cliff

### 4.2 Vesting Formula

```
vested(t) =
    0                                    if t < startTime
    tgeAmount                            if t < startTime + cliff
    tgeAmount + totalAmount × elapsed / vestingDuration   if t ≥ startTime + cliff
    tgeAmount + totalAmount              if elapsed ≥ vestingDuration

where elapsed = t - (startTime + cliff)
```

### 4.3 Schedule Definitions

| Schedule ID | Beneficiary | Total + TGE | TGE % | Cliff | Vesting | Purpose |
|-------------|-------------|-------------|-------|-------|---------|---------|
| `SEED` | Seed investors | 10,000,000 | 0% | 12mo | 24mo | Early backers |
| `IDO` | Public sale | 12,000,000 | 10% | 0mo | 12mo | IDO participants |
| `LIQUIDITY` | Liquidity pools | 20,000,000 | 50% | 0mo | 6mo | DEX liquidity |
| `TEAM` | Core team | 10,000,000 | 0% | 12mo | 36mo | Team incentives |
| `TREASURY` | DAO treasury | 18,200,000 | 11% | 0mo | 48mo | Ecosystem fund |
| `FOUNDER_OPS` | Founders | 8,000,000 | 0% | 6mo | 30mo | Operations |
| `AIRDROPS` | Community | 5,000,000 | 100% | 0mo | 6mo | Marketing |
| **TOTAL** | | **83,200,000** | | | | |

Note: The remaining ~16.8M ZENTHIS is held in treasury for unallocated ecosystem needs.

### 4.4 Rescue Mechanism

The owner can call `cancelSchedule()` to recover tokens from a schedule — but **only before its `startTime`**. Once a schedule begins, tokens are irrevocably committed to the beneficiary.

### 4.5 Month Definition

The `MONTH` constant is defined as `30 days` (2,592,000 seconds). Over a 48-month schedule, this is ~5.25 calendar days shorter than actual months. This provides predictable, evenly-spaced unlocks.

---

## 5. Tokenomics

### 5.1 Supply Distribution

```
Total Supply: 100,000,000 ZENTHIS

SEED        ████████░░  10.0M  (10.0%)
IDO         █████████░  12.0M  (12.0%)   + 1.2M TGE
LIQUIDITY   ████████████████  20.0M  (20.0%)   + 10.0M TGE
TEAM        ████████░░  10.0M  (10.0%)
TREASURY    ██████████████░  18.2M  (18.2%)   + 2.0M TGE
FOUNDER_OPS ██████░░░░   8.0M   (8.0%)
AIRDROPS     ████░░░░░░   5.0M   (5.0%)    + 5.0M TGE  (100%)
Unallocated  █████████████░  16.8M  (16.8%)

TGE Unlock: 18.7M ZENTHIS (18.7% of supply)
```

### 5.2 Release Schedule (Cumulative)

```
Months after TGE    Cumulative Unlocked
─────────────────────────────────────
 0 (TGE)             18,700,000  (18.7%)
 6                   42,033,333  (42.0%)
12                   56,240,740  (56.2%)
18                   65,574,074  (65.6%)
24                   71,883,333  (71.9%)
36                   80,002,778  (80.0%)
48                   83,200,000  (83.2%)
```

### 5.3 Deflationary Mechanics

ZENTHIS includes a public `burn()` function. Any holder can permanently remove tokens from circulation, creating deflationary pressure. The `totalBurned` is not explicitly tracked on-chain (events serve this purpose), but `totalSupply()` decreases with each burn.

---

## 6. Security

### 6.1 Audit Status

An internal security audit was conducted in May 2026. **Rating: A-**.

| Severity | Findings | Status |
|----------|----------|--------|
| Critical | 0 | — |
| High | 1 | Fixed |
| Medium | 3 | 2 fixed, 1 operational |
| Low | 4 | Documented |
| Info | 5 | Noted |

See [SECURITY_AUDIT.md](./audit/SECURITY_AUDIT.md) for full details.

### 6.2 OWASP Smart Contract Top 10

All 10 OWASP categories are covered:
- Reentrancy → `nonReentrant` on all state-changing external functions
- Integer overflow → Solidity 0.8.x built-in checks
- Timestamp dependence → Only used for deadlines (≥ check, not ==)
- Access control → OpenZeppelin `Ownable` with clear privilege separation
- Front-running → No MEV-sensitive operations
- DoS → No unbounded loops
- Logic errors → Cleaned up dead code post-audit
- Randomness → Not used
- Gas limit → No unbounded arrays in transactions
- Unchecked calls → All `.call` results validated

### 6.3 Test Coverage

| Type | Count | Status |
|------|-------|--------|
| Unit tests | 153 | 100% passing |
| Integration tests | 34 | 100% passing |
| **Total** | **187** | **100% passing** |

---

## 7. Deployment

### 7.1 Sepolia Testnet

| Contract | Address |
|----------|---------|
| ZenthisToken | `0x16bD37D89d105a4FBceEB4846e20528f348F02e3` |
| ZenthisVesting | `0xD4773b69ECc47ae8EEE79E2b8869C93B13383D6A` |
| ZenthisHTLC | `0x4CE756e8A56981f27B3Ef78Ee0C876e7e2A9b649` |

All three contracts are verified on [Sepolia Etherscan](https://sepolia.etherscan.io).

### 7.2 Mainnet (Pending)

Mainnet deployment follows the same procedure. Configuration:
- Multi-sig owner (Gnosis Safe) — recommended
- TGE timestamp set to announced launch date
- Vesting wallets set to actual beneficiary addresses
- Sourcify verification enabled

---

## 8. Development

### 8.1 Repository Structure

```
Solvx/
├── contracts/          # Solidity source
│   ├── ZenthisToken.sol
│   ├── ZenthisHTLC.sol
│   └── ZenthisVesting.sol
├── test/               # Unit tests (153)
├── scripts/            # Deploy & integration
├── audit/              # Security report
├── .github/workflows/  # CI/CD
└── deployments/        # (gitignored)
```

### 8.2 CI/CD

GitHub Actions automatically runs on every push and pull request:
1. Solidity/JS lint (Prettier)
2. Compilation + unit tests (153)
3. Integration tests (34)
4. Gas report (on main branch)

### 8.3 Build

```bash
npm install
npx hardhat compile
npx hardhat test
```

---

## 9. License

MIT License — see [LICENSE](./LICENSE) file.

---

*Zenthis Protocol — Building the economic layer of SolvX.*
