# Zenthis Protocol — Roadmap

**Last updated: 2026-05-21**

---

## ✅ Completed

### Phase 1 — Core Development (Q2 2026)
- [x] `ZenthisToken` — ERC-20 with staking, ETH fee distribution, burn, ERC20Permit, ERC20Votes
- [x] `ZenthisHTLC` — Hash Time-Locked Contracts for ETH + ERC-20 atomic swaps (SHA-256)
- [x] `ZenthisVesting` — 7-schedule linear vesting with cliffs, TGE, cancel/rescue
- [x] 153 unit tests (100% passing)
- [x] 34 integration tests (100% passing)
- [x] CI/CD — GitHub Actions (lint + test + gas report on push/PR)

### Phase 2 — Testnet & Security (Q2 2026)
- [x] Deploy to Sepolia testnet (3 contracts + 7 vesting schedules)
- [x] Etherscan Sepolia verification (all 3 contracts)
- [x] Internal security audit (Rating A-)
- [x] Audit fixes applied — no critical/high issues remain
- [x] Technical whitepaper v1.0
- [x] Landing page (zenthisprotocol.xyz)
- [x] Deploy scripts + local testnet tooling
- [x] `.env.example`, `.gitignore`, `.prettierrc`

---

## 🔜 In Progress

### Phase 3 — External Audit (Q2 2026)
- [ ] Submit to CertiK or Trail of Bits
- [ ] Resolve any findings
- [ ] Publish audit report publicly

### Phase 4 — Launch (Q2-Q3 2026)
- [ ] Mainnet deploy (Ethereum)
- [ ] Set up Gnosis Safe multi-sig for owner/admin keys
- [ ] Timelock controller for admin functions
- [ ] Mainnet Etherscan verification + Sourcify
- [ ] Token Generation Event (TGE)
- [ ] Add liquidity to DEX (Uniswap V3)
- [ ] CoinGecko / CoinMarketCap listing
- [ ] Public vesting dashboard

---

## 📅 Planned (Post-Launch)

### Phase 5 — Ecosystem Growth (Q3-Q4 2026)
- [ ] Bug bounty program (Immunefi)
- [ ] The Graph subgraph for on-chain data indexing
- [ ] Dune Analytics dashboard
- [ ] Governance framework (DAO)
- [ ] Telegram Mini App v2
- [ ] Mobile dApp (React Native / PWA)
- [ ] Rate limiting & DDoS protection for API endpoints

### Phase 6 — Cross-Chain Expansion (Q4 2026+)
- [ ] HTLC counterparty contracts on Bitcoin (Taproot)
- [ ] Solana / Polygon / Arbitrum deployments
- [ ] Cross-chain liquidity aggregator
- [ ] MEV protection for atomic swaps

---

## 📊 Key Metrics

| Metric | Value |
|--------|-------|
| Smart contracts | 3 |
| Total lines of Solidity | 656 |
| Unit tests | 153 |
| Integration tests | 34 |
| Test coverage | >90% |
| Audit rating | A- (internal) |
| Deployed networks | Sepolia testnet |
| GitHub Actions | 2 workflows |
