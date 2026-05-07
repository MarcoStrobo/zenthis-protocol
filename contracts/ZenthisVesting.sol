// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title  ZenthisVesting
 * @notice Multi-schedule linear vesting contract for ZENTHIS token.
 *
 * Tokenomics (100 M total):
 * ┌──────────────────────┬─────────┬────────────┬────────┬────────────────────────┐
 * │ Allocation           │ Tokens  │ TGE Unlock │ Cliff  │ Linear Vesting         │
 * ├──────────────────────┼─────────┼────────────┼────────┼────────────────────────┤
 * │ Seed                 │  15 M   │     0 %    │  6 mo  │ 24 months              │
 * │ IDO                  │  25 M   │    20 %    │  0 mo  │ 18 months (on 80%)     │
 * │ Liquidity & Reserves │  25 M   │    14 %    │  0 mo  │ 48 months (on 86%)     │
 * │ Team                 │  20 M   │     0 %    │ 12 mo  │ 36 months              │
 * │ Treasury             │  10 M   │    15 %    │  0 mo  │ 48 months (on 85%)     │
 * │ Airdrops             │   5 M   │   100 %    │   —    │ —                      │
 * └──────────────────────┴─────────┴────────────┴────────┴────────────────────────┘
 *
 * Each schedule is identified by a bytes32 key (use the public constants).
 * Schedules are write-once: once created they cannot be modified or revoked.
 */
