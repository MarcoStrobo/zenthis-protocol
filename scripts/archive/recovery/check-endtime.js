const { ethers } = require("hardhat");

const OLD_PRESALE = "0xb1998cb0e9f0c1e548d52dbeca85d23639cf5eef";

async function main() {
  // Compute custom error selectors
  const errors = [
    "Presale_NotEndedYet()",
    "Presale_AlreadyFailed()",
    "Presale_NotFailed()",
    "Presale_AlreadyFinalized()",
    "Presale_NotFinalized()",
  ];
  console.log("Custom error selectors:");
  for (const err of errors) {
    // keccak256 of error signature
    const sel = ethers.id(err).slice(0, 10);
    console.log(`  0x${sel.slice(2)}  ${err}`);
  }

  // Read endTime from old contract
  // endTime is at storage slot 6 (struct config starts at slot 5, endTime is config.endTime ~ slot 6)
  // Actually, let me check: in Solidity, the struct is stored starting at slot 5
  // config = { token, ... } starts at slot 5
  // The struct layout: token(slot5), rates(slot6), times(slot7,8,9), wallets(slot10,11), amounts(slot12,13,14,15,16)
  // Actually this is hard to know without running the contract. Let me try calling the getter.
  
  const provider = ethers.provider;
  
  // Try reading storage slot 7 (endTime of config struct)
  // In the struct PresaleConfig, the first field after address token (160 bits = 1 slot) 
  // is 'rate' (uint256) slot 6, then 'liquidityPct' (uint256) slot 7
  // ... complex. Let me just try static-calling the function
  // Actually let's read slot 8 (likely config.startTime) and slot 9 (config.endTime)
  
  for (let slot = 5; slot <= 15; slot++) {
    const slotHex = "0x" + slot.toString(16).padStart(64, "0");
    const val = await provider.call({
      to: OLD_PRESALE,
      data: "0x0000000000000000000000000000000000000000000000000000000000000000" // just a dummy
    });
    const storageVal = await provider.getStorage(OLD_PRESALE, slot);
    console.log(`Slot ${slot}: ${storageVal}`);
  }
}

main().catch(console.error);
