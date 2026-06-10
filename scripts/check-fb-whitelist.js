/**
 * Quick Firestore whitelist check - Phase 1 vs Phase 2 counts + export
 *
 * Usage: node scripts/check-fb-whitelist.js
 */
const admin = require("firebase-admin");
admin.initializeApp({
  projectId: "zenthis-app",
  credential: admin.credential.applicationDefault(),
});
const db = admin.firestore();

async function main() {
  const snapshot = await db.collection("waitlist").get();
  const docs = [];
  snapshot.forEach((doc) => docs.push({ id: doc.id, data: doc.data() }));

  console.log(`\n📊 TOTAL: ${docs.length} registros en waitlist\n`);

  let phase1 = 0, phase2 = 0, noPhase = 0;
  let withWallet = 0, withoutWallet = 0;

  for (const { id, data } of docs) {
    const phase = data.phase;
    if (phase === 1 || phase === "1" || phase === "Phase 1") phase1++;
    else if (phase === 2 || phase === "2" || phase === "Phase 2") phase2++;
    else noPhase++;

    const wallet = (data.wallet || "").trim();
    if (wallet.length >= 10) withWallet++;
    else withoutWallet++;
  }

  console.log(`Phase 1: ${phase1}`);
  console.log(`Phase 2: ${phase2}`);
  console.log(`Sin fase: ${noPhase}`);
  console.log(`\nCon wallet: ${withWallet}`);
  console.log(`Sin wallet: ${withoutWallet}`);

  // Export Phase 2 wallets for contract whitelist
  const phase2Wallets = docs
    .filter(({ data }) => {
      const phase = data.phase;
      const isPhase2 = phase === 2 || phase === "2" || phase === "Phase 2";
      const wallet = (data.wallet || "").trim().toLowerCase();
      return isPhase2 && wallet.length >= 10;
    })
    .map(({ data }) => data.wallet.trim().toLowerCase());

  // Also check Phase 1 wallets
  const phase1Wallets = docs
    .filter(({ data }) => {
      const phase = data.phase;
      const isPhase1 = phase === 1 || phase === "1" || phase === "Phase 1";
      const wallet = (data.wallet || "").trim().toLowerCase();
      return isPhase1 && wallet.length >= 10;
    })
    .map(({ data }) => data.wallet.trim().toLowerCase());

  console.log(`\n📤 Phase 2 wallets con wallet: ${phase2Wallets.length}`);
  console.log(`📤 Phase 1 wallets con wallet: ${phase1Wallets.length}`);
  
  // Sample wallets
  if (phase2Wallets.length > 0) {
    console.log(`\n🔍 Muestra Phase 2 (${Math.min(5, phase2Wallets.length)}):`);
    phase2Wallets.slice(0, 5).forEach(w => console.log(`   ${w}`));
  }
  if (phase1Wallets.length > 0) {
    console.log(`\n🔍 Muestra Phase 1 (${Math.min(5, phase1Wallets.length)}):`);
    phase1Wallets.slice(0, 5).forEach(w => console.log(`   ${w}`));
  }

  // === Export CSV for on-chain whitelist ===
  const fs = require("fs");
  const path = require("path");
  
  const outDir = path.join(__dirname, "..", "whitelist");

  // Phase 2 (deduplicated)
  const uniq2 = [...new Set(phase2Wallets)];
  fs.writeFileSync(
    path.join(outDir, "phase2_wallets.txt"),
    uniq2.join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(outDir, "phase2_wallets.json"),
    JSON.stringify(uniq2, null, 2),
    "utf8"
  );
  console.log(`\n✅ Phase 2: ${uniq2.length} wallets únicas → whitelist/phase2_wallets.*`);

  // Phase 1 (deduplicated)
  const uniq1 = [...new Set(phase1Wallets)];
  fs.writeFileSync(
    path.join(outDir, "phase1_wallets.txt"),
    uniq1.join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(outDir, "phase1_wallets.json"),
    JSON.stringify(uniq1, null, 2),
    "utf8"
  );
  console.log(`✅ Phase 1: ${uniq1.length} wallets únicas → whitelist/phase1_wallets.*`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
