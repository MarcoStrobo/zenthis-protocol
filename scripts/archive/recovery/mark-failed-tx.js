const { ethers } = require("hardhat");

const OLD_PRESALE = "0xb1998cb0e9f0c1e548d52dbeca85d23639cf5eef";
const TOKEN = "0xCFAe…F6a6";

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Deployer:", signer.address);

  // Check ZTS balance of old presale
  const tokenAbi = ["function balanceOf(address) view returns (uint256)"];
  const token = new ethers.Contract(TOKEN, tokenAbi, signer.provider);
  const bal = await token.balanceOf(OLD_PRESALE);
  console.log(`Old presale ZTS: ${ethers.formatEther(bal)}`);

  // Try to call markFailed()
  const markFailedSel = ethers.id("markFailed()").slice(0, 10);
  console.log(`\nCalling markFailed()...`);
  try {
    const estGas = await signer.provider.estimateGas({
      to: OLD_PRESALE,
      data: markFailedSel,
      from: signer.address,
    });
    console.log(`Gas est: ${estGas}`);
    const tx = await signer.sendTransaction({
      to: OLD_PRESALE,
      data: markFailedSel,
      gasLimit: (estGas * 12n) / 10n,
    });
    console.log(`Tx: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`✅ markFailed() success! Gas: ${receipt.gasUsed}`);

    // Now withdraw
    const withdrawSel = ethers.id("withdrawUnusedTokens()").slice(0, 10);
    console.log(`\nCalling withdrawUnusedTokens()...`);
    const estGas2 = await signer.provider.estimateGas({
      to: OLD_PRESALE,
      data: withdrawSel,
      from: signer.address,
    });
    const tx2 = await signer.sendTransaction({
      to: OLD_PRESALE,
      data: withdrawSel,
      gasLimit: (estGas2 * 12n) / 10n,
    });
    console.log(`Tx2: ${tx2.hash}`);
    const receipt2 = await tx2.wait();
    console.log(`✅ Withdraw success! Gas: ${receipt2.gasUsed}`);

    // Check final balance
    const finalBal = await token.balanceOf(signer.address);
    console.log(`\nDeployer ZTS: ${ethers.formatEther(finalBal)}`);
  } catch (e) {
    const reason = e.info?.error?.data || e.data || "";
    console.log(`Failed: ${e.message.substring(0, 200)}`);
    if (reason.length > 10) {
      console.log(`Revert data: ${reason}`);
      // Decode common errors
      const sel = reason.slice(2, 10);
      if (sel === "6b8a6e0b") console.log("→ Presale_NotEndedYet (endTime not reached)");
      else if (sel === "a61a6b9c") console.log("→ Ownable: caller not owner");
    }
  }
}

main().catch(console.error);
