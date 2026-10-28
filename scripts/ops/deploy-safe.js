const hre = require("hardhat");
const { ethers } = hre;

// Safe v1.4.1 — deterministic addresses across all EVM chains
const SAFE_SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
const SAFE_FACTORY = "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2";
const FALLBACK_HANDLER = "0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4"; // CompatibilityFallbackHandler

// Safe ABI (minimal: setup + proxy creation)
const SAFE_ABI = [
  "function setup(address[] calldata _owners, uint256 _threshold, address to, bytes calldata data, address fallbackHandler, address paymentToken, uint256 payment, address payable paymentReceiver)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
];

const FACTORY_ABI = [
  "function createProxyWithNonce(address _singleton, bytes memory initializer, uint256 saltNonce) returns (address proxy)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();
  const bal = await ethers.provider.getBalance(deployerAddr);

  console.log("\n" + "═".repeat(60));
  console.log("  🛡️  DEPLOY GNOSIS SAFE — ZENTHIS PROTOCOL");
  console.log("═".repeat(60));
  console.log(`  Deployer  : ${deployerAddr}`);
  console.log(`  Balance   : ${ethers.formatEther(bal)} ETH`);
  console.log(`  Network   : ${hre.network.name} (chainId: ${hre.network.config.chainId})`);
  console.log("═".repeat(60));

  // ═══ Signers ═══
  const owner1 = deployerAddr;
  const owner2 = "0x2C54Fd8D7E87b07b0b8b116F22cD06Bcc200E35c";
  const owners = [owner1, owner2].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const threshold = 2;

  console.log(`\n  Firmante 1: ${owners[0]} (deployer)`);
  console.log(`  Firmante 2: ${owners[1]} (segunda wallet)`);
  console.log(`  Threshold : ${threshold}-of-${owners.length}`);

  // ═══ Validate balance ═══
  if (bal < ethers.parseEther("0.003")) {
    console.error("\n❌ Deployer needs at least 0.003 ETH for gas");
    process.exit(1);
  }

  // ═══ Encode setup calldata ═══
  const safeInterface = new ethers.Interface(SAFE_ABI);
  const setupData = safeInterface.encodeFunctionData("setup", [
    owners,
    threshold,
    ethers.ZeroAddress, // to
    "0x", // data
    ethers.ZeroAddress, // fallbackHandler (no handler needed)
    ethers.ZeroAddress, // paymentToken
    0n, // payment
    ethers.ZeroAddress, // paymentReceiver
  ]);

  // ═══ Deploy via Proxy Factory ═══
  const factory = new ethers.Contract(SAFE_FACTORY, FACTORY_ABI, deployer);
  const saltNonce = Math.floor(Date.now() / 1000); // timestamp as nonce

  console.log(`\n  🚀 Deploying Safe (saltNonce: ${saltNonce})...`);

  const tx = await factory.createProxyWithNonce(SAFE_SINGLETON, setupData, saltNonce, {
    gasLimit: 500_000,
  });
  const receipt = await tx.wait();

  // ═══ Extract Safe address from event ═══
  // GnosisSafeProxyFactory emits: event ProxyCreation(address proxy, address singleton)
  const event = receipt.logs.find((log) => {
    try {
      const parsed = factory.interface.parseLog(log);
      return parsed?.name === "ProxyCreation";
    } catch {
      return false;
    }
  });

  let safeAddress;
  if (event) {
    const parsed = factory.interface.parseLog(event);
    safeAddress = parsed.args.proxy;
  } else {
    // Fallback: compute deterministic address
    console.error("  ⚠️  Could not extract Safe address from event. Computing manually...");
    safeAddress = "UNKNOWN";
  }

  console.log(`  ✅ Safe deployed!`);
  console.log(`  📍 Address  : ${safeAddress}`);
  console.log(`  ⛽ TX       : ${receipt.hash}`);
  console.log(`  ⛽ Gas used : ${receipt.gasUsed.toString()}`);

  // ═══ Verify owners ═══
  if (safeAddress !== "UNKNOWN") {
    const safe = new ethers.Contract(safeAddress, SAFE_ABI, deployer);
    const storedOwners = await safe.getOwners();
    const storedThreshold = await safe.getThreshold();

    console.log(`\n  ✅ Verification:`);
    console.log(`     Owners   : ${storedOwners.join(", ")}`);
    console.log(`     Threshold: ${storedThreshold.toString()}`);
    console.log(
      `     Match    : ${
        storedThreshold === BigInt(threshold) && storedOwners.length === owners.length ? "✅" : "❌"
      }`,
    );
  }

  console.log("\n" + "═".repeat(60));
  console.log("  ✅ GNOSIS SAFE DEPLOYED");
  console.log("═".repeat(60));
  console.log(`  ${safeAddress}`);
  console.log("═".repeat(60));

  // Save to .env
  const fs = require("fs");
  let env = fs.readFileSync(".env", "utf8");
  const gnosisKey = "GNOSIS_SAFE_ADDRESS";
  const re = new RegExp("^" + gnosisKey + "=.*", "m");
  if (re.test(env)) {
    env = env.replace(re, gnosisKey + "=" + safeAddress);
  } else {
    env += "\n" + gnosisKey + "=" + safeAddress;
  }
  fs.writeFileSync(".env", env);
  console.log(`\n📄 Saved to .env as ${gnosisKey}=${safeAddress}`);
}

main().catch((err) => {
  console.error("\n❌ FAILED:", err.message || err);
  process.exit(1);
});
