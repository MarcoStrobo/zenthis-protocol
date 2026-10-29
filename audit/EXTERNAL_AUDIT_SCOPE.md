# Zenthis — External Audit Package

Prepared 2026-10-29 for independent security auditors. Self-contained brief: scope, trust model,
what has been checked, known risks, and how to reproduce. Nothing here is an audit result; the
previous reviews in `audit/` are internal and AI-assisted.

## 1. What Zenthis is

A trustless cross-chain atomic-swap protocol. A user locks ETH in `ZenthisHTLC` on chain A with a
sha256 hashlock and a timelock; a liquidity-provider (LP) bot locks the matching amount on chain B
with a shorter timelock; the user reveals the preimage to claim on B, and the bot uses it to claim
on A. No bridge custody, no wrapped assets. Current deployments are testnet only
(Base Sepolia and Arbitrum Sepolia, see `deployments/htlc-*.json`). Mainnet is not live.

## 2. Requested scope

| Priority | Component                             | Path                                                          | Lines     |
| -------- | ------------------------------------- | ------------------------------------------------------------- | --------- |
| 1        | HTLC contract (v2)                    | `contracts/ZenthisHTLC.sol`                                   | 436       |
| 1        | LP bot lock and redeem logic          | `lp-bot/LpBot.js`, `lp-bot/index.js`                          | 417 + 134 |
| 1        | Web claim flow                        | `web/js/swapflow.js`, `web/js/myswaps.js`, `web/js/config.js` | ~265+     |
| 2        | Vesting                               | `contracts/ZenthisVesting.sol`                                | 237       |
| 2        | Deployment, roles and key management  | `docs/OPERATIONS.md`, `deployments/`                          | n/a       |
| 3        | Relay (ntfy topic for gasless claims) | `lp-bot/index.js` (`mkRelay`), `web/js/config.js`             | n/a       |

Out of scope: `ZenthisToken.sol` and the presale are already deployed on Base and immutable
(findings ZTS-01..03 are documented, not fixable). Review them only for their effect on the HTLC.

Commit to review: `f337908` on `main` (merge of PR #5).

## 3. Trust model and assumptions

- The HTLC is permissionless. The owner (`Ownable2Step`) can pause new swaps, set `feeBps` (cap 500),
  and withdraw collected fees. The owner cannot move locked swap funds. Verify this.
- `redeem` pays the recipient regardless of caller (enables gasless claim by a third party).
- Fee is charged at swap creation and is not refunded.
- ETH refunds that fail are credited to `pendingEthRefunds` and pulled via `withdrawPendingRefund(to)`.
- The LP bot holds a hot key on both chains and is the only counterparty. Users trust the bot only
  to the extent that the lock it creates can be verified on-chain before they reveal the preimage.
- Intended timelock rule: initiator lock TA is longer than the LP lock TB (TB = TA - 1h).
  **Nothing on-chain enforces this.** Safety rests on the bot and on the UI.

## 4. Highest-risk areas (please attack these first)

1. **Timelock ordering between legs** (`LpBot._handleNewSwap`, `_adoptLock`, `swapflow.isGenuineLock`).
   Can a user get the preimage-reveal window to overlap the LP's refund window? Consider RPC failures,
   reorgs, slow relay messages, and the bot redeeming close to expiry.
2. **Accounting in `ZenthisHTLC`:** `redeem`, `refund`, deferred refund path, `totalPendingEthRefunds`,
   force-sent ETH, and the ERC-20 balance-delta check (`unsupported token (fee-on-transfer)`).
3. **Bot state machine:** write-ahead `locking` status, `uncertain` reconcile from receipt and logs,
   duplicate-lock prevention after ambiguous RPC failures, exposure caps, large-swap deferral.
4. **Relay input handling** (public topic, unauthenticated): malformed or forged claim messages.
5. **Frontend authentication of the LP lock** before the secret is revealed (re-validated via `getSwap`
   with at least 120 s left). The frontend and the LP are in the same trust domain (WEB-01).
6. **ERC-20 swaps:** no token allowlist. Check weird tokens (rebasing, ERC-777 hooks, blocklists,
   non-standard returns). The bot only accepts native ETH (`token === ZeroAddress`).

## 5. What has already been checked (by us, not independent)

Source of every number: `audit/AI_Assisted_Security_Review_2026-10-28.md` section 9.

- 294 hardhat tests passing. Seeded stateful fuzz (~7,500 hostile operations, no invariant broken).
- Mutation testing of `ZenthisHTLC`: 76 of 81 mutants killed; 5 survivors judged equivalent
  (lines 193, 217, 287, 410, 423). Please confirm independently.
- Slither 0.11: no High findings on HTLC or Vesting.
- `npm audit`: 0 vulnerabilities. gitleaks and Slither run in CI (`.github/workflows/security.yml`).
- Three bot vulnerabilities found and fixed with failing-first tests: LP-05 (ERC-20 treated as ETH),
  LP-06 (malformed relay message aborts the cycle), LP-07 (failing scan starves redemptions).
- End-to-end swaps on real testnets in both directions, including gasless claim.

## 6. Known and accepted limitations

- HTLC-04 (design): timelock ordering is not enforced on-chain.
- LP-04: bot hot key. WEB-03: public relay topic. WEB-01: frontend and LP in one trust domain.
- Deployer key is still a Safe signer and was kept in a plaintext `.env`. Plan: hardware wallet or
  2-of-3 Safe. Safe (2-of-2): `0x06C691900069c44B0c312179Fc1AfeAdc71Bc717`.
- ZTS-01..03: token is immutable; staking reward sniping item remains open.
- A SendGrid key leaked in public git history (commit `636b506`) and has been revoked.
  Treat the history as public; do not rely on it for anything secret.

## 7. Reproduce

```bash
npm ci
npx hardhat test                      # 294 tests
FUZZ_SEEDS=10 FUZZ_STEPS=120 npx hardhat test test/fuzz/ZenthisHTLC.stateful.test.js
npx prettier --check .
npm audit
```

Mutation harness and Slither setup: see section 7 of the AI-assisted review. Testnet addresses are in
`deployments/htlc-baseSepolia.json` and `deployments/htlc-arbitrumSepolia.json`; the LP address is in
`web/js/config.js` (`LP_ADDRESS_TESTNET`).

## 8. Deliverables we want

- Findings with severity, impact and a proof-of-concept test for each confirmed issue.
- Explicit opinion on enforcing timelock ordering on-chain versus in the bot.
- A fix review round included in the price.
- A report we can publish under the auditor's name.

## 9. Contact

Project: Zenthis (`MarcoStrobo/zenthis-protocol`). Contact: zenthisio@proton.me.
