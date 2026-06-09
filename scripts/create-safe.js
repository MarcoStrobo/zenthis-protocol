/**
 * Create a 2/2 Gnosis Safe on Arbitrum One using ethers directly.
 *
 * Safe Proxy Factory:  0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2  (Arbitrum)
 * Safe Singleton:       0x41675C099F32341bf84BFc5382aF534df5C7461a  (Arbitrum)
 * CreateCall:           0x7cbB62EaA69F79e6873cD1ecB239297103dD0022  (Arbitrum)
 */

const { ethers } = require("ethers");
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const ARBITRUM_RPC = "https://arb1.arbitrum.io/rpc";
const SIGNERS = [
  "0x39ED77a1b2C33D25A08e4Ae530f2ED6eA2e55E84",
  "0x0939Ebf43eAA4E798Cc483A5a5128e3E9Dfb30DE",
];
const THRESHOLD = 2;
const SALT_NONCE = 42; // arbitrary — change to deploy a different address

// ── Arbitrum One addresses (Safe v1.4.1) ───────────────────────────
const SAFE_SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
const SAFE_PROXY_FACTORY = "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2";
const FALLBACK_HANDLER = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99";

// ── Safe setup data (encoded) ─────────────────────────────────────
function encodeSetupData(
  owners,
  threshold,
  to,
  data,
  fallbackHandler,
  paymentToken,
  payment,
  paymentReceiver,
) {
  const safeInterface = new ethers.Interface([
    "function setup(address[] calldata _owners, uint256 _threshold, address to, bytes calldata data, address fallbackHandler, address paymentToken, uint256 payment, address payable paymentReceiver)",
  ]);
  return safeInterface.encodeFunctionData("setup", [
    owners,
    threshold,
    to || ethers.ZeroAddress,
    data || "0x",
    fallbackHandler || ethers.ZeroAddress,
    paymentToken || ethers.ZeroAddress,
    payment || 0,
    paymentReceiver || ethers.ZeroAddress,
  ]);
}

// ── Predict address ────────────────────────────────────────────────
function predictSafeAddress(factoryAddress, singletonAddress, setupData, saltNonce) {
  const abi = [
    "function createProxyWithNonce(address _singleton, bytes memory initializer, uint256 saltNonce) public returns (address proxy)",
  ];
  const iface = new ethers.Interface(abi);

  // The address is computed as:
  // keccak256(0xff + factoryAddress + saltHash + keccak256(creationCode + singleton + setupData))
  const creationCode =
    "0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555050610168806101196000396000f3fe6080604052600436106100225760003560e01c8063a619486e14610027575b600080fd5b61002f610031565b005b6000809054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff1614156100ba573660008037600080366000845af43d6000803e80600081146100a8573d6000f35b3d6000fd5b3d6000fd5b600080fd5b600080fd5b600080fd5b600080fdfea2646970667358221220177a6171c62b84e53a5befb1153981d4f9fd92a8ea0dddd6a81ae51ff64dde0a64736f6c63430007060033";

  const saltHash = ethers.solidityPackedKeccak256(
    ["bytes", "uint256"],
    [ethers.keccak256(setupData), saltNonce],
  );

  const deploymentData = ethers.solidityPacked(
    ["bytes", "address", "bytes"],
    [creationCode, singletonAddress, setupData],
  );

  const address = ethers.getAddress(
    ethers.dataSlice(
      ethers.solidityPackedKeccak256(
        ["bytes", "address", "bytes32", "bytes32"],
        ["0xff", factoryAddress, saltHash, ethers.keccak256(deploymentData)],
      ),
      12,
    ),
  );
  return address;
}

async function main() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) throw new Error("DEPLOYER_PRIVATE_KEY not found in .env");

  const provider = new ethers.JsonRpcProvider(ARBITRUM_RPC);
  const deployer = new ethers.Wallet(pk, provider);
  const deployerAddr = await deployer.getAddress();

  console.log("\n" + "═".repeat(60));
  console.log("  🔐 CREATING GNOSIS SAFE — Arbitrum One");
  console.log("═".repeat(60));
  console.log(`  Deployer       : ${deployerAddr}`);
  console.log(
    `  Deployer bal    : ${ethers.formatEther(await provider.getBalance(deployerAddr))} ETH`,
  );
  console.log(`  Signers (${SIGNERS.length}):`);
  SIGNERS.forEach((s, i) => console.log(`    ${i + 1}. ${s}`));
  console.log(`  Threshold       : ${THRESHOLD}/${SIGNERS.length}`);

  // ── Encode setup data ──────────────────────────────────────────
  const initializer = encodeSetupData(
    SIGNERS,
    THRESHOLD,
    ethers.ZeroAddress,
    "0x",
    FALLBACK_HANDLER,
    ethers.ZeroAddress,
    0,
    ethers.ZeroAddress,
  );

  // ── Predict Safe address ───────────────────────────────────────
  const predicted = predictSafeAddress(SAFE_PROXY_FACTORY, SAFE_SINGLETON, initializer, SALT_NONCE);
  console.log(`\n  📍 Predicted Safe address: ${predicted}`);

  // ── Send tx ────────────────────────────────────────────────────
  const factory = new ethers.Contract(
    SAFE_PROXY_FACTORY,
    [
      "function createProxyWithNonce(address _singleton, bytes memory initializer, uint256 saltNonce) public returns (address proxy)",
    ],
    deployer,
  );

  console.log("\n  🔨 Deploying Safe (createProxyWithNonce)...");
  const tx = await factory.createProxyWithNonce(SAFE_SINGLETON, initializer, SALT_NONCE, {
    gasLimit: 300000,
  });
  console.log(`  Tx submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  ✅ Safe deployed at: ${predicted}`);
  console.log(`  Gas used: ${receipt.gasUsed.toString()}`);
  console.log(`  Block   : ${receipt.blockNumber}`);

  // ── Verify ─────────────────────────────────────────────────────
  const code = await provider.getCode(predicted);
  if (code !== "0x") {
    console.log("\n  ✅ ✅ Safe IS DEPLOYED and has code");
  } else {
    console.log("\n  ❌ Safe deployment FAILED — no code at address");
    process.exit(1);
  }

  console.log("\n" + "═".repeat(60));
  console.log("  ✅ SAFE CREATED SUCCESSFULLY");
  console.log("═".repeat(60));
  console.log(`  Safe address: ${predicted}`);
  console.log(`  View: https://app.safe.global/home?safe=arb1:${predicted}`);
  console.log(`  Network: Arbitrum One`);
  console.log("═".repeat(60));

  // ── Print .env snippet ────────────────────────────────────────
  console.log(`\n📄 Add to .env:`);
  console.log(`  GNOSIS_SAFE_ADDRESS=${predicted}`);
}

main().catch((err) => {
  console.error("\n❌ ERROR:", err.message || err);
  process.exit(1);
});
