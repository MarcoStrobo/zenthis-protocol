---
Title:       Security Review — Zenthis Protocol (contracts, LP bot, web app, infrastructure)
Date:        2026-10-28
Commit:      83482b7 (main after PR #3)
Reviewer:    Claude (Anthropic AI model), run at the request of the project owner
Methodology: Manual line-by-line review + Slither static analysis + executable proof-of-concept tests
Report type: AI-assisted INTERNAL review. NOT an independent audit. Not affiliated with CertiK.
---

# Zenthis Protocol — Security Review (October 2026)

> **Read this first.** This is a security review performed by an AI model on behalf of the project
> owner. It follows the layout of professional audit reports (summary, scope, finding table,
> per-finding detail, status) so it is easy to compare with one, but it is **not** an independent
> audit, was **not** performed by CertiK or any audit firm, and carries **no** guarantee. An AI
> reviewer can miss issues that human specialists find. **An independent external audit of
> `ZenthisHTLC`, the LP bot and the relay is still required before deploying with real user funds.**

## 1. Executive summary

| Severity | Count | Fixed in this PR | Open / accepted |
|----------|:-----:|:----------------:|:---------------:|
| Critical | 2 | 2 (rules deployed to production; SendGrid key must still be rotated) | 0 |
| High | 3 | 2 fixed, 1 mitigated | 0 |
| Medium | 9 | 6 (4 fixed, 2 mitigated) | 3 |
| Low | 9 | 5 (4 fixed, 1 mitigated) | 4 |
| Informational | 4 | – | 4 |

- **`ZenthisHTLC` core logic: no critical or high issue found.** Slither reports no High/Medium
  detector hits on it. The medium/low items are design limits (owner-controlled fee, unsupported
  token types, a refund that can be bricked by a contract wallet).
- **The most serious problems were outside the Solidity**: leaked SMTP credentials in a public
  repository, Firestore rules that allowed anyone to dump the waitlist and send email through the
  project's account, and a web claim step that did not authenticate the liquidity provider's lock.
- Deployed mainnet contracts (`ZenthisToken`, closed `ZenthisPresale`) are immutable; their findings
  are mitigations/disclosures, not patches.

Test status after remediation: **263 tests passing**, Prettier clean. `ZenthisHTLC` v2 and the LP bot were redeployed/restarted on Base Sepolia and Arbitrum Sepolia and a full swap was re-run through the UI (see section 10).

## 2. Scope

| Component | Path | Lines | Depth |
|-----------|------|:-----:|-------|
| `ZenthisHTLC` | `contracts/ZenthisHTLC.sol` | 356 | Full line-by-line, PoCs |
| `ZenthisToken` (deployed on Base) | `contracts/ZenthisToken.sol` | 231 | Full line-by-line, PoCs |
| `ZenthisVesting` | `contracts/ZenthisVesting.sol` | 222 | Full line-by-line, PoCs |
| `ZenthisPresale` (deployed, closed) | `contracts/ZenthisPresale.sol` | 943 | Slither + targeted reading only |
| LP bot | `lp-bot/` | ~600 | Full |
| Web swap flow, relay | `web/js/`, `web/app.html` | ~900 | Full |
| Infrastructure config | `firestore.rules`, `firebase.json`, `extensions/`, repo history | – | Full |

Out of scope / not reviewed: the Python bots and Cloud Functions logic beyond what they expose,
OpenZeppelin dependencies, the validator/consensus layer mentioned in the whitepaper (not present in
the repository), economic/tokenomics review, legal review.

## 3. Method

1. Read every in-scope contract and component line by line.
2. Slither 0.11 (`solc 0.8.24`) over all contracts (`slither . --filter-paths "node_modules|test|@openzeppelin"`).
3. Wrote a proof-of-concept for each contract finding (`test/audit/AuditFindings.test.js`); each
   asserts the current behaviour so it stays reproducible and can be flipped when fixed.
4. Drove the real UI against the real testnets with a mock wallet and attacked the claim step.
5. Searched the working tree and git history for secrets and reviewed hosting/Firestore configuration.

## 4. Findings overview

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| OPS-01 | Critical | SendGrid SMTP credentials committed to a public repository | Fixed in repo · **rotate key** |
| OPS-02 | Critical | Firestore rules allow public waitlist dump and email relay | Fixed in repo · **deploy rules** |
| OPS-03 | High | ~86% of ZTS supply sat in a hot EOA whose key is in plaintext | Mitigated (moved to the 2-of-2 Safe; signer-key risk remains) |
| UI-01 | High | Claim step did not authenticate the LP's destination lock | Fixed |
| LP-01 | High | Ambiguous RPC failures could cause a double lock or lost state | Fixed |
| HTLC-01 | Medium | Owner can change the fee instantly; no max-fee protection for users | Fixed (v2: `newSwapProtected`) |
| HTLC-02 | Medium | Fee-on-transfer / rebasing tokens make the pool insolvent | Fixed (v2: received-balance check) |
| HTLC-03 | Medium | `refund()` can be bricked by a contract that rejects ETH | Fixed (v2: deferred refund + `withdrawPendingRefund`) |
| ZTS-01 | Medium | Staking reward sniping (stake, claim, unstake around `depositFees`) | Open (token immutable) |
| LP-02 | Medium | Capital-lock griefing against the LP | Mitigated |
| LP-03 | Medium | L2 reorg / finality risk with low confirmations | Mitigated (large swaps wait for more blocks) |
| WEB-01 | Medium | Frontend and LP share one trust domain (secret generated in the browser) | Acknowledged |
| WEB-02 | Medium | ethers loaded at runtime from a public CDN | Fixed |
| WEB-03 | Medium | Gasless-claim relay is a public ntfy.sh topic | Acknowledged |
| HTLC-04 | Low | Protocol fee is not returned on refund | Accepted (design, disclosed) |
| ZTS-02 | Low | `withdrawStuckETH` can never return force-sent ETH after claims | Open (token immutable) |
| ZTS-03 | Low | `rescueERC20` uses `transfer` (non-standard tokens not rescuable) | Open |
| VEST-01 | Low | `totalAllocated` never decreases: new schedules blocked after releases | Fixed |
| VEST-02 | Low | Beneficiary cannot be changed; lost key locks the allocation | Fixed (`transferBeneficiary`) |
| GEN-01 | Low | `Ownable` instead of `Ownable2Step` (HTLC, Token, Vesting) | Fixed for HTLC and Vesting (Token is immutable) |
| WEB-04 | Low | Landing page claimed a live presale, a waitlist counter and dead links | Fixed |
| WEB-05 | Low | Swap secrets in `localStorage`; no CSP | Mitigated (headers + CSP; `unsafe-inline` still needed) |
| LP-04 | Low | LP private key in a plaintext `.env` | Acknowledged |
| PRE-01 | Info | Presale tokens were transferred, not deposited: `funded` stayed false | Closed (presale closed) |
| SL-01 | Info | Slither `reentrancy-eth` in `rescueUnclaimedEth` is a false positive | – |
| SL-02 | Info | Slither `divide-before-multiply` in presale bonus math (dust-level) | – |
| SL-03 | Info | Slither `incorrect-equality` on zero checks, `timestamp` hits | – |

## 5. Findings

### OPS-01 — SendGrid SMTP credentials committed to a public repository (Critical)
**Where:** `extensions/firestore-send-email.env`, tracked since commit `636b506` (2026-06-09).
The repository `MarcoStrobo/zenthis-protocol` is **public**. The file contained `SMTP_CONNECTION_URI`
with user and password for `smtp.sendgrid.net`.
**Impact:** anyone could send email as the project (phishing from the project's domain), consume the
SendGrid quota and burn the sender reputation.
**Fix applied:** file untracked (`git rm --cached`), `extensions/*.env` added to `.gitignore`, a
placeholder `extensions/firestore-send-email.env.example` added.
**Required from the owner:** the secret remains in git history and must be treated as **compromised**.
Revoke the SendGrid API key now, issue a new one, and update the extension configuration. Rewriting
history is optional and does not undo exposure.

### OPS-02 — Firestore rules allow public waitlist dump and email relay (Critical)
**Where:** `firestore.rules`. `waitlist`, `airdrop`, `referral_events` allowed `read: if true`;
`airdrop_meta` allowed public `write`; `mail` allowed public `create`. A Cloud Function and the
send-email extension fire on every new `mail` document.
**Impact:** (a) any visitor could list every registered email address (personal data, GDPR exposure);
(b) any visitor could create `mail` documents and trigger outgoing email with arbitrary recipient and
content through the project's mail account; (c) anyone could overwrite airdrop statistics.
**Fix applied:** rules replaced with deny-all (the web app no longer uses Firestore from the browser;
Cloud Functions use the Admin SDK and bypass rules).
**Required from the owner:** `firebase deploy --only firestore:rules`. This also stops the live site's
old forms from writing, which is intended.

### OPS-03 — Concentrated, hot-wallet custody of the token supply (High)
**Observed on-chain (Base, 2026-10-28):** the deployer EOA holds **85,937,000 ZTS (85.9% of supply)**
and is one of two owners of the 2-of-2 Safe that owns `ZenthisToken`. Its private key is stored in
plaintext in a developer `.env`.
**Impact:** compromise of one workstation exposes most of the supply and half of the admin
multisig. A 2-of-2 Safe also has no redundancy: losing either key permanently locks owner functions.
**Recommendation:** move the supply to the Safe (or a vesting contract) and use a hardware wallet for
the second signer; consider a 2-of-3 Safe; never keep large balances on the deployer.
**Status:** Mitigated on 2026-10-28: the 85,937,000 ZTS were moved to the 2-of-2 Safe (tx `0xf26390fc…78d2`), so
moving them now needs both signers. The deployer key is still one of the two signers and is still in a plaintext
`.env`, so replacing it with a hardware wallet (ideally in a 2-of-3 Safe) is still recommended.

### UI-01 — Claim step did not authenticate the LP's destination lock (High) — Fixed
**Where:** `web/js/swapflow.js`, `waitAndClaim`.
**Scenario:** the hashlock is public on the source chain. An attacker copies it and creates on the
destination chain `newSwap(user, hashlock, ...)` with 1 wei, **before** the LP. The UI selected the
first `SwapCreated` event matching the hashlock and redeemed it, revealing the secret. The LP (or
anyone) then redeems the source lock, while the user received dust and never claimed the LP's real lock.
**Fix:** `isGenuineLpLock` accepts a destination lock only if `initiator` is the LP address stored in
the swap record, the token is native ETH, the amount is at least 99% of the quote taken at creation,
and at least 10 minutes remain on its timelock. Verified in a browser against the live testnets
(dust, wrong initiator, ERC-20, short timelock and wrong hashlock are all rejected).

### LP-01 — Ambiguous RPC failures could cause a double lock or lost state (High) — Fixed
**Where:** `lp-bot/LpBot.js`, `lp-bot/index.js`.
**Scenario:** the public RPCs return errors such as `could not coalesce error` even for transactions
that were mined. The bot marked the swap `failed` and kept the A-side swap without tracking the B lock
that actually existed (user redeems B and later refunds A: the LP loses the amount), or, after a crash
between broadcast and save, re-processed the event and locked B a second time. Two locks with the same
hashlock are both redeemable with one secret.
**Fix:** write-ahead record (`locking`) before sending funds; errors that are not provably pre-broadcast
become `uncertain` and are reconciled from the receipt/logs, never re-sent; unresolved locks are marked
failed only after a grace period with an alert; state file written atomically (tmp + rename); exposure
counts in-flight locks. Covered by new tests (ambiguous RPC, no double lock).

### HTLC-01 — Owner can change the fee instantly (Medium) — Fixed in v2
`setFeeBps` takes effect immediately (cap 5%). A user who signed a swap quoted at 0.20% can be charged up
to 5% by a front-running owner transaction; `newSwap` has no `maxFeeBps` argument. **PoC:**
`HTLC-01` in `test/audit/AuditFindings.test.js`.
**Fix (v2):** `newSwapProtected(recipient, hashlock, timelock, maxFeeBps)` and `newSwapTokenProtected(...)`
revert if the current fee exceeds the user's maximum; the web app now always uses them with the quoted fee.
The original `newSwap`/`newSwapToken` remain for compatibility and still apply the current fee. Keep the owner a multisig.

### HTLC-02 — Fee-on-transfer and rebasing tokens make the pool insolvent (Medium) — Fixed in v2
`newSwapToken` credits `amount` without measuring the received balance. With a token that burns 10% on
transfer the contract records 100 but holds 90; the last redeemer of that token reverts and `refund`
also fails. The limitation is documented in the NatSpec but not enforced. **PoC:** `HTLC-02`.
**Fix (v2):** `newSwapToken` measures the balance actually received and reverts with
`HTLC: unsupported token (fee-on-transfer)` unless it equals `amount`. (Slither flags the intentional strict
equality; it is the check itself.)

### HTLC-03 — `refund()` can be bricked by an ETH-rejecting initiator (Medium) — Fixed in v2
If the initiator is a contract whose `receive()` reverts, `refund` reverts forever with
`HTLC: ETH refund failed`; the swap stays active and the ETH is locked. **PoC:** `HTLC-03`.
**Fix (v2):** when the push fails, `refund()` marks the swap refunded and credits `pendingEthRefunds`; the
initiator withdraws to any address with `withdrawPendingRefund(to)`. Nothing can be locked by a reverting wallet.

### ZTS-01 — Staking reward sniping (Medium) — Open (token is immutable)
`stake`/`unstake` have no lock or cooldown and `depositFees` is a visible owner transaction. An attacker
stakes a large amount in the block before the deposit, claims, and unstakes: in the PoC the attacker took
90% of 1 ETH of fees while the long-term staker received 10%. **PoC:** `ZTS-01`.
**Mitigation (no redeploy possible):** send `depositFees` through a private relay and/or in the same
transaction as an unrelated action; document the behaviour. A future token version should add a minimum
stake period or time-weighted rewards.

### LP-02 — Capital-lock griefing against the LP (Medium) — Mitigated
An attacker can open swaps on A and never redeem on B, locking LP capital for up to one hour per swap at
the price of the 0.20% fee. **Mitigation added:** per-initiator exposure cap (`maxOpenPerInitiator`,
default 0.2 ETH) in addition to the global cap. Residual: multiple addresses. Consider a bond, a higher
fee for new addresses, or shorter LP timelocks.

### LP-03 — L2 reorg / finality risk (Medium) — Mitigated
The bot acts after `confirmations` blocks (default 2). On an L2 a reorg of the unsafe head after the LP
locked on B would leave the LP with a lock on B and no swap on A. **Mitigation added:** swaps at or above `largeAmount` (default 0.05 ETH) are only acted on after
`largeConfirmations` (default 20) blocks; the scan cursor stays before them and smaller swaps are not delayed
(test `LP-03`). Mainnet should additionally use the chain's `safe`/`finalized` tag.

### WEB-01 — Frontend and LP share one trust domain (Medium) — Acknowledged
The secret is generated in the user's browser; whoever serves the page and whoever runs the LP can be the
same party. A malicious page update could leak the secret to the LP before it locks on B, letting the LP
redeem the source lock without locking. This is inherent to a hosted UI. Mitigations: publish the UI as a
reproducible build / IPFS with a pinned hash, keep the repository public, and allow self-hosting.

### WEB-02 — ethers loaded from a public CDN (Medium) — Fixed
`app.js`, `myswaps.js` and `swapflow.js` imported ethers from `cdn.jsdelivr.net` at runtime with no
integrity check; a CDN or npm compromise would run attacker code with wallet access. **Fix:** ethers 6.16.0
vendored at `web/js/vendor/ethers.min.js` (sha256 `2cf48c79d5f9136499527d43e5dc662071d41a000fd822de105533ab7502e950`).

### WEB-03 — Public relay topic (Medium) — Acknowledged
The gasless-claim relay is an ntfy.sh topic. Revealing the secret there is harmless once the LP lock exists
(both redeems pay fixed recipients), the bot validates `sha256(preimage) == hashlock`, acts only on its own
locked swaps and retries at most 3 times. Residual risks: availability and spam. Replace with an owned
endpoint before mainnet.

### Low severity (summary)
- **HTLC-04 (accepted)** The fee is taken on creation and is not returned on refund (PoC `HTLC-04`); a swap that never
  executes still costs the initiator the fee. Design choice; disclose it.
- **ZTS-02** `withdrawStuckETH` compares the balance to a cumulative `totalFeesDeposited` that is never
  reduced when stakers claim, so ETH force-sent afterwards can never be withdrawn (PoC `ZTS-02`). Harmless
  to stakers; funds are simply stranded.
- **ZTS-03** `rescueERC20` uses `transfer`; tokens that return no boolean cannot be rescued. Use `safeTransfer`.
- **VEST-01 (fixed)** `totalAllocated` is now reduced on `release`, so the balance check reflects only
  unreleased commitments (test `VEST-01`).
- **VEST-02 (fixed)** `transferBeneficiary` lets the current beneficiary rotate to a new address; the owner
  cannot redirect funds. A key that is already lost still cannot be recovered: use a multisig as beneficiary.
- **GEN-01 (fixed for HTLC and Vesting)** Both now use `Ownable2Step` (`transferOwnership` + `acceptOwnership`). The
  deployed token keeps `Ownable`. Deployment scripts must have the Safe call `acceptOwnership()`.
- **WEB-04** The landing page advertised "Presale live (18 Jun - 2 Jul)", a "1,473 people on the waitlist"
  counter, a form posting to a removed script and a link to a deleted page. All removed/corrected; the page
  still contains contradictory tokenomics wording (fair launch on Solana via pump.fun vs. a token on Base)
  that the owner should reconcile.
- **WEB-05** Swap secrets are stored unencrypted in `localStorage`; with no CSP an XSS could read them.
  Security headers (`nosniff`, `X-Frame-Options: DENY`, referrer, permissions, HSTS) were added to
  `firebase.json`; a Content-Security-Policy was added (`object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, a
  `connect-src` allowlist that blocks exfiltration to unknown hosts, script hosts limited to self, gstatic and
  googletagmanager). It still needs `'unsafe-inline'` for the existing inline scripts, so it limits but does
  not eliminate XSS impact. Validated in a browser against the landing page and the app.
- **LP-04** The LP key is in a plaintext `.env`. Keep the LP balance low; never reuse the deployer key.

### Informational
- **PRE-01** The presale contract held 20.3 M ZTS that had been `transfer`red instead of deposited via
  `depositTokens()`, so `funded` stayed `false` and `contribute()` reverted for every buyer. This is why
  nothing was ever raised. The presale was closed (`markFailed`) and the tokens recovered on 2026-10-28.
- **SL-01** `reentrancy-eth` in `rescueUnclaimedEth`: the function is `onlyOwner`, `nonReentrant`, zeroes
  the balance before the call (gas-limited to 10 000) and restores it on failure. False positive.
- **SL-02** `divide-before-multiply` in presale bonus ratios loses at most dust; no value is created.
- **SL-03** `incorrect-equality` hits are zero-amount guards; `timestamp` hits are the intended timelocks.

## 6. Slither summary

| Impact | Detector | Count | Triage |
|--------|----------|:-----:|--------|
| High | reentrancy-eth | 1 | False positive (SL-01) |
| Medium | divide-before-multiply | 9 | Dust-level (SL-02) |
| Medium | incorrect-equality | 4 | Benign zero checks (SL-03) |
| Low | timestamp | 21 | Intended |
| Low | calls-loop, return-bomb, reentrancy-events | 4 | Presale rescue loop, gas-limited |
| Info | naming, low-level calls, complexity | 29 | – |

No High/Medium detector fired on `ZenthisHTLC`.

## 7. Reproduce

```bash
npx hardhat test                                   # 263 tests
npx hardhat test test/audit/AuditFindings.test.js   # fix tests for HTLC/VEST/GEN, open-issue PoCs for ZTS-01..02, HTLC-04
slither . --filter-paths "node_modules|test|@openzeppelin"
```

## 8. Recommendations before mainnet

1. Rotate the SendGrid key and deploy the new Firestore rules (OPS-01, OPS-02).
2. Move the token supply off the deployer EOA; use hardware wallets for Safe signers (OPS-03).
3. Commission an **independent external audit** of `ZenthisHTLC` v2, the LP bot and the relay.
4. Replace the staking contract (or add a minimum stake period) in any future token version (ZTS-01..03).
5. Replace ntfy with an owned relay, use keyed RPC providers with fallback, and raise bot confirmations
   for larger swaps.
6. Add a strict CSP and publish the UI with a pinned, reproducible build.

## 9. Remediation log

| Finding | Action | Evidence |
|---------|--------|----------|
| OPS-01 | File untracked, `.gitignore`, `.example` template | repo; **key rotation still required** |
| OPS-02 | `firestore.rules` deny-all | repo; **deploy still required** |
| UI-01 | `isGenuineLpLock` | browser test against live testnets |
| LP-01, LP-02, LP-03 | write-ahead + reconcile, atomic state, per-initiator cap, deferred large swaps | `test/LpBot.test.js` (13 tests) |
| HTLC-01..03, GEN-01 | `ZenthisHTLC` v2 | `test/audit/AuditFindings.test.js`, full suite |
| VEST-01, VEST-02, GEN-01 | `ZenthisVesting` changes | `test/audit/AuditFindings.test.js` |
| WEB-02, WEB-04, WEB-05 | vendored ethers, landing corrections, headers + CSP | browser checks |
| OPS-03, ZTS-01..03, HTLC-04, WEB-01, WEB-03, LP-04 | cannot be fixed in code | see `docs/OPERATIONS.md` |

## 10. Redeployment (testnet)

`ZenthisHTLC` v2 (verified on the explorers):
- Base Sepolia: `0x789b6fd580b1C507386EdCf676D5dc46D0158aea`
- Arbitrum Sepolia: `0xC5FC2E804DFdbCf30F9DfC645fB2dD67Dea2BCf7`

The previous testnet deployment (`0x3c0328eb…47eB`) is superseded. After redeploying, a full Base Sepolia to Arbitrum
Sepolia swap was driven through the web UI with the LP bot running (`newSwapProtected`, lock authentication,
claim). Mainnet HTLC has not been deployed.

## 11. Limitations

- Performed by an AI model in a single session; no formal verification or fuzzing campaign beyond the
  repository's existing fuzz/invariant tests.
- The presale was reviewed with static analysis and targeted reading only; it is closed and holds no funds.
- Findings about the live website depend on what is currently deployed, which was not inspected.
- This report is not legal, financial or investment advice and is not a certification.

*Internal security review — 28 October 2026. Reviewer: Claude (AI). Not affiliated with CertiK.*
