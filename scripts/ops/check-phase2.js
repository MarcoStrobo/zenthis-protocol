const { Firestore } = require("@google-cloud/firestore");
async function main() {
  const db = new Firestore({ projectId: "zenthis-app" });
  const snap = await db.collection("waitlist").get();
  const all = [];
  const cutoff14 = new Date("2026-06-11T14:00:00+02:00");
  let phase1 = 0,
    phase2 = 0,
    noTimestamp = 0;

  snap.forEach((d) => {
    const d2 = d.data();
    // Try multiple timestamp fields
    let raw = d2.registeredAt || d2.ts || d2.createdAt || d2.timestamp || null;
    let ts = null;
    if (raw) {
      if (typeof raw.toDate === "function") ts = raw.toDate();
      else if (raw._seconds) ts = new Date(raw._seconds * 1000);
      else if (typeof raw === "string") ts = new Date(raw);
      else if (typeof raw === "number") ts = new Date(raw);
    }
    const wallet = (d2.wallet || "").toLowerCase();
    if (!ts || !wallet) {
      noTimestamp++;
      return;
    }

    all.push({ wallet, ts, id: d.id });
    if (ts < cutoff14) {
      phase1++;
    } else {
      phase2++;
    }
  });

  console.log("Total docs:", snap.size);
  console.log("Con wallet+timestamp:", all.length);
  console.log("Sin timestamp o wallet:", noTimestamp);

  // Count Phase 1 & 2 properly
  const phase1Set = new Set();
  const phase2Set = new Set();
  all.forEach((d) => {
    if (d.ts < cutoff14) phase1Set.add(d.wallet);
    else phase2Set.add(d.wallet);
  });

  // Phase 2 wallets NOT in Phase 1
  const newPhase2 = [...phase2Set].filter((w) => !phase1Set.has(w));

  console.log("Phase 1 wallets:", phase1Set.size);
  console.log("Phase 2 wallets:", phase2Set.size);
  console.log("Phase 2 NUEVAS:", newPhase2.length);
  console.log("\n--- Phase 2 wallets (nuevas) ---");
  all
    .filter((d) => d.ts >= cutoff14 && !phase1Set.has(d.wallet))
    .forEach((d) => {
      console.log(d.wallet, d.ts.toISOString());
    });
}
main().catch(console.error);
