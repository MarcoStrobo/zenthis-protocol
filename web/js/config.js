/* Shared swap configuration. Fill after deploying ZenthisHTLC and funding the LP. */

// ZenthisHTLC address per chain key (see CHAINS in app.js).
export const HTLC_ADDRESSES = {
  ETH: '', ARB: '', POL: '', BNB: '', AVAX: '', BASE: ''
};

// Liquidity provider that locks the counter-leg on the destination chain.
export const LP_ADDRESS = '';

// Minimal ABI used by the swap flow and the "My swaps" panel.
export const HTLC_ABI = [
  'function newSwap(address recipient, bytes32 hashlock, uint256 timelock) external payable returns (bytes32 swapId)',
  'function newSwapToken(address recipient, address tokenAddr, uint256 amount, bytes32 hashlock, uint256 timelock) external returns (bytes32 swapId)',
  'function redeem(bytes32 swapId, bytes32 preimage) external',
  'function refund(bytes32 swapId) external',
  'function getSwap(bytes32 swapId) view returns (tuple(address initiator, address recipient, address token, uint256 amount, bytes32 hashlock, uint256 timelock, uint8 status))',
  'event SwapCreated(bytes32 indexed swapId, address indexed initiator, address indexed recipient, address token, uint256 amount, bytes32 hashlock, uint256 timelock)'
];

// Chain keys -> numeric chain id / label (mirrors CHAINS in app.js).
export const CHAIN_INFO = {
  ETH:  { id: 1,     label: 'Ethereum' },
  ARB:  { id: 42161, label: 'Arbitrum' },
  POL:  { id: 137,   label: 'Polygon' },
  BNB:  { id: 56,    label: 'BNB Chain' },
  AVAX: { id: 43114, label: 'Avalanche' },
  BASE: { id: 8453,  label: 'Base' }
};

export const SWAP_STORE_KEY = 'zenthis_swaps';
