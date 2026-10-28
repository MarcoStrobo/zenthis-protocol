const { ethers } = require("hardhat");

const OLD_PRESALE = "0xb1998cb0e9f0c1e548d52dbeca85d23639cf5eef";
const TOKEN = "0xCFAeB3678DbC479e26Fd87C2cA7eD0a264f1F6a6";

async function main() {
  const [signer] = await ethers.getSigners();
  const provider = signer.provider;
  console.log("Deployer:", signer.address);

  // Read ZTS balance via raw eth_call
  const balanceOfData = "0x70a08231" + "000000000000000000000000" + OLD_PRESALE.slice(2);
  const balHex = await provider.call({ to: TOKEN, data: balanceOfData });
  const bal = ethers.toBigInt(balHex);
  console.log(`Old presale ZTS: ${ethers.formatEther(bal)}`);

  if (bal === 0n) {
    console.log("No ZTS to recover. Exiting.");
    return;
  }

  // Try markFailed()
  const markFailedSel = ethers.id("markFailed()").slice(0, 10);
  console.log(`\n1/2 Calling markFailed() [0x${markFailedSel.slice(2)}]...`);
  
  try {
    const estGas = await provider.estimateGas({
      to: OLD_PRESALE, data: markFailedSel, from: signer.address
    });
    console.log(`Gas est: ${estGas}`);
    
    const tx = await signer.sendTransaction({
      to: OLD_PRESALE, data: markFailedSel,
      gasLimit: estGas * 12n / 10n
    });
    console.log(`Tx: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`✅ markFailed() done! Status: ${receipt.status} Gas: ${receipt.gasUsed}`);
  } catch (e) {
    console.log(`markFailed() reverted: ${e.message.substring(0, 250)}`);
    
    // Try to decode revert
    const data = e.info?.error?.data || e.data || "";
    if (data && data !== "0x") {
      const sel = data.slice(2, 10);
      console.log(`Revert selector: 0x${sel}`);
    }
    
    console.log("\nTrying direct approach: just reduce vesting schedule instead.");
    return;
  }

  // Then withdraw
  const withdrawSel = ethers.id("withdrawUnusedTokens()").slice(0, 10);
  console.log(`\n2/2 Calling withdrawUnusedTokens()...`);
  
  try {
    const estGas = await provider.estimateGas({
      to: OLD_PRESALE, data: withdrawSel, from: signer.address
    });
    const tx = await signer.sendTransaction({
      to: OLD_PRESALE, data: withdrawSel,
      gasLimit: estGas * 12n / 10n
    });
    console.log(`Tx: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`✅ withdrawUnusedTokens() done! Status: ${receipt.status}`);
    
    // Check final deployer balance
    const deployerBalHex = await provider.call({
      to: TOKEN, data: "0x70a08231" + "000000000000000000000000" + signer.address.slice(2)
    });
    const finalBal = ethers.formatEther(ethers.toBigInt(deployerBalHex));
    console.log(`\n✅ Deployer ZTS: ${finalBal}`);
  } catch (e) {
    console.log(`withdrawUnusedTokens() reverted: ${e.message.substring(0, 250)}`);
    const data = e.info?.error?.data || e.data || "";
    if (data && data !== "0x") {
      const sel = data.slice(2, 10);
      console.log(`Revert selector: 0x${sel}`);
    }
  }
}

main().catch(console.error);
