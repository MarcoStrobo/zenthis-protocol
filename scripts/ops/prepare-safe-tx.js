const { ethers } = require("ethers");
const Safe = require("@safe-global/protocol-kit").default;

const RPC_URL = "https://base-mainnet.infura.io/v3/b111055d4bf6457ca760e294f9901281";
const SAFE_ADDRESS = "0x06C691900069c44B0c312179Fc1AfeAdc71Bc717";
const TOKEN_ADDRESS = "0xCFAeB3678DbC479e26Fd87C2cA7eD0a264f1F6a6";
const SIGNER1_PK = "6002b362928cc2f3636daf8f0b739080f81cfe8ce02d28d6ec51e491fb3d3453";

async function main() {
  console.log("=== PREPARE acceptOwnership FOR SAFE ===\n");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer1 = new ethers.Wallet(SIGNER1_PK, provider);
  const signer1Addr = await signer1.getAddress();
  console.log("Signer 1:", signer1Addr);

  // Create Safe instance
  const safeKit = await Safe.init({
    provider: RPC_URL,
    signer: SIGNER1_PK,
    safeAddress: SAFE_ADDRESS,
  });

  // Create transaction data
  const tokenInterface = new ethers.Interface(["function acceptOwnership()"]);
  const data = tokenInterface.encodeFunctionData("acceptOwnership", []);

  // Create Safe transaction
  const safeTransaction = await safeKit.createTransaction({
    transactions: [
      {
        to: TOKEN_ADDRESS,
        value: "0",
        data: data,
      },
    ],
  });

  // Get safe transaction hash
  const safeTxHash = await safeKit.getTransactionHash(safeTransaction);
  console.log("Safe tx hash:", safeTxHash);

  // Sign with signer 1
  const signature = await safeKit.signHash(safeTxHash);
  console.log("Signed by signer 1:", signature);

  // Get the transaction data in readable format
  console.log("\n=== DATOS PARA SAFE WEB ===");
  console.log("\nPega esto en Safe Web:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("To:", TOKEN_ADDRESS);
  console.log("Value:", "0");
  console.log("Data (hex):", data);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Generate a ready-to-use URL
  const txData = {
    to: TOKEN_ADDRESS,
    value: "0",
    data: data,
    operation: 0,
    safeTxGas: 0,
    baseGas: 0,
    gasPrice: "0",
    gasToken: "0x0000000000000000000000000000000000000000",
    refundReceiver: "0x0000000000000000000000000000000000000000",
    nonce: 1, // will be replaced by Safe
  };

  console.log("\n=== INSTRUCCIONES ===");
  console.log("1. Abre https://app.safe.global/transactions/queue?safe=base:" + SAFE_ADDRESS);
  console.log("2. Conecta la wallet 2 (0x2C54Fd...E35c)");
  console.log("3. Dale a 'New Transaction' → 'Contract Interaction'");
  console.log("4. Address:", TOKEN_ADDRESS);
  console.log(
    '5. Pega este ABI en el campo: [{"inputs":[],"name":"acceptOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"}]',
  );
  console.log("6. Selecciona acceptOwnership() → Submit");
  console.log("7. Firma con ambas wallets");
}

main().catch(console.error);
