/* Shared swap configuration. Fill after deploying ZenthisHTLC and funding the LP. */

// ZenthisHTLC address per chain key (see CHAINS in app.js).
export const HTLC_ADDRESSES = {
  ETH: '', ARB: '', POL: '', BNB: '', AVAX: '', BASE: '',
  // Testnets (open /app.html?testnet=1)
  BASE_SEP: '0x3c0328eb23E76B35aaCA9DE1BC98bDcfd53547eB',
  ARB_SEP: '0x3c0328eb23E76B35aaCA9DE1BC98bDcfd53547eB'
};

// Liquidity provider that locks the counter-leg on the destination chain.
export const LP_ADDRESS = '';
export const LP_ADDRESS_TESTNET = '0xb8420eB9c1611D630022b7692181d4325EE0eDfA';

// Minimal ABI used by the swap flow and the "My swaps" panel.
export const HTLC_ABI = [
  'function newSwap(address recipient, bytes32 hashlock, uint256 timelock) external payable returns (bytes32 swapId)',
  'function newSwapToken(address recipient, address tokenAddr, uint256 amount, bytes32 hashlock, uint256 timelock) external returns (bytes32 swapId)',
  'function feeBps() view returns (uint256)',
  'function redeem(bytes32 swapId, bytes32 preimage) external',
  'event SwapRedeemed(bytes32 indexed swapId, bytes preimage)',
  'function refund(bytes32 swapId) external',
  'function getSwap(bytes32 swapId) view returns (tuple(address initiator, address recipient, address token, uint256 amount, bytes32 hashlock, uint256 timelock, uint8 status))',
  'event SwapCreated(bytes32 indexed swapId, address indexed initiator, address indexed recipient, address token, uint256 amount, bytes32 hashlock, uint256 timelock)'
];

// Chain keys -> numeric chain id / label / explorer (mirrors CHAINS in app.js).
export const CHAIN_INFO = {
  ETH:  { id: 1,      label: 'Ethereum',         explorer: 'https://etherscan.io' },
  ARB:  { id: 42161,  label: 'Arbitrum',         explorer: 'https://arbiscan.io' },
  POL:  { id: 137,    label: 'Polygon',          explorer: 'https://polygonscan.com' },
  BNB:  { id: 56,     label: 'BNB Chain',        explorer: 'https://bscscan.com' },
  AVAX: { id: 43114,  label: 'Avalanche',        explorer: 'https://snowtrace.io' },
  BASE: { id: 8453,   label: 'Base',             explorer: 'https://basescan.org' },
  BASE_SEP: { id: 84532,  label: 'Base Sepolia',     explorer: 'https://sepolia.basescan.org' },
  ARB_SEP:  { id: 421614, label: 'Arbitrum Sepolia', explorer: 'https://sepolia.arbiscan.io' }
};

// Public read RPCs (CORS-enabled). Used for balances, LP liquidity and event polling
// without depending on the wallet's current network.
export const CHAIN_RPC = {
  ETH: 'https://ethereum-rpc.publicnode.com',
  ARB: 'https://arbitrum-one-rpc.publicnode.com',
  POL: 'https://polygon-bor-rpc.publicnode.com',
  BNB: 'https://bsc-rpc.publicnode.com',
  AVAX: 'https://avalanche-c-chain-rpc.publicnode.com',
  BASE: 'https://mainnet.base.org',
  BASE_SEP: 'https://sepolia.base.org',
  ARB_SEP: 'https://sepolia-rollup.arbitrum.io/rpc'
};

// Routes the LP bot serves, as [from, to]. Add a pair only when the bot watches it.
export const ROUTES = [
  ['BASE_SEP', 'ARB_SEP'],
  ['ARB_SEP', 'BASE_SEP']
];

// Must match the LP bot (LP_SPREAD_BPS) and its min/max amounts.
export const LP_SPREAD_BPS = 30;
export const SWAP_LIMITS = { min: 0.001, max: 0.1 };
// Gasless claim: the user posts the secret here once the LP has locked on the destination
// chain, and the LP redeems on their behalf (HTLC redeem always pays the recipient, so
// revealing the secret at that point is harmless). Must match LP_RELAY_URL of the bot.
export const RELAY_URL = 'https://ntfy.sh/zenthis-claims-e8039d74d1bae70d7deb';
// Below this destination balance the UI uses the gasless claim instead of a wallet tx.
export const MIN_GAS_BALANCE_ETH = 0.0002;

// Initiator timelock (seconds). The LP locks for this minus 1h, so keep it > 1h30.
export const SWAP_TIMELOCK_SECS = 2 * 3600;

export const SWAP_STORE_KEY = 'zenthis_swaps';
