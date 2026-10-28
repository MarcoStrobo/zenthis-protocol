# Operations and security runbook

Items from `audit/AI_Assisted_Security_Review_2026-10-28.md` that cannot be fixed by changing code. Do them
in this order.

## 1. Rotate the leaked mail credentials (OPS-01) — urgent

`extensions/firestore-send-email.env` was public in git from 2026-06-09. The file is no longer tracked, but the
old value stays in the history, so treat it as compromised.

1. In SendGrid: revoke the API key used as the SMTP password, create a new one with the minimum scope (Mail Send).
2. Put the new value in your local, untracked `extensions/firestore-send-email.env`
   (see `extensions/firestore-send-email.env.example` for the variable names).
3. Re-deploy the extension configuration: `firebase ext:configure firestore-send-email --project <project-id>`.
4. Optional: purge the file from history with `git filter-repo` and force-push. Rotation already removes the risk;
   a rewrite only hides the old value for new clones.

## 2. Deploy the new Firestore rules and headers (OPS-02, WEB-05)

```bash
cd <repo>
firebase deploy --only firestore:rules --project <project-id>
firebase deploy --only hosting --project <project-id>
```

The new rules deny every client read and write. Cloud Functions keep working because the Admin SDK bypasses rules.
Any old page still calling Firestore from the browser (waitlist/airdrop) stops working, which is intended.
The hosting deploy also applies the security headers and the Content-Security-Policy from `firebase.json`.
After deploying, load the landing page and the app and check the browser console for CSP violations.

## 3. Custody of the ZTS supply (OPS-03)

On 2026-10-28 the deployer EOA held 85,937,000 ZTS and co-owned the 2-of-2 Safe that owns the token.
The supply was moved to the Safe that day (tx `0xf26390fc…78d2`). Remaining steps:

1. Optionally move it on to a vesting contract with the intended schedules.
2. Make the second Safe signer a hardware wallet; prefer a 2-of-3 Safe so one lost key does not freeze admin.
3. Keep only gas money in the deployer; never keep a key that can move funds in a plaintext `.env` on a daily-use machine.
4. Verify afterwards with `scripts/ops/check-owner.js` and a balance check.

## 4. Staking reward sniping (ZTS-01) — cannot be patched

`ZenthisToken` is immutable. Mitigations:

- Call `depositFees` at unpredictable times and in the same transaction as other Safe actions where possible.
  Base has no public mempool (the sequencer orders transactions), which makes front-running harder than on L1 but not
  impossible if the schedule is predictable.
- Document the behaviour for stakers.
- In any future token version add a minimum stake period or time-weighted rewards.

`ZTS-02` (force-sent ETH cannot be withdrawn) and `ZTS-03` (`rescueERC20` uses `transfer`) have no impact on staker
funds; do not send ETH or non-standard tokens to the token contract.

## 5. Deploying the v2 contracts on mainnet

`ZenthisHTLC` and `ZenthisVesting` use `Ownable2Step`: `transferOwnership(safe)` only proposes; the Safe must then
execute `acceptOwnership()` (see `scripts/ops/propose-accept-ownership.js`). Do not consider the Safe the owner
until that transaction is confirmed.

Mainnet HTLC checklist:

1. Independent external audit of `ZenthisHTLC` v2, the LP bot and the relay.
2. Cap per swap and LP `maxOpenExposure` / `maxOpenPerInitiator` set deliberately.
3. Keyed RPC providers with a fallback; bot `largeConfirmations` and the `safe`/`finalized` tag for large swaps.
4. Replace the public ntfy.sh relay topic with an endpoint you control (WEB-03).
5. Publish the UI from a pinned, reproducible build (WEB-01) and keep the repository public so it can be audited.

## 6. Accepted design limits

- `HTLC-04`: the protocol fee is charged when a swap is created and is not returned on refund.
- `WEB-01`: whoever serves the UI and whoever runs the LP can be the same party; this is inherent to a hosted UI.
- `LP-04`: the LP bot key is a hot key in `.env`; keep its balance low and never reuse the deployer key.
