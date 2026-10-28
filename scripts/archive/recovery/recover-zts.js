const { ethers } = require("hardhat");

const OLD_PRESALE = "0xb1998cb0e9f0c1e548d52dbeca85d23639cf5eef";

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Deployer:", await signer.getAddress());

  // Function selectors
  const sels = {
    withdrawUnusedTokens: ethers.id("withdrawUnusedTokens()").slice(0, 10),
    rescueUnclaimedEth: ethers.id("rescueUnclaimedEth(address[])").slice(0, 10),
    owner: ethers.id("owner()").slice(0, 10),
  };
  for (const [name, sel] of Object.entries(sels)) {
    console.log(`  ${name}: ${sel}`);
  }

  // Check if old presale has owner() 
  try {
    const code = await signer.provider.getCode(OLD_PRESALE);
    const hasWithdraw = code.toLowerCase().includes(sels.withdrawUnusedTokens.slice(2).toLowerCase());
    const hasOwner = code.toLowerCase().includes(sels.owner.slice(2).toLowerCase());
    console.log(`\nContract code: ${code.length} bytes`);
    console.log(`Has withdrawUnusedTokens(): ${hasWithdraw}`);
    console.log(`Has owner(): ${hasOwner}`);

    if (hasOwner) {
      const ownerData = sels.owner;
      const result = await signer.provider.call({ to: OLD_PRESALE, data: ownerData });
      const ownerAddr = ethers.getAddress("0x" + result.slice(26));
      console.log(`\nOwner of old presale: ${ownerAddr}`);
      console.log(`Is deployer owner? ${ownerAddr.toLowerCase() === (await signer.getAddress()).toLowerCase()}`);

      if (hasWithdraw && ownerAddr.toLowerCase() === (await signer.getAddress()).toLowerCase()) {
        console.log("\n✅ Can call withdrawUnusedTokens()!");
        
        // Estimate gas for withdraw
        const gasEst = await signer.provider.estimateGas({
          to: OLD_PRESALE,
          data: sels.withdrawUnusedTokens,
          from: await signer.getAddress()
        }).catch(e => null);
        console.log(`Gas est: ${gasEst}`);

        // Send the transaction
        console.log("\nSending withdrawUnusedTokens()...");
        const tx = await signer.sendTransaction({
          to: OLD_PRESALE,
          data: sels.withdrawUnusedTokens,
          gasLimit: gasEst ? gasEst * 12n / 10n : 200000n
        });
        console.log(`Tx sent: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`✅ Withdraw completed! Gas used: ${receipt.gasUsed}`);
      } else {
        if (!hasWithdraw) console.log("❌ Contract doesn't have withdrawUnusedTokens()");
        if (ownerAddr.toLowerCase() !== (await signer.getAddress()).toLowerCase()) console.log("❌ Owner mismatch");
      }
    }
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

main().catch(console.error);
