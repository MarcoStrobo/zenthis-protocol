const fs = require("fs");
let env = fs.readFileSync(".env", "utf8");

const wallets = {
  WALLET_SEED: "0x17eCC2493f15c7b8265889aC3f44D4b5aE1D0665",
  WALLET_IDO: "0xA8172F86764c34381371B950E4982ab62Cf91D86",
  WALLET_LIQUIDITY: "0xaa6D1BEc62a324bAa8E1cC284e85D70484F3EBaC",
  WALLET_TEAM: "0x47B4e2E8E413FA8444383A83ABDbbc9F370aA269",
  WALLET_TREASURY: "0xe1985d3f16714d202579CF758C9cFd3386bb6FA9",
  WALLET_FOUNDER_OPS: "0xC07c1F4e9c8A5ae0597e53a8494005AF96689130",
  WALLET_AIRDROPS: "0x5412c037f74A56B8749f7A5f4D0579B087c2a4E0",
};

for (const [key, val] of Object.entries(wallets)) {
  const re = new RegExp("^" + key + "=.*", "m");
  if (re.test(env)) {
    env = env.replace(re, key + "=" + val);
  } else {
    env += "\n" + key + "=" + val;
  }
}

fs.writeFileSync(".env", env);
console.log("✅ .env updated");
for (const [k, v] of Object.entries(wallets)) {
  console.log("  " + k + "=" + v);
}
