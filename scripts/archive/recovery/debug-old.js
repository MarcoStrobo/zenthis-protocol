const { ethers } = require("hardhat");
const OLD = "0xb1998cb0e9f0c1e548d52dbeca85d23639cf5eef";

async function main() {
  // All errors from the presale contract
  const errors = [
    "Presale_ZeroAddress", "Presale_ClaimDeadlineNotSet", "Presale_ClaimWindowActive",
    "Presale_NotStarted", "Presale_Ended", "Presale_NotEnded", "Presale_NotEndedYet",
    "Presale_SoftCapNotMet", "Presale_SoftCapMet", "Presale_BelowMinBuy",
    "Presale_AboveMaxBuy", "Presale_AboveHardCap", "Presale_NothingToClaim",
    "Presale_AlreadyClaimed", "Presale_SelfReferral", "Presale_InvalidThreshold",
    "Presale_NotFunded", "Presale_AlreadyFunded", "Presale_BonusPoolTooSmall",
    "Presale_InvalidRate", "Presale_InvalidCaps", "Presale_InvalidLimits",
    "Presale_InvalidPct", "Presale_InvalidTimes", "Presale_EndInPast",
    "Presale_NotFailed", "Presale_TransferFailed", "Presale_AlreadyFinalized",
    "Presale_AlreadyFailed", "Presale_NotFinalizedOrFailed", "Presale_InvalidMinBuy",
    "Presale_BatchTooLarge", "Presale_AlreadyRequested", "Presale_TimelockPending",
    "Presale_InsufficientBalance", "Presale_RenounceDisabled", "Presale_NotWhitelisted",
    "Presale_BatchEmpty", "Presale_BatchTooLargeWhiteList", "Presale_InvalidPhase",
    "Presale_ClaimWindowExpired", "Presale_NotFinalized", "Presale_AlreadyStarted",
  ];
  
  console.log("Error selectors:");
  for (const err of errors) {
    const sel = ethers.id(`${err}()`).slice(0, 10);
    if (sel === "0x6e61a946") {
      console.log(`  🎯 MATCH: 0x${sel.slice(2)}  ${err}()`);
    }
  }
  console.log("\nNo match found among standard errors.");

  // Check if the endTime getter exists
  const fn = ethers.id("endTime()").slice(0, 10);
  const fn2 = ethers.id("getEndTime()").slice(0, 10);
  console.log(`\nendTime() getter: 0x${fn.slice(2)}`);
  console.log(`getEndTime() getter: 0x${fn2.slice(2)}`);
  
  // Try to read storage slot 5 (config.startTime) and slot 6 (config.endTime) 
  // assuming standard struct layout
  const provider = ethers.provider;
  for (let slot = 0; slot < 20; slot++) {
    try {
      const val = await provider.getStorage(OLD, slot);
      if (val !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
        const num = ethers.toBigInt(val);
        // If timestamp looks reasonable (2024-2030 range: 1.7B to 1.9B timestamp)
        if (num > 1000000000n && num < 2000000000n) {
          console.log(`\n  Slot ${slot}: ${val} → ${new Date(Number(num) * 1000).toISOString()}`);
        } else if (val.length > 42) {
          // Might be an address
          console.log(`  Slot ${slot}: ${val}`);
        }
      }
    } catch {}
  }
}

main().catch(console.error);
