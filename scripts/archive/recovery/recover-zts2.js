const { ethers } = require("hardhat");

const OLD_PRESALE = "0xb1998cb0e9f0c1e548d52dbeca85d23639cf5eef";

async function main() {
  const [signer] = await ethers.getSigners();

  // Check if the old presale has markFailed or other state-changing functions
  const funcs = [
    "withdrawUnusedTokens()",
    "markFailed()",
    "finalize()",
    "depositTokens(uint256)",
    "setPhase2Config((uint256,uint256,uint256,uint256,uint256,uint256,uint256))",
  ];

  const code = await signer.provider.getCode(OLD_PRESALE);

  for (const f of funcs) {
    const sel = ethers.id(f).slice(0, 10);
    const found = code.toLowerCase().includes(sel.slice(2).toLowerCase());
    console.log(`${sel} → ${f.padEnd(50)} ${found ? "✅" : "❌"}`);
  }

  // Try to call owner() via static call to verify
  const ownerData = ethers.id("owner()").slice(0, 10);
  try {
    const result = await signer.provider.call({ to: OLD_PRESALE, data: ownerData });
    console.log(`\nOwner: 0x${result.slice(26)}`);
  } catch (e) {
    console.log(`\nOwner call failed: ${e.message.substring(0, 100)}`);
  }

  // Check contract's ZTS balance
  const token = await ethers.getContractAt("IERC20", "0xCFAe…F6a6");
  const bal = await token.balanceOf(OLD_PRESALE);
  console.log(`\nZTS balance of old presale: ${ethers.formatEther(bal)}`);

  // Try to get revert reason of withdrawUnusedTokens
  const withdrawSel = ethers.id("withdrawUnusedTokens()").slice(0, 10);
  try {
    await signer.provider.call({ to: OLD_PRESALE, data: withdrawSel, from: signer.address });
    console.log("Withdraw would succeed!");
  } catch (e) {
    // Try to decode revert reason
    const data = e.data || e.info?.error?.data || "";
    if (data && data.length > 10) {
      try {
        // Try custom error (4 bytes selector)
        const reasonSel = data.slice(2, 10);
        console.log(`Revert selector: 0x${reasonSel}`);
        // Common error selectors
        const errors = {
          "6b8a6e0b": "Presale_NotFinalizedOrFailed()",
          "6c8c0a2c": "Presale_ClaimDeadlineNotSet()",
          "5299aeb3": "Presale_ClaimWindowActive()",
          "312a91cc": "Presale_NothingToClaim()",
        };
        console.log(`Error: ${errors[reasonSel] || "Unknown custom error"}`);
      } catch {}
    } else {
      console.log(`Withdraw reverted (no data): ${e.message.substring(0, 200)}`);
    }
  }

  // Check if we can try a different approach - maybe transferFrom
  const allowance = await token.allowance(OLD_PRESALE, signer.address);
  console.log(`\nAllowance from old presale → deployer: ${ethers.formatEther(allowance)}`);
}

main().catch(console.error);
