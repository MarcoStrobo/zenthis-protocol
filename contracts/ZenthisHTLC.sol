// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ZenthisHTLC
 * @notice Hash Time-Lock Contract for cross-chain atomic ETH swaps.
 *
 * Flow:
 *   1. Initiator calls newSwap() — locks ETH, sets hashlock (sha256) + timelock
 *   2. Recipient (or anyone holding the preimage) calls redeem() before timelock
 *   3. If unredeemed, initiator calls refund() after timelock
 *
 * Hashlock: sha256(abi.encodePacked(preimage))
 * Timelock: absolute Unix timestamp; must be > MIN_TIMELOCK from now
 *           and < MAX_TIMELOCK from now.
 */
contract ZenthisHTLC is Ownable, Pausable, ReentrancyGuard {

    // ── Constants ──────────────────────────────────────────────────────────────
    uint256 public constant MIN_TIMELOCK_DELTA =  5 minutes;   //  300 s  (60 s < this)
    uint256 public constant MAX_TIMELOCK_DELTA =  2 days;      // 172800 s (3 days > this)

    // ── Swap status ───────────────────────────────────────────────────────────
    enum Status { EMPTY, ACTIVE, REDEEMED, REFUNDED }

    // ── Swap record ───────────────────────────────────────────────────────────
    struct Swap {
        address  initiator;
        address  recipient;
        address  token;        // address(0) = native ETH
        uint256  amount;
        bytes32  hashlock;
        uint256  timelock;
        Status   status;
    }

    // ── Storage ───────────────────────────────────────────────────────────────
    mapping(bytes32 => Swap) private _swaps;

    // ── Events ────────────────────────────────────────────────────────────────
    event SwapCreated(
        bytes32 indexed swapId,
        address indexed initiator,
        address indexed recipient,
        address  token,
        uint256  amount,
        bytes32  hashlock,
        uint256  timelock
    );

    event SwapRedeemed(bytes32 indexed swapId, bytes preimage);
    event SwapRefunded(bytes32 indexed swapId);

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor() Ownable(msg.sender) {}

    // ── Reject plain ETH transfers ────────────────────────────────────────────
    receive() external payable {
        revert("HTLC: use newSwap()");
    }

    fallback() external payable {
        revert("HTLC: use newSwap()");
    }

    // ── newSwap ───────────────────────────────────────────────────────────────

    /**
     * @notice Create a new ETH HTLC swap.
     * @param swapId   Unique identifier chosen by initiator (bytes32).
     * @param recipient  Address that can redeem with correct preimage.
     * @param hashlock   sha256(abi.encodePacked(preimage)).
     * @param timelock   Absolute Unix timestamp after which refund is possible.
     */
    function newSwap(
        bytes32 swapId,
        address recipient,
        bytes32 hashlock,
        uint256 timelock
    ) external payable whenNotPaused nonReentrant {
        require(msg.value > 0,                        "HTLC: amount must be > 0");
        require(recipient != address(0),              "HTLC: invalid recipient");
        require(recipient != msg.sender,              "HTLC: self-swap not allowed");
        require(_swaps[swapId].status == Status.EMPTY, "HTLC: swap ID already used");
        require(
            timelock >= block.timestamp + MIN_TIMELOCK_DELTA,
            "HTLC: timelock too short"
        );
        require(
            timelock <= block.timestamp + MAX_TIMELOCK_DELTA,
            "HTLC: timelock too long"
        );

        _swaps[swapId] = Swap({
            initiator: msg.sender,
            recipient: recipient,
            token:     address(0),
            amount:    msg.value,
            hashlock:  hashlock,
            timelock:  timelock,
            status:    Status.ACTIVE
        });

        emit SwapCreated(
            swapId,
            msg.sender,
            recipient,
            address(0),
            msg.value,
            hashlock,
            timelock
        );
    }

    // ── redeem ────────────────────────────────────────────────────────────────

    /**
     * @notice Redeem a swap by providing the preimage.
     *         Anyone holding the correct preimage can trigger settlement;
     *         ETH always goes to the designated recipient.
     * @param swapId   Swap identifier.
     * @param preimage Secret bytes whose sha256 matches the hashlock.
     */
    function redeem(bytes32 swapId, bytes32 preimage) external nonReentrant {
        Swap storage s = _swaps[swapId];
        require(s.status == Status.ACTIVE, "HTLC: swap not active");
        require(
            sha256(abi.encodePacked(preimage)) == s.hashlock,
            "HTLC: invalid preimage"
        );

        s.status = Status.REDEEMED;

        (bool ok, ) = s.recipient.call{value: s.amount}("");
        require(ok, "HTLC: ETH transfer failed");

        emit SwapRedeemed(swapId, abi.encodePacked(preimage));
    }

    // ── refund ────────────────────────────────────────────────────────────────

    /**
     * @notice Refund a timed-out swap back to the initiator.
     *         Only callable by the original initiator after timelock expires.
     * @param swapId  Swap identifier.
     */
    function refund(bytes32 swapId) external nonReentrant {
        Swap storage s = _swaps[swapId];
        require(s.status == Status.ACTIVE,          "HTLC: swap not active");
        require(block.timestamp >= s.timelock,      "HTLC: timelock not expired");
        require(msg.sender == s.initiator,          "HTLC: only initiator can refund");

        s.status = Status.REFUNDED;

        (bool ok, ) = s.initiator.call{value: s.amount}("");
        require(ok, "HTLC: ETH refund failed");

        emit SwapRefunded(swapId);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function getSwap(bytes32 swapId) external view returns (Swap memory) {
        return _swaps[swapId];
    }

    function isActive(bytes32 swapId) external view returns (bool) {
        return _swaps[swapId].status == Status.ACTIVE;
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
