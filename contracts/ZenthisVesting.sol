// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ZenthisVesting — Multi-schedule linear vesting with cliffs
/// @dev Schedule lifecycle:
///      1. Owner creates schedule via createSchedule() [EMPTY → INITIALIZED]
///      2. Beneficiary releases vested tokens via release()
///      3. Owner cancels before startTime via cancelSchedule() [INITIALIZED → CANCELLED]
contract ZenthisVesting is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    uint64 public constant MONTH = 30 days;

    /// @notice Track total tokens committed across all schedules.
    /// @dev Used to prevent creating schedules that exceed the contract's balance.
    uint256 public totalAllocated;

    enum Status { EMPTY, INITIALIZED, CANCELLED }

    struct Schedule {
        address beneficiary;
        uint256 totalAmount;
        uint256 tgeAmount;
        uint64  startTime;
        uint64  cliffDuration;
        uint64  vestingDuration;
        uint256 released;
        Status  status;
    }

    mapping(bytes32 => Schedule) private schedules;
    bytes32[] private scheduleIds;

    // ── Named schedule identifiers ─────────────────────────────────────────────
    bytes32 public constant SEED        = keccak256("SEED");
    bytes32 public constant IDO         = keccak256("IDO");
    bytes32 public constant LIQUIDITY   = keccak256("LIQUIDITY");
    bytes32 public constant TEAM        = keccak256("TEAM");
    bytes32 public constant TREASURY    = keccak256("TREASURY");
    bytes32 public constant FOUNDER_OPS = keccak256("FOUNDER_OPS");
    bytes32 public constant AIRDROPS    = keccak256("AIRDROPS");

    // ── Events ─────────────────────────────────────────────────────────────────
    event ScheduleCreated(
        bytes32 indexed scheduleId,
        address indexed beneficiary,
        uint256 totalAmount,
        uint256 tgeAmount,
        uint64  startTime,
        uint64  cliffDuration,
        uint64  vestingDuration
    );
    event TokensReleased(bytes32 indexed scheduleId, address indexed beneficiary, uint256 amount);
    event ScheduleCancelled(bytes32 indexed scheduleId, uint256 recoveredAmount);

    // ── Errors ─────────────────────────────────────────────────────────────────
    error ZeroAddress();
    error ZeroAllocation();
    error ZeroVestingDuration();
    error StartTimeInPast();
    error ScheduleAlreadyExists();
    error ScheduleNotFound();
    error NotBeneficiary();
    error NothingToRelease();
    error ScheduleActive();
    error InsufficientContractBalance();

    // ── Constructor ────────────────────────────────────────────────────────────
    constructor(address _token, address _owner) Ownable(_owner) {
        if (_token == address(0)) revert ZeroAddress();
        token = IERC20(_token);
    }

    // ── Owner: create schedule ─────────────────────────────────────────────────
    /// @notice Create a vesting schedule.
    /// @dev Requires the contract to hold enough tokens to cover the allocation.
    function createSchedule(
        bytes32  scheduleId,
        address  beneficiary,
        uint256  totalAmount,
        uint256  tgeAmount,
        uint64   startTime,
        uint64   cliffMonths,
        uint64   vestingMonths
    ) external onlyOwner {
        if (schedules[scheduleId].status != Status.EMPTY) revert ScheduleAlreadyExists();
        if (beneficiary == address(0)) revert ZeroAddress();
        if (totalAmount == 0 && tgeAmount == 0) revert ZeroAllocation();
        if (totalAmount > 0 && vestingMonths == 0) revert ZeroVestingDuration();
        if (startTime <= block.timestamp) revert StartTimeInPast();

        uint64 cliffDuration = cliffMonths * MONTH;
        uint64 vestingDuration = vestingMonths * MONTH;

        // Ensure the contract has sufficient balance to back this new schedule.
        uint256 allocation = totalAmount + tgeAmount;
        if (token.balanceOf(address(this)) < totalAllocated + allocation) {
            revert InsufficientContractBalance();
        }
        totalAllocated += allocation;

        schedules[scheduleId] = Schedule({
            beneficiary:     beneficiary,
            totalAmount:     totalAmount,
            tgeAmount:       tgeAmount,
            startTime:       startTime,
            cliffDuration:   cliffDuration,
            vestingDuration: vestingDuration,
            released:        0,
            status:          Status.INITIALIZED
        });

        scheduleIds.push(scheduleId);
        emit ScheduleCreated(scheduleId, beneficiary, totalAmount, tgeAmount, startTime, cliffDuration, vestingDuration);
    }

    // ── Release ─────────────────────────────────────────────────────────────────
    function release(bytes32 scheduleId) external nonReentrant {
        Schedule storage s = schedules[scheduleId];
        if (s.status != Status.INITIALIZED) revert ScheduleNotFound();
        if (msg.sender != s.beneficiary) revert NotBeneficiary();

        uint256 amount = releasableAmount(scheduleId);
        if (amount == 0) revert NothingToRelease();

        s.released += amount;
        token.safeTransfer(msg.sender, amount);
        emit TokensReleased(scheduleId, msg.sender, amount);
    }

    // ── Cancel ──────────────────────────────────────────────────────────────────

    /// @notice Cancel a schedule & recover tokens (only before startTime).
    /// @dev Sets status to CANCELLED and removes the ID from scheduleIds.
    function cancelSchedule(bytes32 scheduleId) external onlyOwner {
        Schedule storage s = schedules[scheduleId];
        if (s.status != Status.INITIALIZED) revert ScheduleNotFound();
        if (block.timestamp >= s.startTime) revert ScheduleActive();

        uint256 total = s.totalAmount + s.tgeAmount;
        totalAllocated -= total;

        s.released = total;
        s.status = Status.CANCELLED;

        // Remove scheduleId from the scheduleIds array via swap-and-pop.
        uint256 len = scheduleIds.length;
        for (uint256 i = 0; i < len; i++) {
            if (scheduleIds[i] == scheduleId) {
                scheduleIds[i] = scheduleIds[len - 1];
                scheduleIds.pop();
                break;
            }
        }

        token.safeTransfer(owner(), total);
        emit ScheduleCancelled(scheduleId, total);
    }

    // ── Views ───────────────────────────────────────────────────────────────────
    function vestedAmount(bytes32 scheduleId) public view returns (uint256) {
        Schedule storage s = schedules[scheduleId];
        if (s.status != Status.INITIALIZED) return 0;
        return _vestedAmount(s);
    }

    function releasableAmount(bytes32 scheduleId) public view returns (uint256) {
        Schedule storage s = schedules[scheduleId];
        if (s.status != Status.INITIALIZED) return 0;
        uint256 vested = _vestedAmount(s);
        if (vested <= s.released) return 0;
        return vested - s.released;
    }

    function getSchedule(bytes32 scheduleId) external view returns (Schedule memory) {
        return schedules[scheduleId];
    }

    function getScheduleIds() external view returns (bytes32[] memory) {
        return scheduleIds;
    }

    // ── Internal ────────────────────────────────────────────────────────────────
    function _vestedAmount(Schedule storage s) private view returns (uint256) {
        uint64 ts = uint64(block.timestamp);
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
