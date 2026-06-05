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
 *   3. If unredeemed, anyone calls refund() after timelock — funds return to initiator
 *
 * Flow (ERC-20):
 *   1. Initiator approves this contract, calls newSwapToken()
 *   2. Recipient calls redeem() — tokens go to recipient
 *   3. Anyone calls refund() after timelock — tokens return to initiator
 *
 * Security:
 *   - swapId is NOT user-supplied: it is derived from msg.sender, recipient,
 *     hashlock, timelock, chainid and a per-initiator nonce. This eliminates
 *     the swap-ID front-running vector.
 *   - Fee deduction via _calcFee() before state mutation (Checks-Effects-Interactions).
 *   - ReentrancyGuard on all external state-changing functions.
 *   - redeem() enforces block.timestamp < timelock so expired swaps are
 *     exclusively refundable.
 *   - refund() is permissionless — no liveness dependency on the initiator.
 *
 * Compatibility:
 *   - Fee-on-transfer / rebasing tokens are NOT supported. The contract
 *     does not measure pre/post transfer balances.
 *
 * Protocol fee (optional):
 *   feeBps — basis points deducted from the locked amount on swap creation
 *            (e.g. 10 = 0.1%). Fees accumulate in this contract and are
 *            withdrawn by the owner via withdrawEthFees() / withdrawTokenFees().
 *
 * Hashlock: sha256(abi.encodePacked(preimage))
 * Timelock: absolute Unix timestamp; must be > MIN_TIMELOCK from now
 *           and < MAX_TIMELOCK from now.
 */
