// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title ZenthisHTLC
 * @notice Hash Time-Lock Contract for cross-chain atomic swaps (ETH and ERC-20).
 *
 * Flow (ETH):
 *   1. Initiator calls newSwap()      — locks ETH, sets hashlock (sha256) + timelock.
 *      swapId is computed deterministically from initiator + params + chain + nonce.
 *   2. Recipient (or anyone with preimage) calls redeem() before timelock
 *   3. If unredeemed, initiator calls refund() after timelock
 *
 * Flow (ERC-20):
 *   1. Initiator approves this contract, calls newSwapToken()
 *   2. Recipient calls redeem() — tokens go to recipient
 *   3. Initiator calls refund() after timelock — tokens return to initiator
 *
 * Security:
 *   - swapId is NOT user-supplied: it is derived from msg.sender, recipient,
 *     hashlock, timelock, chainid and a per-initiator nonce. This eliminates
 *     the swap-ID front-running vector (M-01 / SWC-114).
 *   - Fee deduction: _calcFee() before state mutation (Checks-Effects-Interactions).
 *   - ReentrancyGuard on all external state-changing functions.
 *   - redeem() enforces block.timestamp < timelock so expired swaps are
 *     exclusively refundable (H-02 fix).
 *
 * Compatibility:
 *   - Fee-on-transfer / rebasing tokens are NOT supported. The contract
 *     does not measure pre/post transfer balances (M-01).
 *
 * Protocol fee (optional):
 *   feeBps — basis points deducted from the locked amount on swap creation
 *            (e.g. 10 = 0.1%). Fees accumulate in this contract and are
 *            withdrawn by the owner via withdrawFees().
 *
 * Hashlock: sha256(abi.encodePacked(preimage))
 * Timelock: absolute Unix timestamp; must be > MIN_TIMELOCK from now
 *           and < MAX_TIMELOCK from now.
 */
