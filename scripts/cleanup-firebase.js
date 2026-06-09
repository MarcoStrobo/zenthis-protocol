/**
 * Firebase Whitelist Cleanup Script
 *
 * Re-applies the audit logic to Firebase Firestore:
 * - Removes email farm bots (incremental patterns)
 * - Removes duplicate/sybil wallets
 * - Removes fake contract addresses as wallets
 * - Removes zero-effort registrations (no wallet, no verification)
 * - Removes duplicate X handles
 *
 * Run: node scripts/cleanup-firebase.js
 */

const admin = require("firebase-admin");

// Try to use application default credentials (from firebase login)
admin.initializeApp({
  projectId: "zenthis-app",
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

// Known contract addresses used as fake wallets
const FAKE_CONTRACT_WALLETS = new Set([
  "0x00000000219ab540356cbb839cbe05303d7705fa", // ETH2 Deposit
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH
  "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", // UNI
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", // WBTC
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
  "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT
  "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9", // AAVE
  "0x514910771af9ca656af840dff83e8264ecf986ca", // LINK
  "0xae7ab96520de3a18e5e111b5eaab095312d7fe84", // stETH
  "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
]);

async function main() {
  console.log("Fetching all waitlist documents from Firestore...\n");

  const snapshot = await db.collection("waitlist").get();
  const docs = [];
  snapshot.forEach((doc) => {
    docs.push({ id: doc.id, data: doc.data() });
  });

  console.log(`Total documents: ${docs.length}\n`);

  // ──────────────────────────────────────────
  // 1. EMAIL FARM BOTS (incremental patterns)
  // ──────────────────────────────────────────
  console.log("--- Step 1: Email farm detection ---");
  const emailPatterns = {};
  const emailFarmIds = new Set();

  docs.forEach(({ id, data }) => {
    const email = (data.email || id).toLowerCase();
    // Check for incremental patterns: test1@, user2@, farmer3@, etc.
    const match = email.match(/^([a-z0-9_]+?)(\d+)@/);
    if (match) {
      const prefix = match[1];
      if (!emailPatterns[prefix]) emailPatterns[prefix] = [];
      emailPatterns[prefix].push({ id, email, num: parseInt(match[2]) });
    }
  });

  Object.entries(emailPatterns).forEach(([prefix, emails]) => {
    if (emails.length >= 3) {
      // Check if numbers form a sequential pattern
      emails.sort((a, b) => a.num - b.num);
      let sequentialCount = 1;
      for (let i = 1; i < emails.length; i++) {
        if (emails[i].num === emails[i - 1].num + 1) {
          sequentialCount++;
        } else if (sequentialCount < 3) {
          sequentialCount = 1;
        }
      }
      // Check if ALL follow a clear incremental pattern
      const nums = emails.map((e) => e.num);
      const isSequentialFarm =
        nums.length >= 3 &&
        nums.every((n, i) => i === 0 || n === nums[i - 1] + 1 || n === nums[i - 1]);

      if (
        isSequentialFarm ||
        (nums.length >= 5 && nums[nums.length - 1] - nums[0] === nums.length - 1)
      ) {
        emails.forEach(({ id }) => {
          emailFarmIds.add(id);
        });
        console.log(
          `  Farm detected: "${prefix}" (${emails.length} emails: ${emails[0].num}-${
            emails[emails.length - 1].num
          })`,
        );
      }
    }
  });

  console.log(`  → ${emailFarmIds.size} email farm documents to remove\n`);

  // ──────────────────────────────────────────
  // 2. FAKE CONTRACT WALLETS
  // ──────────────────────────────────────────
  console.log("--- Step 2: Fake contract wallet detection ---");
  const fakeWalletIds = new Set();

  docs.forEach(({ id, data }) => {
    const wallet = (data.wallet || "").toLowerCase().trim();
    if (wallet && FAKE_CONTRACT_WALLETS.has(wallet)) {
      fakeWalletIds.add(id);
      console.log(`  Fake contract: ${id} → ${wallet}`);
    }
  });

  console.log(`  → ${fakeWalletIds.size} fake contract documents to remove\n`);

  // ──────────────────────────────────────────
  // 3. DUPLICATE WALLETS (sybil)
  // ──────────────────────────────────────────
  console.log("--- Step 3: Duplicate wallet detection ---");
  const walletCounts = {};
  docs.forEach(({ id, data }) => {
    const wallet = (data.wallet || "").toLowerCase().trim();
    if (wallet && !FAKE_CONTRACT_WALLETS.has(wallet) && !emailFarmIds.has(id)) {
      if (!walletCounts[wallet]) walletCounts[wallet] = [];
      walletCounts[wallet].push(id);
    }
  });

  const duplicateWalletIds = new Set();
  Object.entries(walletCounts)
    .filter(([, ids]) => ids.length > 1)
    .sort(([, a], [, b]) => b.length - a.length)
    .forEach(([wallet, ids]) => {
      // Keep the first one (earliest), delete the rest
      const toDelete = ids.slice(1);
      toDelete.forEach((id) => duplicateWalletIds.add(id));
      console.log(
        `  Wallet ${wallet.slice(0, 10)}... used ${ids.length} times → keeping 1, deleting ${
          toDelete.length
        }`,
      );
    });

  console.log(`  → ${duplicateWalletIds.size} sybil wallet documents to remove\n`);

  // ──────────────────────────────────────────
  // 4. DUPLICATE X HANDLES
  // ──────────────────────────────────────────
  console.log("--- Step 4: Duplicate X handle detection ---");
  const xCounts = {};
  docs.forEach(({ id, data }) => {
    const xhandle = (data.twitter || "").toLowerCase().replace(/^@/, "").trim();
    if (xhandle && !emailFarmIds.has(id) && !fakeWalletIds.has(id) && !duplicateWalletIds.has(id)) {
      if (!xCounts[xhandle]) xCounts[xhandle] = [];
      xCounts[xhandle].push(id);
    }
  });

  const duplicateXIds = new Set();
  Object.entries(xCounts)
    .filter(([, ids]) => ids.length > 1)
    .sort(([, a], [, b]) => b.length - a.length)
    .forEach(([handle, ids]) => {
      const toDelete = ids.slice(1);
      toDelete.forEach((id) => duplicateXIds.add(id));
      console.log(
        `  X handle @${handle} used ${ids.length} times → keeping 1, deleting ${toDelete.length}`,
      );
    });

  console.log(`  → ${duplicateXIds.size} duplicate X handle documents to remove\n`);

  // ──────────────────────────────────────────
  // 5. ZERO EFFORT (no wallet, no telegram, no tweet)
  // ──────────────────────────────────────────
  console.log("--- Step 5: Zero-effort detection ---");
  const zeroEffortIds = new Set();

  docs.forEach(({ id, data }) => {
    if (
      emailFarmIds.has(id) ||
      fakeWalletIds.has(id) ||
      duplicateWalletIds.has(id) ||
      duplicateXIds.has(id)
    )
      return;

    const hasWallet = (data.wallet || "").trim().length > 5;
    const hasTelegram = data.telegramVerified === true;
    const hasTweet = (data.tweetUrl || "").trim().length > 5;
    const hasRefCount = (data.refCount || 0) > 0;

    if (!hasWallet && !hasTelegram && !hasTweet && !hasRefCount) {
      zeroEffortIds.add(id);
    }
  });

  console.log(`  → ${zeroEffortIds.size} zero-effort documents to remove\n`);

  // ──────────────────────────────────────────
  // COMBINE ALL TO DELETE
  // ──────────────────────────────────────────
  const allToDelete = new Set([
    ...emailFarmIds,
    ...fakeWalletIds,
    ...duplicateWalletIds,
    ...duplicateXIds,
    ...zeroEffortIds,
  ]);

  console.log("═══════════════════════════════════════");
  console.log(`  TOTAL TO DELETE: ${allToDelete.size} documents`);
  console.log(`  REMAINING: ${docs.length - allToDelete.size} documents`);
  console.log("═══════════════════════════════════════\n");

  // ──────────────────────────────────────────
  // EXECUTE DELETION
  // ──────────────────────────────────────────
  if (allToDelete.size === 0) {
    console.log("Nothing to delete. Exiting.");
    return;
  }

  const batchSize = 500;
  const toDeleteArray = Array.from(allToDelete);
  let deleted = 0;

  for (let i = 0; i < toDeleteArray.length; i += batchSize) {
    const batch = toDeleteArray.slice(i, i + batchSize);
    const writeBatch = db.batch();

    batch.forEach((docId) => {
      const docRef = db.collection("waitlist").doc(docId);
      writeBatch.delete(docRef);
    });

    await writeBatch.commit();
    deleted += batch.length;
    console.log(`  Deleted ${deleted}/${allToDelete.size}...`);
  }

  // ──────────────────────────────────────────
  // UPDATE STATS COUNTER
  // ──────────────────────────────────────────
  const newCount = docs.length - allToDelete.size;
  await db.collection("waitlist_meta").doc("stats").set(
    {
      count: newCount,
    },
    { merge: true },
  );

  console.log(`\n✅ Stats counter updated to ${newCount}`);
  console.log("✅ Cleanup complete!");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