contract ZenthisHTLC is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -- Constants
    /// @notice Minimum timelock delta from creation (5 minutes).
    uint256 public constant MIN_TIMELOCK_DELTA =  5 minutes;
    /// @notice Maximum timelock delta from creation (2 days).
    uint256 public constant MAX_TIMELOCK_DELTA =  2 days;
    /// @notice Maximum fee basis points (500 = 5%).
    uint256 public constant MAX_FEE_BPS        =  500;

    // -- Swap status
    /// @notice Lifecycle state of a swap.
    enum Status { EMPTY, ACTIVE, REDEEMED, REFUNDED }

    // -- Swap record
    /// @notice Full swap data stored on-chain.
    struct Swap {
        address  initiator;
        address  recipient;
        address  token;   // address(0) for ETH swaps
        uint256  amount;  // net amount after fee deduction
        bytes32  hashlock;
        uint256  timelock;
        Status   status;
    }

    // -- Storage
    mapping(bytes32 => Swap) private _swaps;
    mapping(address => uint256) private _nonces; // per-initiator nonce for swapId derivation

    /// @notice Current protocol fee in basis points.
    uint256 public feeBps;
    /// @notice Accumulated ETH protocol fees.
    uint256 public collectedEthFees;
    /// @notice Accumulated ERC-20 protocol fees per token address.
    mapping(address => uint256) public collectedTokenFees;

    // -- Events
    /// @notice Emitted when a new swap is created.
    /// @param swapId    Deterministic identifier for the swap.
    /// @param initiator Address that locked the funds.
    /// @param recipient Address that can redeem the funds.
    /// @param token     Token address (0x0 for ETH).
    /// @param amount    Net amount locked (after fee).
    /// @param hashlock  SHA-256 hash of the preimage.
    /// @param timelock  Unix timestamp after which the swap can be refunded.
    event SwapCreated(
        bytes32 indexed swapId,
        address indexed initiator,
        address indexed recipient,
        address  token,
        uint256  amount,
        bytes32  hashlock,
        uint256  timelock
    );
    /// @notice Emitted when a swap is redeemed.
    event SwapRedeemed(bytes32 indexed swapId, bytes preimage);
    /// @notice Emitted when a swap is refunded.
    event SwapRefunded(bytes32 indexed swapId);
    /// @notice Emitted when the protocol fee is changed.
    event FeeBpsUpdated(uint256 oldBps, uint256 newBps);
    /// @notice Emitted when accumulated fees are withdrawn.
    /// @param token Token address (0x0 for ETH).
    event FeesWithdrawn(address indexed token, address indexed to, uint256 amount);

    // -- Constructor
    /// @notice Deploys the contract. Sets deployer as initial owner.
    constructor() Ownable(msg.sender) {}

    /// @notice Reject direct ETH sends; use newSwap().
    receive() external payable { revert("HTLC: use newSwap()"); }
    /// @notice Reject unknown function calls; use newSwap().
    fallback() external payable { revert("HTLC: use newSwap()"); }

    // -- Internal helpers

    /// @notice Compute a deterministic, collision-resistant swap ID.
    /// @dev The nonce is per-initiator, preventing front-runners from occupying the ID.
    /// @param recipient The intended swap recipient.
    /// @param hashlock  The SHA-256 hashlock to satisfy.
    /// @param timelock  The absolute Unix expiry timestamp.
    /// @return A unique bytes32 swap identifier.
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

    /// @notice Validate common swap creation parameters.
    /// @dev Reverts if recipient is zero, self-swap is attempted, or timelock is out of bounds.
    /// @param recipient The intended swap recipient.
    /// @param timelock  The absolute Unix expiry timestamp.
    function _validateSwapParams(
        address recipient,
        uint256 timelock
    ) internal view {
        require(recipient != address(0),               "HTLC: invalid recipient");
        require(recipient != msg.sender,               "HTLC: self-swap not allowed");
        require(timelock >= block.timestamp + MIN_TIMELOCK_DELTA, "HTLC: timelock too short");
        require(timelock <= block.timestamp + MAX_TIMELOCK_DELTA, "HTLC: timelock too long");
    }

    /// @notice Calculate protocol fee from a gross amount.
    /// @param gross The full lock amount before fee.
    /// @return fee The protocol fee deducted.
    /// @return net  The net amount after fee (gross - fee).
    function _calcFee(uint256 gross) internal view returns (uint256 fee, uint256 net) {
        fee = (gross * feeBps) / 10_000;
        net = gross - fee;
    }

    // -- newSwap (ETH)

    /// @notice Lock ETH in a new atomic swap.
    /// @dev Emits SwapCreated with the deterministic swapId. Fee is deducted automatically.
    ///      The swapId is returned so the initiator can share it with the recipient.
    /// @param recipient Address that can redeem by supplying the preimage.
    /// @param hashlock  SHA-256 hash of the preimage that satisfies the swap.
    /// @param timelock  Absolute Unix timestamp after which the swap expires.
    /// @return swapId   The deterministic identifier for this swap.
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

    /// @notice Lock ERC-20 tokens in a new atomic swap.
    /// @dev The caller must have approved this contract to spend `amount` tokens.
    ///      Fee is deducted automatically; the recipient receives the net amount.
    /// @param recipient Address that can redeem by supplying the preimage.
    /// @param tokenAddr The ERC-20 token address.
    /// @param amount    Gross amount of tokens to lock (fee deducted on top).
    /// @param hashlock  SHA-256 hash of the preimage that satisfies the swap.
    /// @param timelock  Absolute Unix timestamp after which the swap expires.
    /// @return swapId   The deterministic identifier for this swap.
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

    /// @notice Redeem a swap by providing the preimage.
    /// @dev Funds are transferred to s.recipient regardless of msg.sender.
    ///      Reverts if swap is expired (block.timestamp >= s.timelock).
    /// @param swapId   The swap identifier to redeem.
    /// @param preimage The secret whose SHA-256 hash matches the swap's hashlock.
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

    /// @notice Refund an expired swap (anyone can call; funds always go to initiator).
    /// @dev Permissionless: if the initiator is offline, any third party can trigger the refund.
    ///      Reverts if the swap is still active (block.timestamp < s.timelock).
    /// @param swapId The swap identifier to refund.
    function refund(bytes32 swapId) external nonReentrant {
        Swap storage s = _swaps[swapId];
        require(s.status == Status.ACTIVE,     "HTLC: swap not active");
        require(block.timestamp >= s.timelock, "HTLC: timelock not expired");

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

    /// @notice Get the full swap data for a given swap ID.
    /// @param swapId The swap identifier.
    /// @return The Swap struct (initiator, recipient, token, amount, hashlock, timelock, status).
    function getSwap(bytes32 swapId) external view returns (Swap memory) {
        return _swaps[swapId];
    }

    /// @notice Returns the current nonce for a given account.
    /// @dev Used by off-chain clients to pre-compute swapId before submitting a transaction.
    /// @param account The initiator address to query.
    /// @return The current nonce value.
    function getNonce(address account) external view returns (uint256) {
        return _nonces[account];
    }

    /// @notice Check whether a swap is still active (unredeemed and unrefunded).
    /// @param swapId The swap identifier.
    /// @return true if the swap status is ACTIVE, false otherwise.
    function isActive(bytes32 swapId) external view returns (bool) {
        return _swaps[swapId].status == Status.ACTIVE;
    }

    // -- Admin

    /// @notice Set the protocol fee in basis points.
    /// @param bps New fee value (capped at MAX_FEE_BPS = 500 = 5%).
    function setFeeBps(uint256 bps) external onlyOwner {
        require(bps <= MAX_FEE_BPS, "HTLC: fee too high");
        uint256 oldBps = feeBps;
        feeBps = bps;
        emit FeeBpsUpdated(oldBps, bps);
    }

    /// @notice Withdraw accumulated ETH protocol fees.
    /// @param to Recipient of the withdrawn fees. Must be non-zero.
    function withdrawEthFees(address payable to) external onlyOwner nonReentrant {
        require(to != address(0), "HTLC: invalid address");
        uint256 amount = collectedEthFees;
        require(amount > 0, "HTLC: no ETH fees");
        collectedEthFees = 0;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "HTLC: ETH withdrawal failed");
        emit FeesWithdrawn(address(0), to, amount);
    }

    /// @notice Withdraw accumulated ERC-20 protocol fees for a specific token.
    /// @param tokenAddr The ERC-20 token address whose fees to withdraw.
    /// @param to        Recipient of the withdrawn tokens. Must be non-zero.
    function withdrawTokenFees(address tokenAddr, address to) external onlyOwner nonReentrant {
        require(to != address(0), "HTLC: invalid address");
        uint256 amount = collectedTokenFees[tokenAddr];
        require(amount > 0, "HTLC: no token fees");
        collectedTokenFees[tokenAddr] = 0;
        IERC20(tokenAddr).safeTransfer(to, amount);
        emit FeesWithdrawn(tokenAddr, to, amount);
    }

    /// @notice Pause all swap creation (emergency stop).
    function pause()   external onlyOwner { _pause(); }
    /// @notice Unpause swap creation.
    function unpause() external onlyOwner { _unpause(); }
}
