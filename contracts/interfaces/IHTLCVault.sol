// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IHTLCVault
/// @notice Interface for the Zenthis Hash Time-Locked Contract vault
interface IHTLCVault {

    enum SwapState { PENDING, CLAIMED, REFUNDED }

    struct Swap {
        address initiator;
        address recipient;
        address token;
        uint256 amount;
        bytes32 hashlock;
        uint256 timelock;
        SwapState state;
    }

    event SwapInitiated(
        bytes32 indexed swapId,
        address indexed initiator,
        address indexed recipient,
        address token,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelock
    );
    event SwapClaimed(bytes32 indexed swapId, bytes32 preimage);
    event SwapRefunded(bytes32 indexed swapId);

    function initSwap(
        bytes32 swapId,
        address recipient,
        address token,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelockDuration
    ) external;

    function claim(bytes32 swapId, bytes32 preimage) external;

    function refund(bytes32 swapId) external;

    function getSwap(bytes32 swapId) external view returns (Swap memory);

    function isClaimable(bytes32 swapId, bytes32 preimage) external view returns (bool);

    function isRefundable(bytes32 swapId) external view returns (bool);
}