contract ZenthisHTLC is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -- Constants
    uint256 public constant MIN_TIMELOCK_DELTA =  5 minutes;
    uint256 public constant MAX_TIMELOCK_DELTA =  2 days;
    uint256 public constant MAX_FEE_BPS        =  500;

    // -- Swap status
    enum Status { EMPTY, ACTIVE, REDEEMED, REFUNDED }

    // -- Swap record
    struct Swap {
        address  initiator;
        address  recipient;
        address  token;
        uint256  amount;
        bytes32  hashlock;
        uint256  timelock;
        Status   status;
    }

    // -- Storage
    mapping(bytes32 => Swap) private _swaps;
    mapping(address => uint256) private _nonces; // per-initiator nonce for swapId derivation

    uint256 public feeBps;
    uint256 public collectedEthFees;
    mapping(address => uint256) public collectedTokenFees;

    // -- Events
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
    event FeeBpsUpdated(uint256 oldBps, uint256 newBps);
    event FeesWithdrawn(address indexed token, address indexed to, uint256 amount);

    // -- Constructor
    constructor() Ownable(msg.sender) {}

    receive() external payable { revert("HTLC: use newSwap()"); }
    fallback() external payable { revert("HTLC: use newSwap()"); }

    // -- Internal helpers

    /// @notice Compute a deterministic, collision-resistant swap ID.
    /// @dev The nonce is per-initiator, preventing front-runners from occupying the ID.
    function _nextSwapId(
        address recipient,
        bytes32 hashlock,
        uint256 timelock
    ) internal returns (bytes32) {
        uint256 nonce = _nonces[msg.sender]++;
        return keccak256(abi.encodePacked(
            msg.sender, recipient, hashlock, timelock, block.chainid, nonce
        ));
    }

    function _validateSwapParams(
        address recipient,
        uint256 timelock
    ) internal view {
        require(recipient != address(0),               "HTLC: invalid recipient");
        require(recipient != msg.sender,               "HTLC: self-swap not allowed");
        require(timelock >= block.timestamp + MIN_TIMELOCK_DELTA, "HTLC: timelock too short");
        require(timelock <= block.timestamp + MAX_TIMELOCK_DELTA, "HTLC: timelock too long");
    }

    function _calcFee(uint256 gross) internal view returns (uint256 fee, uint256 net) {
        fee = (gross * feeBps) / 10_000;
        net = gross - fee;
    }

    // -- newSwap (ETH)

    /// @notice Create an atomic swap, locking ETH. swapId is derived from params + nonce.
    /// @return swapId The deterministic identifier for this swap.
    function newSwap(
        address recipient,
        bytes32 hashlock,
        uint256 timelock
    ) external payable whenNotPaused nonReentrant returns (bytes32 swapId) {
        require(msg.value > 0, "HTLC: amount must be > 0");
        _validateSwapParams(recipient, timelock);

        (uint256 fee, uint256 net) = _calcFee(msg.value);
        if (fee > 0) collectedEthFees += fee;

        swapId = _nextSwapId(recipient, hashlock, timelock);

        _swaps[swapId] = Swap({
            initiator: msg.sender,
            recipient: recipient,
            token:     address(0),
            amount:    net,
            hashlock:  hashlock,
            timelock:  timelock,
            status:    Status.ACTIVE
        });

        emit SwapCreated(swapId, msg.sender, recipient, address(0), net, hashlock, timelock);
    }

    // -- newSwapToken (ERC-20)

    /// @notice Create an atomic swap, locking ERC-20 tokens. swapId is derived from params + nonce.
    /// @return swapId The deterministic identifier for this swap.
    function newSwapToken(
        address recipient,
        address tokenAddr,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelock
    ) external whenNotPaused nonReentrant returns (bytes32 swapId) {
        require(amount > 0,               "HTLC: amount must be > 0");
        require(tokenAddr != address(0),  "HTLC: invalid token");
        _validateSwapParams(recipient, timelock);

        (uint256 fee, uint256 net) = _calcFee(amount);

        IERC20(tokenAddr).safeTransferFrom(msg.sender, address(this), amount);
        if (fee > 0) collectedTokenFees[tokenAddr] += fee;

        swapId = _nextSwapId(recipient, hashlock, timelock);

        _swaps[swapId] = Swap({
            initiator: msg.sender,
            recipient: recipient,
            token:     tokenAddr,
            amount:    net,
            hashlock:  hashlock,
            timelock:  timelock,
            status:    Status.ACTIVE
        });

        emit SwapCreated(swapId, msg.sender, recipient, tokenAddr, net, hashlock, timelock);
    }

    // -- redeem (ETH + ERC-20)

    function redeem(bytes32 swapId, bytes32 preimage) external nonReentrant {
        Swap storage s = _swaps[swapId];
        require(s.status == Status.ACTIVE, "HTLC: swap not active");
        require(block.timestamp < s.timelock,  "HTLC: swap expired");
        require(
            sha256(abi.encodePacked(preimage)) == s.hashlock,
            "HTLC: invalid preimage"
        );

        s.status = Status.REDEEMED;

        if (s.token == address(0)) {
            (bool ok, ) = s.recipient.call{value: s.amount}("");
            require(ok, "HTLC: ETH transfer failed");
        } else {
            IERC20(s.token).safeTransfer(s.recipient, s.amount);
        }

        emit SwapRedeemed(swapId, abi.encodePacked(preimage));
    }

    // -- refund (ETH + ERC-20)

    function refund(bytes32 swapId) external nonReentrant {
        Swap storage s = _swaps[swapId];
        require(s.status == Status.ACTIVE,     "HTLC: swap not active");
        require(block.timestamp >= s.timelock, "HTLC: timelock not expired");
        require(msg.sender == s.initiator,     "HTLC: only initiator can refund");

        s.status = Status.REFUNDED;

        if (s.token == address(0)) {
            (bool ok, ) = s.initiator.call{value: s.amount}("");
            require(ok, "HTLC: ETH refund failed");
        } else {
            IERC20(s.token).safeTransfer(s.initiator, s.amount);
        }

        emit SwapRefunded(swapId);
    }

    // -- Views

    function getSwap(bytes32 swapId) external view returns (Swap memory) {
        return _swaps[swapId];
    }

    function isActive(bytes32 swapId) external view returns (bool) {
        return _swaps[swapId].status == Status.ACTIVE;
    }

    // -- Admin

    function setFeeBps(uint256 bps) external onlyOwner {
        require(bps <= MAX_FEE_BPS, "HTLC: fee too high");
        uint256 oldBps = feeBps;
        feeBps = bps;
        emit FeeBpsUpdated(oldBps, bps);
    }

    function withdrawEthFees(address payable to) external onlyOwner nonReentrant {
        require(to != address(0), "HTLC: invalid address");
        uint256 amount = collectedEthFees;
        require(amount > 0, "HTLC: no ETH fees");
        collectedEthFees = 0;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "HTLC: ETH withdrawal failed");
        emit FeesWithdrawn(address(0), to, amount);
    }

    function withdrawTokenFees(address tokenAddr, address to) external onlyOwner nonReentrant {
        require(to != address(0), "HTLC: invalid address");
        uint256 amount = collectedTokenFees[tokenAddr];
        require(amount > 0, "HTLC: no token fees");
        collectedTokenFees[tokenAddr] = 0;
        IERC20(tokenAddr).safeTransfer(to, amount);
        emit FeesWithdrawn(tokenAddr, to, amount);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}