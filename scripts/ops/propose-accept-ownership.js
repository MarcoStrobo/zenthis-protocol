const { ethers } = require("ethers");
const Safe = require("@safe-global/protocol-kit").default;
const SafeApiKit = require("@safe-global/api-kit").default;

const RPC_URL = "https://base-mainnet.infura.io/v3/b111055d4bf6457ca760e294f9901281";
const SAFE_ADDRESS = "0x06C691900069c44B0c312179Fc1AfeAdc71Bc717";
const TOKEN_ADDRESS = "0xCFAeB3678DbC479e26Fd87C2cA7eD0a264f1F6a6";
const SIGNER1_PK = "6002b362928cc2f3636daf8f0b739080f81cfe8ce02d28d6ec51e491fb3d3453";

async function main() {
  console.log("=== PROPOSE acceptOwnership TO SAFE ===\n");

  // 1. Connect signer
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer1 = new ethers.Wallet(SIGNER1_PK, provider);
  const signer1Addr = await signer1.getAddress();
  console.log("Signer 1:", signer1Addr);

  // 2. Create Safe instance
  const safeKit = await Safe.init({
    provider: RPC_URL,
    signer: SIGNER1_PK,
    safeAddress: SAFE_ADDRESS,
  });
  console.log("Safe connected:", SAFE_ADDRESS);

  // 3. Create API Kit
  const apiKit = new SafeApiKit({
    chainId: 8453n,
  });
  console.log("API Kit ready");

  // 4. Create transaction data for acceptOwnership()
  const tokenInterface = new ethers.Interface(["function acceptOwnership()"]);
  const data = tokenInterface.encodeFunctionData("acceptOwnership", []);

  // 5. Create Safe transaction
  const safeTransaction = await safeKit.createTransaction({
    transactions: [
      {
        to: TOKEN_ADDRESS,
        value: "0",
        data: data,
      },
    ],
  });

  // 6. Sign with signer 1
  const signedTx = await safeKit.signTransaction(safeTransaction);
  console.log("Signed by signer 1 ✅");

  // 7. Propose to Safe Transaction Service
  try {
    const safeAddress = SAFE_ADDRESS;
    const senderAddress = signer1Addr;

    await apiKit.proposeTransaction({
      safeAddress,
      safeTransactionData: safeTransaction.data,
      safeTxHash: signedTx.hash,
      senderAddress,
      signature: signedTx.signatures.get(signer1Addr.toLowerCase())?.data || "",
    });

    console.log("\n✅ Transaction proposed to Safe Service!");
    console.log("\n📋 Ahora abre https://app.safe.global");
    console.log("   Conecta con la wallet 2 (0x2C54Fd...E35c)");
    console.log("   Ve a Transactions → Queue");
    console.log("   Dale a Confirm y firma con Phantom");
  } catch (err) {
    console.error("\n❌ Error proposing:", err.message);
    if (err.data) console.error("Details:", err.data);
  }
}

main().catch(console.error);
