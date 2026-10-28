require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    // ── Testnets ──────────────────────────────────────────────────────────────
    sepolia: {
      url:      process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      chainId:  11155111,
    },
    arbitrumSepolia: {
      url:      process.env.ARB_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      chainId:  421614,
    },
    // ── Base Sepolia (testnet) ────────────────────────────────────────────────
    baseSepolia: {
      url:      process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      chainId:  84532,
    },
    // ── Mainnet ───────────────────────────────────────────────────────────────
    ethereum: {
      url:      process.env.ETH_RPC_URL || "https://ethereum-rpc.publicnode.com",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      chainId:  1,
      gasPrice: "auto",
    },
    // ── Arbitrum ───────────────────────────────────────────────────────────────
    arbitrum: {
      url:      process.env.ARB_RPC_URL || "https://arbitrum-rpc.publicnode.com",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      chainId:  42161,
      gasPrice: "auto",
    },
    // ── Polygon ────────────────────────────────────────────────────────────────
    polygon: {
      url:      process.env.POL_RPC_URL || "https://polygon-rpc.com",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      chainId:  137,
      gasPrice: "auto",
    },
    // ── BNB Chain ─────────────────────────────────────────────────────────────
    bsc: {
      url:      process.env.BNB_RPC_URL || "https://binance.llamarpc.com",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      chainId:  56,
      gasPrice: "auto",
    },
    // ── Avalanche ─────────────────────────────────────────────────────────────
    avalanche: {
      url:      process.env.AVAX_RPC_URL || "https://avalanche-rpc.publicnode.com",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      chainId:  43114,
      gasPrice: "auto",
    },
    // ── Base (production) ─────────────────────────────────────────────────────
    base: {
      url:      process.env.BASE_RPC_URL || "https://mainnet.base.org",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      chainId:  8453,
      gasPrice: "auto",
    },
  },
  etherscan: {
    // Etherscan API v2 — single key + chainid covers all 60+ chains
    // https://docs.etherscan.io/v2-migration
    apiKey: process.env.ETHERSCAN_API_KEY || "",
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=8453",
          browserURL: "https://basescan.org",
        },
      },
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=84532",
          browserURL: "https://sepolia.basescan.org",
        },
      },
    ],
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
  },
  paths: {
    sources:   "./contracts",
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts",
  },
};
