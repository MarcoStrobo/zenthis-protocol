const { ethers, network, run } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(
    `Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`,
  );

  console.log("\n📦 Deploying ZenthisToken...");
  const Token = await ethers.getContractFactory("ZenthisToken");
  const token = await Token.deploy(deployer.address);
  await token.waitForDeployment();
  const addr = await token.getAddress();
  console.log(`   ✓ ZenthisToken: ${addr}`);

  const total = await token.totalSupply();
  console.log(`   Supply: ${ethers.formatEther(total)} ZTS`);

  if (network.name !== "hardhat" && network.name !== "localhost") {
    console.log("\n⏳ Waiting 30s for Etherscan...");
    await new Promise((r) => setTimeout(r, 30000));
    try {
      await run("verify:verify", { address: addr, constructorArguments: [deployer.address] });
      console.log("   ✓ Verified on Etherscan");
    } catch (e) {
      console.log(`   ⚠ Verify: ${e.message}`);
    }
  }

  console.log(`\n✅ TOKEN_ADDRESS=${addr}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
