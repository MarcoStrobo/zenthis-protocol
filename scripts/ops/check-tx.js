const { ethers } = require("hardhat");

async function main() {
  const txHash = "0x33529a0cd3d080ee085b3c3676dcfb1687038d2b238a894fe615eaf1a4daa66e";
  const receipt = await ethers.provider.getTransactionReceipt(txHash);

  if (!receipt) {
    console.error("Receipt not found");
    process.exit(1);
  }

  console.log("Logs:", receipt.logs.length);

  const FACTORY_IFACE = new ethers.Interface([
    "event ProxyCreation(address indexed proxy, address singleton)",
  ]);

  for (const log of receipt.logs) {
    try {
      const parsed = FACTORY_IFACE.parseLog(log);
      if (parsed) {
        console.log("\n✅ ProxyCreation event found!");
        console.log("Proxy     :", parsed.args.proxy);
        console.log("Singleton :", parsed.args.singleton);
        console.log("From      :", log.address);
      }
    } catch {}
  }

  // Show all logs
  console.log("\nAll logs:");
  for (let i = 0; i < receipt.logs.length; i++) {
    const l = receipt.logs[i];
    console.log(
      `${i}: addr=${l.address}, topics=${l.topics.length}, data=${l.data.slice(0, 40)}...`,
    );
  }
}

main().catch(console.error);
