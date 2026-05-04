// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IHTLCVault.sol";

/// @title HTLCVault
/// @notice Hash Time-Locked Contract vault for Zenthis atomic cross-chain swaps.
/// @dev Initiator locks ERC-20 tokens with a SHA-256 hashlock. The recipient
///      claims funds by revealing the preimage before the timelock expires.
///      If unclaimed, the initiator refunds after expiry. A 0.10% protocol
///      fee is deducted on successful claims.
contract HTLCVault is IHTLCVault, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────────────────────

    /// @notice Protocol fee in basis points (10 bps = 0.10%).
    uint256 public constant FEE_BPS = 10;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Minimum swap timelock duration.
    uint256 public constant MIN_TIMELOCK = 10 minutes;

    /// @notice Maximum swap timelock duration.
    uint256 public constant MAX_TIMELOCK = 48 hours;

    // ─── State ───────────────────────────────────────────────────────────────

    /// @notice Address that receives protocol fees.
    address public immutable feeRecipient;

    /// @notice Cumulative protocol fees collected across all swaps.
    uint256 public totalFeeCollected;

    /// @notice Mapping from swap ID to Swap struct.
    mapping(bytes32 => Swap) private _swaps;

    // ─── Errors ──────────────────────────────────────────────────────────────

    error SwapAlreadyExists();
    error SwapNotFound();
    error SwapNotPending();
    error InvalidHashlock();
    error InvalidTimelock();
    error InvalidAmount();
    error WrongPreimage();
    error TimelockNotExpired();
    error TimelockExpired();
    error NotInitiator();
    error ZeroAddress();

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @param _feeRecipient Address to receive the 0.10% protocol fee on claims.
    constructor(address _feeRecipient) {
        if (_feeRecipient == address(0)) revert ZeroAddress();
        feeRecipient = _feeRecipient;
    }

    // ─── Core functions ──────────────────────────────────────────────────────

    /// @notice Lock ERC-20 tokens in a new HTLC swap.
    /// @param swapId           Unique identifier for this swap (e.g. keccak256 of order params).
    /// @param recipient        Address that can claim the tokens by revealing the preimage.
    /// @param token            ERC-20 token address.
    /// @param amount           Amount of tokens to lock (must be > 0).
    /// @param hashlock         SHA-256 hash of the secret preimage: sha256(abi.encodePacked(preimage)).
    /// @param timelockDuration Duration in seconds until the swap can be refunded [10min, 48h].
    function initSwap(
        bytes32 swapId,
        address recipient,
        address token,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelockDuration
    ) external nonReentrant {
        if (_swaps[swapId].initiator != address(0)) revert SwapAlreadyExists();
        if (recipient == address(0))  revert ZeroAddress();
        if (token == address(0))      revert ZeroAddress();
        if (amount == 0)              revert InvalidAmount();
        if (hashlock == bytes32(0))   revert InvalidHashlock();
        if (timelockDuration < MIN_TIMELOCK || timelockDuration > MAX_TIMELOCK)
            revert InvalidTimelock();

        uint256 timelock = block.timestamp + timelockDuration;

        _swaps[swapId] = Swap({
            initiator: msg.sender,
            recipient: recipient,
            token:     token,
            amount:    amount,
            hashlock:  hashlock,
            timelock:  timelock,
            state:     SwapState.PENDING
        });

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit SwapInitiated(swapId, msg.sender, recipient, token, amount, hashlock, timelock);
    }

    /// @notice Claim locked tokens by revealing the secret preimage.
    /// @dev    A 0.10% fee is deducted and sent to `feeRecipient`.
    /// @param swapId   Swap identifier.
    /// @param preimage Secret preimage whose SHA-256 hash equals the swap's hashlock.
    function claim(bytes32 swapId, bytes32 preimage) external nonReentrant {
        Swap storage swap = _swaps[swapId];

        if (swap.initiator == address(0))       revert SwapNotFound();
        if (swap.state != SwapState.PENDING)    revert SwapNotPending();
        if (block.timestamp >= swap.timelock)   revert TimelockExpired();
        if (sha256(abi.encodePacked(preimage)) != swap.hashlock) revert WrongPreimage();

        swap.state = SwapState.CLAIMED;

        uint256 fee       = (swap.amount * FEE_BPS) / BPS_DENOMINATOR;
        uint256 amountOut = swap.amount - fee;
        totalFeeCollected += fee;

        IERC20(swap.token).safeTransfer(swap.recipient, amountOut);
        if (fee > 0) IERC20(swap.token).safeTransfer(feeRecipient, fee);

        emit SwapClaimed(swapId, preimage);
    }

    /// @notice Refund locked tokens to the initiator after the timelock expires.
    /// @param swapId Swap identifier.
    function refund(bytes32 swapId) external nonReentrant {
        Swap storage swap = _swaps[swapId];

        if (swap.initiator == address(0))       revert SwapNotFound();
        if (swap.state != SwapState.PENDING)    revert SwapNotPending();
        if (block.timestamp < swap.timelock)    revert TimelockNotExpired();
        if (msg.sender != swap.initiator)       revert NotInitiator();

        swap.state = SwapState.REFUNDED;

        IERC20(swap.token).safeTransfer(swap.initiator, swap.amount);

        emit SwapRefunded(swapId);
    }

    // ─── View functions ──────────────────────────────────────────────────────

    /// @notice Return the full Swap struct for a given swap ID.
    function getSwap(bytes32 swapId) external view returns (Swap memory) {
        return _swaps[swapId];
    }

    /// @notice Returns true if the swap can be claimed right now with the given preimage.
    function isClaimable(bytes32 swapId, bytes32 preimage) external view returns (bool) {
        Swap memory swap = _swaps[swapId];
        return swap.state == SwapState.PENDING
            && block.timestamp < swap.timelock
            && sha256(abi.encodePacked(preimage)) == swap.hashlock;
    }

    /// @notice Returns true if the swap can be refunded (timelock expired, still pending).
    function isRefundable(bytes32 swapId) external view returns (bool) {
        Swap memory swap = _swaps[swapId];
        return swap.state == SwapState.PENDING
            && block.timestamp >= swap.timelock;
    }
}