contract ZenthisVesting is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Types ────────────────────────────────────────────────────────────────

    struct Schedule {
        address beneficiary;
        uint256 totalAmount;      // Tokens subject to linear vesting (excl. tgeAmount)
        uint256 tgeAmount;        // Released immediately at startTime
        uint64  startTime;        // Unix timestamp of TGE / vesting start
        uint64  cliffDuration;    // Seconds before linear vesting begins
        uint64  vestingDuration;  // Seconds of linear vesting (after cliff)
        uint256 released;         // Cumulative tokens already claimed
        bool    initialized;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20 public immutable token;

    mapping(bytes32 => Schedule) private _schedules;
    bytes32[] private _scheduleIds;

    // ─── Schedule ID constants ────────────────────────────────────────────────

    bytes32 public constant SEED      = keccak256("SEED");
    bytes32 public constant IDO       = keccak256("IDO");
    bytes32 public constant LIQUIDITY = keccak256("LIQUIDITY");
    bytes32 public constant TEAM      = keccak256("TEAM");
    bytes32 public constant TREASURY  = keccak256("TREASURY");
    bytes32 public constant AIRDROPS  = keccak256("AIRDROPS");

    // ─── Duration constants (30-day months) ──────────────────────────────────

    uint64 public constant MONTH = 30 days;

    // ─── Errors ───────────────────────────────────────────────────────────────

    error ZeroAddress();
    error ZeroAllocation();
    error ZeroVestingDuration();
    error ScheduleAlreadyExists(bytes32 id);
    error ScheduleNotFound(bytes32 id);
    error NotBeneficiary(bytes32 id);
    error NothingToRelease(bytes32 id);
    error StartTimeInPast();

    // ─── Events ───────────────────────────────────────────────────────────────

    event ScheduleCreated(
        bytes32 indexed id,
        address indexed beneficiary,
        uint256 totalAmount,
        uint256 tgeAmount,
        uint64  startTime,
        uint64  cliffDuration,
        uint64  vestingDuration
    );

    event TokensReleased(
        bytes32 indexed id,
        address indexed beneficiary,
        uint256 amount
    );

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address tokenAddress, address initialOwner) Ownable(initialOwner) {
        if (tokenAddress == address(0)) revert ZeroAddress();
        token = IERC20(tokenAddress);
    }

    // ─── Admin: create schedule ───────────────────────────────────────────────

    /**
     * @notice Register a new vesting schedule. Write-once; cannot be changed.
     *
     * @param id              Unique schedule identifier (use the public constants).
     * @param beneficiary     Address that may call release().
     * @param totalAmount     Tokens subject to cliff+linear vesting (excl. tgeAmount).
     * @param tgeAmount       Tokens released the moment startTime is reached.
     * @param startTime       Unix timestamp of TGE.
     * @param cliffMonths     Months of cliff (no vesting, TGE unlock still applies).
     * @param vestingMonths   Months of linear vesting after the cliff.
     *
     * @dev The caller must have already transferred (totalAmount + tgeAmount)
     *      tokens to this contract before (or shortly after) calling this function.
     */
    function createSchedule(
        bytes32 id,
        address beneficiary,
        uint256 totalAmount,
        uint256 tgeAmount,
        uint64  startTime,
        uint64  cliffMonths,
        uint64  vestingMonths
    ) external onlyOwner {
        if (_schedules[id].initialized)           revert ScheduleAlreadyExists(id);
        if (beneficiary == address(0))             revert ZeroAddress();
        if (totalAmount == 0 && tgeAmount == 0)    revert ZeroAllocation();
        if (totalAmount > 0 && vestingMonths == 0) revert ZeroVestingDuration();
        if (startTime < block.timestamp)           revert StartTimeInPast();

        uint64 cliffDuration   = cliffMonths   * MONTH;
        uint64 vestingDuration = vestingMonths * MONTH;

        _schedules[id] = Schedule({
            beneficiary:     beneficiary,
            totalAmount:     totalAmount,
            tgeAmount:       tgeAmount,
            startTime:       startTime,
            cliffDuration:   cliffDuration,
            vestingDuration: vestingDuration,
            released:        0,
            initialized:     true
        });
        _scheduleIds.push(id);

        emit ScheduleCreated(
            id, beneficiary, totalAmount, tgeAmount,
            startTime, cliffDuration, vestingDuration
        );
    }

    // ─── Beneficiary: claim ───────────────────────────────────────────────────

    /**
     * @notice Transfer all currently releasable tokens to the beneficiary.
     * @param id  Schedule identifier.
     */
    function release(bytes32 id) external nonReentrant {
        Schedule storage s = _schedules[id];
        if (!s.initialized)              revert ScheduleNotFound(id);
        if (msg.sender != s.beneficiary) revert NotBeneficiary(id);

        uint256 releasable = _releasableOf(s);
        if (releasable == 0)             revert NothingToRelease(id);

        s.released += releasable;
        token.safeTransfer(s.beneficiary, releasable);

        emit TokensReleased(id, s.beneficiary, releasable);
    }

    // ─── View functions ───────────────────────────────────────────────────────

    /// @notice All tokens vested so far (cumulative, including already released).
    function vestedAmount(bytes32 id) external view returns (uint256) {
        Schedule storage s = _schedules[id];
        if (!s.initialized) return 0;
        return _vestedAt(s, uint64(block.timestamp));
    }

    /// @notice Tokens that can be claimed right now.
    function releasableAmount(bytes32 id) external view returns (uint256) {
        Schedule storage s = _schedules[id];
        if (!s.initialized) return 0;
        return _releasableOf(s);
    }

    /// @notice Full schedule data for a given ID.
    function getSchedule(bytes32 id) external view returns (Schedule memory) {
        return _schedules[id];
    }

    /// @notice All registered schedule IDs.
    function getScheduleIds() external view returns (bytes32[] memory) {
        return _scheduleIds;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _releasableOf(Schedule storage s) internal view returns (uint256) {
        return _vestedAt(s, uint64(block.timestamp)) - s.released;
    }

    function _vestedAt(Schedule storage s, uint64 ts) internal view returns (uint256) {
        if (ts < s.startTime) return 0;

        uint256 vested = s.tgeAmount;
        if (s.totalAmount == 0) return vested;

        uint64 cliffEnd = s.startTime + s.cliffDuration;
        if (ts < cliffEnd) return vested;

        uint64 elapsed = ts - cliffEnd;
        if (elapsed >= s.vestingDuration) {
            vested += s.totalAmount;
        } else {
            vested += (s.totalAmount * uint256(elapsed)) / uint256(s.vestingDuration);
        }

        return vested;
    }
}
