const { ethers } = require("ethers");
const provider = new ethers.JsonRpcProvider(
  "https://base-mainnet.infura.io/v3/b111055d4bf6457ca760e294f9901281",
);
const token = new ethers.Contract(
  "0xCFAeB3678DbC479e26Fd87C2cA7eD0a264f1F6a6",
  ["function owner() view returns (address)"],
  provider,
);
token
  .owner()
  .then((owner) => {
    console.log("Token owner:", owner);
    const safeAddr = "0x06C691900069c44B0c312179Fc1AfeAdc71Bc717";
    console.log("Is Safe?", owner.toLowerCase() === safeAddr.toLowerCase() ? "✅ YES" : "❌ NO");
  })
  .catch((e) => console.error("Error:", e.message));
