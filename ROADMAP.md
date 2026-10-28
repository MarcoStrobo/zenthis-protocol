# Zenthis Protocol — Roadmap

**Last updated: 2026-10-28**

Focus: **trustless cross-chain atomic swaps** (HTLC). Token and presale are secondary and paused.

---

## ✅ Completed

### Core
- [x] `ZenthisHTLC` (ETH + ERC-20, SHA-256 hashlock, protocol fee, pause)
- [x] `ZenthisToken`, `ZenthisVesting`, `ZenthisPresale`
- [x] 247 tests: unit, fuzz, invariant, two-chain swap simulation, LP bot
- [x] CI (lint + tests), internal reviews (June and Oct 2026, the latter AI-assisted with PoCs), whitepaper, landing page

### Atomic swap MVP (Oct 2026)
- [x] UI fixes: sha256 hashlock, LP recipient, secret persisted before sending
- [x] `ZenthisHTLC` deployed and verified on Base Sepolia and Arbitrum Sepolia
- [x] LP bot (`lp-bot/`) with exposure caps and restart-safe state
- [x] End-to-end ETH swap Base Sepolia to Arbitrum Sepolia completed on real testnets
- [x] "My swaps" panel: claim, refund, secret backup
- [x] Testnet mode in the UI (`/app.html?testnet=1`)

### Base mainnet (paused)
- [x] ZTS token (100 M) owned by a 2-of-2 Safe
- [x] `ZenthisPresale` deployed, never launched; closed with `markFailed()` on 2026-10-28 and the 20.3 M ZTS recovered to the deployer

---

## 🔜 Next

### Swap hardening (before mainnet)
- [ ] Soak the LP bot on testnet (multiple swaps, restarts, RPC failures)
- [ ] Alerts for the bot (missed redeem window, low balance)
- [ ] ERC-20 swaps in UI and bot
- [ ] Hosted LP quote API (spread, limits) instead of constants in `config.js`
- [ ] Rotate the SendGrid key and deploy the new Firestore rules (audit OPS-01, OPS-02)
- [ ] Move the ZTS supply off the deployer EOA (audit OPS-03)
- [ ] HTLC v2: `maxFeeBps`, balance-delta check, pull-based refund, `Ownable2Step` (audit HTLC-01..03)
- [ ] External audit of `ZenthisHTLC` (356 lines), the LP bot and the relay
- [ ] Safe multisig as owner of the HTLC; cap per swap on mainnet launch
- [ ] Fund the deployer / LP with real ETH and deploy HTLC on Base and Arbitrum

### Presale (when relaunching)
- [ ] Fresh presale deployment once swaps are live

---

## 📅 Later

- [ ] Order book / multiple LPs
- [ ] Bitcoin (Taproot) HTLC counterparty
- [ ] Solana / Polygon / Avalanche deployments
- [ ] Bug bounty, subgraph, public dashboard

---

## 📊 Key metrics

| Metric | Value |
|--------|-------|
| Contracts | 4 (HTLC, Token, Vesting, Presale) |
| Tests | 263 passing |
| HTLC testnets | Base Sepolia, Arbitrum Sepolia |
| Reviews | internal (Jun 2026) + AI-assisted (Oct 2026); external audit pending |
