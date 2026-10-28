const { ethers } = require("hardhat");
const { Firestore } = require("@google-cloud/firestore");

const PRESALE_ADDR = "0x50425684634F9AF37D1dE14Bb1140057C421b656";
const MAX_BATCH = 500;

async function main() {
  const [deployer] = await ethers.getSigners();
  const ethBal = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer: ${deployer.address} (${ethers.formatEther(ethBal)} ETH)`);

  const presale = await ethers.getContractAt("ZenthisPresale", PRESALE_ADDR);

  // Read Phase 1 wallets from Firestore
  const db = new Firestore({ projectId: "zenthis-app" });
  const snap = await db.collection("waitlist").where("phase", "==", 1).get();

  let wallets = [];
  snap.forEach((doc) => {
    const w = (doc.data().wallet || "").trim().toLowerCase();
    if (w.length >= 42 && w.startsWith("0x")) wallets.push(w);
  });
  wallets = [...new Set(wallets)];
  console.log(`Phase 1 wallets únicas: ${wallets.length}`);

  // Upload in batches of 500
  for (let i = 0; i < wallets.length; i += MAX_BATCH) {
    const batch = wallets.slice(i, i + MAX_BATCH);
    console.log(`\n📤 Batch ${Math.floor(i / MAX_BATCH) + 1}: ${batch.length} wallets...`);

    const tx = await presale.addToWhitelist(batch, 1);
    const receipt = await tx.wait();
    console.log(`   ✅ Tx: ${receipt.hash}`);

    const remaining = await ethers.provider.getBalance(deployer.address);
    console.log(`   Balance restante: ${ethers.formatEther(remaining)} ETH`);
  }

  // Verify sample
  let verified = 0;
  for (const w of wallets.slice(0, 20)) {
    const phase = await presale.whitelistPhase(w);
    if (phase === 1n) verified++;
  }
  console.log(`\n✅ Verificación (muestra 20): ${verified}/20 en Phase 1`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
