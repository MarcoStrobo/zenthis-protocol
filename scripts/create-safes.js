const hre = require("hardhat");
const { ethers } = hre;

const SAFE_SINGLETON = "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552";
const SIGNER_1 = "0x39ED77a1b2C33D25A08e4Ae530f2ED6eA2e55E84";
const SIGNER_2 = "0x0939Ebf43eAA4E798Cc483A5a5128e3E9Dfb30DE";

// EIP-1167 minimal proxy that stores the master at storage slot 0
// (c0ffee00000000000000000000000000000000000000000000000000000000 per Safe v1.3.0)
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log(
    "Balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "ETH",
  );

  // Build the proxy creation bytecode (Safe v1.3.0 uses a specific proxy)
  // The proxy creation code for Safe v1.3.0 factory:
  // 0x608060... + singleton addr + 0x0000... + 0x0000... + 0x0000... + 0x0000...(init code)

  // Simpler: use a factory pattern. Deploy a temporary factory contract.
  // Or use CREATE2 directly with the known proxy init code.

  // The Safe proxy init code (from factory):
  // Minimal proxy that delegates to the singleton
  const proxyInitCode = ethers.getBytes(
    "0x" +
      "6080" + // PUSH1 0x80
      "6040" + // PUSH1 0x40
      "52" + // MSTORE
      // ... actual Safe proxy init code would go here
      // But this is complex. Let me use the Safe API instead.
      "00", // STOP
  );

  // ALTERNATIVE: Use the Safe Deployments library
  // https://docs.safe.global/safe-core-api/available-services
  // The Safe Transaction Service API can create Safes

  console.log("\n🔄 Enfoque alternativo: Safe Transaction Service API");
  console.log("URL: https://safe-transaction-base.safe.global/api/v1/safes/");

  // Let's use the Safe Config Service to get deploy info
  const https = require("https");

  function apiGet(path) {
    return new Promise((resolve, reject) => {
      https
        .get(`https://safe-config-base.safe.global/api/v1${path}`, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(data);
            }
          });
        })
        .on("error", reject);
    });
  }

  // Get the master copies (singletons) registered on Base
  const masterCopies = await apiGet("/about/master-copies/");
  console.log("\nRegistered Safe versions on Base:");
  for (const mc of masterCopies) {
    console.log(`  v${mc.version}: ${mc.address} (deployed: ${mc.deployerCode ? "yes" : "no"})`);
  }

  // Get the proxy factory address
  console.log("\nGetting proxy factory info...");
  const about = await apiGet("/about/");
  console.log("About:", JSON.stringify(about, null, 2).substring(0, 500));

  // Get deployment info
  console.log("Available endpoints:");
  const endpoints = ["/about/", "/about/master-copies/", "/about/deployer/"];
  for (const ep of endpoints) {
    const data = await apiGet(ep);
    console.log(
      `  ${ep}:`,
      typeof data === "object" ? Object.keys(data).join(", ") : data.substring(0, 100),
    );
  }
}

main().catch(console.error);
