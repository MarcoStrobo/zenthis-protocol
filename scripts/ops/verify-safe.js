const { ethers } = require("hardhat");

async function main() {
  const txHash = "0x33529a0cd3d080ee085b3c3676dcfb1687038d2b238a894fe615eaf1a4daa66e";
  const receipt = await ethers.provider.getTransactionReceipt(txHash);

  // Log 1 is factory event, decode data
  const factoryLog = receipt.logs[1];
  const data = factoryLog.data;

  // ABI decode: (address proxy, address singleton) — no indexed params
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const [proxy, singleton] = abiCoder.decode(["address", "address"], data);

  console.log("Safe Proxy:", proxy);
  console.log("Singleton:", singleton);

  // Verify it's a Safe by checking code
  const code = await ethers.provider.getCode(proxy);
  console.log("Code length:", code.length / 2 - 1, "bytes");
  console.log("Has code:", code !== "0x");

  // Verify owners
  const SAFE_ABI = [
    "function getOwners() view returns (address[])",
    "function getThreshold() view returns (uint256)",
  ];
  const safe = new ethers.Contract(proxy, SAFE_ABI, ethers.provider);
  const owners = await safe.getOwners();
  const threshold = await safe.getThreshold();

  console.log("\nVerification:");
  console.log("Owners:", owners.join(", "));
  console.log("Threshold:", threshold.toString());
}

main().catch(console.error);
